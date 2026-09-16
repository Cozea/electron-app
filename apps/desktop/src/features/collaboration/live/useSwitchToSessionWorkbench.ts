import { useCallback, useState } from "react"
import { useMutation } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState"
import { buildProjectPath } from "@/contexts/project/projectRoutes"
import { useOptionalProjectRouteContext } from "@/contexts/project/ProjectRouteContext"
import { invalidateProjectWorkspaceResolution } from "@/features/workspace/useProjectWorkspaceResolution"
import { appToast } from "@/lib/appToast"
import { cleanConvexError } from "@/lib/convexError"
import { formatCloneErrorMessage } from "@/lib/git/gitErrorFormatting"
import { useViewTransitionNavigate } from "@/lib/navigation"

export interface SwitchToSessionTarget {
  sessionId: Id<"collaborationSessions">
  publicSessionId: string
  branchName: string
  repositoryUrl?: string | null
  viewerMembership?: string | null
}

/**
 * One-click switch to a live session's workbench: joins first when this
 * device is not an active member, then ensures and opens the session
 * workbench. Clone failures surface the concise repo link; everything else
 * keeps the cleaned server message.
 */
export function useSwitchToSessionWorkbench(input: {
  projectId: Id<"projects"> | null
  projectName?: string | null
  sourceWorkspaceId: string | null
}): {
  switchToSession: (target: SwitchToSessionTarget) => Promise<void>
  switching: boolean
} {
  const { projectId, projectName, sourceWorkspaceId } = input
  const navigate = useViewTransitionNavigate()
  const route = useOptionalProjectRouteContext()
  const joinSession = useMutation(api.collaborationSessions.join)
  const [switching, setSwitching] = useState(false)

  const switchToSession = useCallback(
    async (target: SwitchToSessionTarget) => {
      if (!projectId || switching) return
      setSwitching(true)
      try {
        if (target.viewerMembership !== "active") {
          await joinSession({ sessionId: target.sessionId })
        }
        const ensured = await window.electronAPI.projectd.workbenches.ensureSession({
          projectId: String(projectId),
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
        invalidateProjectWorkspaceResolution(String(projectId))
        navigate(buildProjectPath(String(projectId), "workbench"), {
          state: buildProjectRouteNavigationState({
            projectId: String(projectId),
            projectName: projectName ?? null,
            preferredWorkspaceId: ensured.workspace.workspaceId,
          }),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : null
        const formatted = formatCloneErrorMessage(message, target.repositoryUrl ?? null)
        appToast.error({
          title: "Could not open the Session Workbench",
          description:
            typeof formatted === "string"
              ? cleanConvexError(error, "Could not open the Session Workbench")
              : formatted,
        })
      } finally {
        setSwitching(false)
      }
    },
    [joinSession, navigate, projectId, projectName, route?.projectName, sourceWorkspaceId, switching],
  )

  return { switchToSession, switching }
}
