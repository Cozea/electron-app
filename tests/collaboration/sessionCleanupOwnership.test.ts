import { afterEach, expect, it, vi } from "vitest"
import type { SessionWorkspaceCoordinator } from "../../apps/desktop/electron/collaboration/SessionWorkspaceCoordinator"
const state = vi.hoisted(() => ({ clean: vi.fn(async () => ({ files: 0, bytes: 0, unusedKeyVersions: [] as number[] })), prepare: vi.fn(async () => {}), ensure: vi.fn(), stop: vi.fn(async () => {}) }))
vi.mock("electron", () => ({ safeStorage: {} }))
vi.mock("../../apps/desktop/electron/collaboration/SessionKeyCache", () => ({ SessionKeyCache: class {} }))
vi.mock("../../apps/desktop/electron/collaboration/SessionKeyManager", () => ({ SessionKeyManager: class {
  async ensure() { state.ensure(); return this.recoverKey() }
  async recoverKey() { return { keyVersion: 1, roomKeyBase64: "key", session: { projectId: "p", roomId: "session:s" } } }
  async versions() { return [1] }
  async retireUnusedVersions() { return { files: 0, bytes: 0 } }
} }))
vi.mock("../../apps/desktop/electron/collaboration/InitializationBasisCleanup", () => ({ compactQuiescentInitializationBases: state.clean }))
vi.mock("../../apps/desktop/electron/collaboration/RecoveryStorageCleanup", () => ({ compactVerifiedRecoveryStore: async () => ({ files: 0, bytes: 0 }) }))
vi.mock("../../apps/desktop/electron/collaboration/DeviceCollaborationGateway", () => ({ DeviceCollaborationGateway: class {
  async accessToken() { return "controlled-token" }
  async post() { return { role: "editor", session: { projectId: "p" } } }
}, CollaborationGatewayUnavailable: class extends Error {} }))
vi.mock("../../apps/desktop/electron/collaboration/NativeWorkspaceBridge", () => ({ activateNativeWorkspaceRoot: async () => {} }))
vi.mock("../../apps/desktop/electron/collaboration/CollaborationSessionRuntime", () => ({ CollaborationSessionRuntime: class {
  files = { files: () => [] }
  subscribe() { return () => {} }
  reportRecoveryError() {}
  async start() { return true }
  async readyForWorkspace() {}
  async stop() { await state.stop() }
} }))
import { SessionRuntimeHost } from "../../apps/desktop/electron/collaboration/SessionRuntimeHost"
const hosts: SessionRuntimeHost[] = []
afterEach(async () => { state.stop.mockResolvedValue(undefined); for (const host of hosts.splice(0)) await host.shutdown(); vi.clearAllMocks() })
function fixture() {
  const binding = { generation: 3, sessionId: "s", projectId: "p", sourceWorkspaceId: "source", workspaceId: "room" }
  const coordinator = { getBinding: async () => binding, bindingForWorkspace: async () => binding,
    prepare: async () => { await state.prepare(); return binding },
    workspaceForSession: async () => ({ projectRootPath: "/tmp/controlled-room", workspaceId: "room" }),
    activate: async () => {}, adoptPublished: async () => {}, recordRecoveryKey: async () => {},
    suspendActions: async () => "room", restoreSourceFocus: async () => {}, leave: async () => {} }
  const host = new SessionRuntimeHost(coordinator as unknown as SessionWorkspaceCoordinator, "/tmp/controlled-host", () => {}, async () => {})
  hosts.push(host)
  return host
}
function deferred() { let resolve = () => {}; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

it("cannot inventory bases while a Start is still preparing or after its runtime becomes active", async () => {
  const host = fixture(), gate = deferred()
  state.prepare.mockImplementationOnce(() => gate.promise)
  const opening = host.open("s", "source"), cleanup = host.cleanupRecovery("s")
  try {
    await vi.waitFor(() => expect(state.prepare).toHaveBeenCalledOnce())
    expect(state.clean).not.toHaveBeenCalled()
    gate.resolve(); await opening; await cleanup
    expect(state.clean).not.toHaveBeenCalled()
  } finally { gate.resolve(); await Promise.allSettled([opening, cleanup]) }
})
it("holds a later Start until quiescent basis cleanup finishes", async () => {
  const host = fixture(), gate = deferred()
  state.clean.mockImplementationOnce(async () => { await gate.promise; return { files: 0, bytes: 0, unusedKeyVersions: [] } })
  const cleanup = host.cleanupRecovery("s")
  await vi.waitFor(() => expect(state.clean).toHaveBeenCalledOnce())
  const opening = host.open("s", "source")
  try {
    await Promise.resolve(); await Promise.resolve()
    expect(state.ensure).not.toHaveBeenCalled()
    gate.resolve(); await cleanup; await opening
    expect(state.ensure).toHaveBeenCalledOnce()
  } finally { gate.resolve(); await Promise.allSettled([cleanup, opening]) }
})
it("retains initialization bases while a failed runtime owner remains alive", async () => {
  const host = fixture(); await host.open("s", "source")
  state.stop.mockRejectedValueOnce(new Error("owner has not stopped"))
  await expect(host.leave("s", false)).rejects.toThrow("not stopped")
  await host.cleanupRecovery("s")
  expect(state.clean).not.toHaveBeenCalled()
  await host.leave("s", false)
  await host.cleanupRecovery("s")
  expect(state.clean).toHaveBeenCalledOnce()
})
it("drains admitted cleanup before quit and rejects new cleanup after the quit fence", async () => {
  const host = fixture(), gate = deferred()
  state.clean.mockImplementationOnce(async () => { await gate.promise; return { files: 0, bytes: 0, unusedKeyVersions: [] } })
  const cleanup = host.cleanupRecovery("s")
  await vi.waitFor(() => expect(state.clean).toHaveBeenCalledOnce())
  let stopped = false
  const stopping = host.shutdown().then(() => { stopped = true })
  try {
    await Promise.resolve(); await Promise.resolve(); expect(stopped).toBe(false)
    await expect(host.cleanupRecovery("s")).rejects.toThrow("before quit")
    gate.resolve(); await cleanup; await stopping; expect(stopped).toBe(true)
  } finally { gate.resolve(); await Promise.allSettled([cleanup, stopping]) }
})
