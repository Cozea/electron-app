import { useParams } from '@/lib/router'
import { useAuth } from "@/contexts/AuthContext"
import {
  useOptionalProjectRouteContext,
} from "@/contexts/project/ProjectRouteContext"
import { useProjectRouteData } from "./useProjectRouteData"

export function useAccessibleProject() {
  const { slug, projectId } = useParams()
  const { principalId } = useAuth()
  const projectRouteContext = useOptionalProjectRouteContext()
  const routeProjectIdParam = projectRouteContext?.projectIdParam ?? projectId ?? null
  const routeSlugParam = projectRouteContext?.slugParam ?? slug ?? null

  const data = useProjectRouteData(routeProjectIdParam, routeSlugParam, !projectRouteContext)

  return {
    project: projectRouteContext ? projectRouteContext.project : data.project,
    localProject: projectRouteContext?.localProject ?? data.localProject,
    localProjectId: projectRouteContext?.localProjectId ?? projectRouteContext?.localProject?.projectId ??
      projectRouteContext?.projectIdParam ?? projectRouteContext?.project?._id ?? data.localProjectId,
    cloudProjectId: projectRouteContext?.cloudProjectId ?? projectRouteContext?.project?._id ?? data.cloudProjectId,
    projectName: projectRouteContext?.projectName ?? data.projectName,
    catalogReady: projectRouteContext?.catalogReady ?? data.catalogReady,
    cloudError: projectRouteContext?.cloudError ?? data.cloudError,
    projectIdParam: routeProjectIdParam,
    slugParam: routeSlugParam,
    principalId,
    slugResolution: projectRouteContext?.slugResolution ?? data.slugResolution,
  }
}
