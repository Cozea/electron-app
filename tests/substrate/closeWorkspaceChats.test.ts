import { describe, expect, it, vi } from "vitest"
import { ProjectId, ThreadId, ProviderInstanceId, type OrchestrationShellSnapshot, type OrchestrationThreadShell } from "@cozea/contracts/t3"
import { closeWorkspaceChats } from "../../apps/server/src/closeWorkspaceChats"
const stamp = "2026-10-02T00:00:00.000Z"
const projectId = ProjectId.make("assistant-project")
function thread(id = "saved", owner = projectId): OrchestrationThreadShell {
  const threadId = ThreadId.make(id)
  return { id: threadId, projectId: owner, title: "Saved chat", modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "model" }, runtimeMode: "approval-required", interactionMode: "default",
    branch: null, worktreePath: null, latestTurn: null, createdAt: stamp, updatedAt: stamp,
    archivedAt: null, settledOverride: null, settledAt: null, latestUserMessageAt: null,
    hasPendingApprovals: false, hasPendingUserInput: false, hasActionableProposedPlan: false,
    session: { threadId, status: "ready", providerName: "codex", runtimeMode: "approval-required", updatedAt: stamp, lastError: null, activeTurnId: null },
  }
}
function snapshot(threads: OrchestrationThreadShell[]): OrchestrationShellSnapshot {
  return { snapshotSequence: 1, projects: [{ id: projectId, title: "Saved project", workspaceRoot: "/project", defaultModelSelection: null, scripts: [], createdAt: stamp, updatedAt: stamp }], threads, updatedAt: stamp }
}
describe("native chat workspace close", () => {
  it("stops exact-root idle chats including archived chats, preserving IDs and unrelated sessions", async () => {
    const saved = { ...thread(), archivedAt: stamp }
    const unrelated = thread("other", ProjectId.make("other-project"))
    const before = snapshot([saved, unrelated])
    const after = snapshot([{ ...saved, session: { ...saved.session!, status: "stopped" } }, unrelated])
    const backend = { getSnapshot: vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after), dispatchCommand: vi.fn().mockResolvedValue({ sequence: 2 }) }
    await closeWorkspaceChats(backend, ["/project"])
    expect(backend.dispatchCommand).toHaveBeenCalledTimes(1)
    expect(backend.dispatchCommand.mock.calls[0][0]).toMatchObject({ type: "thread.session.stop", threadId: saved.id })
    expect(before.threads[0].session?.status).toBe("ready")
    expect(after.threads[1].session?.status).toBe("ready")
  })
  it("blocks a running chat or background activity before any stop command", async () => {
    for (const busy of [{ session: { ...thread().session!, status: "running" as const } }, { backgroundLiveness: "monitoring" as const }]) {
      const backend = { getSnapshot: vi.fn().mockResolvedValue(snapshot([{ ...thread(), ...busy }])), dispatchCommand: vi.fn() }
      await expect(closeWorkspaceChats(backend, ["/project"])).rejects.toThrow("Stop running chats")
      expect(backend.dispatchCommand).not.toHaveBeenCalled()
    }
  })
  it("includes a thread's exact worktree scope without stopping neighboring roots", async () => {
    const saved = { ...thread("worktree", ProjectId.make("other-project")), worktreePath: "/worktree" }
    const unrelated = { ...thread("neighbor", ProjectId.make("other-project")), worktreePath: "/worktree-neighbor" }
    const backend = { getSnapshot: vi.fn().mockResolvedValueOnce(snapshot([saved, unrelated])).mockResolvedValue(snapshot([{ ...saved, session: { ...saved.session!, status: "stopped" } }, unrelated])), dispatchCommand: vi.fn().mockResolvedValue({ sequence: 2 }) }
    await closeWorkspaceChats(backend, ["/worktree"])
    expect(backend.dispatchCommand).toHaveBeenCalledTimes(1)
    expect(backend.dispatchCommand.mock.calls[0][0]).toMatchObject({ threadId: saved.id })
  })
  it("does not treat a failed command or malformed authoritative snapshot as success", async () => {
    const backend = { getSnapshot: vi.fn().mockResolvedValue(snapshot([thread()])), dispatchCommand: vi.fn().mockRejectedValue(new Error("lost stop reply")) }
    await expect(closeWorkspaceChats(backend, ["/project"])).rejects.toThrow("lost stop reply")
    backend.getSnapshot.mockResolvedValue({})
    await expect(closeWorkspaceChats(backend, ["/project"])).rejects.toThrow()
  })
  it("waits for the stopped snapshot rather than trusting command acceptance", async () => {
    const saved = thread()
    const stopped = { ...saved, session: { ...saved.session!, status: "stopped" as const } }
    const backend = { getSnapshot: vi.fn().mockResolvedValueOnce(snapshot([saved])).mockResolvedValueOnce(snapshot([saved])).mockResolvedValue(snapshot([stopped])), dispatchCommand: vi.fn().mockResolvedValue({ sequence: 2 }) }
    await closeWorkspaceChats(backend, ["/project"])
    expect(backend.getSnapshot).toHaveBeenCalledTimes(3)
  })
})
