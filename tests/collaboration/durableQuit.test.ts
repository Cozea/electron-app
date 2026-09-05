import { describe, expect, it, vi } from "vitest"
import { createDurableQuitHandler } from "../../shared/durableQuit"

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function fixture() {
  const deps = { prepare: vi.fn(async () => {}), dispose: vi.fn(async () => {}), quit: vi.fn(), failed: vi.fn() }
  const event = { preventDefault: vi.fn() }
  return { deps, event, handle: createDurableQuitHandler(deps) }
}

describe("durable application quit ordering", () => {
  it("does nothing before will-quit, so canceled renderer unload keeps owners alive", () => {
    const { deps } = fixture()
    expect(deps.prepare).not.toHaveBeenCalled()
    expect(deps.dispose).not.toHaveBeenCalled()
  })

  it("waits for persistence before disposal, and disposal before retrying quit", async () => {
    const { deps, event, handle } = fixture()
    const persist = deferred(), dispose = deferred()
    deps.prepare.mockReturnValue(persist.promise)
    deps.dispose.mockReturnValue(dispose.promise)
    handle(event); handle(event)
    await vi.waitFor(() => expect(deps.prepare).toHaveBeenCalledTimes(1))
    expect(deps.dispose).not.toHaveBeenCalled()
    persist.resolve()
    await vi.waitFor(() => expect(deps.dispose).toHaveBeenCalledTimes(1))
    expect(deps.quit).not.toHaveBeenCalled()
    dispose.resolve()
    await vi.waitFor(() => expect(deps.quit).toHaveBeenCalledTimes(1))
    const finalEvent = { preventDefault: vi.fn() }
    handle(finalEvent)
    expect(finalEvent.preventDefault).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
  })

  it("retains all owners after failed persistence and allows a safe retry", async () => {
    const { deps, event, handle } = fixture()
    deps.prepare.mockRejectedValueOnce(new Error("private storage detail"))
    handle(event)
    await vi.waitFor(() => expect(deps.failed).toHaveBeenCalledWith("prepare"))
    expect(deps.dispose).not.toHaveBeenCalled()
    expect(deps.quit).not.toHaveBeenCalled()
    handle(event)
    await vi.waitFor(() => expect(deps.quit).toHaveBeenCalledTimes(1))
    expect(deps.prepare).toHaveBeenCalledTimes(2)
    expect(deps.dispose).toHaveBeenCalledTimes(1)
  })

  it("retries incomplete disposal without calling the already disposed host again", async () => {
    const { deps, event, handle } = fixture()
    deps.dispose.mockRejectedValueOnce(new Error("private process detail"))
    handle(event)
    await vi.waitFor(() => expect(deps.failed).toHaveBeenCalledWith("dispose"))
    expect(deps.quit).not.toHaveBeenCalled()
    handle(event)
    await vi.waitFor(() => expect(deps.quit).toHaveBeenCalledTimes(1))
    expect(deps.prepare).toHaveBeenCalledTimes(1)
    expect(deps.dispose).toHaveBeenCalledTimes(2)
  })
})
