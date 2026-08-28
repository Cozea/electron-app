import { clearCachedProjectLaneState } from "@/features/projects/hooks/useProjectLaneState"
import { clearProjectBranchSession } from "@/features/projects/lib/projectBranchSessionStore"
import { useWorkspaceRuntimeStore } from "@/features/projects/workspaces/useWorkspaceRuntimeStore"

const WORKSPACE_LOOKUP_TIMEOUT_MS = 3_000
const SESSION_CLEANUP_TIMEOUT_MS = 3_000
const STORAGE_DELETE_TIMEOUT_MS = 30_000

export interface DeletedProjectLocalCleanupOptions {
  /** When true (default for UI), skip trashing local folders. */
  keepLocalFiles?: boolean
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

async function closeProjectWorkbenchSessions(
  projectId: string,
  workspaceIds: Set<string>,
): Promise<void> {
  const sessionApi = window.electronAPI?.workbenchSession
  if (!sessionApi) return

  try {
    const sessions = await withTimeout(
      sessionApi.listSessions(),
      SESSION_CLEANUP_TIMEOUT_MS,
      "Listing workbench sessions",
    )
    await Promise.allSettled(
      sessions
        .filter((session) => {
          if (session.projectId !== projectId) return false
          const workspaceId = normalizeId(session.workspaceId)
          return workspaceIds.size === 0 || (workspaceId !== null && workspaceIds.has(workspaceId))
        })
        .map((session) =>
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
  } catch (error) {
    console.warn("[ProjectDelete] Failed to close local workbench sessions.", error)
  }
}

function closeProjectRuntimes(projectId: string, workspaceIds: Set<string>): void {
  const runtimeStore = useWorkspaceRuntimeStore.getState()
  const runtimeRecords = Object.values(runtimeStore.runtimes)

  for (const runtimeRecord of runtimeRecords) {
    const runtimeProjectId = normalizeId(String(runtimeRecord.config.projectId ?? ""))
    if (runtimeProjectId !== projectId) continue

    const workspaceId = normalizeId(runtimeRecord.config.workspaceId ?? null)
    if (workspaceIds.size > 0 && (workspaceId === null || !workspaceIds.has(workspaceId))) {
      continue
    }
    runtimeStore.actions.closeRuntime(runtimeRecord.runtimeId)
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

export async function cleanupDeletedProjectLocally(
  projectId: string,
  options: DeletedProjectLocalCleanupOptions = {},
): Promise<void> {
  const normalizedProjectId = normalizeId(projectId)
  if (!normalizedProjectId) return

  const workspaceIds = new Set<string>()
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
      if (workspaceId) {
        workspaceIds.add(workspaceId)
      }
      if (workspaceId && workspace.storageOwnership === "managed") {
        managedWorkspaceIds.add(workspaceId)
      }
    }
  } catch (error) {
    console.warn("[ProjectDelete] Failed to list local workspaces.", error)
  }

  const closeSessionsTask = closeProjectWorkbenchSessions(normalizedProjectId, workspaceIds)
  closeProjectRuntimes(normalizedProjectId, workspaceIds)

  for (const workspaceId of workspaceIds) {
    clearProjectBranchSession(normalizedProjectId, workspaceId)
    clearCachedProjectLaneState(normalizedProjectId, workspaceId)
  }

  const keepLocalFiles = options.keepLocalFiles !== false
  await closeSessionsTask
  const workspaceIdsToForget = keepLocalFiles
    ? new Set<string>()
    : await trashManagedWorkspaces(managedWorkspaceIds)
  for (const workspaceId of workspaceIds) {
    // Always forget workspace bindings so Cozea stops hosting the deleted project,
    // even when the on-disk folder is intentionally preserved.
    workspaceIdsToForget.add(workspaceId)
  }
  if (!workspaceApi) return

  await Promise.allSettled(
    Array.from(workspaceIdsToForget).map((workspaceId) =>
      withTimeout(
        workspaceApi.forget(workspaceId),
        WORKSPACE_LOOKUP_TIMEOUT_MS,
        `Forgetting local workspace ${workspaceId}`,
      ),
    ),
  )
}
