import { useEffect, useState } from "react"
import { Navigate } from "@/lib/router"
import { useQuery } from "convex/react"
import { getWorkspaceSelectionId } from "@shared/types"
import { FolderOpen, Plus } from "lucide-react"

import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { useResolvedScope } from "@/hooks/useResolvedScope"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import { useProjectCreationMenu } from "@/features/projects/hooks/useProjectCreationMenu"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  buildWorkbenchHref,
  clearLastWorkbenchRoute,
  readLastWorkbenchRoute,
} from "@/features/projects/lib/lastWorkbenchRoute"

export function ProjectsLaunchPage() {
  const { convexUserId, isLoading } = useAuth()
  const resolvedScope = useResolvedScope({ ignoreLocation: true })
  const { personalScoped, workspaceScoped, convexOrg, capabilities } = useScopedAppContext()
  const { openProjectCreationMenu } = useProjectCreationMenu()
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

  const hasProjects = Boolean(fallbackProject?._id)
  const canCreateProjects = capabilities.canCreateProjects
  const canStartProjectFlow = canCreateProjects || capabilities.canImportProjects

  return (
    <div className="flex min-h-full flex-1 items-center justify-center">
      <div className="w-full p-6 md:p-10">
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia>
              <FolderOpen className="h-8 w-8" />
            </EmptyMedia>
            <EmptyTitle>{hasProjects ? "Select a project" : "No projects yet"}</EmptyTitle>
            <EmptyDescription>
              {hasProjects
                ? "Choose a project from the sidebar to open its workbench."
                : canStartProjectFlow
                  ? canCreateProjects
                    ? "Create a project to start working in this workspace."
                    : "Import a project to start working in this workspace."
                  : "Projects will appear here when this workspace has active projects you can access."}
            </EmptyDescription>
          </EmptyHeader>
          {!hasProjects && canStartProjectFlow ? (
            <EmptyContent>
              <Button className="gap-2" onClick={(event) => void openProjectCreationMenu(event)}>
                <Plus className="h-4 w-4" />
                {canCreateProjects ? "Create Project" : "Import Project"}
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      </div>
    </div>
  )
}
