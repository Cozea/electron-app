"use client"

import { useCallback, useMemo, useState } from 'react'
import { useLocation } from '@/lib/router'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { ChevronsUpDown, FolderOpen, Home, Plus, Building2, ArrowRightLeft } from 'lucide-react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useAuth } from '@/contexts/AuthContext'
import { getOrganizationPlanLabel, getPersonalPlanLabel } from '@/lib/billing/planLabels'
import { getSeatManagementCacheKey } from '@/lib/queryCacheKeys'
import { useCachedQuery } from '@/stores/useQueryCache'
import { useCreateWorkspaceDialogStore } from '@/stores/useCreateWorkspaceDialogStore'
import { parseProjectRoute } from '@/features/projects/lib/projectRoutes'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'
import { WorkspaceAvatar } from '@/components/workspaces/WorkspaceAvatar'

interface ProjectNavigationState {
  projectId?: string
  projectSlug?: string
  projectName?: string
  projectTemplate?: string
  localPath?: string | null
  syncMode?: 'git'
}

export function ContextSwitcher() {
  const { isMobile } = useSidebar()
  const navigate = useViewTransitionNavigate()
  const openCreateWorkspaceDialog = useCreateWorkspaceDialogStore(
    (state) => state.open
  )
  const location = useLocation()
  const { organizationWorkspaces, personalWorkspace, convexUserId } = useAuth()
  const {
    resolvedScope,
    personalScoped: isPersonalWorkspace,
    preferredConvexOrganizationId,
    convexOrg,
    workspaceName,
  } = useScopedAppContext()
  const currentWorkspace = resolvedScope.activeWorkspace
  const availableWorkspaces = useMemo(
    () => (personalWorkspace ? [personalWorkspace, ...organizationWorkspaces] : organizationWorkspaces),
    [organizationWorkspaces, personalWorkspace],
  )

  const [open, setOpen] = useState(false)
  const routeProject = useMemo(
    () => parseProjectRoute(location.pathname),
    [location.pathname]
  )

  const currentProjectById = useQuery(
    api.projects.getAccessibleById,
    routeProject.projectId && convexUserId
      ? { projectId: routeProject.projectId as Id<'projects'>, userId: convexUserId }
      : 'skip'
  )

  const currentProjectBySlug = useQuery(
    api.projects.getAccessibleBySlug,
    !routeProject.projectId && routeProject.slug && convexUserId
      ? {
          slug: routeProject.slug,
          userId: convexUserId,
          preferredOrganizationId: preferredConvexOrganizationId,
        }
      : 'skip'
  )

  const currentProject =
    routeProject.projectId
      ? currentProjectById
      : currentProjectBySlug?.status === 'ok'
        ? currentProjectBySlug.project
        : null

  const currentSeatManagement = useQuery(
    api.billing.getSeatManagement,
    convexOrg?._id && convexUserId
      ? { organizationId: convexOrg._id, userId: convexUserId }
      : 'skip'
  )
  const cachedSeatManagement = useCachedQuery(
    getSeatManagementCacheKey(convexOrg?._id, convexUserId),
    currentSeatManagement
  )

  // Determine if we're in a project context
  const isInProject = location.pathname.startsWith('/projects/') && !!(routeProject.projectId || routeProject.slug)
  const navigationState = location.state as ProjectNavigationState | null
  const hasMatchingNavigationState =
    (Boolean(routeProject.projectId) && navigationState?.projectId === routeProject.projectId) ||
    navigationState?.projectSlug === routeProject.slug
  const navigationNameHint =
    hasMatchingNavigationState ? navigationState?.projectName : undefined
  const navigationTemplateHint =
    hasMatchingNavigationState ? navigationState?.projectTemplate : undefined

  // Organization info
  const organization = {
    name: workspaceName || currentWorkspace?.organizationName || 'My Workspace',
    plan: isPersonalWorkspace
      ? getPersonalPlanLabel(cachedSeatManagement?.entitlement?.plan)
      : `Workspace · ${getOrganizationPlanLabel(cachedSeatManagement?.entitlement?.plan)}`,
  }

  const handleGoHome = useCallback(() => {
    setOpen(false)
    navigate('/projects')
  }, [navigate])

  const handleNewProject = useCallback(() => {
    setOpen(false)
    navigate('/projects/new')
  }, [navigate])

  const handleSwitchWorkspace = useCallback(() => {
    setOpen(false)
    navigate('/workspaces/select')
  }, [navigate])

  const handleCreateWorkspace = useCallback(() => {
    setOpen(false)
    openCreateWorkspaceDialog()
  }, [openCreateWorkspaceDialog])

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  {isInProject ? (
                    <FolderOpen className="size-4" />
                  ) : (
                    <WorkspaceAvatar
                      workspaceType={currentWorkspace?.workspaceType}
                      iconKey={currentWorkspace?.iconKey}
                      iconColor={currentWorkspace?.iconColor}
                      logoUrl={currentWorkspace?.logoUrl}
                      size="sm"
                      className="size-8 rounded-lg border-0"
                      iconClassName="size-4"
                    />
                  )}
                </div>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">
                  {isInProject
                    ? currentProject?.name ??
                      navigationNameHint ??
                      routeProject.slug ??
                      'Project'
                    : organization.name}
                </span>
                {isInProject ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {currentProject?.template ??
                      navigationTemplateHint ??
                      'Project'}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <span className="truncate">{organization.plan}</span>
                  </span>
                )}
              </div>
              <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            {isInProject && (
              <>
                <DropdownMenuItem onSelect={handleGoHome} className="w-full cursor-pointer gap-2 p-2">
                  <div className="flex size-6 items-center justify-center rounded-md">
                    <Home className="size-3.5" />
                  </div>
                  All Projects
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={handleNewProject} className="w-full cursor-pointer gap-2 p-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-transparent">
                <Plus className="size-4" />
              </div>
              <span className="text-muted-foreground font-medium">New Project</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleCreateWorkspace} className="w-full cursor-pointer gap-2 p-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-transparent">
                <Building2 className="size-4" />
              </div>
              <span className="text-muted-foreground font-medium">Create Workspace</span>
            </DropdownMenuItem>
            {availableWorkspaces.length > 1 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleSwitchWorkspace} className="w-full cursor-pointer gap-2 p-2">
                  <div className="flex size-6 items-center justify-center rounded-md bg-transparent">
                    <ArrowRightLeft className="size-4" />
                  </div>
                  <span className="text-muted-foreground font-medium">Switch Workspace</span>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
