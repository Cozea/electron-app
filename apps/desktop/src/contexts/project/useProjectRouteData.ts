import { useEffect, useMemo } from "react"

import { api } from "../../../../../convex/_generated/api"
import { useAuth } from "@/contexts/AuthContext"
import { useCachedQuery } from "@/app/model/queryCache"
import { useSafeConvexQuery } from "@/hooks/useSafeConvexQuery"
import { useWorkspaceCatalogSnapshot } from "@/features/workspace/useWorkspaceCatalogSnapshot"
import { layoutProjectQueryCacheKey } from "@/features/projects/lib/projectSwitchPrefetch"
import { resolveLocalProjectRoute } from "./localProjectRoute"
import { LOCAL_PROJECT_ID_PREFIX } from "@shared/localProjectTypes"

/** Cloud documents stay genuine and optional; local entries supply execution identity. */
export function useProjectRouteData(projectId: string | null | undefined, slug: string | null | undefined, enabled = true) {
  const { principalId, isConvexAuthReady, localDevice } = useAuth()
  const snapshot = useWorkspaceCatalogSnapshot(enabled)
  const local = useMemo(() => resolveLocalProjectRoute(snapshot, enabled ? projectId : null, enabled ? slug : null), [snapshot, projectId, slug, enabled])
  const cloudReady = enabled && Boolean(principalId && isConvexAuthReady)
  const byId = useSafeConvexQuery(api.projects.getAccessibleById,
    cloudReady && local.cloudProjectId ? { projectId: local.cloudProjectId } : "skip")
  const byRoute = useSafeConvexQuery(api.projects.getAccessibleByRouteKey,
    cloudReady && local.legacyCloudRouteKey ? { projectKey: local.legacyCloudRouteKey } : "skip")
  const bySlug = useSafeConvexQuery(api.projects.getAccessibleBySlug,
    cloudReady && local.catalogReady && !projectId && slug && !local.localProject && !local.localSlugAmbiguous
      ? { slug } : "skip")
  const freshProject = !enabled ? undefined : !projectId && !slug ? null : local.cloudProjectId ? byId.data : projectId
    ? byRoute.data
    : bySlug.data?.status === "ok" ? bySlug.data.project : bySlug.data ? null : undefined
  const cached = useCachedQuery(enabled ? layoutProjectQueryCacheKey(projectId, slug) : "disabled-local-project-route", freshProject)
  // A cache cannot attach another project's shared state, including before discovery.
  const cachedMatches = !cached || (local.cloudProjectId ? cached._id === local.cloudProjectId
    : projectId ? !projectId.startsWith(LOCAL_PROJECT_ID_PREFIX) && cached._id === projectId
      : cached.slug === slug)
  const project = !enabled ? undefined : (local.localProject && !local.cloudProjectId) || !cachedMatches ? null : cached
  const cloudProjectId = local.cloudProjectId ?? project?._id ?? null

  // Persist only a fresh, authenticated observation of an existing association.
  // Neither a cached document nor a navigation hint can create an association.
  const localEntry = local.localProject
  const observation = useMemo(() => {
    if (!cloudReady || !localDevice || !localEntry || localEntry.status === "removed" ||
      !freshProject || freshProject._id !== localEntry.cloudProjectId ||
      (localEntry.sharedName === freshProject.name && localEntry.sharedStatus === freshProject.status &&
        localEntry.sharedIdentityKey === localDevice.identityKey)) return null
    return {
      projectId: localEntry.projectId,
      cloudProjectId: freshProject._id,
      name: freshProject.name,
      slug: freshProject.slug,
      status: freshProject.status,
      identityKey: localDevice.identityKey,
    }
  }, [cloudReady, localDevice?.identityKey, localEntry?.projectId, localEntry?.cloudProjectId,
    localEntry?.status, localEntry?.sharedName, localEntry?.sharedStatus, localEntry?.sharedIdentityKey,
    freshProject?._id, freshProject?.name, freshProject?.slug, freshProject?.status])
  useEffect(() => {
    if (!observation || typeof window === "undefined" || !window.electronAPI?.workspace?.projects?.observeShared) return
    void window.electronAPI.workspace.projects.observeShared(observation).then((result) => {
      if (!result.success) console.warn("[ProjectRoute] Could not save shared presentation:", result.error)
    }).catch((error: unknown) => console.warn("[ProjectRoute] Could not save shared presentation:", error))
  }, [observation])
  return {
    ...local,
    project,
    cloudProjectId,
    freshProject,
    slugResolution: bySlug.data,
    cloudError: byId.error ?? byRoute.error ?? bySlug.error,
    projectName: local.localProject?.name ?? project?.name ?? null,
    projectSlug: local.localProject?.slug ?? project?.slug ?? slug ?? null,
    localProjectId: local.localProjectId ?? project?._id ?? null,
    executionProjectId: local.executionProjectId ?? (!local.localSlugAmbiguous && !local.localProject ? project?._id ?? null : null),
  }
}
