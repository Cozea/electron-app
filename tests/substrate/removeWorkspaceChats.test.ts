import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ProjectId, ThreadId, type OrchestrationShellSnapshot } from "@cozea/contracts/t3"
import { removeWorkspaceChats } from "../../apps/server/src/removeWorkspaceChats"

const stamp = "2026-10-02T00:00:00.000Z"
const owner = ProjectId.make("native-project")
const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-native-removal-"))
  directories.push(directory)
  const snapshot: OrchestrationShellSnapshot = {
    snapshotSequence: 1, updatedAt: stamp,
    projects: [{ id: owner, title: "Native", workspaceRoot: "/source", defaultModelSelection: null, scripts: [], createdAt: stamp, updatedAt: stamp }],
    threads: [],
  }
  const backend = {
    getSnapshot: vi.fn(async () => structuredClone(snapshot)),
    dispatchCommand: vi.fn(async (command: unknown) => {
      const input = command as { type: string; threadId?: string; projectId?: string }
      if (input.type === "thread.delete") snapshot.threads = snapshot.threads.filter((thread) => thread.id !== input.threadId)
      if (input.type === "project.delete") snapshot.projects = snapshot.projects.filter((project) => project.id !== input.projectId)
      return { sequence: ++snapshot.snapshotSequence }
    }),
  }
  return { directory, snapshot, backend }
}
describe("native permanent data-removal evidence", () => {
  it("persists the exact native IDs before effects and leaves later history untouched on replay", async () => {
    const { directory, snapshot, backend } = await fixture()
    await removeWorkspaceChats(backend, ["/source"], "remove", directory)
    expect(snapshot.projects).toEqual([])
    const evidence = JSON.parse(await fs.readFile(path.join(directory, "remove.json"), "utf8"))
    expect(evidence.projects).toEqual([{ id: owner, root: "/source" }])
    snapshot.projects = [{ ...evidence.projects[0], id: ProjectId.make("new-native-project"), title: "New", workspaceRoot: "/source", defaultModelSelection: null, scripts: [], createdAt: stamp, updatedAt: stamp }]
    await removeWorkspaceChats(backend, ["/source"], "remove", directory)
    expect(snapshot.projects[0].id).toBe("new-native-project")
    expect(backend.dispatchCommand).toHaveBeenCalledTimes(1)
  })
  it("reconciles a lost deletion reply from the saved ID scope", async () => {
    const { directory, snapshot, backend } = await fixture()
    backend.dispatchCommand.mockImplementationOnce(async () => { snapshot.projects = []; throw new Error("Lost deletion reply") })
    await expect(removeWorkspaceChats(backend, ["/source"], "remove", directory)).rejects.toThrow("Lost deletion reply")
    await removeWorkspaceChats(backend, ["/source"], "remove", directory)
    expect(backend.dispatchCommand).toHaveBeenCalledTimes(1)
  })
  it("rejects malformed evidence, changed contexts and traversal before any deletion", async () => {
    const { directory, backend } = await fixture()
    await expect(removeWorkspaceChats(backend, ["/source"], "../escape", directory)).rejects.toThrow("Invalid")
    await fs.writeFile(path.join(directory, "remove.json"), JSON.stringify({ version: 1, operationId: "remove", roots: ["/source"], projects: [{ id: owner, root: "/changed" }], threads: [] }))
    await expect(removeWorkspaceChats(backend, ["/source"], "remove", directory)).rejects.toThrow("new or unconfirmed")
    await fs.writeFile(path.join(directory, "remove.json"), JSON.stringify({ version: 1, operationId: "remove", roots: ["/source"], projects: [null], threads: [] }))
    await expect(removeWorkspaceChats(backend, ["/source"], "remove", directory)).rejects.toThrow("another scope")
    expect(backend.dispatchCommand).not.toHaveBeenCalled()
  })
  it("does not delete a project that acquired a conversation outside its saved scope", async () => {
    const { directory, snapshot, backend } = await fixture()
    await fs.writeFile(path.join(directory, "remove.json"), JSON.stringify({ version: 1, operationId: "remove", roots: ["/source"], projects: [{ id: owner, root: "/source" }], threads: [] }))
    snapshot.threads = [{ id: ThreadId.make("later"), projectId: owner, title: "Later", modelSelection: { instanceId: "codex", model: "model" }, runtimeMode: "approval-required", interactionMode: "default", branch: null, worktreePath: null, latestTurn: null, session: null, createdAt: stamp, updatedAt: stamp, archivedAt: null, settledOverride: null, settledAt: null, latestUserMessageAt: null, hasPendingApprovals: false, hasPendingUserInput: false, hasActionableProposedPlan: false } as OrchestrationShellSnapshot["threads"][number]]
    await expect(removeWorkspaceChats(backend, ["/source"], "remove", directory)).rejects.toThrow("new or unconfirmed")
    expect(backend.dispatchCommand).not.toHaveBeenCalled()
  })
})
