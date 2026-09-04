import type { WorkbenchSessionSnapshot } from "@shared/electronApiTypes"

import { removeLocalProjectDevApp } from "@/features/devapps/localProjectDevAppStore"
import { useAssistantComposerDraftStore } from "@/features/assistant/chat/composerDraftStore"
import { clearPersistedProjectSidebarEntry } from "@/features/projects/ui/sidebar/projectSidebarState"
import { clearDevServerRunsForWorkspace } from "@/features/dev-server/devServerRunStore"
import { clearDevServerProcessConfigForWorkspace } from "@/features/dev-server/devServerProcessConfigStore"
import { releaseDevServerSurfaceLease } from "@/features/dev-server/devServerSurfaceController"
import { clearCachedProjectLaneState } from "@/features/workbench/hooks/useProjectLaneState"
import {
  collectAssistantProjectIdsForDeletion,
  deleteAssistantProjectsForDeletedWorkspace,
} from "@/features/assistant/services/assistantProjectDeletion"
import { clearLastWorkbenchRoutesForProject } from "@/features/workbench/model/lastWorkbenchRoute"
import { clearProjectBranchSession } from "@/features/source-control/model/projectBranchSessionStore"
import { clearRecentProjectOpenSync } from "@/features/projects/lib/recentProjectOpenSync"
import { clearPersistedWorkbenchLayoutsForProject } from "@/features/workbench/model/workbenchLayoutPersistence"
import { clearSyncFeedSeen } from "@/features/source-control/syncFeedSeen"
import { useWorkspaceRuntimeStore } from "@/lib/workspaceRuntimeStore"
import { useProjectWorkbenchStore } from "@/lib/workbenchStore"
import { useQueryCache } from "@/app/model/queryCache"
import { useTerminalStore } from "@/features/terminal/model/terminalStore"
import { useThreadDetailStore } from "@/features/assistant/model/threadDetailStore"

const WORKSPACE_LOOKUP_TIMEOUT_MS = 3_000
const SESSION_CLEANUP_TIMEOUT_MS = 3_000
const DEV_SERVER_STOP_TIMEOUT_MS = 5_000
const STORAGE_DELETE_TIMEOUT_MS = 30_000

export interface DeletedProjectLocalCleanupOptions {
  /** When true (default for UI), skip trashing local folders. */
  keepLocalFiles?: boolean
  /** Used only to remove project-scoped renderer preferences. */
  projectSlug?: string | null
}

interface ProjectRendererStateSnapshot {
  assistantProjectIds: Set<string>
  laneIdsByWorkspaceId: Map<string, Set<string>>
  threadIds: Set<string>
  tileIds: Set<string>
  workspaceIds: Set<string>
}

function normalizeId(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
  }
}

function addLane(
  laneIdsByWorkspaceId: Map<string, Set<string>>,
  workspaceId: string | null | undefined,
  laneId: string | null | undefined,
): void {
  const normalizedWorkspaceId = normalizeId(workspaceId)
  const normalizedLaneId = normalizeId(laneId)
  if (!normalizedWorkspaceId || !normalizedLaneId) return

  const laneIds = laneIdsByWorkspaceId.get(normalizedWorkspaceId) ?? new Set<string>()
  laneIds.add(normalizedLaneId)
  laneIdsByWorkspaceId.set(normalizedWorkspaceId, laneIds)
}

function collectProjectRendererState(projectId: string): ProjectRendererStateSnapshot {
  const snapshot: ProjectRendererStateSnapshot = {
    assistantProjectIds: new Set(),
    laneIdsByWorkspaceId: new Map(),
    threadIds: new Set(),
    tileIds: new Set(),
    workspaceIds: new Set(),
  }

  for (const workbench of Object.values(useProjectWorkbenchStore.getState().workbenches)) {
    if (workbench.projectId !== projectId) continue

    const workspaceId = normalizeId(workbench.workspaceId)
    if (workspaceId) {
      snapshot.workspaceIds.add(workspaceId)
      addLane(snapshot.laneIdsByWorkspaceId, workspaceId, workbench.laneId)
    }

    for (const tile of Object.values(workbench.tiles)) {
      snapshot.tileIds.add(tile.id)
      if (tile.type !== "assistantChat") continue

      const assistantProjectId = normalizeId(tile.assistantProjectId)
      const threadId = normalizeId(tile.threadId)
      if (assistantProjectId) snapshot.assistantProjectIds.add(assistantProjectId)
      if (threadId) snapshot.threadIds.add(threadId)
    }
  }

  const runtimeState = useWorkspaceRuntimeStore.getState()
  for (const runtimeRecord of Object.values(runtimeState.runtimes)) {
    if (normalizeId(String(runtimeRecord.config.projectId ?? "")) !== projectId) continue
    const workspaceId = normalizeId(runtimeRecord.config.workspaceId ?? null)
    if (workspaceId) snapshot.workspaceIds.add(workspaceId)
  }

  return snapshot
}

