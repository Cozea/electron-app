import type { NativeApi, ProjectId, OrchestrationReadModel } from "@cozea/assistant-contracts"
import type { LocalProjectsElectronAPI } from "@shared/localProjectTypes"
import { newCommandId } from "@/features/assistant/lib/utils"

interface RepairedAssistantProjectInput {
  projectId: string
  workspaceId: string
  assistantProjectId: ProjectId
  previousFolder: string
  currentFolder: string
  projects: Pick<LocalProjectsElectronAPI, "getCompletedRepair">
  orchestration: Pick<NativeApi["orchestration"], "getSnapshot" | "dispatchCommand">
}

/** Only a completed exact catalog move authorizes rebasing an existing chat project. */
export async function reconcileRepairedAssistantProject(input: RepairedAssistantProjectInput): Promise<OrchestrationReadModel> {
  const repair = await input.projects.getCompletedRepair(input.workspaceId, input.previousFolder, input.currentFolder)
  if (!repair || repair.projectId !== input.projectId) throw new Error("This conversation belongs to another folder. Repair the original folder before continuing.")
  const snapshot = await input.orchestration.getSnapshot()
  const project = snapshot.projects.find((candidate) => candidate.id === input.assistantProjectId)
  if (!project || (project.workspaceRoot !== input.previousFolder && project.workspaceRoot !== input.currentFolder)) throw new Error("The assistant project changed. Refresh Chat history before continuing.")
  const threads = snapshot.threads.filter((thread) => thread.projectId === project.id && !thread.deletedAt)
  if (threads.some((thread) => thread.latestTurn?.state === "running" || thread.session?.status === "starting" || thread.session?.status === "running")) throw new Error("Stop running chats before completing their folder repair.")
  // Provider sessions retain their execution cwd independently of project
  // metadata. Stop idle sessions; history, native IDs and drafts remain intact.
  for (const thread of threads) {
    if (thread.session && thread.session.status !== "stopped" && thread.session.status !== "error") await input.orchestration.dispatchCommand({
      type: "thread.session.stop", commandId: newCommandId(), threadId: thread.id, createdAt: new Date().toISOString(),
    })
  }
  if (project.workspaceRoot !== input.currentFolder) await input.orchestration.dispatchCommand({
    type: "project.meta.update", commandId: newCommandId(), projectId: project.id, workspaceRoot: input.currentFolder,
  })
  const committed = await input.orchestration.getSnapshot()
  if (committed.projects.find((candidate) => candidate.id === project.id)?.workspaceRoot !== input.currentFolder ||
    committed.threads.some((thread) => thread.projectId === project.id && !thread.deletedAt && thread.session && !["stopped", "error"].includes(thread.session.status))) throw new Error("The chat runtime has not confirmed its repaired folder. Retry after its saved sessions stop.")
  return committed
}
