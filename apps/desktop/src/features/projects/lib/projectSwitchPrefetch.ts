import type { ConvexReactClient } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { prefetchProjectLaneState } from "@/features/workbench/hooks/useProjectLaneState"
import { prefetchProjectWorkspaceResolution } from "@/features/workspace/useProjectWorkspaceResolution"
import { useQueryCache } from "@/app/model/queryCache"
import { featureFlags } from "@/lib/featureFlags"

export function layoutProjectQueryCacheKey(
  routeProjectId: string | null | undefined,
  routeSlug: string | null | undefined,
): string {
  return `layout-project-${routeProjectId ?? routeSlug}`
}

export interface PrefetchProjectSwitchInput {
  projectId: string
  projectSlug?: string | null
  workspaceId?: string | null
  collabBranch?: string | null
  convex: Pick<ConvexReactClient, "query">
  principalId: Id<"devicePrincipals"> | null
}

const prefetchInflight = new Set<string>()

export function prefetchProjectSwitch(input: PrefetchProjectSwitchInput): void {
  const projectId = input.projectId.trim()
  if (!projectId) {
    return
  }

  const inflightKey = `${projectId}::${input.workspaceId ?? ""}::${input.principalId ?? ""}`
  if (prefetchInflight.has(inflightKey)) {
    return
  }
  prefetchInflight.add(inflightKey)

  void (async () => {
    try {
      const tasks: Array<Promise<unknown>> = []

      if (featureFlags.commonRoutePrewarm) {
        tasks.push(import("@/features/projects/pages/ProjectWorkbenchPage"))
      }

      if (input.principalId) {
        tasks.push(
          prefetchLayoutProject({
            convex: input.convex,
            projectId,
            principalId: input.principalId,
          }),
        )
      }

      if (featureFlags.localWorkspaceCatalog) {
        tasks.push(
          prefetchProjectWorkspaceResolution({
            projectId,
            projectSlug: input.projectSlug ?? null,
            preferredWorkspaceId: input.workspaceId ?? null,
            allowCandidateScan: true,
          }),
        )
      }

      if (input.workspaceId) {
        tasks.push(
          prefetchProjectLaneState({
            projectId,
            workspaceId: input.workspaceId,
            collabBranch: input.collabBranch ?? null,
          }),
        )
      }

      await Promise.all(tasks)
    } catch (error) {
      console.warn("[projectSwitchPrefetch] Failed to prefetch project switch", error)
    } finally {
      prefetchInflight.delete(inflightKey)
    }
  })()
}

export async function prefetchLayoutProject(input: {
  convex: Pick<ConvexReactClient, "query">
  projectId: string
  principalId: Id<"devicePrincipals">
}): Promise<void> {
  const cacheKey = layoutProjectQueryCacheKey(input.projectId, null)
  const cached = useQueryCache.getState().get(cacheKey)
  if (cached) {
    return
  }

  const project = await input.convex.query(api.projects.getAccessibleById, {
    projectId: input.projectId as Id<"projects">,
  })
  if (project) {
    useQueryCache.getState().set(cacheKey, project)
  }
}
