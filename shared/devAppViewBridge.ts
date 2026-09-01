import type { DevAppWorkerViewPortBootstrap } from "./devAppWorkerProtocol"

/** Main transfers a view-owned DOM MessagePort over this guest-only preload channel. */
export const DEV_APP_VIEW_WORKER_PORT_CHANNEL = "cozea:devapp-view-worker-port"
export const DEV_APP_VIEW_WORKER_REVOKED_CHANNEL = "cozea:devapp-view-worker-revoked"

export interface DevAppViewWorkerConnection {
  readonly bootstrap: DevAppWorkerViewPortBootstrap
  readonly port: MessagePort
}

export interface DevAppViewWorkerConnectOptions {
  /** Bounded locally by the preload. Defaults to ten seconds. */
  timeoutMs?: number
}

/**
 * Low-level Phase 4 bridge. Phase 6's public package wraps this in typed request helpers.
 * Keeping the raw connection explicit lets app-specific view/worker methods remain private.
 */
export interface CozeaDevAppViewBridge {
  connectWorker: (options?: DevAppViewWorkerConnectOptions) => Promise<DevAppViewWorkerConnection>
  currentWorker: () => DevAppViewWorkerConnection | null
  onWorkerConnection: (listener: (connection: DevAppViewWorkerConnection) => void) => () => void
}
