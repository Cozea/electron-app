import { useQueryCache } from "@/app/model/queryCache"
import { useWorkspaceRuntimeStore } from "@/lib/workspaceRuntimeStore"

/**
 * Immediately tear the deleted project out of the renderer so the workbench
 * cannot keep hosting it (and so ProjectLayout does not sit on a dead route
 * long enough to thrash).
 */
export function detachDeletedProjectFromUi(projectId: string): void {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return

  const queryCache = useQueryCache.getState()
  queryCache.clear(`layout-project-${normalizedProjectId}`)

  // Also clear any slug-keyed layout cache entries that still point at this id.
  for (const key of Object.keys(queryCache.cache)) {
    if (!key.startsWith("layout-project-")) continue
    const cached = queryCache.get<{ _id?: string }>(key, Number.POSITIVE_INFINITY)
    if (cached && String(cached._id) === normalizedProjectId) {
      queryCache.clear(key)
    }
  }

  useWorkspaceRuntimeStore.getState().actions.suppressProject(normalizedProjectId)
}
