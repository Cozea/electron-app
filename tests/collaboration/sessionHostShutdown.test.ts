import { afterEach, describe, expect, it, vi } from "vitest"
import type { SessionWorkspaceCoordinator } from "../../apps/desktop/electron/collaboration/SessionWorkspaceCoordinator"

vi.mock("electron", () => ({ safeStorage: {} }))
vi.mock("../../apps/desktop/electron/collaboration/DeviceCollaborationGateway", () => ({ DeviceCollaborationGateway: class {}, CollaborationGatewayUnavailable: class extends Error {} }))
vi.mock("../../apps/desktop/electron/collaboration/SessionKeyManager", () => ({ SessionKeyManager: class {} }))
vi.mock("../../apps/desktop/electron/collaboration/SessionKeyCache", () => ({ SessionKeyCache: class {} }))
vi.mock("../../apps/desktop/electron/collaboration/NativeWorkspaceBridge", () => ({ activateNativeWorkspaceRoot: vi.fn() }))
import { SessionRuntimeHost } from "../../apps/desktop/electron/collaboration/SessionRuntimeHost"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(finish => { resolve = finish })
  return { promise, resolve }
}
function fixture() {
  const suspend = vi.fn(async (id: string) => id)
  const stop = vi.fn(async () => {})
  const host = new SessionRuntimeHost({ suspendActions: suspend } as unknown as SessionWorkspaceCoordinator, "/tmp/cozea-host-test", () => {}, stop)
  // Lifecycle fixtures bypass key/bootstrap networking, not the production
  // shutdown method. Their only resources are explicit mock owners and timers.
  const state = host as unknown as {
    sessions: Map<string, ReturnType<typeof session>>
    opening: Map<string, Promise<boolean>>
  }
  return { host, state, suspend, stop }
}
function session() {
  return {
    ready: true, maintenance: null as Promise<void> | null, publication: Promise.resolve(),
    runtime: { stop: vi.fn(async () => {}) }, unsubscribe: vi.fn(), timer: setInterval(() => {}, 60_000),
  }
}
const timers: ReturnType<typeof setInterval>[] = []
afterEach(() => { for (const timer of timers.splice(0)) clearInterval(timer) })
function trackedSession() { const value = session(); timers.push(value.timer); return value }

describe("application-scoped session shutdown", () => {
  it("retains only failed owners for retry after a partial shutdown", async () => {
    const { host, state, stop } = fixture()
    const a = trackedSession(), b = trackedSession()
    state.sessions.set("a", a); state.sessions.set("b", b)
    stop.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("owner remains alive"))
    await expect(host.shutdown()).rejects.toThrow("owner remains alive")
    expect(state.sessions.has("a")).toBe(false)
    expect(state.sessions.has("b")).toBe(true)
    expect(a.runtime.stop).toHaveBeenCalledTimes(1)
    expect(b.runtime.stop).not.toHaveBeenCalled()
    await host.shutdown()
    expect(state.sessions.size).toBe(0)
    expect(a.runtime.stop).toHaveBeenCalledTimes(1)
    expect(b.runtime.stop).toHaveBeenCalledTimes(1)
  })

  it("drains in-flight maintenance and publications before destroying the owner", async () => {
    const { host, state, stop } = fixture()
    const maintenance = deferred(), publication = deferred()
    const hosted = trackedSession()
    hosted.maintenance = maintenance.promise; hosted.publication = publication.promise
    state.sessions.set("a", hosted)
    const closed = host.shutdown()
    expect(host.shutdown()).toBe(closed)
    await vi.waitFor(() => expect(hosted.ready).toBe(false))
    expect(stop).not.toHaveBeenCalled()
    maintenance.resolve()
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
    expect(hosted.runtime.stop).not.toHaveBeenCalled()
    publication.resolve(); await closed
    expect(hosted.runtime.stop).toHaveBeenCalledTimes(1)
  })

  it("includes joins already in progress and rejects new opens after the quit fence", async () => {
    const { host, state } = fixture()
    const joining = deferred(), hosted = trackedSession()
    state.opening.set("a", joining.promise.then(() => { state.sessions.set("a", hosted); return true }))
    const closed = host.shutdown()
    await expect(host.open("new", "source")).rejects.toThrow("before quit")
    joining.resolve(); await closed
    expect(hosted.runtime.stop).toHaveBeenCalledTimes(1)
    expect(state.sessions.size).toBe(0)
  })
})
