import type { OrgDevAppPreflightReport } from "../../../../shared/orgDevAppDiagnostics"
import { grantFingerprint, type DevAppGrant } from "../../../../shared/devAppCapabilities"
import {
  NATIVE_DEV_APP_MANIFEST_FILENAME,
  defaultNativeDevAppSurface,
  parseNativeDevAppManifest,
  rendererModuleForSurface,
  requestedNativeDevAppGrant,
  type NativeDevAppManifestV3,
} from "../../../../shared/nativeDevAppManifest"
import {
  developmentTrustBadge,
  type DevAppDevelopmentTrustStore,
} from "../../../../shared/devAppDevelopmentTrust"
import type { DevAppPreviewStatus, DevAppPreviewView } from "../../../../shared/devAppPreviewTypes"
import type {
  DevAppWorkerBinding,
  DevAppWorkerState,
  DevAppWorkerStateChange,
  DevAppWorkerTransferablePort,
} from "./DevAppWorkerHost"
import type { DevAppWorkerViewPortBootstrap } from "../../../../shared/devAppWorkerProtocol"
import { buildDevAppPreviewUrl } from "../../../../shared/devAppPreviewProtocol"
import { validateDevAppToolInput } from "../../../../shared/devAppToolInputValidation"

/** Injected so the session is testable without a real tree, clock, or Electron. */
export interface DevAppPreviewFs {
  readFile: (absolutePath: string) => string | null
  exists: (absolutePath: string) => boolean
  /** Resolves symlinks. Returns null when the path does not exist. */
  realpath: (absolutePath: string) => string | null
}

export interface DevAppPreviewWorkerHost {
  start: (options: {
    publicationId: string
    entrypoint: string
    packageRoot: string
    protocolVersion: number
    grant: DevAppGrant
    authorizationExpiresAt: number | null
    binding: DevAppWorkerBinding
    leaseId: string
    declaredToolNames?: string[]
  }) => DevAppWorkerState
  invoke?: (
    publicationId: string,
    method: string,
    params: unknown,
    timeoutMs?: number,
  ) => Promise<unknown>
  stop: (publicationId: string) => void
  release: (publicationId: string, leaseId: string) => void
  getState: (publicationId: string) => DevAppWorkerState | null
  attachViewPort: (
    publicationId: string,
    connectionId: string,
    protocolVersion: number,
    port: DevAppWorkerTransferablePort,
  ) => DevAppWorkerViewPortBootstrap
  detachViewPort: (publicationId: string, connectionId: string) => void
  onStateChange?: (listener: (change: DevAppWorkerStateChange) => void) => () => void
}

export interface DevAppPreviewDeps {
  fs: DevAppPreviewFs
  join: (...parts: string[]) => string
  resolve: (value: string) => string
  /** Derives the opaque source id. Must be stable for a path and not reveal it. */
  hashPath: (absolutePath: string) => string
  preflight: (projectRoot: string) => OrgDevAppPreflightReport
  trust: DevAppDevelopmentTrustStore
  worker: DevAppPreviewWorkerHost
}

export interface DevAppPreviewOpenOptions {
  /** Absolute path to the directory holding cozea-devapp.json. */
  sourcePath: string
  workspaceId: string
  workspaceRoot: string
  /** Held for as long as the tile or agent session is open. */
  leaseId: string
}

interface OpenSession {
  sourceId: string
  sourcePath: string
  binding: DevAppWorkerBinding
  leases: Set<string>
  manifest: NativeDevAppManifestV3
  workerKey: string | null
  workerProtocolVersion: number | null
  reloadToken: number
}

const MAX_OPEN_PREVIEW_SESSIONS = 64
const MAX_LEASES_PER_PREVIEW = 64

/** Keeps development workers in a namespace disjoint from published release refs. */
export function developmentWorkerKey(sourceId: string): string {
  return `dev:${sourceId}`
}

export class DevAppPreviewSession {
  private readonly deps: DevAppPreviewDeps
  private readonly sessions = new Map<string, OpenSession>()

  constructor(deps: DevAppPreviewDeps) {
    this.deps = deps
  }

