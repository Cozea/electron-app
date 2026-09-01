import type { OrgDevAppPreflightReport } from "../../../../shared/orgDevAppDiagnostics"
import { grantFingerprint, type DevAppGrant } from "../../../../shared/devAppCapabilities"
import {
  DEV_APP_MANIFEST_FILENAME,
  parseDevAppPackage,
  requestedGrant,
  type DevAppPackage,
} from "../../../../shared/devAppPackage"
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

/**
 * Runs an unpublished DevApp from a local directory.
 *
 * This is the authoring loop. Its one non-negotiable property is that development runs
 * the intended view, worker protocol, and preflight contracts: the manifest is parsed by
 * the shared parser, capabilities are gated by the versioned host, and preflight is the
 * same check publishing performs. Published worker execution remains disconnected until
 * its container runtime exists; this local process is not represented as that sandbox.
 *
 * Preflight therefore runs continuously rather than at publish time. A developer iterating
 * against a dev server gets hot reload, but is told the whole time whether what they have
 * would actually publish — which is the failure this rebuild exists to remove.
 */

/** Injected so the session is testable without a real tree, a real clock, or Electron. */
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
  }) => DevAppWorkerState
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
  manifest: DevAppPackage
  workerKey: string | null
  workerProtocolVersion: number | null
  reloadToken: number
}

const MAX_OPEN_PREVIEW_SESSIONS = 64
const MAX_LEASES_PER_PREVIEW = 64

/**
 * Namespaces the worker host key.
 *
 * The host keys workers by publication id. A development source is not a publication, and
 * a prefix is what keeps a working tree from ever addressing a running published worker —
 * or being addressed as one.
 */
export function developmentWorkerKey(sourceId: string): string {
  return `dev:${sourceId}`
}

export class DevAppPreviewSession {
  private readonly deps: DevAppPreviewDeps
  private readonly sessions = new Map<string, OpenSession>()

  constructor(deps: DevAppPreviewDeps) {
    this.deps = deps
  }

  open(options: DevAppPreviewOpenOptions): DevAppPreviewStatus {
    if (!/^[A-Za-z0-9_-]{1,192}$/.test(options.leaseId)) {
      throw new Error("The DevApp preview lease is invalid.")
    }
    const unresolvedSourcePath = this.deps.resolve(options.sourcePath)
    const unresolvedWorkspaceRoot = this.deps.resolve(options.workspaceRoot)
    const sourcePath = this.deps.fs.realpath(unresolvedSourcePath)
    const workspaceRoot = this.deps.fs.realpath(unresolvedWorkspaceRoot)

    // A DevApp under development is developed inside a project. Requiring that keeps
    // "preview this folder" from being a way to read an arbitrary directory, and it is
    // what makes binding the worker to this workspace the honest thing to do. Real paths
    // are required here: a lexical child may be a symlink to an arbitrary machine path.
    if (!sourcePath || !workspaceRoot || !isInside(workspaceRoot, sourcePath)) {
      return {
        status: "invalid",
        diagnostics: [
          {
            code: "manifest-missing",
            severity: "blocker",
            message: "A DevApp can only be previewed from inside the project it belongs to.",
            fix: "Move the package into this project, or open the project that holds it.",
          },
        ],
      }
    }

    const manifestPath = this.deps.join(sourcePath, DEV_APP_MANIFEST_FILENAME)
    const source = this.deps.fs.readFile(manifestPath)
    if (source === null) {
      return {
        status: "invalid",
        diagnostics: [
          {
            code: "manifest-missing",
            severity: "blocker",
            message: `This folder has no ${DEV_APP_MANIFEST_FILENAME}.`,
            fix: `Add ${DEV_APP_MANIFEST_FILENAME} describing the app's view, worker, or service.`,
          },
        ],
      }
    }

    const parsed = parseDevAppPackage(source)
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

  /**
   * Re-reads the package after the working tree changed.
   *
   * Everything is re-derived: the manifest, preflight, and the grant. A reload that could
   * keep a running worker while its manifest asked for more would make hot reload a way
   * to gain capabilities without being asked, so a widened request stops the worker and
   * drops back to needing approval.
   */
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
      this.deps.join(session.sourcePath, DEV_APP_MANIFEST_FILENAME),
    )
    if (source === null) {
      this.stopWorker(session)
      return {
        status: "invalid",
        diagnostics: [
          {
            code: "manifest-missing",
            severity: "blocker",
            message: `${DEV_APP_MANIFEST_FILENAME} is no longer there.`,
          },
        ],
      }
    }

    const parsed = parseDevAppPackage(source)
    if (!parsed.manifest) {
      this.stopWorker(session)
      return { status: "invalid", diagnostics: parsed.diagnostics }
    }

    session.manifest = parsed.manifest
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
    if (!connection) throw new Error("This DevApp preview has no available worker.")
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

