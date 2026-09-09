import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SessionCommandAdmission } from "../../apps/desktop/electron/collaboration/SessionCommandAdmission"
import { createCollaborationCommandSurface } from "../../apps/desktop/electron/collaboration/CollaborationCommandSurface"
import { SessionRuntimeHost } from "../../apps/desktop/electron/collaboration/SessionRuntimeHost"
import type { SessionWorkspaceCoordinator } from "../../apps/desktop/electron/collaboration/SessionWorkspaceCoordinator"
import type { CollaborationSessionRuntime } from "../../apps/desktop/electron/collaboration/CollaborationSessionRuntime"
import type { SessionWorkspaceBinding } from "../../shared/collaborationDesktop"

vi.mock("electron", () => ({ safeStorage: {} }))
vi.mock("../../apps/desktop/electron/collaboration/DeviceCollaborationGateway", () => ({
  DeviceCollaborationGateway: class { post = vi.fn(async () => null); accessToken = vi.fn(async () => "main-token") },
  CollaborationGatewayUnavailable: class extends Error {},
}))
vi.mock("../../apps/desktop/electron/collaboration/SessionKeyManager", () => ({ SessionKeyManager: class {} }))
vi.mock("../../apps/desktop/electron/collaboration/SessionKeyCache", () => ({ SessionKeyCache: class {} }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  const events: string[] = []
  let binding: SessionWorkspaceBinding = { generation: 3, sessionId: "session", projectId: "project", repositoryId: "repository", workspaceId: "workspace", sourceWorkspaceId: "source", sessionBranch: "cozea/collab/session", baseCommitSha: "a".repeat(40), role: "editor", state: "active", joinedAt: 1 }
  const coordinator = {
    getBinding: vi.fn(async () => binding),
    suspendActions: vi.fn(async () => { events.push("suspend"); return "workspace" }),
    leave: vi.fn(async (_id: string, end: boolean) => { events.push("leave"); binding = { ...binding, state: end ? "ended" : "left" }; return binding }),
    restoreSourceFocus: vi.fn(async () => { events.push("restore") }),
    adoptPublished: vi.fn(async () => binding),
  }
  const runtime = {
    stop: vi.fn(async () => { events.push("stop") }),
    reportRecoveryError: vi.fn(), applyEditorUpdate: vi.fn(async (_update: Uint8Array) => {}),
    files: { files: () => [{ path: "live.ts", originalPath: "old.ts" }] },
    waitForSequence: vi.fn(async (_sequence: number) => {}), projectFiles: vi.fn(async () => {}), checkpointPublished: vi.fn(async (_sequence: number) => {}),
  }
  const stopWriters = vi.fn(async (_workspaceId: string) => { events.push("writers") })
  const host = new SessionRuntimeHost(coordinator as unknown as SessionWorkspaceCoordinator, "/unused-fixture", vi.fn(), stopWriters)
  const hosted = { runtime: runtime as unknown as CollaborationSessionRuntime, timer: setInterval(() => {}, 15_000), unsubscribe: vi.fn(), projectId: "project", maintenance: null, publication: Promise.resolve(), ready: true, recoveryRequired: false }
  const sessions = Reflect.get(host, "sessions") as Map<string, typeof hosted>
  sessions.set("session", hosted)
  return { host, coordinator, runtime, hosted, sessions, stopWriters, events, surface: createCollaborationCommandSurface(host) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

describe("session command admission", () => {
  it("fences synchronously and drains accepted callbacks", async () => {
    const gate = new SessionCommandAdmission(), saved = deferred(), events: string[] = []
    const accepted = gate.run("s", async () => { events.push("start"); await saved.promise; events.push("saved") })
    gate.fence("s")
    await expect(gate.run("s", async () => {})).rejects.toThrow("no new commands")
    let drained = false
    const drain = gate.drain("s").then(() => { drained = true })
    await Promise.resolve(); expect(drained).toBe(false)
    saved.resolve(); await accepted; await drain
    expect(events).toEqual(["start", "saved"])
    gate.resume("s"); await expect(gate.run("s", async () => 7)).resolves.toBe(7)
  })

  it("reports a rejected command without poisoning draining or another session", async () => {
    const gate = new SessionCommandAdmission()
    await expect(gate.run("s", async () => { throw new Error("disk full") })).rejects.toThrow("disk full")
    gate.fence("s"); await gate.drain("s")
    await expect(gate.run("other", async () => "ok")).resolves.toBe("ok")
    gate.fenceAll(); await expect(gate.run("other", async () => {})).rejects.toThrow()
    gate.allowAfterShutdownFailure()
    await expect(gate.run("s", async () => {})).rejects.toThrow()
  })

  it("does not resume a fenced owner while its accepted work is pending", async () => {
    const gate = new SessionCommandAdmission(), saved = deferred()
    const accepted = gate.run("s", () => saved.promise)
    gate.fence("s"); expect(() => gate.resume("s")).toThrow("Drain")
    saved.resolve(); await accepted; await gate.drain("s"); gate.resume("s")
  })
})

describe("registered collaboration lifecycle", () => {
  it("legacy Leave drains an admitted editor write before stopping or switching", async () => {
    const f = fixture(), saved = deferred()
    f.runtime.applyEditorUpdate.mockImplementation(async () => { f.events.push("edit"); await saved.promise; f.events.push("saved") })
    const edit = f.surface.runtime.edit({ sessionId: "session", update: new Uint8Array([1]) })
    const leave = f.surface.legacy.leave({ sessionId: "session", ended: false })
    await expect(f.surface.runtime.edit({ sessionId: "session", update: new Uint8Array([2]) })).rejects.toThrow("not ready")
    expect(f.stopWriters).not.toHaveBeenCalled()
    saved.resolve(); await edit; const binding = await leave
    expect(binding.state).toBe("left")
    expect(f.events).toEqual(["edit", "saved", "suspend", "writers", "stop", "leave"])
    expect(f.hosted.unsubscribe).toHaveBeenCalledOnce()
    expect(f.sessions.size).toBe(0)
  })

  it("rejects retry while Leave or Quit is draining accepted work", async () => {
    const f = fixture(), saved = deferred()
    const accepted = f.host.withRuntime("session", () => saved.promise)
    const leaving = f.host.leave("session", false)
    await expect(f.surface.runtime.retry("session")).rejects.toThrow("exit")
    saved.resolve(); await accepted; await leaving
    const other = fixture(), second = deferred()
    const edit = other.host.withRuntime("session", () => second.promise)
    const quit = other.host.shutdown()
    await expect(other.surface.runtime.retry("session")).rejects.toThrow("exit")
    second.resolve(); await edit; await quit
  })

  it("host adoption derives protection from its canonical runtime", async () => {
    const f = fixture()
    Reflect.set(f.host, "gateway", {
      post: async () => ({ session: { publishedThroughSequence: 12 } }),
      accessToken: async () => "trusted-main-token",
    })
    await f.surface.legacy.adoptPublished({ sessionId: "session", accessToken: "renderer-token", sharedPaths: ["forged.ts"] })
    expect(f.runtime.waitForSequence).toHaveBeenCalledWith(12)
    expect(f.coordinator.adoptPublished).toHaveBeenCalledWith("session", "trusted-main-token", ["live.ts", "old.ts"])
    expect(f.runtime.checkpointPublished).toHaveBeenCalledWith(12)
  })

  it("single-flights repeated Leave requests", async () => {
    const f = fixture(), writers = deferred()
    f.stopWriters.mockImplementation(() => writers.promise)
    const first = f.host.leave("session", false)
    expect(f.host.leave("session", false)).toBe(first)
    writers.resolve(); await first
    expect(f.runtime.stop).toHaveBeenCalledOnce()
    expect(f.coordinator.leave).toHaveBeenCalledOnce()
  })

  it("retains a failed writer owner, rejects new work, and retries Leave", async () => {
    const f = fixture()
    f.stopWriters.mockRejectedValueOnce(new Error("writer did not stop"))
    await expect(f.host.leave("session", false)).rejects.toThrow("writer did not stop")
    expect(f.runtime.stop).not.toHaveBeenCalled()
    expect(f.coordinator.leave).not.toHaveBeenCalled()
    expect(f.sessions.has("session")).toBe(true)
    await expect(f.surface.runtime.deleteFile({ sessionId: "session", fileId: "f" })).rejects.toThrow("not ready")
    await f.host.leave("session", false)
    expect(f.coordinator.leave).toHaveBeenCalledOnce()
  })

  it("does not switch the source workspace after a failed durable runtime stop", async () => {
    const f = fixture()
    f.runtime.stop.mockRejectedValueOnce(new Error("recovery flush failed"))
    await expect(f.host.leave("session", false)).rejects.toThrow("recovery flush failed")
    expect(f.coordinator.leave).not.toHaveBeenCalled()
    expect(f.hosted.unsubscribe).not.toHaveBeenCalled()
    await f.host.leave("session", false)
    expect(f.coordinator.leave).toHaveBeenCalledOnce()
  })

  it("waits for an in-flight Open before completing Leave", async () => {
    const f = fixture(), opening = deferred()
    const openings = Reflect.get(f.host, "opening") as Map<string, Promise<boolean>>
    openings.set("session", opening.promise.then(() => true))
    const leaving = f.host.leave("session", false)
    await Promise.resolve(); expect(f.stopWriters).not.toHaveBeenCalled()
    await expect(f.host.open("session", "source")).rejects.toThrow("Leave")
    opening.resolve(); await leaving
    expect(f.coordinator.leave).toHaveBeenCalledOnce()
  })

  it("Quit fences new commands and drains accepted work before destruction", async () => {
    const f = fixture(), saved = deferred()
    const edit = f.host.withRuntime("session", () => saved.promise)
    const quit = f.host.shutdown()
    await expect(f.host.withRuntime("session", async () => {})).rejects.toThrow()
    expect(f.runtime.stop).not.toHaveBeenCalled()
    saved.resolve(); await edit; await quit
    expect(f.events).toEqual(["suspend", "writers", "stop"])
    expect(f.sessions.size).toBe(0)
  })

  it("does not end the remote session before writer and runtime shutdown", async () => {
    const f = fixture()
    const control = vi.spyOn(f.host, "control").mockImplementation(async <T>(operation: string) => { f.events.push(operation); return null as T })
    await f.host.leave("session", true)
    expect(f.events).toEqual(["suspend", "writers", "stop", "closeSession", "leave"])
    expect(control).toHaveBeenCalledWith("closeSession", { sessionId: "session" })
  })

  it("legacy prepare delegates to the runtime, not renderer credentials", async () => {
    const f = fixture(), binding = await f.coordinator.getBinding()
    const prepare = vi.spyOn(f.host, "prepareBinding").mockResolvedValue(binding)
    await f.surface.legacy.prepare({ sessionId: "session", sourceWorkspaceId: "source", accessToken: "renderer-token" })
    expect(prepare).toHaveBeenCalledWith("session", "source")
  })

  it("legacy adoption ignores renderer-provided path protection and credentials", async () => {
    const f = fixture(), binding = await f.coordinator.getBinding()
    const adopt = vi.spyOn(f.host, "adoptPublished").mockResolvedValue(binding)
    await f.surface.legacy.adoptPublished({ sessionId: "session", accessToken: "renderer-token", sharedPaths: ["forged.ts"] })
    expect(adopt).toHaveBeenCalledWith("session")
  })

  it("generic renderer control cannot bypass close, leave or commit ownership", async () => {
    const f = fixture(), control = vi.spyOn(f.host, "control")
    for (const operation of ["closeSession", "leaveSession", "acquireCommitLease", "markLocalCommitReady", "beginPush", "releaseCommitLease"]) {
      await expect(f.surface.runtime.control({ operation, args: { sessionId: "session" } })).rejects.toThrow("session runtime")
    }
    expect(control).not.toHaveBeenCalled()
    await f.surface.runtime.control({ operation: "listForProject", args: { projectId: "project" } })
    expect(control).toHaveBeenCalledOnce()
  })
})
