import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import { isHostWorkspaceCloseRequest, requestHostWorkspaceClose, type HostWorkspaceCloseRequest } from "../../shared/hostWorkspaceClose"
const request: HostWorkspaceCloseRequest = { type: "cozea:workspace-close", requestId: "request-one", roots: ["/project"] }
function child() {
  return Object.assign(new EventEmitter(), { connected: true, send: vi.fn((_message: object, callback: (error: Error | null) => void) => callback(null)) })
}
describe("workspace close parent/child acknowledgment", () => {
  it("accepts only the matching request and removes listeners", async () => {
    const host = child()
    const closing = requestHostWorkspaceClose(host, request)
    host.emit("message", { type: "cozea:workspace-close-result", requestId: "other", success: true })
    expect(host.listenerCount("message")).toBe(1)
    host.emit("message", { type: "cozea:workspace-close-result", requestId: request.requestId, success: true })
    await closing
    expect(host.listenerCount("message")).toBe(0)
    expect(host.listenerCount("exit")).toBe(0)
  })
  it("preserves a negative acknowledgment and fails on disconnect or timeout", async () => {
    const host = child()
    const closing = requestHostWorkspaceClose(host, request)
    host.emit("message", { type: "cozea:workspace-close-result", requestId: request.requestId, success: false, error: "Stop running chats" })
    await expect(closing).rejects.toThrow("Stop running chats")
    const exited = requestHostWorkspaceClose(host, request)
    host.emit("exit")
    await expect(exited).rejects.toThrow("stopped before confirming")
    await expect(requestHostWorkspaceClose(host, request, 1)).rejects.toThrow("not confirmed")
    host.connected = false
    await expect(requestHostWorkspaceClose(host, request)).rejects.toThrow("unavailable")
    expect(host.listenerCount("message")).toBe(0)
  })
  it("rejects malformed, relative, empty and oversized scopes before send", async () => {
    for (const roots of [[], ["relative"], ["/bad\0path"], Array.from({ length: 65 }, () => "/root"), ["/" + "a".repeat(4096)]]) expect(isHostWorkspaceCloseRequest({ ...request, roots })).toBe(false)
    const host = child()
    await expect(requestHostWorkspaceClose(host, { ...request, roots: [] })).rejects.toThrow("unavailable")
    expect(host.send).not.toHaveBeenCalled()
  })
})
