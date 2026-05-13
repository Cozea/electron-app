import { clearCachedProjectLaneState } from "@/features/projects/hooks/useProjectLaneState"
import { clearProjectBranchSession } from "@/features/projects/lib/projectBranchSessionStore"
import { useWorkspaceRuntimeStore } from "@/features/projects/workspaces/useWorkspaceRuntimeStore"

const WORKSPACE_LOOKUP_TIMEOUT_MS = 3_000
const SESSION_CLEANUP_TIMEOUT_MS = 3_000
const STORAGE_DELETE_TIMEOUT_MS = 30_000
const FALLBACK_PROJECT_PATH_ID_PREFIX = "path:"

export interface DeletedProjectLocalCleanupOptions {
  projectName?: string | null
  projectSlug?: string | null
  managedProjectPaths?: Array<string | null | undefined>
}

function normalizeId(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

function buildFilesystemSlug(value: string | null | undefined): string | null {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
  return slug || null
}

function joinManagedPath(rootPath: string, childName: string): string {
  const separator = rootPath.includes("\\") ? "\\" : "/"
  return `${rootPath.replace(/[\\/]+$/, "")}${separator}${childName.replace(/^[/\\]+|[/\\]+$/g, "")}`
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

async function collectFallbackManagedProjectPaths(
  options: DeletedProjectLocalCleanupOptions,
): Promise<string[]> {
  const managedProjectPaths = new Set<string>()

  for (const projectPath of options.managedProjectPaths ?? []) {
    const normalizedPath = normalizeId(projectPath)
    if (normalizedPath) {
      managedProjectPaths.add(normalizedPath)
    }
  }

  const settingsApi = window.electronAPI?.settings
  if (!settingsApi) return Array.from(managedProjectPaths)

  let projectsDirectory: string | null = null
  try {
    const settings = await withTimeout(
      settingsApi.get(),
      WORKSPACE_LOOKUP_TIMEOUT_MS,
      "Loading projects directory",
    )
    projectsDirectory = normalizeId(settings.projectsDirectory)
  } catch (error) {
    console.warn("[ProjectDelete] Failed to load projects directory for local cleanup.", error)
  }

  if (!projectsDirectory) return Array.from(managedProjectPaths)

  const slugCandidates = new Set<string>()
  const explicitSlug = normalizeId(options.projectSlug)
  if (explicitSlug) {
    slugCandidates.add(explicitSlug)
  }

  const slugFromName = buildFilesystemSlug(options.projectName)
  if (slugFromName) {
    slugCandidates.add(slugFromName)
  }

  for (const slug of slugCandidates) {
    managedProjectPaths.add(joinManagedPath(projectsDirectory, slug))
  }

  return Array.from(managedProjectPaths)
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

async function deleteManagedProjectPaths(
  projectPathsByWorkspaceId: Map<string, string>,
): Promise<Set<string>> {
  const deletedWorkspaceIds = new Set<string>()
  const storageApi = window.electronAPI?.storage
  if (!storageApi) {
    if (projectPathsByWorkspaceId.size > 0) {
      console.warn("[ProjectDelete] Local storage API is unavailable; managed project folders were not deleted.")
    }
    return deletedWorkspaceIds
  }

  const workspaceIdsByProjectPath = new Map<string, string[]>()
  for (const [workspaceId, projectPath] of projectPathsByWorkspaceId) {
    const workspaceIds = workspaceIdsByProjectPath.get(projectPath) ?? []
    workspaceIds.push(workspaceId)
    workspaceIdsByProjectPath.set(projectPath, workspaceIds)
  }

  const deleteResults = await Promise.allSettled(
    Array.from(workspaceIdsByProjectPath, async ([projectPath, workspaceIds]) => {
      const result = await withTimeout(
        storageApi.deleteProject({ projectPath }),
        STORAGE_DELETE_TIMEOUT_MS,
        `Moving local project folder to Trash ${projectPath}`,
      )
      if (!result.success) {
        throw new Error(result.error || `Failed to move local project folder to Trash: ${projectPath}`)
      }
      return workspaceIds
    }),
  )

  for (const result of deleteResults) {
    if (result.status === "fulfilled") {
      for (const workspaceId of result.value) {
        if (!workspaceId.startsWith(FALLBACK_PROJECT_PATH_ID_PREFIX)) {
          deletedWorkspaceIds.add(workspaceId)
        }
      }
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
  const projectPathsByWorkspaceId = new Map<string, string>()
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
      const projectRootPath = normalizeId(workspace.projectRootPath)
      if (workspaceId && projectRootPath) {
        projectPathsByWorkspaceId.set(workspaceId, projectRootPath)
      }
    }
  } catch (error) {
    console.warn("[ProjectDelete] Failed to list local workspaces.", error)
  }

  const fallbackProjectPaths = await collectFallbackManagedProjectPaths(options)
  for (const projectPath of fallbackProjectPaths) {
    const fallbackWorkspaceId = `${FALLBACK_PROJECT_PATH_ID_PREFIX}${projectPath}`
    if (!projectPathsByWorkspaceId.has(fallbackWorkspaceId)) {
      projectPathsByWorkspaceId.set(fallbackWorkspaceId, projectPath)
    }
  }

  const closeSessionsTask = closeProjectWorkbenchSessions(normalizedProjectId, workspaceIds)
  closeProjectRuntimes(normalizedProjectId, workspaceIds)

  for (const workspaceId of workspaceIds) {
    clearProjectBranchSession(normalizedProjectId, workspaceId)
    clearCachedProjectLaneState(normalizedProjectId, workspaceId)
  }

  const workspaceIdsToForget = await deleteManagedProjectPaths(projectPathsByWorkspaceId)
  for (const workspaceId of workspaceIds) {
    if (!projectPathsByWorkspaceId.has(workspaceId)) {
      workspaceIdsToForget.add(workspaceId)
    }
  }

  await closeSessionsTask

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
