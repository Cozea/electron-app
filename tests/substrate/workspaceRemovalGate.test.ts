import { describe, expect, it, vi } from "vitest"
import { ProjectId } from "@cozea/contracts/t3"
import { assertWorkspaceRequestAllowed } from "../../apps/server/src/workspaceRemovalGate"
const stamp = "2026-10-02T00:00:00.000Z"
const snapshot = { snapshotSequence: 1, threads: [], updatedAt: stamp, projects: [{ id: ProjectId.make("native"), title: "Native", workspaceRoot: "/source", defaultModelSelection: null, scripts: [], createdAt: stamp, updatedAt: stamp }] }
describe("native workspace request removal gate", () => {
  it("blocks chat and native terminal/Git requests by execution root", async () => {
    for (const [method, payload] of [["orchestration.dispatchCommand", { projectId: "native" }], ["terminal.open", { cwd: "/source/subfolder" }], ["vcs.createWorktree", { cwd: "/source" }], ["git.runStackedAction", { cwd: "/other", worktreePath: "/source" }]] as const) {
      await expect(assertWorkspaceRequestAllowed(method, payload, ["/source"], async () => snapshot)).rejects.toThrow("excluded")
    }
  })
  it("normalizes traversal but leaves neighboring roots and server subscriptions available", async () => {
    await expect(assertWorkspaceRequestAllowed("terminal.open", { cwd: "/source/sub/.." }, ["/source"], async () => snapshot)).rejects.toThrow("excluded")
    await expect(assertWorkspaceRequestAllowed("terminal.open", { cwd: "/source-neighbor" }, ["/source"], async () => snapshot)).resolves.toBeUndefined()
    const read = vi.fn()
    await assertWorkspaceRequestAllowed("server.getConfig", {}, ["/source"], read)
    expect(read).not.toHaveBeenCalled()
  })
  it("fails closed when exclusion exists but authority is malformed", async () => {
    await expect(assertWorkspaceRequestAllowed("vcs.pull", { cwd: "/other" }, ["/source"], async () => ({}))).rejects.toThrow()
  })
})