async function listProjectWorkbenchSessions(projectId: string): Promise<WorkbenchSessionSnapshot[]> {
  const sessionApi = window.electronAPI?.workbenchSession
  if (!sessionApi) return []

  try {
    const sessions = await withTimeout(
      sessionApi.listSessions(),
      SESSION_CLEANUP_TIMEOUT_MS,
      "Listing workbench sessions",
    )
    return sessions.filter((session) => session.projectId === projectId)
  } catch (error) {
    console.warn("[ProjectDelete] Failed to list local workbench sessions.", error)
    return []
  }
}

async function closeProjectWorkbenchSessions(
  sessions: readonly WorkbenchSessionSnapshot[],
): Promise<void> {
  const sessionApi = window.electronAPI?.workbenchSession
  if (!sessionApi) return

  const results = await Promise.allSettled(
    sessions.map((session) =>
      withTimeout(
        sessionApi.closeSession({
          sessionKey: session.sessionKey,
          projectId: session.projectId,
          laneId: session.laneId,
          workspaceId: session.workspaceId,
        }),
        SESSION_CLEANUP_TIMEOUT_MS,
        `Closing workbench session ${session.sessionKey}`,
      ),
    ),
  )

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[ProjectDelete] Failed to close a local workbench session.", result.reason)
    }
  }
}

function closeProjectRuntimes(projectId: string): void {
  const runtimeStore = useWorkspaceRuntimeStore.getState()
  for (const runtimeRecord of Object.values(runtimeStore.runtimes)) {
    if (normalizeId(String(runtimeRecord.config.projectId ?? "")) === projectId) {
      runtimeStore.actions.closeRuntime(runtimeRecord.runtimeId)
    }
  }
}

async function stopProjectDevServers(
  workspaceIds: ReadonlySet<string>,
  laneIdsByWorkspaceId: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<void> {
  const devServerApi = window.electronAPI?.devServer
  if (!devServerApi) return

  const stops: Array<{ workspaceId: string; laneId: string }> = []
  for (const workspaceId of workspaceIds) {
    const laneIds = new Set(laneIdsByWorkspaceId.get(workspaceId) ?? [])
    laneIds.add("collab")
    for (const laneId of laneIds) {
      stops.push({ workspaceId, laneId })
    }
  }

  const results = await Promise.allSettled(
    stops.map(async ({ workspaceId, laneId }) => {
      const result = await withTimeout(
        devServerApi.stop({ workspaceId, laneId }),
        DEV_SERVER_STOP_TIMEOUT_MS,
        `Stopping dev server ${workspaceId}::${laneId}`,
      )
      if (!result.success) {
        throw new Error(result.error || "Failed to stop the project dev server.")
      }
    }),
  )

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[ProjectDelete] Failed to stop a project dev server.", result.reason)
    }
  }
}

async function trashManagedWorkspaces(
  managedWorkspaceIds: Set<string>,
): Promise<Set<string>> {
  const deletedWorkspaceIds = new Set<string>()
  const workspaceApi = window.electronAPI?.workspace
  if (!workspaceApi) {
    if (managedWorkspaceIds.size > 0) {
      console.warn("[ProjectDelete] Workspace API is unavailable; managed project folders were not moved to Trash.")
    }
    return deletedWorkspaceIds
  }

  const deleteResults = await Promise.allSettled(
    Array.from(managedWorkspaceIds, async (workspaceId) => {
      const result = await withTimeout(
        workspaceApi.trashManagedWorkspace(workspaceId),
        STORAGE_DELETE_TIMEOUT_MS,
        `Moving managed workspace ${workspaceId} to Trash`,
      )
      if (!result.success) {
        throw new Error(result.error || "Failed to move the managed workspace to Trash.")
      }
      return workspaceId
    }),
  )

  for (const result of deleteResults) {
    if (result.status === "fulfilled") {
      deletedWorkspaceIds.add(result.value)
    } else {
      console.warn("[ProjectDelete] Failed to delete a managed local project folder.", result.reason)
    }
  }

  return deletedWorkspaceIds
}

