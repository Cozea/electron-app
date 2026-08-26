import { clearCachedProjectLaneState } from "@/features/projects/hooks/useProjectLaneState"
import { clearProjectBranchSession } from "@/features/projects/lib/projectBranchSessionStore"
import { useWorkspaceRuntimeStore } from "@/features/projects/workspaces/useWorkspaceRuntimeStore"
import { useQueryCache } from "@/stores/useQueryCache"

const TEARDOWN_TIMEOUT_MS = 2_000

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

/**
 * Immediately detach the deleted project from the live UI and stop local hosting.
 * Must not await Convex — this is the escape hatch when the workbench would otherwise
 * keep a deleting project alive (and previously revived closed runtimes via route attach).
 */
export function detachDeletedProjectFromUi(projectId: string): void {
  const normalizedProjectId = normalizeId(projectId)
  if (!normalizedProjectId) return

  useQueryCache.getState().clear(`layout-project-${normalizedProjectId}`)

  const runtimeStore = useWorkspaceRuntimeStore.getState()
  for (const runtimeRecord of Object.values(runtimeStore.runtimes)) {
    const runtimeProjectId = normalizeId(String(runtimeRecord.config.projectId ?? ""))
    if (runtimeProjectId !== normalizedProjectId) continue
    const workspaceId = normalizeId(runtimeRecord.config.workspaceId ?? null)
    if (workspaceId) {
      clearProjectBranchSession(normalizedProjectId, workspaceId)
      clearCachedProjectLaneState(normalizedProjectId, workspaceId)
    }
  }

  // Ban the project so ProjectSyncProvider cannot recreate/host it while still mounted.
  runtimeStore.actions.suppressProject(normalizedProjectId)

  const sessionApi = window.electronAPI?.workbenchSession
  if (!sessionApi?.teardownProject) return

  void withTimeout(
    sessionApi.teardownProject({ projectId: normalizedProjectId }),
    TEARDOWN_TIMEOUT_MS,
    "Main-process project teardown",
  ).catch((error) => {
    console.warn("[ProjectDelete] Failed to force-close workbench sessions.", error)
  })
}
