import { useEffect, useState } from "react"
import type {
  RepoIdentity,
  ResolveProjectWorkspaceRequest,
  ResolveProjectWorkspaceResult,
} from "../../../../shared/workspaceTypes"

/**
 * Calls workspace:resolveProject via IPC and returns the result.
 * Returns null while the resolution is in flight.
 */
export function useProjectWorkspaceResolution(
  projectId: string | null | undefined,
  projectSlug?: string | null,
  expectedRepo?: RepoIdentity | null,
  preferredWorkspaceId?: string | null,
): { result: ResolveProjectWorkspaceResult | null, refresh: () => void } {
  const [result, setResult] = useState<ResolveProjectWorkspaceResult | null>(null)
  const [refreshCounter, setRefreshCounter] = useState(0)

  useEffect(() => {
    if (!projectId) {
      setResult(null)
      return
    }

    setResult(null)
    let cancelled = false

    const req: ResolveProjectWorkspaceRequest = {
      projectId,
      projectSlug: projectSlug ?? null,
      expectedRepo: expectedRepo ?? null,
      preferredWorkspaceId: preferredWorkspaceId ?? null,
      allowCandidateScan: true,
    }

    if (!window.electronAPI.workspace) {
      console.warn("[useProjectWorkspaceResolution] workspace API not available")
      return
    }

    window.electronAPI.workspace.resolveProject(req).then((res) => {
      if (!cancelled) setResult(res)
    }).catch((err) => {
      console.error("[useProjectWorkspaceResolution] IPC error:", err)
      if (!cancelled) {
        // Surface the error as a missing-binding so the repair screen shows
        // instead of an infinite spinner.
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
  }, [projectId, projectSlug, expectedRepo, preferredWorkspaceId, refreshCounter])

  return { result, refresh: () => setRefreshCounter((c) => c + 1) }
}
