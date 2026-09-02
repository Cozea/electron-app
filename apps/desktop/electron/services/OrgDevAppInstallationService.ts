import fs from "node:fs"
import path from "node:path"

import type {
  OrgDevAppInstallRequest,
  OrgDevAppInstallation,
  OrgDevAppInstalledArtifact,
} from "../../../../shared/orgDevAppInstallation"
import { formatDevAppRef, parseDevAppRef } from "../../../../shared/devAppRef"
import { isContentHash, normalizeContentHash, normalizeEntryPath } from "../../../../shared/orgDevAppProtocol"
import type { OrgDevAppArtifactService } from "./OrgDevAppArtifactService"
import {
  validateDevAppRuntimeReleaseImage,
  type DevAppRuntimeReleaseImage,
} from "../../../../shared/devAppContainedRuntime"

interface InstallationRegistry {
  version: 1
  activeByPublication: Record<string, string>
  installations: OrgDevAppInstallation[]
}

const EMPTY_REGISTRY: InstallationRegistry = {
  version: 1,
  activeByPublication: {},
  installations: [],
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const MAX_INSTALLATIONS = 256

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength || /\0/.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

function optionalString(value: unknown, label: string, maxLength: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "string" || value.length > maxLength || /\0/.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

function assertSegment(value: unknown, label: string): string {
  const checked = boundedString(value, label, 128)
  if (!SEGMENT.test(checked)) throw new Error(`${label} is invalid.`)
  return checked
}

function validateInstallation(
  raw: Omit<OrgDevAppInstallation, "active" | "installedAt" | "lastUsedAt" | "sizeBytes">,
): Omit<OrgDevAppInstallation, "active" | "installedAt" | "lastUsedAt" | "sizeBytes"> {
  const parsed = parseDevAppRef(raw.ref)
  if (parsed?.kind !== "publication" || parsed.version === "latest") {
    throw new Error("Installed DevApps require an exact release reference.")
  }
  const publicationId = assertSegment(raw.publicationId, "The publication ID")
  const organizationId = assertSegment(raw.organizationId, "The organization ID")
  if (parsed.publicationId !== publicationId || parsed.organizationId !== organizationId) {
    throw new Error("The installed DevApp reference does not match its publication.")
  }
  if (!Number.isSafeInteger(raw.activeRelease.version) || raw.activeRelease.version < 1) {
    throw new Error("The DevApp release version is invalid.")
  }
  if (parsed.version !== raw.activeRelease.version) {
    throw new Error("The installed DevApp reference does not match its release version.")
  }
  const contentHash = normalizeContentHash(raw.activeRelease.contentHash)
  if (!isContentHash(contentHash)) throw new Error("The DevApp artifact hash is invalid.")
  if (raw.activeRelease.runtimeKind !== "static" && raw.activeRelease.runtimeKind !== "service") {
    throw new Error("The DevApp runtime kind is invalid.")
  }
  const parts = raw.activeRelease.parts
  if (!parts || typeof parts !== "object" || Array.isArray(parts)) {
    throw new Error("The DevApp release parts are invalid.")
  }
  const executable = Boolean(parts.worker || parts.service?.runtimeKind === "node")
  const runtimeSourceDigest = optionalString(raw.activeRelease.runtimeSourceDigest, "The runtime source digest", 64)
  const packageManifestDigest = optionalString(
    raw.activeRelease.packageManifestDigest,
    "The package manifest digest",
    71,
  )
  const runtimeImage = raw.activeRelease.runtimeImage as DevAppRuntimeReleaseImage | null
  if (executable) {
    if (
      !runtimeSourceDigest ||
      !/^[a-f0-9]{64}$/.test(runtimeSourceDigest) ||
      !packageManifestDigest ||
      !/^sha256:[a-f0-9]{64}$/.test(packageManifestDigest) ||
      !runtimeImage
    ) {
      throw new Error("The executable DevApp release has no contained runtime image.")
    }
    const imageError = validateDevAppRuntimeReleaseImage(runtimeImage, {
      sourceDigest: runtimeSourceDigest,
      packageManifestDigest,
    })
    if (imageError) throw new Error(imageError)
  } else if (runtimeSourceDigest || packageManifestDigest || runtimeImage) {
    throw new Error("A static DevApp release cannot carry executable runtime authority.")
  }
  return {
    ref: formatDevAppRef({ ...parsed, version: raw.activeRelease.version }),
    publicationId,
    organizationId,
    organizationName: boundedString(raw.organizationName, "The organization name", 200),
    name: boundedString(raw.name, "The DevApp name", 120),
    description: optionalString(raw.description, "The DevApp description", 500),
    logoDataUrl: optionalString(raw.logoDataUrl, "The DevApp logo", 2_000_000),
    activeRelease: {
      id: assertSegment(raw.activeRelease.id, "The release ID"),
      version: raw.activeRelease.version,
      framework: boundedString(raw.activeRelease.framework, "The framework", 120),
      entryPath: normalizeEntryPath(raw.activeRelease.entryPath),
      contentHash,
      runtimeKind: raw.activeRelease.runtimeKind,
      manifestVersion: raw.activeRelease.manifestVersion,
      platform: optionalString(raw.activeRelease.platform, "The release platform", 64),
      arch: optionalString(raw.activeRelease.arch, "The release architecture", 64),
      permissionSetHash: optionalString(raw.activeRelease.permissionSetHash, "The permission set hash", 128),
      publisherIdentityKey: optionalString(raw.activeRelease.publisherIdentityKey, "The publisher identity", 256),
      publisherDeviceLabel: optionalString(raw.activeRelease.publisherDeviceLabel, "The publisher device", 200),
      parts,
      runtimeSourceDigest,
      packageManifestDigest,
      runtimeImage: runtimeImage ?? null,
    },
  }
}

export class OrgDevAppInstallationService {
  private readonly listeners = new Set<(installations: OrgDevAppInstallation[]) => void>()
  private readonly getRegistryPath: () => string
  private readonly artifacts: OrgDevAppArtifactService

  constructor(getRegistryPath: () => string, artifacts: OrgDevAppArtifactService) {
    this.getRegistryPath = getRegistryPath
    this.artifacts = artifacts
    this.artifacts.setProtectedContentHashes(
      () => new Set(this.readRegistry().installations.map((entry) => entry.activeRelease.contentHash)),
    )
  }

  list(): OrgDevAppInstallation[] {
    const registry = this.readRegistry()
    return registry.installations
      .map((entry) => ({
        ...entry,
        active: registry.activeByPublication[entry.publicationId] === entry.ref,
      }))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) || right.activeRelease.version - left.activeRelease.version,
      )
  }

  resolve(ref: string): OrgDevAppInstallation | null {
    const parsed = parseDevAppRef(ref)
    if (parsed?.kind !== "publication") return null
    const registry = this.readRegistry()
    const exactRef =
      parsed.version === "latest" ? registry.activeByPublication[parsed.publicationId] : formatDevAppRef(parsed)
    if (!exactRef) return null
    const entry = registry.installations.find((candidate) => candidate.ref === exactRef)
    return entry ? { ...entry, active: registry.activeByPublication[entry.publicationId] === entry.ref } : null
  }

  async install(request: OrgDevAppInstallRequest): Promise<OrgDevAppInstallation> {
    const metadata = validateInstallation(request.installation)
    const prepared = await this.artifacts.prepareArtifact({
      downloadUrl: boundedString(request.downloadUrl, "The artifact download URL", 4096),
      contentHash: metadata.activeRelease.contentHash,
      entryPath: metadata.activeRelease.entryPath,
      runtimeKind: metadata.activeRelease.runtimeKind,
    })
    const now = Date.now()
    const registry = this.readRegistry()
    const existing = registry.installations.find((entry) => entry.ref === metadata.ref)
    const installation: OrgDevAppInstallation = {
      ...metadata,
      active: true,
      installedAt: existing?.installedAt ?? now,
      lastUsedAt: now,
      sizeBytes: this.artifacts.getPreparedArtifactSize(prepared.contentHash),
    }
    const installations = registry.installations.filter((entry) => entry.ref !== installation.ref)
    if (installations.length >= MAX_INSTALLATIONS) {
      throw new Error("Too many DevApp releases are installed on this device.")
    }
    installations.push(installation)
    this.writeRegistry({
      version: 1,
      installations,
      activeByPublication: {
        ...registry.activeByPublication,
        [installation.publicationId]: installation.ref,
      },
    })
    this.emit()
    return this.resolve(installation.ref)!
  }

  async prepare(ref: string): Promise<OrgDevAppInstalledArtifact> {
    const installation = this.resolve(ref)
    if (!installation) throw new Error("This DevApp release is not installed on this device.")
    const prepared = this.artifacts.prepareCachedArtifact({
      contentHash: installation.activeRelease.contentHash,
      entryPath: installation.activeRelease.entryPath,
      runtimeKind: installation.activeRelease.runtimeKind,
    })
    const registry = this.readRegistry()
    const stored = registry.installations.find((entry) => entry.ref === installation.ref)
    if (stored) {
      stored.lastUsedAt = Date.now()
      stored.sizeBytes = this.artifacts.getPreparedArtifactSize(stored.activeRelease.contentHash)
      this.writeRegistry(registry)
    }
    return {
      installation: { ...installation, lastUsedAt: stored?.lastUsedAt ?? installation.lastUsedAt },
      originUrl: prepared.originUrl,
      ...(prepared.manifest ? { servicePermissions: prepared.manifest.permissions } : {}),
    }
  }

  uninstallPublication(publicationIdInput: string): number {
    const publicationId = assertSegment(publicationIdInput, "The publication ID")
    const registry = this.readRegistry()
    const removed = registry.installations.filter((entry) => entry.publicationId === publicationId)
    if (removed.length === 0) return 0
    const installations = registry.installations.filter((entry) => entry.publicationId !== publicationId)
    const activeByPublication = { ...registry.activeByPublication }
    delete activeByPublication[publicationId]
    this.writeRegistry({ version: 1, installations, activeByPublication })
    const retainedHashes = new Set(installations.map((entry) => entry.activeRelease.contentHash))
    for (const entry of removed) {
      if (!retainedHashes.has(entry.activeRelease.contentHash)) {
        this.artifacts.removePreparedArtifact(entry.activeRelease.contentHash)
      }
    }
    this.emit()
    return removed.length
  }

  removeVersion(ref: string): boolean {
    const installation = this.resolve(ref)
    if (!installation) return false
    const registry = this.readRegistry()
    const installations = registry.installations.filter((entry) => entry.ref !== installation.ref)
    const activeByPublication = { ...registry.activeByPublication }
    if (activeByPublication[installation.publicationId] === installation.ref) {
      const replacement = installations
        .filter((entry) => entry.publicationId === installation.publicationId)
        .sort((left, right) => right.activeRelease.version - left.activeRelease.version)[0]
      if (replacement) activeByPublication[installation.publicationId] = replacement.ref
      else delete activeByPublication[installation.publicationId]
    }
    this.writeRegistry({ version: 1, installations, activeByPublication })
    if (!installations.some((entry) => entry.activeRelease.contentHash === installation.activeRelease.contentHash)) {
      this.artifacts.removePreparedArtifact(installation.activeRelease.contentHash)
    }
    this.emit()
    return true
  }

  onChange(listener: (installations: OrgDevAppInstallation[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const installations = this.list()
    for (const listener of this.listeners) listener(installations)
  }

  private readRegistry(): InstallationRegistry {
    const registryPath = this.getRegistryPath()
    if (!fs.existsSync(registryPath)) return { ...EMPTY_REGISTRY, activeByPublication: {}, installations: [] }
    try {
      const raw = JSON.parse(fs.readFileSync(registryPath, "utf8")) as Partial<InstallationRegistry>
      if (
        raw.version !== 1 ||
        !Array.isArray(raw.installations) ||
        !raw.activeByPublication ||
        typeof raw.activeByPublication !== "object"
      ) {
        throw new Error("invalid registry")
      }
      const installations = raw.installations.slice(0, MAX_INSTALLATIONS).map((entry) => {
        const validated = validateInstallation(entry)
        const installedAt = Number.isFinite(entry.installedAt) ? entry.installedAt : Date.now()
        const lastUsedAt = Number.isFinite(entry.lastUsedAt) ? entry.lastUsedAt : installedAt
        const sizeBytes = Number.isFinite(entry.sizeBytes) && entry.sizeBytes >= 0 ? entry.sizeBytes : 0
        return { ...validated, active: false, installedAt, lastUsedAt, sizeBytes }
      })
      return {
        version: 1,
        installations,
        activeByPublication: Object.fromEntries(
          Object.entries(raw.activeByPublication).filter(
            (entry): entry is [string, string] =>
              SEGMENT.test(entry[0]) &&
              typeof entry[1] === "string" &&
              installations.some((candidate) => candidate.ref === entry[1]),
          ),
        ),
      }
    } catch {
      throw new Error("The local DevApp installation registry is invalid.")
    }
  }

  private writeRegistry(registry: InstallationRegistry): void {
    const registryPath = this.getRegistryPath()
    fs.mkdirSync(path.dirname(registryPath), { recursive: true })
    const temporary = `${registryPath}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(registry, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, registryPath)
  }
}
