import { useCallback, useState } from "react"
import { useMutation } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState"
import { buildProjectPath } from "@/contexts/project/projectRoutes"
import { useOptionalProjectRouteContext } from "@/contexts/project/ProjectRouteContext"
import { invalidateProjectWorkspaceResolution } from "@/features/workspace/useProjectWorkspaceResolution"
import { useViewTransitionNavigate } from "@/lib/navigation"

export interface SwitchToSessionTarget {
  sessionId: Id<"collaborationSessions">
  publicSessionId: string
  branchName: string
  repositoryUrl?: string | null
  viewerMembership?: string | null
}

/**
 * Single shared join-then-open flow for live sessions: joins first when this
 * device is not an active member, then ensures and navigates to the session
 * workbench. Throws on failure so callers keep their own error presentation.
 */
export function useSwitchToSessionWorkbench(input: {
  projectId: string | null
  projectName?: string | null
  sourceWorkspaceId: string | null
}): {
  openSessionWorkbench: (target: SwitchToSessionTarget) => Promise<void>
  switching: boolean
} {
  const { projectId, projectName, sourceWorkspaceId } = input
  const navigate = useViewTransitionNavigate()
  const route = useOptionalProjectRouteContext()
  const joinSession = useMutation(api.collaborationSessions.join)
  const [switching, setSwitching] = useState(false)

  const openSessionWorkbench = useCallback(
    async (target: SwitchToSessionTarget) => {
      if (!projectId) throw new Error("Open this project first.")
      if (switching) return
      setSwitching(true)
      try {
        if (target.viewerMembership !== "active") {
          await joinSession({ sessionId: target.sessionId })
        }
        const ensured = await window.electronAPI.projectd.workbenches.ensureSession({
          projectId,
          publicSessionId: target.publicSessionId,
          branchName: target.branchName,
          baseBranch: target.branchName,
          createBranch: false,
          title: `${route?.projectName ?? projectName ?? "Project"} · ${target.branchName}`,
          sourceRepoUrl: target.repositoryUrl ?? null,
          sourceWorkspaceId,
          includeDirtyChanges: false,
          setActive: true,
        })
        if (!ensured.success) throw new Error(ensured.error)
        invalidateProjectWorkspaceResolution(projectId)
        navigate(buildProjectPath(projectId, "workbench"), {
          state: buildProjectRouteNavigationState({
            projectId,
            projectName: projectName ?? null,
            preferredWorkspaceId: ensured.workspace.workspaceId,
          }),
        })
      } finally {
        setSwitching(false)
      }
    },
    [joinSession, navigate, projectId, projectName, route?.projectName, sourceWorkspaceId, switching],
  )

  return { openSessionWorkbench, switching }
}