  async invokeTool(
    sourceId: string,
    name: string,
    input: unknown,
    timeoutMs?: number,
  ): Promise<unknown> {
    const session = this.sessions.get(sourceId)
    const tool = session?.manifest.extension?.tools.find((candidate) => candidate.name === name)
    if (!session || !tool || !session.workerKey) {
      throw new Error("The development DevApp did not declare a running tool with that name.")
    }
    const inputError = validateDevAppToolInput(tool.inputSchema, input)
    if (inputError) throw new Error(inputError)
    if (!this.deps.worker.invoke) {
      throw new Error("The development DevApp extension cannot accept tool invocations.")
    }
    return await this.deps.worker.invoke(session.workerKey, tool.name, input, timeoutMs)
  }

  open(options: DevAppPreviewOpenOptions): DevAppPreviewStatus {
    if (!/^[A-Za-z0-9_-]{1,192}$/.test(options.leaseId)) {
      throw new Error("The DevApp preview lease is invalid.")
    }
    const unresolvedSourcePath = this.deps.resolve(options.sourcePath)
    const unresolvedWorkspaceRoot = this.deps.resolve(options.workspaceRoot)
    const sourcePath = this.deps.fs.realpath(unresolvedSourcePath)
    const workspaceRoot = this.deps.fs.realpath(unresolvedWorkspaceRoot)

    if (!sourcePath || !workspaceRoot || !isInside(workspaceRoot, sourcePath)) {
      return {
        status: "invalid",
        diagnostics: [
          {
            code: "manifest-path-escapes-package",
            severity: "blocker",
            message: "A DevApp can only be previewed from inside the project it belongs to.",
            fix: "Move the package into this project, or open the project that holds it.",
          },
        ],
      }
    }

    const manifestPath = this.deps.join(sourcePath, NATIVE_DEV_APP_MANIFEST_FILENAME)
    const source = this.deps.fs.readFile(manifestPath)
    if (source === null) {
      return {
        status: "invalid",
        diagnostics: [
          {
            code: "manifest-unparsable",
            severity: "blocker",
            message: `This folder has no ${NATIVE_DEV_APP_MANIFEST_FILENAME}.`,
            fix: `Add a version 3 ${NATIVE_DEV_APP_MANIFEST_FILENAME} describing its native React surfaces.`,
          },
        ],
      }
    }

    const parsed = parseNativeDevAppManifest(source)
    if (!parsed.manifest) return { status: "invalid", diagnostics: parsed.diagnostics }

    const sourceId = this.deps.hashPath(sourcePath)
    const existing = this.sessions.get(sourceId)
    if (existing) {
      if (
        existing.sourcePath !== sourcePath ||
        existing.binding.workspaceId !== options.workspaceId ||
        existing.binding.workspaceRoot !== workspaceRoot
      ) {
        throw new Error("This DevApp preview is already bound to another workspace.")
      }
      if (!existing.leases.has(options.leaseId) && existing.leases.size >= MAX_LEASES_PER_PREVIEW) {
        throw new Error("This DevApp preview has too many active surfaces.")
      }
      existing.manifest = parsed.manifest
      existing.leases.add(options.leaseId)
      return this.settle(existing)
    }
    if (this.sessions.size >= MAX_OPEN_PREVIEW_SESSIONS) {
      throw new Error("Too many DevApp previews are open.")
    }
    const session: OpenSession = {
      sourceId,
      sourcePath,
      binding: {
        workspaceId: options.workspaceId,
        workspaceRoot,
      },
      leases: new Set([options.leaseId]),
      manifest: parsed.manifest,
      workerKey: null,
      workerProtocolVersion: null,
      reloadToken: 0,
    }
    this.sessions.set(sourceId, session)
    return this.settle(session)
  }

  /** Re-reads the manifest and advances the immutable module generation. */
  reload(sourceId: string): DevAppPreviewStatus | null {
    const session = this.sessions.get(sourceId)
    if (!session) return null
    const invalid = this.refreshManifest(session, true)
    return invalid ?? this.settle(session)
  }

  private refreshManifest(
    session: OpenSession,
    advanceReloadToken: boolean,
  ): DevAppPreviewStatus | null {
    const source = this.deps.fs.readFile(
      this.deps.join(session.sourcePath, NATIVE_DEV_APP_MANIFEST_FILENAME),
    )
    if (source === null) {
      this.stopWorker(session)
      return {
        status: "invalid",
        diagnostics: [
          {
            code: "manifest-unparsable",
            severity: "blocker",
            message: `${NATIVE_DEV_APP_MANIFEST_FILENAME} is no longer there.`,
          },
        ],
      }
    }
    const parsed = parseNativeDevAppManifest(source)
    if (!parsed.manifest) {
      this.stopWorker(session)
      return { status: "invalid", diagnostics: parsed.diagnostics }
    }
    const previousGrant = requestedNativeDevAppGrant(session.manifest)
    const nextGrant = requestedNativeDevAppGrant(parsed.manifest)
    session.manifest = parsed.manifest
    if (grantFingerprint(previousGrant) !== grantFingerprint(nextGrant)) {
      this.stopWorker(session)
    }
    if (advanceReloadToken) session.reloadToken += 1
    return null
  }

