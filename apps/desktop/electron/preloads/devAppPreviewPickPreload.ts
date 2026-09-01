import "../../../../vendor/t3code/apps/desktop/src/preview-pick-preload.ts"

import { ipcRenderer } from "electron"

import {
  DEV_APP_VIEW_WORKER_PORT_CHANNEL,
  DEV_APP_VIEW_WORKER_REVOKED_CHANNEL,
  type CozeaDevAppViewBridge,
  type DevAppViewWorkerConnection,
  type DevAppViewWorkerConnectOptions,
} from "../../../../shared/devAppViewBridge"
import { parseDevAppWorkerViewPortBootstrap } from "../../../../shared/devAppWorkerProtocol"

interface PendingConnection {
  resolve: (connection: DevAppViewWorkerConnection) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000
const pending = new Set<PendingConnection>()
const listeners = new Set<(connection: DevAppViewWorkerConnection) => void>()
let current: DevAppViewWorkerConnection | null = null

const connectWorker = (
  options: DevAppViewWorkerConnectOptions = {},
): Promise<DevAppViewWorkerConnection> => {
  if (current) return Promise.resolve(current)
  const requested = options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  const timeoutMs = Math.max(
    1,
    Math.min(Number.isFinite(requested) ? requested : DEFAULT_CONNECT_TIMEOUT_MS, 30_000),
  )
  return new Promise((resolve, reject) => {
    const waiter: PendingConnection = {
      resolve,
      reject,
      timer: setTimeout(() => {
        pending.delete(waiter)
        reject(new Error("This DevApp preview has no available worker connection."))
      }, timeoutMs),
    }
    pending.add(waiter)
  })
}

const bridge: CozeaDevAppViewBridge = Object.freeze({
  connectWorker,
  currentWorker: () => current,
  onWorkerConnection: (listener: (connection: DevAppViewWorkerConnection) => void) => {
    listeners.add(listener)
    if (current) queueMicrotask(() => listener(current!))
    return () => listeners.delete(listener)
  },
})

Object.defineProperty(window, "cozeaDevApp", {
  value: bridge,
  configurable: false,
  enumerable: false,
  writable: false,
})

ipcRenderer.on(DEV_APP_VIEW_WORKER_PORT_CHANNEL, (event, rawBootstrap: unknown) => {
  const bootstrap = parseDevAppWorkerViewPortBootstrap(rawBootstrap)
  const port = event.ports[0]
  if (!bootstrap || !port || event.ports.length !== 1) {
    for (const transferred of event.ports) transferred.close()
    return
  }

  current?.port.close()
  port.start()
  const connection: DevAppViewWorkerConnection = Object.freeze({
    bootstrap: Object.freeze(bootstrap),
    port,
  })
  current = connection

  for (const waiter of pending) {
    clearTimeout(waiter.timer)
    waiter.resolve(connection)
  }
  pending.clear()
  for (const listener of listeners) {
    try {
      listener(connection)
    } catch {
      // App callbacks do not own preload lifecycle.
    }
  }
})

ipcRenderer.on(DEV_APP_VIEW_WORKER_REVOKED_CHANNEL, (_event, raw: unknown) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return
  const connectionId = Reflect.get(raw, "connectionId")
  if (typeof connectionId !== "string" || current?.bootstrap.connectionId !== connectionId) return
  current.port.close()
  current = null
})

window.addEventListener("beforeunload", () => {
  current?.port.close()
  current = null
  for (const waiter of pending) {
    clearTimeout(waiter.timer)
    waiter.reject(new Error("The DevApp view closed before its worker connected."))
  }
  pending.clear()
  listeners.clear()
})

declare global {
  interface Window {
    readonly cozeaDevApp: CozeaDevAppViewBridge
  }
}
