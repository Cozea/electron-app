import { useOptionalProjectRouteContext } from "@/contexts/project/ProjectRouteContext"
import { useAccessibleProject } from "@/contexts/project/useAccessibleProject"
import { useWorkspaceIdentity } from "@/contexts/workspace/useWorkspaceIdentity"
import { DEFAULT_WORKBENCH_LANE_ID, buildWorkbenchScopeKey } from "@/lib/workbenchScopeKey"

export interface ActiveWorkbenchScope {
  /** Null outside a project route: there is no bench to act on. */
  projectId: string | null
  laneId: string
  workspaceId: string | null
  /** Null whenever projectId is. */
  scopeKey: string | null
  /**
   * Lane state has not resolved yet, so laneId is still the "collab"
   * placeholder rather than a real lane. Read from a bench in this state and
   * you are reading a sibling that does not exist; write to one and you create
   * it. Callers hold rather than act.
   */
  laneResolutionPending: boolean
}

/**
 * Which workbench the user is actually looking at.
 *
 * Anything that opens a tile needs this, and the derivation is not obvious —
 * the lane comes from the route context but falls back through lane state
 * twice, and the workspace comes from the lane in preference to the ambient
 * identity. Spelled out at each call site it drifts; the version in settings
 * had given up entirely and taken the first bench in the record, which is
 * insertion order, not the one on screen.
 */
export function useActiveWorkbenchScope(): ActiveWorkbenchScope {
  const routeContext = useOptionalProjectRouteContext()
  const { project, projectIdParam } = useAccessibleProject()
  const { workspaceId } = useWorkspaceIdentity()

  const projectId = project?._id ? String(project._id) : (projectIdParam ?? null)
  const laneState = routeContext?.laneState ?? null
  const activeLane = routeContext?.activeLane ?? null

  const laneId =
    activeLane?.id ??
    laneState?.activeLaneId ??
    laneState?.collabLaneId ??
    DEFAULT_WORKBENCH_LANE_ID
  const laneWorkspaceId = activeLane?.workspaceId ?? workspaceId

  return {
    projectId,
    laneId,
    workspaceId: laneWorkspaceId,
    scopeKey: projectId ? buildWorkbenchScopeKey(projectId, laneId, laneWorkspaceId) : null,
    laneResolutionPending: Boolean(laneWorkspaceId) && !activeLane && !laneState,
  }
}
