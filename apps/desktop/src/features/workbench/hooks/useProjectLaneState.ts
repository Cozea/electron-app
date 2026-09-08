import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes"
import {
  getProjectLaneResource,
  invalidateProjectLaneState,
} from "@/app/resources/workspaceResources"
import { useSharedProjectLaneState } from "@/app/resources/useWorkspaceResources"

export interface UseProjectLaneStateArgs {
  projectId: string | null
  workspaceId: string | null
  collabBranch: string | null
}

export interface UseProjectLaneStateResult {
  laneState: ProjectLaneState | null
  activeLane: ProjectLaneDescriptor | null
  collabLane: ProjectLaneDescriptor | null
  isLoading: boolean
  refreshLaneState: () => Promise<void>
}

export async function prefetchProjectLaneState(input: {
  projectId: string
  workspaceId: string | null
  collabBranch: string | null
}): Promise<ProjectLaneState | null> {
  const resource = getProjectLaneResource(
    input.projectId,
    input.workspaceId,
    input.collabBranch
  )
  return await resource.ensure('prefetch').catch(() => null)
}

export function clearCachedProjectLaneState(
  projectId: string | null | undefined,
  _workspaceId?: string | null,
): void {
  const trimmedProjectId = projectId?.trim()
  if (!trimmedProjectId) return
  invalidateProjectLaneState(trimmedProjectId)
}

export function useProjectLaneState({
  projectId,
  workspaceId,
  collabBranch,
}: UseProjectLaneStateArgs): UseProjectLaneStateResult {
  return useSharedProjectLaneState(projectId, workspaceId, collabBranch, true)
}
