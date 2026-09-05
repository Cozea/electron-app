import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import {
  DEV_APP_INSTALLATION_REGISTRY_VERSION,
  type DevAppInstallationRegistryV3,
  type DevAppInstallationSourceV3,
  type DevAppInstallationV3,
  type DevAppInstalledReleaseV3,
  type PreparedDevAppSurfaceV3,
} from "../../../../shared/devAppInstallationV3"
import {
  DEV_APP_RELEASE_MANIFEST_VERSION,
  type DevAppReleaseManifestV1,
  type DevAppSurfaceContributionV3,
} from "../../../../shared/devAppManifestV3"
import { buildNativeDevApp } from "../../../../scripts/devapps/native-builder"
export interface DevAppModuleRegistry {
  registerBuild(options: { registrationId: string; generation: string; root: string }): void
  releaseBuild(registrationId: string, generation?: string): boolean
  buildAssetUrl(registrationId: string, generation: string, assetPath: string): string
}

const REGISTRY_FILE = "registry.json"
const MAX_INSTALLATIONS = 256
const MAX_RELEASES_PER_INSTALLATION = 3
const HASH = /^[0-9a-f]{64}$/
const INSTALLATION_ID = /^[0-9a-f]{32}$/

interface PersistedRegistry {
  version: typeof DEV_APP_INSTALLATION_REGISTRY_VERSION
  installations: DevAppInstallationV3[]
}

export interface InstallDevelopmentDevAppOptions {
  workspaceId: string
  relativePath: string
  packageRoot: string
}

/**
 * Device-local install/update/rollback authority for manifest-v3 DevApps.
 *
 * Releases are immutable directories selected by one atomic registry pointer. Native
 * modules are registered only after every output hash has been verified. Source paths
 * stay in the development provenance record and are never used to launch an installation.
 */
export class DevAppInstallationService {
  private readonly getRoot: () => string
  private readonly modules: DevAppModuleRegistry
  private readonly listeners = new Set<(installations: DevAppInstallationV3[]) => void>()
  private loaded = false
  private registry: PersistedRegistry = emptyRegistry()

  constructor(getRoot: () => string, modules: DevAppModuleRegistry) {
    this.getRoot = getRoot
    this.modules = modules
  }

  list(): DevAppInstallationV3[] {
    this.ensureLoaded()
    return clone(this.registry.installations).sort((left, right) =>
      left.name.localeCompare(right.name),
    )
  }

  get(installationId: string): DevAppInstallationV3 | null {
    this.ensureLoaded()
    const installation = this.registry.installations.find(
      (candidate) => candidate.installationId === installationId,
    )
    return installation ? clone(installation) : null
  }