  status(sourceId: string): DevAppPreviewStatus | null {
    const session = this.sessions.get(sourceId)
    return session ? this.settle(session) : null
  }

  workerConnection(sourceId: string): {
    workerKey: string
    protocolVersion: number
  } | null {
    const session = this.sessions.get(sourceId)
    if (!session?.workerKey || session.workerProtocolVersion === null) return null
    const state = this.deps.worker.getState(session.workerKey)
    if (
      !state ||
      state.status !== "ready" ||
      state.protocolVersion !== session.workerProtocolVersion
    ) {
      return null
    }
    return {
      workerKey: session.workerKey,
      protocolVersion: session.workerProtocolVersion,
    }
  }

  attachViewPort(
    sourceId: string,
    connectionId: string,
    port: DevAppWorkerTransferablePort,
  ): DevAppWorkerViewPortBootstrap {
    const connection = this.workerConnection(sourceId)
    if (!connection) throw new Error("This DevApp preview has no available extension worker.")
    return this.deps.worker.attachViewPort(
      connection.workerKey,
      connectionId,
      connection.protocolVersion,
      port,
    )
  }

  detachViewPort(sourceId: string, connectionId: string): void {
    const session = this.sessions.get(sourceId)
    if (session?.workerKey) this.deps.worker.detachViewPort(session.workerKey, connectionId)
  }

  /** Releases one surface lease, or every lease during application shutdown. */
  close(sourceId: string, leaseId?: string): boolean {
    const session = this.sessions.get(sourceId)
    if (!session) return true
    const released = leaseId ? [leaseId] : [...session.leases]
    for (const lease of released) {
      session.leases.delete(lease)
      if (session.workerKey) this.deps.worker.release(session.workerKey, lease)
    }
    if (session.leases.size > 0) return false
    this.sessions.delete(sourceId)
    return true
  }

  approve(sourceId: string, expectedGrantFingerprint: string): DevAppPreviewStatus | null {
    const session = this.sessions.get(sourceId)
    if (!session) return null
    const invalid = this.refreshManifest(session, false)
    if (invalid) return invalid
    const requested = requestedNativeDevAppGrant(session.manifest)
    if (grantFingerprint(requested) !== expectedGrantFingerprint) {
      return this.settle(session)
    }
    this.deps.trust.approve(sourceId, requested)
    return this.settle(session)
  }

  private settle(session: OpenSession): DevAppPreviewStatus {
    const requested = requestedNativeDevAppGrant(session.manifest)
    const extensionExecution = session.manifest.extension !== undefined
    const trust = this.deps.trust.resolve(session.sourceId, requested, {
      requireExplicitApproval: extensionExecution,
    })
    const preflight = this.deps.preflight(session.sourcePath)
    const defaultBadge = developmentTrustBadge(trust)
    const badge = extensionExecution
      ? {
          ...defaultBadge,
          detail:
            trust.status === "approved"
              ? "Unpublished extension code is running out of process with the capabilities shown."
              : "Unpublished extension code requires approval before it can run.",
        }
      : defaultBadge

    if (trust.status !== "approved") {
      this.stopWorker(session)
      return {
        status: "needsApproval",
        sourceId: session.sourceId,
        name: session.manifest.name,
        requested,
        declaredTools: session.manifest.extension?.tools ?? [],
        workerExecution: extensionExecution,
        approvalFingerprint: grantFingerprint(requested),
        missing: trust.status === "unapproved" ? [...trust.missing] : [...requested.capabilities],
        badge,
        preflight,
      }
    }

    return {
      status: "running",
      sourceId: session.sourceId,
      name: session.manifest.name,
      view: this.resolveView(session),
      grant: trust.effective,
      declaredTools: session.manifest.extension?.tools ?? [],
      badge,
      preflight,
      worker: this.ensureWorker(
        session,
        trust.effective,
        extensionExecution ? trust.expiresAt : null,
      ),
      reloadToken: session.reloadToken,
    }
  }

