import path from "node:path"
import fs from "node:fs"
import { net, type Session } from "electron"
import { pathToFileURL } from "node:url"

import { DevAppDevelopmentTrustStore } from "../../../../shared/devAppDevelopmentTrust"
import { preflightProject } from "./orgDevAppPreflight"
import {
  DevAppPreviewSession,
  type DevAppPreviewStatus,
  type DevAppPreviewWorkerHost,
} from "./DevAppPreviewSession"
import { DevAppPreviewWatcher, type DevAppWatch } from "./DevAppPreviewWatcher"
import { hashSourcePath, nodePreviewFs } from "./devAppPreviewAdapters"
import { ORG_DEVAPP_SCHEME } from "../../../../shared/orgDevAppProtocol"
import { parseDevAppPreviewUrl } from "../../../../shared/devAppPreviewProtocol"
import type { DevAppWorkerViewPortBootstrap } from "../../../../shared/devAppWorkerProtocol"
import type { DevAppWorkerState, DevAppWorkerTransferablePort } from "./DevAppWorkerHost"

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
  private readonly entryPaths = new Map<string, string>()
  private readonly registeredSessionProtocols = new WeakSet<Session>()
  private readonly workerStateListeners = new Set<
    (sourceId: string, state: DevAppWorkerState) => void
  >()
  private readonly removeWorkerStateListener: (() => void) | null

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
    this.removeWorkerStateListener =
      deps.worker.onStateChange?.((change) => {
        const match = /^dev:([0-9a-f]{32})$/.exec(change.publicationId)
        if (!match) return
        for (const listener of this.workerStateListeners) listener(match[1]!, change.state)
      }) ?? null
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
    this.trackEntryPath(status.sourceId, status)
    const hotReload = this.watcher.start(status.sourceId, sourcePath, () => {
      this.onChanged(status.sourceId)
    })
    return { ...status, hotReload }
  }

  private onChanged(sourceId: string): void {
    const status = this.session.reload(sourceId)
    // A reload for a source that was closed mid-burst has nothing to report.
    if (status) {
      this.trackEntryPath(sourceId, status)
      this.broadcast(sourceId, status)
    }
  }

  approve(sourceId: string, approvalFingerprint: string): DevAppPreviewStatus | null {
    const status = this.session.approve(sourceId, approvalFingerprint)
    if (status) {
      this.trackEntryPath(sourceId, status)
      this.broadcast(sourceId, status)
    }
    return status
  }

  status(sourceId: string): DevAppPreviewStatus | null {
    return this.session.status(sourceId)
  }

  workerConnection(sourceId: string): {
    protocolVersion: number
  } | null {
    const connection = this.session.workerConnection(sourceId)
    return connection ? { protocolVersion: connection.protocolVersion } : null
  }

  attachViewPort(
    sourceId: string,
    connectionId: string,
    port: DevAppWorkerTransferablePort,
  ): DevAppWorkerViewPortBootstrap {
    return this.session.attachViewPort(sourceId, connectionId, port)
  }

  detachViewPort(sourceId: string, connectionId: string): void {
    this.session.detachViewPort(sourceId, connectionId)
  }

  onWorkerStateChange(listener: (sourceId: string, state: DevAppWorkerState) => void): () => void {
    this.workerStateListeners.add(listener)
    return () => this.workerStateListeners.delete(listener)
  }

  close(sourceId: string, leaseId: string): void {
    if (!this.session.close(sourceId, leaseId)) return
    this.watcher.stop(sourceId)
    this.roots.delete(sourceId)
    this.entryPaths.delete(sourceId)
  }

  registerProtocolForSession(targetSession: Session, sourceId: string): void {
    if (this.registeredSessionProtocols.has(targetSession)) return
    if (!/^[0-9a-f]{32}$/.test(sourceId)) {
      throw new Error("The DevApp preview session key is invalid.")
    }
    targetSession.protocol.handle(ORG_DEVAPP_SCHEME, (request) =>
      this.handleProtocolRequest(sourceId, request),
    )
    this.registeredSessionProtocols.add(targetSession)
  }

  private trackEntryPath(sourceId: string, status: DevAppPreviewStatus): void {
    if (status.status === "running" && status.view.kind === "builtOutput") {
      this.entryPaths.set(sourceId, status.view.entryPath)
    } else {
      this.entryPaths.delete(sourceId)
    }
  }

  private async handleProtocolRequest(boundSourceId: string, request: Request): Promise<Response> {
    const parsed = parseDevAppPreviewUrl(request.url)
    if (!parsed || parsed.sourceId !== boundSourceId) {
      return new Response("Invalid DevApp preview URL", {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    }
    const sourceRoot = this.roots.get(boundSourceId)
    const entryPath = this.entryPaths.get(boundSourceId)
    if (!sourceRoot || !entryPath) {
      return new Response("DevApp preview is no longer open", {
        status: 410,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    }

    const contentRoot = path.resolve(sourceRoot, path.dirname(entryPath))
    const entryDirectory = path.dirname(entryPath).replace(/\\/g, "/")
    const requestedAsset = parsed.assetPath.replace(/\\/g, "/")
    const relativeAsset =
      entryDirectory !== "." && requestedAsset.startsWith(`${entryDirectory}/`)
        ? requestedAsset.slice(entryDirectory.length + 1)
        : requestedAsset
    const candidate = resolvePreviewFile(contentRoot, relativeAsset)
    const fallback = resolvePreviewFile(contentRoot, path.basename(entryPath))
    const filePath = candidate ?? fallback
    if (!filePath) {
      return new Response("DevApp preview file not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    }

    const fileResponse = await net.fetch(pathToFileURL(filePath).toString())
    const headers = new Headers(fileResponse.headers)
    headers.set("content-type", mimeForPreviewPath(filePath))
    headers.set("cache-control", "no-store")
    headers.set(
      "content-security-policy",
      "default-src 'self' https: data: blob:; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; connect-src 'self' https: wss:; script-src 'self'; style-src 'self' 'unsafe-inline'",
    )
    headers.set("x-content-type-options", "nosniff")
    return new Response(fileResponse.body, { status: fileResponse.status, headers })
  }

  dispose(): void {
    this.removeWorkerStateListener?.()
    this.workerStateListeners.clear()
    this.watcher.stopAll()
    for (const sourceId of Array.from(this.roots.keys())) this.session.close(sourceId)
    this.roots.clear()
    this.entryPaths.clear()
  }
}

const PREVIEW_MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
}

function mimeForPreviewPath(filePath: string): string {
  return PREVIEW_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
}

function resolvePreviewFile(contentRoot: string, relativePath: string): string | null {
  try {
    const root = fs.realpathSync.native(contentRoot)
    const candidate = path.resolve(root, relativePath)
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null
    const real = fs.realpathSync.native(candidate)
    if (real !== root && !real.startsWith(`${root}${path.sep}`)) return null
    return fs.statSync(real).isFile() ? real : null
  } catch {
    return null
  }
}
