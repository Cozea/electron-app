import { LOCAL_PROJECT_ID_PREFIX, type LocalProjectDTO } from "@shared/localProjectTypes"
import type { WorkspaceCatalogSnapshot } from "@shared/workspaceTypes"

export interface LocalProjectRouteResolution {
  localProject: LocalProjectDTO | null
  localProjectId: string | null
  executionProjectId: string | null
  cloudProjectId: LocalProjectDTO["cloudProjectId"]
  legacyCloudRouteKey: string | null
  localSlugAmbiguous: boolean
  localSlugCandidates: Array<{ projectId: string; name: string; folderPath: string | null }>
  catalogReady: boolean
}

/** Local identity wins even when a shared deep link contains its associated cloud ID. */
export function resolveLocalProjectRoute(
  snapshot: WorkspaceCatalogSnapshot | null,
  projectId: string | null | undefined,
  slug: string | null | undefined,
): LocalProjectRouteResolution {
  const projects = Object.values(snapshot?.projects ?? {})
  const byId = projectId
    ? projects.find((project) => project.projectId === projectId) ??
      projects.find((project) => project.cloudProjectId === projectId)
    : undefined
  const slugMatches = !projectId && slug
    ? projects.filter((project) => project.slug === slug && project.status !== "removed")
    : []
  const localProject = byId ?? (slugMatches.length === 1 ? slugMatches[0] : null)
  const localProjectId = localProject?.projectId ?? projectId ?? null
  const deviceOnlyRoute = projectId?.startsWith(LOCAL_PROJECT_ID_PREFIX) === true
  return {
    localProject,
    localProjectId,
    executionProjectId: localProject?.status === "removed" ? null : localProject?.projectId ??
      (projectId && (!snapshot || !deviceOnlyRoute || snapshot.entries[projectId]) ? projectId : null),
    cloudProjectId: localProject?.cloudProjectId ?? null,
    legacyCloudRouteKey: projectId && snapshot && !localProject && !deviceOnlyRoute ? projectId : null,
    localSlugAmbiguous: slugMatches.length > 1,
    localSlugCandidates: slugMatches.length > 1 ? slugMatches.map((project) => ({
      projectId: project.projectId, name: project.name,
      folderPath: snapshot?.entries[project.projectId]?.workspace.projectRootPath ?? null,
    })) : [],
    catalogReady: snapshot !== null,
  }
}