  private resolveView(session: OpenSession): DevAppPreviewView {
    const surface = defaultNativeDevAppSurface(session.manifest)
    if (surface.renderer.kind === "native-react") {
      const renderer = rendererModuleForSurface(session.manifest, surface)
      if (!renderer) {
        return {
          kind: "unavailable",
          reason: `The ${surface.id} surface has no renderer module.`,
        }
      }
      if (!this.confine(session, renderer.output)) {
        return {
          kind: "unavailable",
          reason: `${renderer.output} is not in the package.`,
          fix: `Run \`bun run build\` or \`bun run dev\` so the native ESM output exists.`,
        }
      }
      const stylesUrl =
        renderer.styles && this.confine(session, renderer.styles.output)
          ? buildDevAppPreviewUrl(session.sourceId, renderer.styles.output)
          : undefined
      return {
        kind: "nativeReact",
        appId: session.manifest.id,
        appVersion: session.manifest.version,
        surfaceId: surface.id,
        moduleUrl: buildDevAppPreviewUrl(session.sourceId, renderer.output),
        component: surface.renderer.component,
        ...(stylesUrl ? { stylesUrl } : {}),
      }
    }

    const application = session.manifest.webApplications?.[surface.renderer.application]
    if (!application) {
      return {
        kind: "unavailable",
        reason: `The ${surface.id} surface has no web application.`,
      }
    }
    if (application.dev?.url) return { kind: "devServer", url: application.dev.url }
    if (application.entry && this.confine(session, application.entry)) {
      return {
        kind: "builtOutput",
        entryPath: application.entry,
        url: buildDevAppPreviewUrl(session.sourceId, application.entry),
      }
    }
    return {
      kind: "unavailable",
      reason: application.service
        ? "This web application requires its contained service to be running."
        : "The web application has no built entry to show.",
      fix: application.dev?.command
        ? `Run \`${application.dev.command}\` or build the declared web application.`
        : "Build the declared web application output.",
    }
  }

  private ensureWorker(
    session: OpenSession,
    grant: DevAppGrant,
    authorizationExpiresAt: number | null,
  ): DevAppWorkerState | null {
    const extension = session.manifest.extension
    if (!extension) {
      this.stopWorker(session)
      return null
    }
    const entrypoint = this.confine(session, extension.output)
    if (!entrypoint) {
      this.stopWorker(session)
      return null
    }
    const key = developmentWorkerKey(session.sourceId)
    if (
      session.workerKey === key &&
      session.workerProtocolVersion !== null &&
      session.workerProtocolVersion !== extension.protocolVersion
    ) {
      this.stopWorker(session)
    }
    let state: DevAppWorkerState | null = null
    for (const leaseId of session.leases) {
      state = this.deps.worker.start({
        publicationId: key,
        entrypoint,
        packageRoot: session.sourcePath,
        protocolVersion: extension.protocolVersion,
        grant,
        authorizationExpiresAt,
        binding: session.binding,
        leaseId,
        declaredToolNames: extension.tools.map((tool) => tool.name),
      })
    }
    session.workerKey = key
    session.workerProtocolVersion = extension.protocolVersion
    return state
  }

  private stopWorker(session: OpenSession): void {
    if (!session.workerKey) return
    this.deps.worker.stop(session.workerKey)
    session.workerKey = null
    session.workerProtocolVersion = null
  }

  /** Resolves a manifest path through symlinks and keeps it inside the package. */
  private confine(session: OpenSession, relativePath: string): string | null {
    const candidate = this.deps.join(session.sourcePath, relativePath)
    if (!this.deps.fs.exists(candidate)) return null
    const real = this.deps.fs.realpath(candidate)
    if (!real) return null
    const realRoot = this.deps.fs.realpath(session.sourcePath) ?? session.sourcePath
    return isInside(realRoot, real) ? real : null
  }
}

/** Accepts either separator so the check does not depend on the host platform. */
function isInside(root: string, candidate: string): boolean {
  if (candidate === root) return true
  const trimmed = root.replace(/[/\\]+$/, "")
  if (!candidate.startsWith(trimmed)) return false
  const next = candidate.charAt(trimmed.length)
  return next === "/" || next === "\\"
}

export type { DevAppPreviewStatus, DevAppPreviewView }