  onChange(listener: (installations: DevAppInstallationV3[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async installDevelopment(
    options: InstallDevelopmentDevAppOptions,
  ): Promise<DevAppInstallationV3> {
    this.ensureLoaded()
    const source: DevAppInstallationSourceV3 = {
      kind: "development",
      workspaceId: bounded(options.workspaceId, "The workspace ID", 256),
      relativePath: normalizeRelativePackagePath(options.relativePath),
    }
    const packageRoot = fs.realpathSync.native(options.packageRoot)
    if (!fs.statSync(packageRoot).isDirectory()) {
      throw new Error("The DevApp package root is not a directory.")
    }

    const root = this.root()
    const stagingRoot = path.join(root, "staging", randomUUID())
    const buildRoot = path.join(stagingRoot, "build")
    fs.mkdirSync(stagingRoot, { recursive: true })

    try {
      const built = await buildNativeDevApp({ packageRoot, outputRoot: buildRoot })
      await verifyReleaseDirectory(buildRoot, built.release)
      const releaseId = hashRelease(buildRoot)
      const installationId = deriveInstallationId(built.release.appId, source)
      const releaseRoot = this.releaseRoot(installationId, releaseId)
      const sizeBytes = directorySize(buildRoot)
      const now = Date.now()
      const installedRelease: DevAppInstalledReleaseV3 = {
        releaseId,
        appVersion: built.release.appVersion,
        installedAt: now,
        sizeBytes,
        manifest: clone(built.release),
      }

      fs.mkdirSync(path.dirname(releaseRoot), { recursive: true })
      if (!fs.existsSync(releaseRoot)) {
        fs.renameSync(buildRoot, releaseRoot)
      }

      const current = this.registry.installations.find(
        (candidate) => candidate.installationId === installationId,
      )
      const releases = dedupeReleases([installedRelease, ...(current?.releases ?? [])]).slice(
        0,
        MAX_RELEASES_PER_INSTALLATION,
      )
      const installation: DevAppInstallationV3 = {
        installationId,
        appId: built.release.appId,
        name: built.plan.manifest.name,
        description: built.plan.manifest.description ?? null,
        source,
        installedAt: current?.installedAt ?? now,
        updatedAt: now,
        activeReleaseId: releaseId,
        releases,
      }

      if (!current && this.registry.installations.length >= MAX_INSTALLATIONS) {
        throw new Error("This device has reached the DevApp installation limit.")
      }
      this.registry.installations = [
        ...this.registry.installations.filter(
          (candidate) => candidate.installationId !== installationId,
        ),
        installation,
      ]
      this.persist()
      this.registerActive(installation)
      this.pruneReleaseDirectories(installation)
      this.emit()
      return clone(installation)
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true })
    }
  }

  prepareSurface(installationId: string, surfaceId?: string | null): PreparedDevAppSurfaceV3 {
    this.ensureLoaded()
    const installation = this.requireInstallation(installationId)
    const release = activeRelease(installation)
    const surface = selectSurface(release.manifest.contributes.surfaces, surfaceId)
    const base = {
      installationId: installation.installationId,
      releaseId: release.releaseId,
      appId: installation.appId,
      appVersion: release.appVersion,
      surfaceId: surface.id,
      title: surface.title,
      ...(surface.description ? { description: surface.description } : {}),
      ...(surface.placement ? { placement: surface.placement } : {}),
      permissions: clone(release.manifest.permissions),
      contributions: clone(release.manifest.contributes),
    }

    if (surface.renderer.kind === "native-react") {
      const renderer = release.manifest.rendererModules?.[surface.renderer.module]
      if (!renderer) throw new Error("The installed native renderer module is missing.")
      this.registerActive(installation)
      return {
        ...base,
        kind: "nativeReact",
        component: surface.renderer.component,
        moduleUrl: this.modules.buildAssetUrl(
          installation.installationId,
          release.releaseId,
          renderer.entry,
        ),
        ...(renderer.styles
          ? {
              stylesUrl: this.modules.buildAssetUrl(
                installation.installationId,
                release.releaseId,
                renderer.styles,
              ),
            }
          : {}),
      }
    }

    const application = release.manifest.webApplications?.[surface.renderer.application]
    if (!application) throw new Error("The installed web application is missing.")
    if (application.kind !== "static") {
      throw new Error("This service-backed DevApp must start its runtime before opening.")
    }
    this.registerActive(installation)
    return {
      ...base,
      kind: "webApp",
      applicationId: surface.renderer.application,
      url: this.modules.buildAssetUrl(
        installation.installationId,
        release.releaseId,
        application.entry,
      ),
    }
  }

  activateRelease(installationId: string, releaseId: string): DevAppInstallationV3 {
    this.ensureLoaded()
    if (!HASH.test(releaseId)) throw new Error("The DevApp release ID is invalid.")
    const installation = this.requireInstallation(installationId)
    const release = installation.releases.find((candidate) => candidate.releaseId === releaseId)
    if (!release) throw new Error("That DevApp release is not installed.")
    if (!fs.existsSync(this.releaseRoot(installationId, releaseId))) {
      throw new Error("That DevApp release is missing from disk.")
    }
    installation.activeReleaseId = releaseId
    installation.updatedAt = Date.now()
    this.persist()
    this.registerActive(installation)
    this.emit()
    return clone(installation)
  }

  uninstall(installationId: string, removeData = false): boolean {
    this.ensureLoaded()
    if (!INSTALLATION_ID.test(installationId)) throw new Error("The installation ID is invalid.")
    const before = this.registry.installations.length
    this.registry.installations = this.registry.installations.filter(
      (candidate) => candidate.installationId !== installationId,
    )
    if (this.registry.installations.length === before) return false
    this.modules.releaseBuild(installationId)
    fs.rmSync(path.join(this.root(), "installations", installationId), {
      recursive: true,
      force: true,
    })
    if (removeData) {
      fs.rmSync(path.join(this.root(), "data", installationId), {
        recursive: true,
        force: true,
      })
    }
    this.persist()
    this.emit()
    return true
  }

  dispose(): void {
    if (this.loaded) {
      for (const installation of this.registry.installations) {
        this.modules.releaseBuild(installation.installationId)
      }
    }
    this.listeners.clear()
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    fs.mkdirSync(this.root(), { recursive: true })
    const registryPath = path.join(this.root(), REGISTRY_FILE)
    try {
      const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as unknown
      this.registry = validateRegistry(parsed)
    } catch {
      this.registry = emptyRegistry()
    }
    const valid: DevAppInstallationV3[] = []
    for (const installation of this.registry.installations) {
      try {
        this.registerActive(installation)
        valid.push(installation)
      } catch {
        // A torn/missing release cannot remain launch authority.
      }
    }
    if (valid.length !== this.registry.installations.length) {
      this.registry.installations = valid
      this.persist()
    }
  }

  private registerActive(installation: DevAppInstallationV3): void {
    const release = activeRelease(installation)
    const root = this.releaseRoot(installation.installationId, release.releaseId)
    if (!fs.statSync(root).isDirectory()) throw new Error("The active DevApp release is missing.")
    this.modules.registerBuild({
      registrationId: installation.installationId,
      generation: release.releaseId,
      root,
    })
  }

  private requireInstallation(installationId: string): DevAppInstallationV3 {
    if (!INSTALLATION_ID.test(installationId)) throw new Error("The installation ID is invalid.")
    const installation = this.registry.installations.find(
      (candidate) => candidate.installationId === installationId,
    )
    if (!installation) throw new Error("The DevApp is not installed.")
    return installation
  }

  private root(): string {
    const root = path.resolve(this.getRoot())
    fs.mkdirSync(root, { recursive: true })
    return root
  }

  private releaseRoot(installationId: string, releaseId: string): string {
    return path.join(this.root(), "installations", installationId, "releases", releaseId)
  }

  private persist(): void {
    const root = this.root()
    const destination = path.join(root, REGISTRY_FILE)
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(this.registry, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
    fs.renameSync(temporary, destination)
  }

  private pruneReleaseDirectories(installation: DevAppInstallationV3): void {
    const keep = new Set(installation.releases.map((release) => release.releaseId))
    const releasesRoot = path.dirname(this.releaseRoot(installation.installationId, "placeholder"))
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(releasesRoot, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || keep.has(entry.name)) continue
      fs.rmSync(path.join(releasesRoot, entry.name), { recursive: true, force: true })
    }
  }

  private emit(): void {
    const installations = this.list()
    for (const listener of this.listeners) listener(installations)
  }
}

function emptyRegistry(): PersistedRegistry {
  return { version: DEV_APP_INSTALLATION_REGISTRY_VERSION, installations: [] }
}

function deriveInstallationId(appId: string, source: DevAppInstallationSourceV3): string {
  return createHash("sha256")
    .update(`${appId}\0${JSON.stringify(source)}`)
    .digest("hex")
    .slice(0, 32)
}

function normalizeRelativePackagePath(value: string): string {
  if (typeof value !== "string" || value.includes("\0") || value.includes("\\")) {
    throw new Error("The DevApp relative path is invalid.")
  }
  const normalized = value.trim().replace(/^\.\//, "").replace(/\/$/, "") || "."
  if (path.posix.isAbsolute(normalized) || normalized.split("/").some((part) => part === "..")) {
    throw new Error("The DevApp relative path is invalid.")
  }
  return normalized
}

function bounded(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

function activeRelease(installation: DevAppInstallationV3): DevAppInstalledReleaseV3 {
  const release = installation.releases.find(
    (candidate) => candidate.releaseId === installation.activeReleaseId,
  )
  if (!release) throw new Error("The active DevApp release is invalid.")
  return release
}

function selectSurface(
  surfaces: DevAppSurfaceContributionV3[],
  requested?: string | null,
): DevAppSurfaceContributionV3 {
  const surface = requested
    ? surfaces.find((candidate) => candidate.id === requested)
    : surfaces.find((candidate) => candidate.default) ?? surfaces[0]
  if (!surface) throw new Error("The DevApp does not contribute that surface.")
  return surface
}

function dedupeReleases(releases: DevAppInstalledReleaseV3[]): DevAppInstalledReleaseV3[] {
  const result: DevAppInstalledReleaseV3[] = []
  const seen = new Set<string>()
  for (const release of releases) {
    if (seen.has(release.releaseId)) continue
    seen.add(release.releaseId)
    result.push(release)
  }
  return result.sort((left, right) => right.installedAt - left.installedAt)
}

function validateRegistry(value: unknown): PersistedRegistry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyRegistry()
  const candidate = value as Partial<DevAppInstallationRegistryV3>
  if (candidate.version !== DEV_APP_INSTALLATION_REGISTRY_VERSION || !Array.isArray(candidate.installations)) {
    return emptyRegistry()
  }
  const installations: DevAppInstallationV3[] = []
  for (const installation of candidate.installations.slice(0, MAX_INSTALLATIONS)) {
    if (!isInstallation(installation)) continue
    installations.push(clone(installation))
  }
  return { version: DEV_APP_INSTALLATION_REGISTRY_VERSION, installations }
}

function isInstallation(value: unknown): value is DevAppInstallationV3 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Partial<DevAppInstallationV3>
  if (
    !INSTALLATION_ID.test(candidate.installationId ?? "") ||
    typeof candidate.appId !== "string" ||
    typeof candidate.name !== "string" ||
    !HASH.test(candidate.activeReleaseId ?? "") ||
    !Array.isArray(candidate.releases) ||
    candidate.releases.length === 0 ||
    candidate.releases.length > MAX_RELEASES_PER_INSTALLATION
  ) {
    return false
  }
  return candidate.releases.every((release) => {
    if (!release || typeof release !== "object") return false
    const typed = release as Partial<DevAppInstalledReleaseV3>
    return (
      HASH.test(typed.releaseId ?? "") &&
      typeof typed.appVersion === "string" &&
      typeof typed.installedAt === "number" &&
      typeof typed.sizeBytes === "number" &&
      isReleaseManifest(typed.manifest)
    )
  })
}

function isReleaseManifest(value: unknown): value is DevAppReleaseManifestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Partial<DevAppReleaseManifestV1>
  return (
    candidate.releaseManifestVersion === DEV_APP_RELEASE_MANIFEST_VERSION &&
    typeof candidate.appId === "string" &&
    typeof candidate.appVersion === "string" &&
    candidate.nativeApi === 1 &&
    Boolean(candidate.contributes && Array.isArray(candidate.contributes.surfaces))
  )
}

