import { describe, expect, it, vi } from "vitest"
import { SessionEditorBridge, installSessionEditorUnloadGuard } from "../../apps/desktop/src/features/collaboration/runtime/SessionEditorBridge"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(accept => { resolve = accept })
  return { promise, resolve }
}

function install(bridge: SessionEditorBridge) {
  const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const remove = installSessionEditorUnloadGuard(target, bridge)
  const listener = target.addEventListener.mock.calls[0]![1] as (event: BeforeUnloadEvent) => void
  const close = () => {
    const event = { preventDefault: vi.fn(), returnValue: "" } as unknown as BeforeUnloadEvent & { preventDefault: ReturnType<typeof vi.fn> }
    listener(event)
    return event
  }
  return { target, remove, listener, close }
}

describe("window protection for editor IPC acceptance", () => {
  it("allows an idle window to close and removes exactly its listener", () => {
    const bridge = new SessionEditorBridge(async () => {})
    const { close, remove, target, listener } = install(bridge)
    expect(close().preventDefault).not.toHaveBeenCalled()
    remove()
    expect(target.removeEventListener).toHaveBeenCalledWith("beforeunload", listener)
  })

  it("blocks a close until an in-flight editor update is durably accepted", async () => {
    const acceptance = deferred()
    const send = vi.fn(() => acceptance.promise)
    const bridge = new SessionEditorBridge(send)
    const saved = bridge.enqueue("s", new Uint8Array([1, 2]))
    const { close } = install(bridge)
    const event = close()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.returnValue).toContain("not been durably accepted")
    expect(send).toHaveBeenCalledTimes(1)
    acceptance.resolve(); await saved
    expect(close().preventDefault).not.toHaveBeenCalled()
  })

  it("retains rejected updates from closed editor views and blocks every close attempt", async () => {
    const send = vi.fn().mockRejectedValue(new Error("IPC unavailable"))
    const bridge = new SessionEditorBridge(send)
    await expect(bridge.enqueue("s", new Uint8Array([7]))).rejects.toThrow("IPC")
    const { close } = install(bridge)
    expect(close().preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(bridge.pendingCount()).toBe(1)
    send.mockResolvedValue(undefined)
    await bridge.flushAll()
    expect(close().preventDefault).not.toHaveBeenCalled()
    expect(send.mock.calls.map(([, update]) => [...update])).toEqual([[7], [7], [7]])
  })

  it("waits for every session queue, including edits enqueued while flushing", async () => {
    const acceptance = deferred()
    const bridge = new SessionEditorBridge(async () => acceptance.promise)
    const first = bridge.enqueue("a", new Uint8Array([1]))
    const { close } = install(bridge)
    expect(close().preventDefault).toHaveBeenCalledOnce()
    const second = bridge.enqueue("b", new Uint8Array([2]))
    const third = bridge.enqueue("a", new Uint8Array([3]))
    expect(bridge.pendingCount()).toBe(3)
    acceptance.resolve()
    await Promise.all([first, second, third, bridge.flushAll()])
    expect(bridge.pendingCount()).toBe(0)
    expect(close().preventDefault).not.toHaveBeenCalled()
  })
})
