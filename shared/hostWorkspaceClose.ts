interface WorkspaceCloseChild {
  readonly connected: boolean
  on(event: "message", listener: (message: unknown) => void): unknown
  on(event: "exit", listener: () => void): unknown
  off(event: "message", listener: (message: unknown) => void): unknown
  off(event: "exit", listener: () => void): unknown
  send(message: object, callback: (error: Error | null) => void): unknown
}

export interface HostWorkspaceCloseRequest {
  type: "cozea:workspace-close"
  requestId: string
  roots: readonly string[]
}

export function isHostWorkspaceCloseRequest(value: unknown): value is HostWorkspaceCloseRequest {
  if (!value || typeof value !== "object") return false
  const request = value as Record<string, unknown>
  return request.type === "cozea:workspace-close" && typeof request.requestId === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(request.requestId) &&
    Array.isArray(request.roots) && request.roots.length > 0 && request.roots.length <= 64 && JSON.stringify(request.roots).length <= 4096 &&
    request.roots.every((root: unknown) => typeof root === "string" && root.startsWith("/") && !root.includes("\0"))
}

/** Parent/child channel only; unavailable or missing acknowledgments fail closed. */
export function requestHostWorkspaceClose(child: WorkspaceCloseChild, request: HostWorkspaceCloseRequest, timeoutMs = 15_000): Promise<void> {
  if (!child.connected || !isHostWorkspaceCloseRequest(request)) return Promise.reject(new Error("The chat server is unavailable for workspace close."))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off("message", onMessage)
      child.off("exit", onExit)
      if (error) reject(error)
      else resolve()
    }
    const onExit = () => finish(new Error("The chat server stopped before confirming workspace close."))
    const onMessage = (value: unknown) => {
      if (!value || typeof value !== "object") return
      const reply = value as Record<string, unknown>
      if (reply.type !== "cozea:workspace-close-result" || reply.requestId !== request.requestId) return
      finish(reply.success === true ? undefined : new Error(typeof reply.error === "string" ? reply.error.slice(0, 2000) : "The chat server could not confirm workspace close."))
    }
    const timer = setTimeout(() => finish(new Error("Chat sessions have not confirmed workspace close. Retry the saved request.")), timeoutMs)
    child.on("message", onMessage)
    child.on("exit", onExit)
    try { child.send(request, (error) => { if (error) finish(error) }) }
    catch { finish(new Error("The chat server disconnected during workspace close.")) }
  })
}
