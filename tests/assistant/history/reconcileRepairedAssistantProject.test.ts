import { describe, expect, it, vi } from "vitest"
import { ProjectId, ThreadId, ProviderInstanceId, type OrchestrationReadModel, type OrchestrationThread } from "@cozea/assistant-contracts"
import type { LocalProjectId, ProjectOperationDTO } from "../../../shared/localProjectTypes"
import { reconcileRepairedAssistantProject } from "@/features/assistant/history/reconcileRepairedAssistantProject"

const projectId = ProjectId.make("assistant-project")
const threadId = ThreadId.make("saved-thread")
const stamp = "2026-10-02T00:00:00.000Z"
const repair: ProjectOperationDTO = {
  operationId: "repair", projectId: "lpj_local" as LocalProjectId, kind: "repair", state: "completed", stage: "completed",
  details: { workspaceId: "workspace", previousFolder: "/original", sourceFolder: "/moved", expectedWorkspaceRevision: "1" },
  requestDetails: {}, revision: 5, lastError: null, createdAt: 1, updatedAt: 2,
}
function snapshot(root = "/original", threads: OrchestrationThread[] = []): OrchestrationReadModel {
  return { snapshotSequence: 1, projects: [{ id: projectId, title: "Project", workspaceRoot: root, defaultModelSelection: null, scripts: [], createdAt: stamp, updatedAt: stamp, deletedAt: null }], threads, updatedAt: stamp }
}
function thread(): OrchestrationThread {
  return { id: threadId, projectId, title: "Saved chat", modelSelection: { provider: "codex", instanceId: ProviderInstanceId.make("codex"), model: "model" },
    runtimeMode: "approval-required", interactionMode: "default", branch: null, worktreePath: null, latestTurn: null,
    createdAt: stamp, updatedAt: stamp, deletedAt: null, messages: [], proposedPlans: [], activities: [], checkpoints: [],
    session: { threadId, status: "ready", providerName: "codex", runtimeMode: "approval-required", updatedAt: stamp, lastError: null, activeTurnId: null },
  }
}
function input() {
  const getSnapshot = vi.fn().mockResolvedValue(snapshot())
  const dispatchCommand = vi.fn().mockResolvedValue({ sequence: 1 })
  return { projectId: repair.projectId, workspaceId: "workspace", assistantProjectId: projectId,
    previousFolder: "/original", currentFolder: "/moved", projects: { getCompletedRepair: vi.fn().mockResolvedValue(repair) },
    orchestration: { getSnapshot, dispatchCommand } }
}

describe("assistant reconciliation after a verified folder repair", () => {
  it("requires a matching durable repair before any native command", async () => {
    const request = input()
    request.projects.getCompletedRepair.mockResolvedValue(null)
    await expect(reconcileRepairedAssistantProject(request)).rejects.toThrow("another folder")
    expect(request.orchestration.dispatchCommand).not.toHaveBeenCalled()
    expect(request.orchestration.getSnapshot).not.toHaveBeenCalled()
  })
  it("stops idle provider sessions before rebasing metadata and preserves native IDs", async () => {
    const request = input()
    const saved = thread()
    request.orchestration.getSnapshot.mockResolvedValueOnce(snapshot("/original", [saved])).mockResolvedValueOnce(snapshot("/moved", [{ ...saved, session: { ...saved.session!, status: "stopped" } }]))
    const result = await reconcileRepairedAssistantProject(request)
    expect(request.orchestration.dispatchCommand.mock.calls.map(([command]) => command.type)).toEqual(["thread.session.stop", "project.meta.update"])
    expect(result.threads[0].id).toBe(threadId)
    expect(result.projects[0].id).toBe(projectId)
  })
  it("blocks a running chat and preserves its execution context", async () => {
    const request = input()
    const saved = thread()
    request.orchestration.getSnapshot.mockResolvedValue(snapshot("/original", [{ ...saved, session: { ...saved.session!, status: "running" } }]))
    await expect(reconcileRepairedAssistantProject(request)).rejects.toThrow("Stop running chats")
    expect(request.orchestration.dispatchCommand).not.toHaveBeenCalled()
  })
  it("reconciles a lost metadata reply without creating a new assistant project", async () => {
    const request = input()
    request.orchestration.getSnapshot.mockResolvedValue(snapshot("/moved"))
    expect((await reconcileRepairedAssistantProject(request)).projects[0].id).toBe(projectId)
    expect(request.orchestration.dispatchCommand).not.toHaveBeenCalled()
  })
})
