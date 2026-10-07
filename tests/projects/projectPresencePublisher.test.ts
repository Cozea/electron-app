import { describe, expect, it, vi, afterEach } from "vitest"
import { createProjectPresencePublisher } from "@/hooks/projectPresencePublisher"

afterEach(() => vi.useRealTimers())
function fixture(scope?: string) {
  let visible = true
  let visibility = () => {}
  const heartbeat = vi.fn(async () => {})
  const leave = vi.fn(async () => {})
  const owner = createProjectPresencePublisher({ heartbeat, leave,
    isVisible: () => visible, onVisibilityChange: (callback) => { visibility = callback; return () => { visibility = () => {} } },
    setInterval: (callback, delay) => setInterval(callback, delay), clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>), onError: vi.fn(),
  }, scope)
  return { owner, heartbeat, leave, visibility: (next: boolean) => { visible = next; visibility() } }
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe("single foreground project presence owner", () => {
  it("publishes once, throttles transitions and releases while hidden", async () => {
    vi.useFakeTimers()
    const f = fixture()
    await settle()
    expect(f.heartbeat).toHaveBeenCalledTimes(1)
    f.owner.update(1000); f.owner.update(1100)
    await settle()
    expect(f.heartbeat).toHaveBeenCalledTimes(2)
    f.visibility(false)
    await settle()
    expect(f.leave).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(f.heartbeat).toHaveBeenCalledTimes(2)
    f.visibility(true)
    await settle()
    expect(f.heartbeat).toHaveBeenCalledTimes(3)
    f.owner.stop()
    await settle()
    expect(f.leave).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("an old owner's delayed cleanup cannot leave a replacement owner's presence", async () => {
    vi.useFakeTimers()
    const old = fixture("shared:device")
    old.owner.stop()
    const next = fixture("shared:device")
    await settle()
    expect(next.heartbeat).toHaveBeenCalledTimes(1)
    expect(old.leave).not.toHaveBeenCalled()
    next.owner.stop()
    await settle()
    await vi.runOnlyPendingTimersAsync()
    expect(next.leave).toHaveBeenCalledTimes(1)
  })

  it("waits for a pending heartbeat before sending leave", async () => {
    vi.useFakeTimers()
    let resolve!: () => void
    const heartbeat = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    const leave = vi.fn(async () => {})
    const owner = createProjectPresencePublisher({ heartbeat, leave, isVisible: () => true,
      onVisibilityChange: () => () => {}, setInterval: (callback, delay) => setInterval(callback, delay),
      clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>), onError: vi.fn() })
    owner.stop()
    expect(leave).not.toHaveBeenCalled()
    resolve()
    await settle()
    expect(leave).toHaveBeenCalledTimes(1)
  })
})
