import path from "node:path"
import fs from "node:fs"

import { DevAppDevelopmentTrustStore } from "../../../../shared/devAppDevelopmentTrust"
import { preflightProject } from "./orgDevAppPreflight"
import {
  DevAppPreviewSession,
  type DevAppPreviewStatus,
  type DevAppPreviewWorkerHost,
} from "./DevAppPreviewSession"
import { DevAppPreviewWatcher, type DevAppWatch } from "./DevAppPreviewWatcher"
import { hashSourcePath, nodePreviewFs } from "./devAppPreviewAdapters"

/**
 * Owns the development preview: the session, the watcher, and telling the renderer.
 *
 * The renderer never names a directory. It names a workspace and a path relative to that
 * workspace's root, and this joins them — so there is no message the renderer can send
 * that points outside the project, whatever it does with its own state. The session's own
 * containment check then stands as a second line rather than the only one.
 */

export interface DevAppPreviewServiceDeps {
  worker: DevAppPreviewWorkerHost
  /** Pushes a fresh status to whoever is showing this source. */
  broadcast: (sourceId: string, status: DevAppPreviewStatus) => void
  /** Injected for tests; defaults to a recursive fs.watch. */
  watch?: DevAppWatch
  now?: () => number
}

const nodeWatch: DevAppWatch = (root, onChange) => {
  try {
    const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      onChange(typeof filename === "string" ? filename : "")
    })
    return { close: () => watcher.close() }
  } catch {
    // Recursive watching is unavailable on some platforms and filesystems. The caller
    // reports "no hot reload" rather than silently never reloading.
    return null
  }
}

export class DevAppPreviewService {
  private readonly session: DevAppPreviewSession
  private readonly watcher: DevAppPreviewWatcher
  private readonly broadcast: (sourceId: string, status: DevAppPreviewStatus) => void
  private readonly roots = new Map<string, string>()

  constructor(deps: DevAppPreviewServiceDeps) {
    this.broadcast = deps.broadcast
    this.session = new DevAppPreviewSession({
      fs: nodePreviewFs,
      join: (...parts) => path.join(...parts),
      resolve: (value) => path.resolve(value),
      hashPath: hashSourcePath,
      preflight: preflightProject,
      trust: new DevAppDevelopmentTrustStore(deps.now ?? (() => Date.now())),
      worker: deps.worker,
    })
    this.watcher = new DevAppPreviewWatcher({
      watch: deps.watch ?? nodeWatch,
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    })
  }

  /**
   * Opens a package for preview.
   *
   * `relativePath` is resolved against the authorized workspace root by the caller's
   * `workspaceRoot`, never taken as an absolute path from the renderer.
   */
  open(options: {
    workspaceId: string
    workspaceRoot: string
    relativePath: string
    leaseId: string
  }): DevAppPreviewStatus & { hotReload: boolean } {
    const sourcePath = path.resolve(options.workspaceRoot, options.relativePath)
    const status = this.session.open({
      sourcePath,
      workspaceId: options.workspaceId,
      workspaceRoot: options.workspaceRoot,
      leaseId: options.leaseId,
    })

    if (status.status === "invalid") return { ...status, hotReload: false }

    this.roots.set(status.sourceId, sourcePath)
    const hotReload = this.watcher.start(status.sourceId, sourcePath, () => {
      this.onChanged(status.sourceId)
    })
    return { ...status, hotReload }
  }

  private onChanged(sourceId: string): void {
    const status = this.session.reload(sourceId)
    // A reload for a source that was closed mid-burst has nothing to report.
    if (status) this.broadcast(sourceId, status)
  }

  approve(sourceId: string): DevAppPreviewStatus | null {
    const status = this.session.approve(sourceId)
    if (status) this.broadcast(sourceId, status)
    return status
  }

  status(sourceId: string): DevAppPreviewStatus | null {
    return this.session.status(sourceId)
  }

  close(sourceId: string): void {
    this.watcher.stop(sourceId)
    this.roots.delete(sourceId)
    this.session.close(sourceId)
  }

  dispose(): void {
    this.watcher.stopAll()
    for (const sourceId of Array.from(this.roots.keys())) this.session.close(sourceId)
    this.roots.clear()
  }
}
