"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { ChevronsUpDown, FolderOpen, Home, Plus, Building2, Loader2, Cloud, Check, ArrowRightLeft, User } from 'lucide-react'
import { useConvex, useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import { getWorkspacePlanLabel } from '@/lib/billing/planLabels'
import { buildProjectPath, parseProjectRoute } from '@/features/projects/lib/projectRoutes'
import { prepareGitProjectForOpen, type ProjectOpenGitProjectLike } from '@/features/projects/lib/projectOpenGitSync'
import {
  logProjectSourceDebug,
  summarizeProjectForDebug,
} from '@/features/projects/lib/projectSourceDebug'

type SyncState = 'idle' | 'checking' | 'syncing' | 'ready' | 'error'

interface ProjectListItem extends ProjectOpenGitProjectLike {
  name?: string | null
  template?: string | null
  status?: string
}

interface ProjectNavigationState {
  projectId?: string
  projectSlug?: string
  projectName?: string
  projectTemplate?: string
  syncMode?: 'replica' | 'git'
}

export function ContextSwitcher() {
  const convex = useConvex()
  const { isMobile } = useSidebar()
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const { currentOrganization, user, organizations } = useAuth()

  const [open, setOpen] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null)

  // Get Convex organization
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId
      ? { workosId: currentOrganization.organizationId }
      : 'skip'
  )

  const convexUser = useQuery(
    api.users.getByWorkosId,
    user?.id ? { workosId: user.id } : 'skip'
  )

  const routeProject = useMemo(
    () => parseProjectRoute(location.pathname),
    [location.pathname]
  )

  const currentProjectById = useQuery(
    api.projects.getAccessibleById,
    routeProject.projectId && convexUser?._id
      ? { projectId: routeProject.projectId as Id<'projects'>, userId: convexUser._id }
      : 'skip'
  )

  const currentProjectBySlug = useQuery(
    api.projects.getAccessibleBySlug,
    !routeProject.projectId && routeProject.slug && convexUser?._id
      ? {
          slug: routeProject.slug,
          userId: convexUser._id,
          preferredOrganizationId: convexOrg?._id,
        }
      : 'skip'
  )

  const currentProject =
    routeProject.projectId
      ? currentProjectById
      : currentProjectBySlug?.status === 'ok'
        ? currentProjectBySlug.project
        : null

  // Get recent projects
  const projects = useQuery(
    currentOrganization?.workspaceType === 'personal'
      ? api.projects.listForPersonalWorkspaceMemberView
      : api.projects.listForOrganization,
    currentOrganization?.workspaceType === 'personal'
      ? convexUser?._id
        ? { userId: convexUser._id }
        : 'skip'
      : convexOrg?._id
        ? { organizationId: convexOrg._id }
        : 'skip'
  )

  const isPersonalWorkspace = currentOrganization?.workspaceType === 'personal'

  const personalSeatManagement = useQuery(
    api.billing.getSeatManagement,
    isPersonalWorkspace && convexOrg?._id && convexUser?._id
      ? { organizationId: convexOrg._id, userId: convexUser._id }
      : 'skip'
  )

  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)

  const normalizedProjects = useMemo(
    () => {
      const rows = projects ?? []
      return rows.filter((project): project is NonNullable<typeof project> => project !== null)
    },
    [projects]
  )

  // Get recent projects (up to 4, sorted by last updated)
  const recentProjects = [...normalizedProjects]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4)

  // Determine if we're in a project context
  const isInProject = location.pathname.startsWith('/projects/') && !!(routeProject.projectId || routeProject.slug)
  const navigationState = location.state as ProjectNavigationState | null
  const selectedProjectFromList = useMemo(() => {
    if (routeProject.projectId) {
      return normalizedProjects.find((project) => String(project._id) === routeProject.projectId) ?? null
    }
    if (routeProject.slug) {
      return normalizedProjects.find((project) => project.slug === routeProject.slug) ?? null
    }
    return null
  }, [normalizedProjects, routeProject.projectId, routeProject.slug])
  const hasMatchingNavigationState =
    (Boolean(routeProject.projectId) && navigationState?.projectId === routeProject.projectId) ||
    navigationState?.projectSlug === (routeProject.slug ?? selectedProjectFromList?.slug)
  const navigationNameHint =
    hasMatchingNavigationState ? navigationState?.projectName : undefined
  const navigationTemplateHint =
    hasMatchingNavigationState ? navigationState?.projectTemplate : undefined

  useEffect(() => {
    logProjectSourceDebug('context_switcher:state', {
      authWorkosUserId: user?.id ?? null,
      routeProjectId: routeProject.projectId,
      routeSlug: routeProject.slug,
      currentOrganizationId: currentOrganization?.organizationId ?? null,
      workspaceType: currentOrganization?.workspaceType ?? null,
      convexOrganizationId: convexOrg?._id ?? null,
      convexUserId: convexUser?._id ?? null,
      currentProject: summarizeProjectForDebug(currentProject),
      selectedProjectFromList: summarizeProjectForDebug(selectedProjectFromList),
      normalizedProjects: normalizedProjects.map((project) => summarizeProjectForDebug(project)),
    })
  }, [
    convexOrg?._id,
    convexUser?._id,
    currentOrganization?.organizationId,
    currentOrganization?.workspaceType,
    currentProject,
    normalizedProjects,
    routeProject.projectId,
    routeProject.slug,
    selectedProjectFromList,
    user?.id,
  ])

  // Organization info
  const organization = {
    name: currentOrganization?.organizationName || 'My Workspace',
    plan: isPersonalWorkspace
      ? getWorkspacePlanLabel(personalSeatManagement?.entitlement?.plan ?? convexOrg?.subscription?.plan)
      : getWorkspacePlanLabel(convexOrg?.subscription?.plan),
  }

  const resetSyncState = useCallback(() => {
    setSyncState('idle')
    setSyncMessage('')
    setActiveProjectName(null)
  }, [])

  const handleProjectSelect = useCallback(async (project: ProjectListItem, event?: Event) => {
    event?.preventDefault()
    if (syncState !== 'idle') return

    logProjectSourceDebug('context_switcher:open_project', {
      project: summarizeProjectForDebug(project),
      routeProjectId: routeProject.projectId,
      routeSlug: routeProject.slug,
    })

    // Draft projects go straight to wizard
    if (project.status === 'draft') {
      setOpen(false)
      navigate(`/projects/new?resume=${project._id}`)
      return
    }

    setActiveProjectName(project.name ?? null)
    setSyncState('checking')
    setSyncMessage('Preparing project...')
    setOpen(true)

    try {
      await prepareGitProjectForOpen({
        convex,
        project,
        localPath: await window.electronAPI.project.getLocalPath(project.slug),
        userId: convexUser?._id,
        onProgress: (message) => {
          setSyncMessage(message)
        },
        updateMemberLocalPath: convexUser?._id ? updateMemberLocalPath : undefined,
      })

      setSyncState('ready')
      setSyncMessage('Opening project...')

      setTimeout(() => {
        setOpen(false)
        navigate(buildProjectPath(String(project._id)), {
          state: {
            projectSlug: project.slug,
            projectId: String(project._id),
            projectName: project.name ?? undefined,
            projectTemplate: project.template ?? undefined,
            syncMode: 'git',
          } satisfies ProjectNavigationState,
        })
        resetSyncState()
      }, 200)
    } catch (error) {
      console.error('[ContextSwitcher] Project prep failed:', error)
      setSyncState('error')
      setSyncMessage(error instanceof Error ? error.message : 'Failed to prepare project')

      setTimeout(() => {
        resetSyncState()
      }, 2000)
    }
  }, [convex, convexUser?._id, navigate, resetSyncState, syncState, updateMemberLocalPath])

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
    navigate('/workspaces/new')
  }, [navigate])

  const isBusy = syncState !== 'idle'

  const handleOpenChange = (nextOpen: boolean) => {
    if (isBusy && !nextOpen) return
    setOpen(nextOpen)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={open} onOpenChange={handleOpenChange}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  {isInProject ? (
                    <FolderOpen className="size-4" />
                  ) : isPersonalWorkspace ? (
                    <User className="size-4" />
                  ) : (
                    <Building2 className="size-4" />
                  )}
                </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {isInProject
                    ? currentProject?.name ??
                      navigationNameHint ??
                      selectedProjectFromList?.name ??
                      routeProject.slug ??
                      'Project'
                    : organization.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {isInProject
                    ? currentProject?.template ??
                      navigationTemplateHint ??
                      selectedProjectFromList?.template ??
                      'Project'
                    : organization.plan}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            {syncState !== 'idle' && (
              <>
                <div className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    {syncState === 'error' ? (
                      <div className="size-6 rounded-md bg-destructive/10 flex items-center justify-center">
                        <Cloud className="size-3.5 text-destructive" />
                      </div>
                    ) : syncState === 'ready' ? (
                      <div className="size-6 rounded-md bg-green-500/10 flex items-center justify-center">
                        <Check className="size-3.5 text-green-500" />
                      </div>
                    ) : (
                      <div className="size-6 rounded-md bg-primary/10 flex items-center justify-center">
                        <Loader2 className="size-3.5 text-primary animate-spin" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-muted-foreground truncate">
                        {syncMessage}
                      </div>
                      {activeProjectName && (
                        <div className="text-[11px] text-muted-foreground/70 truncate">
                          {activeProjectName}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 h-0.5 w-full bg-border/50">
                    <div
                      className={`h-full transition-all duration-300 ${
                        syncState === 'ready' ? 'bg-green-500' : syncState === 'error' ? 'bg-destructive' : 'bg-primary'
                      } ${syncState !== 'ready' && syncState !== 'error' ? 'animate-pulse' : ''}`}
                      style={{
                        width: syncState === 'ready' ? '100%' : syncState === 'syncing' ? '70%' : '30%',
                      }}
                    />
                  </div>
                </div>
                <DropdownMenuSeparator />
              </>
            )}
            {isInProject && (
              <>
                <DropdownMenuItem onSelect={handleGoHome} className="w-full cursor-pointer gap-2 p-2" disabled={isBusy}>
                  <div className="flex size-6 items-center justify-center rounded-md">
                    <Home className="size-3.5" />
                  </div>
                  All Projects
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Recent Projects
            </DropdownMenuLabel>
            {recentProjects.length > 0 ? (
              recentProjects.map((project) => (
                <DropdownMenuItem
                  key={project._id}
                  onSelect={(event) => handleProjectSelect(project, event)}
                  className="w-full cursor-pointer gap-2 p-2"
                  disabled={isBusy}
                >
                  <div className="flex size-6 items-center justify-center rounded-md">
                    <FolderOpen className="size-3.5 shrink-0" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{project.name}</div>
                  </div>
                </DropdownMenuItem>
              ))
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleNewProject} className="w-full cursor-pointer gap-2 p-2" disabled={isBusy}>
              <div className="flex size-6 items-center justify-center rounded-md bg-transparent">
                <Plus className="size-4" />
              </div>
              <span className="text-muted-foreground font-medium">New Project</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleCreateWorkspace} className="w-full cursor-pointer gap-2 p-2" disabled={isBusy}>
              <div className="flex size-6 items-center justify-center rounded-md bg-transparent">
                <Building2 className="size-4" />
              </div>
              <span className="text-muted-foreground font-medium">Create Workspace</span>
            </DropdownMenuItem>
            {organizations.length > 1 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleSwitchWorkspace} className="w-full cursor-pointer gap-2 p-2" disabled={isBusy}>
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