async function verifyReleaseDirectory(
  root: string,
  release: DevAppReleaseManifestV1,
): Promise<void> {
  if (!isReleaseManifest(release)) throw new Error("The generated DevApp release is invalid.")
  const integrityPath = path.join(root, "integrity.json")
  const parsed = JSON.parse(fs.readFileSync(integrityPath, "utf8")) as {
    algorithm?: unknown
    files?: unknown
  }
  if (parsed.algorithm !== "sha256" || !parsed.files || typeof parsed.files !== "object") {
    throw new Error("The DevApp integrity manifest is invalid.")
  }
  const declared = parsed.files as Record<string, unknown>
  const actual = listFiles(root)
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .filter((file) => file !== "integrity.json")
    .sort()
  if (actual.length !== Object.keys(declared).length) {
    throw new Error("The DevApp integrity manifest is incomplete.")
  }
  for (const relative of actual) {
    const expected = declared[relative]
    if (typeof expected !== "string" || !HASH.test(expected)) {
      throw new Error(`The DevApp integrity entry is invalid: ${relative}`)
    }
    const actualHash = createHash("sha256")
      .update(fs.readFileSync(path.join(root, ...relative.split("/"))))
      .digest("hex")
    if (actualHash !== expected) throw new Error(`DevApp integrity check failed: ${relative}`)
  }
}

function hashRelease(root: string): string {
  return createHash("sha256")
    .update(fs.readFileSync(path.join(root, "release.json")))
    .update("\0")
    .update(fs.readFileSync(path.join(root, "integrity.json")))
    .digest("hex")
}

function listFiles(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error("Installed DevApp output contains a symlink.")
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(absolute)
    }
  }
  visit(root)
  return files.sort()
}

function directorySize(root: string): number {
  return listFiles(root).reduce((total, file) => total + fs.statSync(file).size, 0)
}

function clone<Value>(value: Value): Value {
  return structuredClone(value)
}
