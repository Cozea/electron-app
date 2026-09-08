import type {
  RepoIdentity,
  ResolveProjectWorkspaceResult,
} from "@shared/workspaceTypes"
import {
  getWorkspaceResolutionResource,
  invalidateProjectWorkspaceResolution as invalidateSharedResolution,
} from "@/app/resources/workspaceResources"
import { useSharedWorkspaceResolution } from "@/app/resources/useWorkspaceResources"

export async function prefetchProjectWorkspaceResolution(input: {
  projectId: string
  projectSlug?: string | null
  preferredWorkspaceId?: string | null
  allowCandidateScan?: boolean
}): Promise<ResolveProjectWorkspaceResult | null> {
  const resource = getWorkspaceResolutionResource(
    input.projectId,
    input.preferredWorkspaceId,
    input.projectSlug,
    null,
    false // Intent prefetch is bound-only; a foreground repair can request candidates.
  )
  return await resource.ensure('prefetch').catch(() => null)
}

/** Drops cached resolutions for a project after relink/close/repair actions. */
export function invalidateProjectWorkspaceResolution(projectId: string): void {
  invalidateSharedResolution(projectId)
}

/**
 * Shared workspace resolution hook.
 * Uses KeyedResource with single in-flight deduplication and stable snapshots.
 */
export function useProjectWorkspaceResolution(
  projectId: string | null | undefined,
  projectSlug?: string | null,
  expectedRepo?: RepoIdentity | null,
  preferredWorkspaceId?: string | null,
  options?: { allowCandidateScan?: boolean },
): { result: ResolveProjectWorkspaceResult | null, refresh: () => void } {
  return useSharedWorkspaceResolution(
    projectId,
    projectSlug,
    expectedRepo,
    preferredWorkspaceId,
    options
  )
}
