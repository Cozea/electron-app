import type { OrgDevAppPreflightReport } from "../../../../shared/orgDevAppDiagnostics"
import type { DevAppGrant } from "../../../../shared/devAppCapabilities"
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
import type {
  DevAppPreviewStatus,
  DevAppPreviewView,
} from "../../../../shared/devAppPreviewTypes"
import type { DevAppWorkerBinding, DevAppWorkerState } from "./DevAppWorkerHost"
import { buildDevAppPreviewUrl } from "../../../../shared/devAppPreviewProtocol"

/**
 * Runs an unpublished DevApp from a local directory.
 *
 * This is the authoring loop. Its one non-negotiable property is that development runs
 * the same view, worker, and protocol path an installed app runs: the manifest is parsed
 * by the same parser, capabilities are gated by the same host, and preflight is the same
 * check publishing performs. "Works in dev, fails on publish" needs those paths to differ
 * somewhere, and this session is written so there is nowhere for them to differ.
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
    grant: DevAppGrant
    binding: DevAppWorkerBinding
    leaseId: string
  }) => DevAppWorkerState
  stop: (publicationId: string) => void
  release: (publicationId: string, leaseId: string) => void
  getState: (publicationId: string) => DevAppWorkerState | null
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
  leaseId: string
  manifest: DevAppPackage
  workerKey: string | null
  reloadToken: number
}

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
    const sourcePath = this.deps.resolve(options.sourcePath)
    const workspaceRoot = this.deps.resolve(options.workspaceRoot)

    // A DevApp under development is developed inside a project. Requiring that keeps
    // "preview this folder" from being a way to read an arbitrary directory, and it is
    // what makes binding the worker to this workspace the honest thing to do.
    if (!isInside(workspaceRoot, sourcePath)) {
      return {
        status: "invalid",
        diagnostics: [{
          code: "manifest-missing",
          severity: "blocker",
          message: "A DevApp can only be previewed from inside the project it belongs to.",
          fix: "Move the package into this project, or open the project that holds it.",
        }],
      }
    }

    const manifestPath = this.deps.join(sourcePath, DEV_APP_MANIFEST_FILENAME)
    const source = this.deps.fs.readFile(manifestPath)
    if (source === null) {
      return {
        status: "invalid",
        diagnostics: [{
          code: "manifest-missing",
          severity: "blocker",
          message: `This folder has no ${DEV_APP_MANIFEST_FILENAME}.`,
          fix: `Add ${DEV_APP_MANIFEST_FILENAME} describing the app's view, worker, or service.`,
        }],
      }
    }

    const parsed = parseDevAppPackage(source)
    if (!parsed.manifest) return { status: "invalid", diagnostics: parsed.diagnostics }

    const sourceId = this.deps.hashPath(sourcePath)
    const session: OpenSession = {
      sourceId,
      sourcePath,
      binding: {
        workspaceId: options.workspaceId,
        workspaceRoot,
      },
      leaseId: options.leaseId,
      manifest: parsed.manifest,
      workerKey: null,
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

    const source = this.deps.fs.readFile(
      this.deps.join(session.sourcePath, DEV_APP_MANIFEST_FILENAME),
    )
    if (source === null) {
      this.stopWorker(session)
      return {
        status: "invalid",
        diagnostics: [{
          code: "manifest-missing",
          severity: "blocker",
          message: `${DEV_APP_MANIFEST_FILENAME} is no longer there.`,
        }],
      }
    }

    const parsed = parseDevAppPackage(source)
    if (!parsed.manifest) {
      this.stopWorker(session)
      return { status: "invalid", diagnostics: parsed.diagnostics }
    }

    session.manifest = parsed.manifest
    session.reloadToken += 1
    return this.settle(session)
  }

  status(sourceId: string): DevAppPreviewStatus | null {
    const session = this.sessions.get(sourceId)
    return session ? this.settle(session) : null
  }

  close(sourceId: string): void {
    const session = this.sessions.get(sourceId)
    if (!session) return
    if (session.workerKey) this.deps.worker.release(session.workerKey, session.leaseId)
    this.sessions.delete(sourceId)
  }

  /** Records the user's approval of exactly what the current manifest asks for. */
  approve(sourceId: string): DevAppPreviewStatus | null {
    const session = this.sessions.get(sourceId)
    if (!session) return null
    this.deps.trust.approve(sourceId, requestedGrant(session.manifest))
    return this.settle(session)
  }

  private settle(session: OpenSession): DevAppPreviewStatus {
    const requested = requestedGrant(session.manifest)
    const trust = this.deps.trust.resolve(session.sourceId, requested)
    // Preflight runs on every settle, not only at publish, so a project that has drifted
    // out of publishable shape says so while it is still cheap to fix.
    const preflight = this.deps.preflight(session.sourcePath)
    const badge = developmentTrustBadge(trust)

    if (trust.status !== "approved") {
      this.stopWorker(session)
      return {
        status: "needsApproval",
        sourceId: session.sourceId,
        name: session.manifest.name,
        requested,
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
      badge,
      preflight,
      worker: this.ensureWorker(session, trust.effective),
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

  private ensureWorker(session: OpenSession, grant: DevAppGrant): DevAppWorkerState | null {
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
    // Restarting on every settle would make a view reload kill in-flight worker work.
    // The host joins an already-running worker, so this is start-or-join.
    const state = this.deps.worker.start({
      publicationId: key,
      entrypoint,
      grant,
      binding: session.binding,
      leaseId: session.leaseId,
    })
    session.workerKey = key
    return state
  }

  private stopWorker(session: OpenSession): void {
    if (!session.workerKey) return
    this.deps.worker.stop(session.workerKey)
    session.workerKey = null
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
