import { useEffect, useState } from "react"

import { projectAnalysisDesktopClient } from "@/lib/projectAnalysis/projectAnalysisDesktopClient"

/** Resolves the concrete root used only for workspace-relative assistant presentation. */
export function useAssistantWorkspaceRoot(
  projectRootPath: string | null,
  workspaceId: string | null,
): string | null {
  const [resolvedRoot, setResolvedRoot] = useState<string | null>(projectRootPath)

  useEffect(() => {
    if (projectRootPath) {
      setResolvedRoot(projectRootPath)
      return
    }
    if (!workspaceId) {
      setResolvedRoot(null)
      return
    }

    let cancelled = false
    void projectAnalysisDesktopClient
      .resolveRoot(workspaceId)
      .then((root) => {
        if (!cancelled) setResolvedRoot(root)
      })
      .catch(() => {
        if (!cancelled) setResolvedRoot(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectRootPath, workspaceId])

  return resolvedRoot
}
