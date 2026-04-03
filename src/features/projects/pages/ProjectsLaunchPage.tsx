import { useEffect, useState } from "react"
import { Navigate } from "@/lib/router"
import { useQuery } from "convex/react"
import { getWorkspaceSelectionId } from "@shared/types"

import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { useResolvedScope } from "@/hooks/useResolvedScope"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import { Projects } from "@/pages/Projects"
import {
  buildWorkbenchHref,
  clearLastWorkbenchRoute,
  readLastWorkbenchRoute,
} from "@/features/projects/lib/lastWorkbenchRoute"

export function ProjectsLaunchPage() {
  const { convexUserId, isLoading } = useAuth()
  const resolvedScope = useResolvedScope({ ignoreLocation: true })
  const { personalScoped, workspaceScoped, convexOrg } = useScopedAppContext()
  const workspaceSelectionId =
    getWorkspaceSelectionId(resolvedScope.activeWorkspace) ??
    resolvedScope.activeWorkspace?.organizationId ??
    null
  const [ignoredWorkspaceSelectionId, setIgnoredWorkspaceSelectionId] = useState<string | null>(null)
  const lastWorkbenchRoute =
    ignoredWorkspaceSelectionId === workspaceSelectionId
      ? null
      : readLastWorkbenchRoute(workspaceSelectionId)

  const restoredProject = useQuery(
    api.projects.getAccessibleById,
    lastWorkbenchRoute?.projectId && convexUserId
      ? {
          projectId: lastWorkbenchRoute.projectId as Id<"projects">,
          userId: convexUserId,
        }
      : "skip",
  )

  const personalProjectsPage = useQuery(
    api.projects.listPageForPersonalWorkspaceMemberView,
    !lastWorkbenchRoute && personalScoped && convexUserId
      ? {
          userId: convexUserId,
          statusFilter: "all",
          sortBy: "last_modified",
          page: 1,
          pageSize: 1,
        }
      : "skip",
  )
  const workspaceProjectsPage = useQuery(
    api.projects.listPageForOrganization,
    !lastWorkbenchRoute && workspaceScoped && convexOrg?._id && convexUserId
      ? {
          organizationId: convexOrg._id,
          userId: convexUserId,
          statusFilter: "all",
          sortBy: "last_modified",
          page: 1,
          pageSize: 1,
        }
      : "skip",
  )

  useEffect(() => {
    if (!workspaceSelectionId || !lastWorkbenchRoute) {
      return
    }
    if (restoredProject !== null) {
      return
    }

    clearLastWorkbenchRoute(workspaceSelectionId)
    setIgnoredWorkspaceSelectionId(workspaceSelectionId)
  }, [lastWorkbenchRoute, restoredProject, workspaceSelectionId])

  if (isLoading) {
    return null
  }

  if (lastWorkbenchRoute) {
    if (restoredProject === undefined) {
      return null
    }

    if (restoredProject) {
      return (
        <Navigate
          to={buildWorkbenchHref(lastWorkbenchRoute.projectId, lastWorkbenchRoute.laneId, {
            focusTileId: lastWorkbenchRoute.focusTileId,
          })}
          replace
        />
      )
    }
  }

  const fallbackProject = personalScoped
    ? (personalProjectsPage?.items?.[0] ?? null)
    : (workspaceProjectsPage?.items?.[0] ?? null)

  if (
    (!personalScoped && workspaceScoped && convexOrg?._id && workspaceProjectsPage === undefined) ||
    (personalScoped && convexUserId && personalProjectsPage === undefined)
  ) {
    return null
  }

  if (fallbackProject?._id) {
    return <Navigate to={buildWorkbenchHref(String(fallbackProject._id))} replace />
  }

  return <Projects />
}
