import { useEffect, useState } from "react"
import type {
  RepoIdentity,
  ResolveProjectWorkspaceRequest,
  ResolveProjectWorkspaceResult,
} from "../../../../shared/workspaceTypes"

// Stale-while-revalidate cache. Without it, every navigation into a project
// re-resolved the workspace over IPC with `result === null` in the meantime —
// the content area showed a spinner on each project revisit even when the
// answer could not have changed.
const resolutionCache = new Map<string, ResolveProjectWorkspaceResult>()

function resolutionCacheKey(projectId: string, preferredWorkspaceId: string | null): string {
  return `${projectId}::${preferredWorkspaceId ?? ""}`
}

/** Drops cached resolutions for a project after relink/close/repair actions. */
export function invalidateProjectWorkspaceResolution(projectId: string): void {
  for (const key of resolutionCache.keys()) {
    if (key.startsWith(`${projectId}::`)) {
      resolutionCache.delete(key)
    }
  }
}

/**
 * Calls workspace:resolveProject via IPC and returns the result.
 * Returns the last known result for the project immediately (stale-while-
 * revalidate) and null only when nothing has ever resolved for it.
 */
export function useProjectWorkspaceResolution(
  projectId: string | null | undefined,
  projectSlug?: string | null,
  expectedRepo?: RepoIdentity | null,
  preferredWorkspaceId?: string | null,
  options?: { allowCandidateScan?: boolean },
): { result: ResolveProjectWorkspaceResult | null, refresh: () => void } {
  const cacheKey = projectId
    ? resolutionCacheKey(projectId, preferredWorkspaceId ?? null)
    : null
  const [result, setResult] = useState<ResolveProjectWorkspaceResult | null>(() =>
    cacheKey ? resolutionCache.get(cacheKey) ?? null : null,
  )
  const [refreshCounter, setRefreshCounter] = useState(0)

  useEffect(() => {
    if (!projectId || !cacheKey) {
      setResult(null)
      return
    }

    // Keep showing the cached result while revalidating; reset to null only
    // when this project has never resolved (true first visit -> loading state).
    setResult(resolutionCache.get(cacheKey) ?? null)
    let cancelled = false

    const req: ResolveProjectWorkspaceRequest = {
      projectId,
      projectSlug: projectSlug ?? null,
      expectedRepo: expectedRepo ?? null,
      preferredWorkspaceId: preferredWorkspaceId ?? null,
      allowCandidateScan: options?.allowCandidateScan ?? false,
    }

    if (!window.electronAPI.workspace) {
      console.warn("[useProjectWorkspaceResolution] workspace API not available")
      return
    }

    window.electronAPI.workspace.resolveProject(req).then((res) => {
      // Preserve identity when revalidation returns the same content, so the
      // providers downstream don't see a "new" resolution on every revisit.
      const prev = resolutionCache.get(cacheKey)
      const next = prev && JSON.stringify(prev) === JSON.stringify(res) ? prev : res
      resolutionCache.set(cacheKey, next)
      if (!cancelled) setResult(next)
    }).catch((err) => {
      console.error("[useProjectWorkspaceResolution] IPC error:", err)
      if (!cancelled) {
        // Surface the error as a missing-binding so the repair screen shows
        // instead of an infinite spinner. Not cached: errors should retry.
        setResult({
          status: "missing-binding",
          projectId,
          actions: [
            { kind: "locate", label: "Locate existing folder" },
            { kind: "clone", label: "Clone repository" },
            { kind: "create", label: "Create local folder" },
          ],
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [projectId, cacheKey, projectSlug, expectedRepo, options?.allowCandidateScan, preferredWorkspaceId, refreshCounter])

  // refresh() is the post-mutation path (relink/clone/create): the cached
  // answer is known-invalid, so drop it rather than serving it stale.
  const refresh = () => {
    if (cacheKey) resolutionCache.delete(cacheKey)
    setRefreshCounter((c) => c + 1)
  }

  return { result, refresh }
}