  /** Records the user's approval of exactly what the current manifest asks for. */
  approve(sourceId: string, expectedGrantFingerprint: string): DevAppPreviewStatus | null {
    // Re-read from disk at click time. The watcher is debounced, so checking only the
    // in-memory manifest would leave a window where changed worker code could start
    // under the approval for the previous manifest.
    const session = this.sessions.get(sourceId)
    if (!session) return null
    const invalid = this.refreshManifest(session, false)
    if (invalid) return invalid
    const requested = requestedGrant(session.manifest)
    // The manifest may change between rendering the prompt and clicking Approve. Never
    // approve a request the user was not actually shown.
    if (grantFingerprint(requested) !== expectedGrantFingerprint) {
      return this.settle(session)
    }
    this.deps.trust.approve(sourceId, requested)
    return this.settle(session)
  }

  private settle(session: OpenSession): DevAppPreviewStatus {
    const requested = requestedGrant(session.manifest)
    const workerExecution = session.manifest.worker !== undefined
    const trust = this.deps.trust.resolve(session.sourceId, requested, {
      requireExplicitApproval: workerExecution,
    })
    // Preflight runs on every settle, not only at publish, so a project that has drifted
    // out of publishable shape says so while it is still cheap to fix.
    const preflight = this.deps.preflight(session.sourcePath)
    const defaultBadge = developmentTrustBadge(trust)
    const badge = workerExecution
      ? {
          ...defaultBadge,
          detail:
            trust.status === "approved"
              ? "Unpublished worker code is running with restricted filesystem and process access, but it can reach the network and is not OS-sandboxed."
              : "Unpublished worker code requires approval before it can run. It is not an OS sandbox.",
        }
      : defaultBadge

    if (trust.status !== "approved") {
      this.stopWorker(session)
      return {
        status: "needsApproval",
        sourceId: session.sourceId,
        name: session.manifest.name,
        requested,
        declaredTools: session.manifest.worker?.tools ?? [],
        workerExecution,
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
      declaredTools: session.manifest.worker?.tools ?? [],
      badge,
      preflight,
      worker: this.ensureWorker(session, trust.effective, workerExecution ? trust.expiresAt : null),
      reloadToken: session.reloadToken,
    }
  }

  private resolveView(session: OpenSession): DevAppPreviewView {
    const view = session.manifest.view
    if (!view) {
      return { kind: "unavailable", reason: "This DevApp has no view to show." }
    }

    // A dev server is preferred when the author declared one: hot reload is the point of
    // the loop, and preflight covers the correctness the built output would have proved.
    if (view.dev?.url) return { kind: "devServer", url: view.dev.url }

    if (!this.confine(session, view.entry)) {
      return {
        kind: "unavailable",
        reason: `${view.entry} is not in the package.`,
        fix: view.dev?.command
          ? `Run \`${view.dev.command}\`, or build the app so ${view.entry} exists.`
          : `Build the app so ${view.entry} exists, or declare view.dev.url.`,
      }
    }
    return {
      kind: "builtOutput",
      entryPath: view.entry,
      url: buildDevAppPreviewUrl(session.sourceId, view.entry),
    }
  }

  private ensureWorker(
    session: OpenSession,
    grant: DevAppGrant,
    authorizationExpiresAt: number | null,
  ): DevAppWorkerState | null {
    const worker = session.manifest.worker
    if (!worker) {
      this.stopWorker(session)
      return null
    }

    const entrypoint = this.confine(session, worker.entry)
    if (!entrypoint) {
      this.stopWorker(session)
      return null
    }

    const key = developmentWorkerKey(session.sourceId)
    if (
      session.workerKey === key &&
      session.workerProtocolVersion !== null &&
      session.workerProtocolVersion !== worker.protocolVersion
    ) {
      this.stopWorker(session)
    }
    // Restarting on every settle would make a view reload kill in-flight worker work.
    // The host joins an already-running worker, so this is start-or-join.
    let state: DevAppWorkerState | null = null
    for (const leaseId of session.leases) {
      state = this.deps.worker.start({
        publicationId: key,
        entrypoint,
        packageRoot: session.sourcePath,
        protocolVersion: worker.protocolVersion,
        grant,
        authorizationExpiresAt,
        binding: session.binding,
        leaseId,
      })
    }
    session.workerKey = key
    session.workerProtocolVersion = worker.protocolVersion
    return state
  }

  private stopWorker(session: OpenSession): void {
    if (!session.workerKey) return
    this.deps.worker.stop(session.workerKey)
    session.workerKey = null
    session.workerProtocolVersion = null
  }

  /**
   * Resolves a manifest-declared path against the package, through symlinks.
   *
   * The manifest parser already refused traversal, but it cannot see the filesystem: a
   * symlink inside the package pointing at /etc passes every textual check. Resolving and
   * re-checking containment is what closes that.
   */
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
  // Guards the `/a/project` vs `/a/project-secrets` case, where startsWith alone passes.
  return next === "/" || next === "\\"
}

export type { DevAppPreviewStatus, DevAppPreviewView }
