import { useOptionalProjectRouteContext } from "@/contexts/project/ProjectRouteContext"
import { useAccessibleProject } from "@/contexts/project/useAccessibleProject"
import { useWorkspaceIdentity } from "@/contexts/workspace/useWorkspaceIdentity"
import { useActiveWorkspaceOrNull } from "@/contexts/workspace/ActiveWorkspaceContext"
import type { ProjectLaneDescriptor, ProjectLaneState } from "@cozea/app-contract/electronApi"
import type { WorkspaceLaneDTO } from "@shared/workspaceTypes"
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

export function resolveActiveWorkbenchScope(input: {
  projectId: string | null
  workspaceId: string | null
  laneState: ProjectLaneState | null
  activeLane: ProjectLaneDescriptor | null
  catalogLane: Pick<WorkspaceLaneDTO, "projectId" | "workspaceId" | "laneId" | "gitRootPath"> | null
  workspaceGitRootPath: string | null | undefined
}): ActiveWorkbenchScope {
  // A verified non-Git folder has a concrete catalog lane but no Git branch
  // state to load. Git workspaces must still wait for their branch identity.
  const nonGitLane = input.catalogLane?.projectId === input.projectId &&
    input.catalogLane.workspaceId === input.workspaceId &&
    input.workspaceGitRootPath === null && input.catalogLane.gitRootPath === null
    ? input.catalogLane : null
  const laneId = input.activeLane?.id ?? input.laneState?.activeLaneId ??
    input.laneState?.collabLaneId ?? nonGitLane?.laneId ?? DEFAULT_WORKBENCH_LANE_ID
  const workspaceId = input.activeLane?.workspaceId ?? input.workspaceId
  return {
    projectId: input.projectId,
    laneId,
    workspaceId,
    scopeKey: input.projectId ? buildWorkbenchScopeKey(input.projectId, laneId, workspaceId) : null,
    laneResolutionPending: Boolean(workspaceId) && !input.activeLane && !input.laneState && !nonGitLane,
  }
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
  const { localProjectId, projectIdParam } = useAccessibleProject()
  const { workspaceId } = useWorkspaceIdentity()
  const activeWorkspace = useActiveWorkspaceOrNull()

  const projectId = localProjectId ?? projectIdParam ?? null
  const laneState = routeContext?.laneState ?? null
  const activeLane = routeContext?.activeLane ?? null

  return resolveActiveWorkbenchScope({
    projectId,
    workspaceId,
    activeLane,
    laneState,
    catalogLane: activeWorkspace?.lane ?? null,
    workspaceGitRootPath: activeWorkspace?.workspace.gitRootPath,
  })
}
