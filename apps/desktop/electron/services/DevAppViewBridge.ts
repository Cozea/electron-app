import {
  parseWorkerMessage,
  workerErrorResponse,
  type DevAppWorkerMessage,
} from "../../../../shared/devAppWorkerProtocol"

/** Structural subset of MessagePortMain, kept injectable for focused broker tests. */
export interface DevAppViewBridgePort {
  postMessage: (message: unknown) => void
  on(event: "message", listener: (event: { data: unknown }) => void): unknown
  on(event: "close", listener: () => void): unknown
  start: () => void
  close: () => void
}

export interface DevAppViewBridgeHandle {
  close: (reason?: string) => void
}

interface PendingRequest {
  timer: unknown
}

const MAX_PENDING_PER_DIRECTION = 16
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/**
 * Brokers a DevApp page to its own worker without making the page an Electron IPC peer.
 *
 * The worker's separate host port remains the only route to privileged Cozea operations,
 * where its approved capability grant is enforced. This broker understands only the shared
 * request/response/event envelope: it bounds work, drops malformed/spoofed responses, times
 * requests out, and owns revocation when either process or the surface goes away.
 */
export function createDevAppViewBridge(options: {
  viewPort: DevAppViewBridgePort
  workerPort: DevAppViewBridgePort
  protocolVersion: number
  requestTimeoutMs?: number
  setTimer?: (callback: () => void, milliseconds: number) => unknown
  clearTimer?: (handle: unknown) => void
  onClose?: (reason: string) => void
}): DevAppViewBridgeHandle {
  const setTimer =
    options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds))
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const timeoutMs = Math.max(
    1,
    Math.min(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 60_000),
  )
  const pendingFromView = new Map<string, PendingRequest>()
  const pendingFromWorker = new Map<string, PendingRequest>()
  let closed = false

  const safePost = (port: DevAppViewBridgePort, message: DevAppWorkerMessage): boolean => {
    if (closed) return false
    try {
      port.postMessage(message)
      return true
    } catch {
      return false
    }
  }

  const clearPending = (pending: Map<string, PendingRequest>, id: string): boolean => {
    const request = pending.get(id)
    if (!request) return false
    pending.delete(id)
    clearTimer(request.timer)
    return true
  }

  const rejectRequest = (
    port: DevAppViewBridgePort,
    id: string,
    code: "invalid-message" | "internal-error" | "worker-unavailable",
    message: string,
  ): void => {
    safePost(port, workerErrorResponse(id, { code, message }, options.protocolVersion))
  }

  const trackRequest = (
    pending: Map<string, PendingRequest>,
    replyPort: DevAppViewBridgePort,
    id: string,
  ): boolean => {
    if (pending.has(id)) {
      rejectRequest(replyPort, id, "invalid-message", "A request with this id is already pending.")
      return false
    }
    if (pending.size >= MAX_PENDING_PER_DIRECTION) {
      rejectRequest(replyPort, id, "internal-error", "Too many view/worker requests are in flight.")
      return false
    }
    const timer = setTimer(() => {
      if (!pending.delete(id) || closed) return
      rejectRequest(replyPort, id, "worker-unavailable", "The DevApp worker request timed out.")
    }, timeoutMs)
    pending.set(id, { timer })
    return true
  }

  const forward = (raw: unknown, from: "view" | "worker"): void => {
    if (closed) return
    const message = parseWorkerMessage(raw, options.protocolVersion)
    if (!message) return
    const destination = from === "view" ? options.workerPort : options.viewPort
    const sender = from === "view" ? options.viewPort : options.workerPort
    const ownPending = from === "view" ? pendingFromView : pendingFromWorker
    const oppositePending = from === "view" ? pendingFromWorker : pendingFromView

    if (message.kind === "request") {
      if (!trackRequest(ownPending, sender, message.id)) return
      if (!safePost(destination, message)) {
        clearPending(ownPending, message.id)
        rejectRequest(sender, message.id, "worker-unavailable", "The DevApp worker is unavailable.")
      }
      return
    }
    if (message.kind === "response") {
      // A response with no request in the opposite direction is spoofed or stale.
      if (!clearPending(oppositePending, message.id)) return
      safePost(destination, message)
      return
    }
    safePost(destination, message)
  }

  const close = (reason = "The DevApp worker connection closed."): void => {
    if (closed) return
    for (const id of pendingFromView.keys()) {
      rejectRequest(options.viewPort, id, "worker-unavailable", reason)
    }
    for (const id of pendingFromWorker.keys()) {
      rejectRequest(options.workerPort, id, "worker-unavailable", reason)
    }
    closed = true
    for (const pending of [pendingFromView, pendingFromWorker]) {
      for (const request of pending.values()) clearTimer(request.timer)
      pending.clear()
    }
    try {
      options.viewPort.close()
    } catch {
      // The remote renderer already closed it.
    }
    try {
      options.workerPort.close()
    } catch {
      // The utility process already closed it.
    }
    options.onClose?.(reason)
  }

  options.viewPort.on("message", (event) => forward(event.data, "view"))
  options.workerPort.on("message", (event) => forward(event.data, "worker"))
  options.viewPort.on("close", () => close("The DevApp view closed."))
  options.workerPort.on("close", () => close("The DevApp worker closed."))
  options.viewPort.start()
  options.workerPort.start()

  return { close }
}