function clearProjectRendererState(
  projectId: string,
  projectSlug: string | null | undefined,
  snapshot: ProjectRendererStateSnapshot,
): void {
  const runBestEffort = (label: string, operation: () => void) => {
    try {
      operation()
    } catch (error) {
      console.warn(`[ProjectDelete] Failed to clear ${label}.`, error)
    }
  }

  runBestEffort("assistant composer drafts", () => {
    useAssistantComposerDraftStore.getState().clearDrafts([
      ...snapshot.tileIds,
      ...snapshot.threadIds,
    ])
  })
  runBestEffort("assistant thread detail", () => {
    for (const threadId of snapshot.threadIds) {
      useThreadDetailStore.getState().resetThread(threadId)
    }
  })
  runBestEffort("Dev Server surface leases", () => {
    for (const tileId of snapshot.tileIds) {
      releaseDevServerSurfaceLease(tileId)
    }
  })

  runBestEffort("branch sessions", () => clearProjectBranchSession(projectId))
  runBestEffort("lane state", () => clearCachedProjectLaneState(projectId))
  runBestEffort("sidebar state", () => clearPersistedProjectSidebarEntry(projectId))
  runBestEffort("last workbench routes", () => clearLastWorkbenchRoutesForProject(projectId))
  runBestEffort("recent open state", () => clearRecentProjectOpenSync(projectId))
  runBestEffort("persisted layouts", () => clearPersistedWorkbenchLayoutsForProject(projectId))
  runBestEffort("sync feed state", () => clearSyncFeedSeen(projectSlug))
  runBestEffort("local Project DevApp", () => removeLocalProjectDevApp(projectId))

  runBestEffort("workspace runtime mirrors", () => {
    for (const workspaceId of snapshot.workspaceIds) {
      clearDevServerRunsForWorkspace(workspaceId)
      clearDevServerProcessConfigForWorkspace(workspaceId)
      useTerminalStore.getState().actions.resetProject(workspaceId)
      window.localStorage.removeItem(`dev-command:${encodeURIComponent(workspaceId)}`)
    }
  })
  runBestEffort("task-board state", () => {
    window.localStorage.removeItem(`cozea:project-task-board:${projectId}`)
    window.localStorage.removeItem(`cozea:project-task-board-migrated:${projectId}`)
  })

  // Cache keys have several legacy project/slug shapes. Clearing this small,
  // bounded cache is safer than retaining a deleted record under one of them.
  runBestEffort("query cache", () => useQueryCache.getState().clear())
  runBestEffort("project workbenches", () => {
    useProjectWorkbenchStore.getState().actions.removeProject(projectId)
  })
}

export async function cleanupDeletedProjectLocally(
  projectId: string,
  options: DeletedProjectLocalCleanupOptions = {},
): Promise<void> {
  const normalizedProjectId = normalizeId(projectId)
  if (!normalizedProjectId) return

  const rendererSnapshot = collectProjectRendererState(normalizedProjectId)
  const workspaceRoots = new Set<string>()
  const managedWorkspaceIds = new Set<string>()
  const workspaceApi = window.electronAPI?.workspace

  try {
    const workspaces = await withTimeout(
      workspaceApi?.listForProject(normalizedProjectId) ?? Promise.resolve([]),
      WORKSPACE_LOOKUP_TIMEOUT_MS,
      "Listing local workspaces for deleted project",
    )
    for (const workspace of workspaces ?? []) {
      const workspaceId = normalizeId(workspace.workspaceId)
      const workspaceRoot = normalizeId(workspace.projectRootPath)
      if (workspaceId) rendererSnapshot.workspaceIds.add(workspaceId)
      if (workspaceRoot) workspaceRoots.add(workspaceRoot)
      if (workspaceId && workspace.storageOwnership === "managed") {
        managedWorkspaceIds.add(workspaceId)
      }
    }
  } catch (error) {
    console.warn("[ProjectDelete] Failed to list local workspaces.", error)
  }

  const sessions = await listProjectWorkbenchSessions(normalizedProjectId)
  for (const session of sessions) {
    const workspaceId = normalizeId(session.workspaceId)
    if (workspaceId) {
      rendererSnapshot.workspaceIds.add(workspaceId)
      addLane(rendererSnapshot.laneIdsByWorkspaceId, workspaceId, session.laneId)
    }
  }

  const assistantProjectIds = collectAssistantProjectIdsForDeletion({
    assistantProjectIds: rendererSnapshot.assistantProjectIds,
    workspaceRoots,
  })

  // Stop process-owning services before closing their terminal sessions or
  // forgetting the workspace authorization records they rely on.
  await stopProjectDevServers(
    rendererSnapshot.workspaceIds,
    rendererSnapshot.laneIdsByWorkspaceId,
  )
  await closeProjectWorkbenchSessions(sessions)
  closeProjectRuntimes(normalizedProjectId)

  await deleteAssistantProjectsForDeletedWorkspace({
    assistantProjectIds,
    workspaceRoots,
  })

  const keepLocalFiles = options.keepLocalFiles !== false
  if (!keepLocalFiles) {
    await trashManagedWorkspaces(managedWorkspaceIds)
  }

  if (workspaceApi) {
    await Promise.allSettled(
      Array.from(rendererSnapshot.workspaceIds).map((workspaceId) =>
        withTimeout(
          workspaceApi.forget(workspaceId),
          WORKSPACE_LOOKUP_TIMEOUT_MS,
          `Forgetting local workspace ${workspaceId}`,
        ),
      ),
    )
  }

  // State cleanup must still happen if native workspace discovery/forgetting
  // is unavailable; otherwise the next import can resurrect the old workbench.
  clearProjectRendererState(normalizedProjectId, options.projectSlug, rendererSnapshot)
}
