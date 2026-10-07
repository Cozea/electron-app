export interface HostWorkspaceRemovalRequest {
  type: "cozea:workspace-remove-data"
  requestId: string
  operationId: string
  roots: readonly string[]
}
export function isHostWorkspaceRemovalRequest(value: unknown): value is HostWorkspaceRemovalRequest {
  if (!value || typeof value !== "object") return false
  const request = value as Record<string, unknown>
  const id = (item: unknown) => typeof item === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(item)
  return request.type === "cozea:workspace-remove-data" && id(request.requestId) && id(request.operationId) &&
    Array.isArray(request.roots) && request.roots.length > 0 && request.roots.length <= 64 && JSON.stringify(request.roots).length <= 16_384 &&
    request.roots.every((root) => typeof root === "string" && root.startsWith("/") && !root.includes("\0"))
}
interface Child {
  readonly connected: boolean
  on(event: "message", listener: (message: unknown) => void): unknown
  on(event: "exit", listener: () => void): unknown
  off(event: "message", listener: (message: unknown) => void): unknown
  off(event: "exit", listener: () => void): unknown
  send(message: object, callback: (error: Error | null) => void): unknown
}
export function requestHostWorkspaceRemoval(child: Child, request: HostWorkspaceRemovalRequest): Promise<void> {
  if (!child.connected || !isHostWorkspaceRemovalRequest(request)) return Promise.reject(new Error("Chat data removal is unavailable."))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true; clearTimeout(timer); child.off("message", message); child.off("exit", exit)
      if (error) reject(error); else resolve()
    }
    const exit = () => finish(new Error("Chat server exited before confirming saved data removal."))
    const message = (value: unknown) => {
      if (!value || typeof value !== "object") return
      const reply = value as Record<string, unknown>
      if (reply.type !== "cozea:workspace-remove-data-result" || reply.requestId !== request.requestId) return
      finish(reply.success === true ? undefined : new Error(typeof reply.error === "string" ? reply.error.slice(0, 2000) : "Chat data removal was not confirmed."))
    }
    const timer = setTimeout(() => finish(new Error("Chat data removal has an unknown outcome. Retry its saved request.")), 30_000)
    child.on("message", message); child.on("exit", exit)
    try { child.send(request, (error) => { if (error) finish(error) }) } catch { finish(new Error("Chat data removal disconnected.")) }
  })
}
