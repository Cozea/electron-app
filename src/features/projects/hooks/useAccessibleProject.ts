import { useMemo } from "react"
import { useParams } from '@/lib/router'
import { useQuery } from "convex/react"

import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import {
  useOptionalProjectRouteContext,
  type ProjectRouteSlugResolutionResult,
} from "@/features/projects/contexts/ProjectRouteContext"

export function useAccessibleProject() {
  const { slug, projectId } = useParams()
  const { convexUserId } = useAuth()
  const { convexOrg, preferredConvexOrganizationId } = useScopedAppContext()
  const projectRouteContext = useOptionalProjectRouteContext()
  const routeProjectIdParam = projectRouteContext?.projectIdParam ?? projectId ?? null
  const routeSlugParam = projectRouteContext?.slugParam ?? slug ?? null

  const projectById = useQuery(
    api.projects.getAccessibleById,
    !projectRouteContext && routeProjectIdParam && convexUserId
      ? { projectId: routeProjectIdParam as Id<"projects">, userId: convexUserId }
      : "skip"
  )

  const projectBySlugResult = useQuery(
    api.projects.getAccessibleBySlug,
    !projectRouteContext && !routeProjectIdParam && routeSlugParam && convexUserId
      ? {
          slug: routeSlugParam,
          userId: convexUserId,
          preferredOrganizationId: preferredConvexOrganizationId,
        }
      : "skip"
  ) as ProjectRouteSlugResolutionResult | undefined

  const project = useMemo(() => {
    if (projectRouteContext) {
      return projectRouteContext.project
    }
    if (routeProjectIdParam) {
      return projectById
    }
    if (!routeSlugParam) {
      return null
    }
    if (projectBySlugResult === undefined) {
      return undefined
    }
    if (projectBySlugResult.status !== "ok") {
      return null
    }
    return projectBySlugResult.project ?? null
  }, [projectById, projectBySlugResult, projectRouteContext, routeProjectIdParam, routeSlugParam])

  return {
    project,
    projectIdParam: routeProjectIdParam,
    slugParam: routeSlugParam,
    convexUserId,
    convexOrg,
    slugResolution: projectRouteContext?.slugResolution ?? projectBySlugResult,
  }
}
