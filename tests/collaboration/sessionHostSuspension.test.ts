import { afterEach, expect, it, vi } from "vitest"
import type { SessionWorkspaceCoordinator } from "../../apps/desktop/electron/collaboration/SessionWorkspaceCoordinator"
const state = vi.hoisted(() => ({ fail: "", controls: [] as string[], authorityLost: () => {}, stopped: 0 }))
vi.mock("electron", () => ({ safeStorage: {} }))
vi.mock("../../apps/desktop/electron/collaboration/SessionKeyCache", () => ({ SessionKeyCache: class {} }))
vi.mock("../../apps/desktop/electron/collaboration/SessionKeyManager", () => ({ SessionKeyManager: class {
  async ensure() { return { roomKeyBase64: "key", keyVersion: 1, session: { projectId: "p", roomId: "session:s" } } }
} }))
vi.mock("../../apps/desktop/electron/collaboration/DeviceCollaborationGateway", () => ({ DeviceCollaborationGateway: class {
  async accessToken() { return "controlled-token" }
  async post(route: string, body: { operation?: string }) {
    if (route.endsWith("control")) { state.controls.push(body.operation!); return {} }
    return { role: "editor", session: { projectId: "p" } }
  }
}, CollaborationGatewayUnavailable: class extends Error {} }))
vi.mock("../../apps/desktop/electron/collaboration/NativeWorkspaceBridge", () => ({ activateNativeWorkspaceRoot: async () => {
  if (state.fail === "activate") { state.fail = ""; throw new Error("activate failed") }
} }))
vi.mock("../../apps/desktop/electron/collaboration/CollaborationSessionRuntime", () => ({ CollaborationSessionRuntime: class {
  files = { files: () => [] }
  constructor(options: { onAuthorityFailure: () => void }) { state.authorityLost = options.onAuthorityFailure }
  subscribe() { return () => {} }
  reportRecoveryError() {}
  async start() { if (state.fail === "start") { state.fail = ""; throw new Error("start failed") }; return true }
  async readyForWorkspace() { if (state.fail === "projection") { state.fail = ""; throw new Error("projection failed") } }
  async stop() { state.stopped++ }
} }))
import { SessionRuntimeHost } from "../../apps/desktop/electron/collaboration/SessionRuntimeHost"
const hosts: SessionRuntimeHost[] = []
afterEach(async () => { for (const host of hosts.splice(0)) await host.shutdown(); state.fail = ""; state.controls = []; state.stopped = 0 })
function fixture() {
  const binding = { projectId: "p", sessionId: "s", sourceWorkspaceId: "source", state: "joining" }
  const coordinator = {
    prepare: vi.fn(async () => binding), getBinding: async () => binding,
    workspaceForSession: async () => ({ projectRootPath: "/tmp/controlled-session", workspaceId: "session-workspace" }),
    activate: async () => { binding.state = "active" }, adoptPublished: async () => {}, recordRecoveryKey: async () => {},
    suspendActions: vi.fn(async () => { binding.state = "joining"; return "session-workspace" }),
    restoreSourceFocus: vi.fn(async () => {}), leave: vi.fn(async () => { binding.state = "left" }),
  }
  const stop = vi.fn(async () => {})
  const host = new SessionRuntimeHost(coordinator as unknown as SessionWorkspaceCoordinator, "/tmp/controlled-host", () => {}, stop)
  hosts.push(host)
  return { host, coordinator, binding, stop }
}
it.each(["start", "projection", "activate"])("suspends %s failure locally and retries without leaving membership", async stage => {
  const f = fixture(); state.fail = stage
  await expect(f.host.open("s", "source")).rejects.toThrow(`${stage} failed`)
  expect(state.controls).toEqual([])
  expect(f.coordinator.leave).not.toHaveBeenCalled()
  expect(f.binding.state).toBe("joining")
  expect(f.coordinator.restoreSourceFocus).toHaveBeenCalledTimes(1)
  expect(await f.host.open("s", "source")).toBe(true)
  expect(state.controls).toEqual([])
  await f.host.leave("s", false)
  expect(state.controls).toEqual(["leaveSession"])
  expect(f.coordinator.leave).toHaveBeenCalledTimes(1)
})
it("authority loss fences locally and retains a failed owner until suspension retries", async () => {
  const f = fixture(); await f.host.open("s", "source")
  f.stop.mockRejectedValueOnce(new Error("owner remains alive"))
  state.authorityLost()
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledTimes(1))
  expect(state.stopped).toBe(0)
  expect(state.controls).toEqual([])
  state.authorityLost()
  await vi.waitFor(() => expect(state.stopped).toBe(1))
  expect(f.coordinator.restoreSourceFocus).toHaveBeenCalledTimes(1)
  expect(state.controls).toEqual([])
  expect(await f.host.open("s", "source")).toBe(true)
})

it.each(["suspend", "restart", "leave"])("drains maintenance and publication before %s removes an owner", async action => {
  const f = fixture(); await f.host.open("s", "source")
  let finishMaintenance = () => {}, finishPublication = () => {}
  const maintenance = new Promise<void>(resolve => { finishMaintenance = resolve })
  const publication = new Promise<void>(resolve => { finishPublication = resolve })
  const internals = f.host as unknown as {
    sessions: Map<string, { maintenance: Promise<void> | null; publication: Promise<void>; ready: boolean }>
    suspendLocal(id: string): Promise<void>
    restartSession(id: string, source: string): Promise<void>
  }
  const hosted = internals.sessions.get("s")!
  hosted.maintenance = maintenance; hosted.publication = publication
  const operation = action === "suspend" ? internals.suspendLocal("s") : action === "restart" ? internals.restartSession("s", "source") : f.host.leave("s", false)
  void operation.catch(() => {})
  try {
    await vi.waitFor(() => expect(hosted.ready).toBe(false))
    expect(internals.sessions.get("s")).toBe(hosted)
    expect(state.stopped).toBe(0)
    finishMaintenance()
    // A queued publication remains an owned writer after maintenance drains.
    await Promise.resolve(); await Promise.resolve()
    expect(internals.sessions.get("s")).toBe(hosted)
    expect(state.stopped).toBe(0)
    finishPublication(); await operation
    expect(internals.sessions.get("s")).not.toBe(hosted)
    expect(state.stopped).toBe(1)
  } finally { finishMaintenance(); finishPublication(); await operation.catch(() => {}) }
})
