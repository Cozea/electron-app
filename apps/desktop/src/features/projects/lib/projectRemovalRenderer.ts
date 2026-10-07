import type { ProjectRemovalRendererRequest, ProjectRemovalWorkspace } from "@shared/localProjectTypes"
import { requireLocalProjectsApi } from "./localProjectsApi"
import { assistantDrafts } from "@/features/assistant/history/assistantDraftRepository"
import { useAssistantHistoryStore } from "@/features/assistant/history/assistantHistoryStore"
import { useWorkspaceRuntimeStore } from "@/lib/workspaceRuntimeStore"
import { useProjectWorkbenchStore, flushWorkbenchStorageDurably } from "@/lib/workbenchStore"
import { evictTerminalViewsForWorkspace } from "@/features/terminal/terminalViewKeepAlive"
import { clearProjectBranchSession } from "@/features/source-control/model/projectBranchSessionStore"
import { clearCachedProjectLaneState } from "@/features/workbench/hooks/useProjectLaneState"
import { clearPersistedWorkbenchLayoutsForProject } from "@/features/workbench/model/workbenchLayoutPersistence"
import { clearDevServerRunsForWorkspace } from "@/features/dev-server/devServerRunStore"
import { clearDevServerProcessConfigForWorkspace } from "@/features/dev-server/devServerProcessConfigStore"
import { clearPersistedProjectSidebarEntry } from "@/features/projects/ui/sidebar/projectSidebarState"
import { clearLastWorkbenchRoutesForProject } from "@/features/workbench/model/lastWorkbenchRoute"
import { clearRecentProjectOpenSync } from "./recentProjectOpenSync"
import { useAssistantComposerDraftStore } from "@/features/assistant/chat/composerDraftStore"
import { useThreadDetailStore } from "@/features/assistant/model/threadDetailStore"
import { desktopPersistenceClient } from "@/app/model/persistence/desktopPersistenceClient"

/** Await every durable writer. An error is returned to the native removal journal. */
export async function handleProjectRemovalRequest(request: ProjectRemovalRendererRequest): Promise<void> {
  const operation = await requireLocalProjectsApi().getOperation(request.operationId)
  if (!operation || operation.projectId !== request.projectId || operation.kind !== "remove" || operation.requestDetails.closeOnly !== false ||
    !operation.details.removalScopeJson || ["completed", "cancelled"].includes(operation.state)) throw new Error("This device data request does not match a pending permanent removal.")
  const scope = JSON.parse(operation.details.removalScopeJson) as ProjectRemovalWorkspace[]
  if (JSON.stringify(scope.map((entry) => entry.workspace.workspaceId).sort()) !== JSON.stringify([...request.workspaceIds].sort())) throw new Error("The saved renderer data scope differs from the native removal.")
  await flushWorkbenchStorageDurably()
  for (const record of Object.values(useWorkspaceRuntimeStore.getState().runtimes)) if (record.config.projectId === request.projectId) {
    useWorkspaceRuntimeStore.getState().actions.closeRuntime(record.runtimeId)
  }
  for (const workspaceId of request.workspaceIds) {
    evictTerminalViewsForWorkspace(workspaceId)
    clearDevServerRunsForWorkspace(workspaceId)
  }
  clearProjectBranchSession(request.projectId)
  clearCachedProjectLaneState(request.projectId)
  if (request.phase === "quiesce") return
  if (!operation.requestDetails.removeLocalData) throw new Error("This removal explicitly retains conversations and layouts.")
  await desktopPersistenceClient.hydrateNamespace("workbenchModel")
  const threads = new Set(Object.entries(useAssistantHistoryStore.getState().conversations).filter(([, entry]) => entry.projectId === request.projectId).map(([threadId]) => threadId))
  const tiles = Object.values(useProjectWorkbenchStore.getState().workbenches).filter((bench) => bench.projectId === request.projectId).flatMap((bench) => Object.values(bench.tiles))
  for (const tile of tiles) if (tile.type === "assistantChat" && tile.threadId) threads.add(tile.threadId)
  useAssistantComposerDraftStore.getState().clearDrafts([...tiles.map((tile) => tile.id), ...threads])
  for (const thread of threads) useThreadDetailStore.getState().resetThread(thread)
  await assistantDrafts.removeProject(request.projectId)
  useAssistantHistoryStore.getState().forgetProject(request.projectId)
  useProjectWorkbenchStore.getState().actions.removeProject(request.projectId)
  for (const record of desktopPersistenceClient.entries("workbenchModel")) {
    if (record.data && typeof record.data === "object" && "projectId" in record.data && record.data.projectId === request.projectId) {
      desktopPersistenceClient.deleteRecord("workbenchModel", record.key)
    }
  }
  await clearPersistedWorkbenchLayoutsForProject(request.projectId)
  clearPersistedProjectSidebarEntry(request.projectId)
  clearLastWorkbenchRoutesForProject(request.projectId)
  clearRecentProjectOpenSync(request.projectId)
  for (const workspaceId of request.workspaceIds) {
    clearDevServerProcessConfigForWorkspace(workspaceId)
    window.localStorage.removeItem(`dev-command:${encodeURIComponent(workspaceId)}`)
  }
  window.localStorage.removeItem(`cozea:project-task-board:${request.projectId}`)
  window.localStorage.removeItem(`cozea:project-task-board-migrated:${request.projectId}`)
  await flushWorkbenchStorageDurably()
  await desktopPersistenceClient.flush()
}
