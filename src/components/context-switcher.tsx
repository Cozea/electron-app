"use client"

import { useCallback, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { ChevronsUpDown, FolderOpen, Home, Plus, Building2, Loader2, Cloud, Check, ArrowRightLeft, User } from 'lucide-react'
import { useQuery, useMutation } from 'convex/react'
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
import { runProjectOpenReplicaCheck } from '@/features/projects/lib/projectOpenReplicaCheck'
import type { ProjectOpenReplicaCheckResult } from '@/features/projects/lib/projectOpenReplicaCheck'
import { formatReplicaSyncError } from '@/features/projects/lib/replicaErrorPresentation'
import { buildProjectPath, parseProjectRoute } from '@/features/projects/lib/projectRoutes'

type SyncState = 'idle' | 'checking' | 'syncing' | 'ready' | 'error'

interface ProjectListItem {
  _id: Id<'projects'>
  slug: string
  name?: string | null
  template?: string | null
  status?: string
}

interface ProjectNavigationState {
  projectId?: string
  projectSlug?: string
  projectName?: string
  projectTemplate?: string
  gateSyncScreen?: boolean
  skipInitialSyncCheck?: boolean
}

export function ContextSwitcher() {
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

  const executeAutoSyncBeforeOpen = useCallback(async (
    project: ProjectListItem,
    effectiveLocalPath: string,
    check: ProjectOpenReplicaCheckResult
  ): Promise<boolean> => {
    setSyncState('syncing')
    setSyncMessage(check.likelyLocalWipe ? 'Downloading cloud files...' : 'Syncing project files...')

    const result = await window.electronAPI.sync.gitReplicaExecute({
      projectId: String(project._id),
      projectPath: effectiveLocalPath,
      sessionId: check.plan.sessionId,
    })

    if (result.success && result.applied) {
      return true
    }

    throw new Error(
      formatReplicaSyncError(
        result.error || 'Failed to sync project files',
        'Failed to sync project files'
      ).summary
    )
  }, [])

  const handleProjectSelect = useCallback(async (project: ProjectListItem, event?: Event) => {
    event?.preventDefault()
    if (syncState !== 'idle') return

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
      let effectiveLocalPath = await window.electronAPI.project.getLocalPath(project.slug)

      if (!effectiveLocalPath) {
        setSyncMessage('Creating local folder...')
        const result = await window.electronAPI.project.createFolder({
          slug: project.slug,
          initGit: true,
        })

        if (!result.success || !result.localPath) {
          throw new Error(result.error || 'Failed to create folder')
        }

        effectiveLocalPath = result.localPath
      }

      if (effectiveLocalPath && convexUser?._id) {
        await updateMemberLocalPath({
          projectId: project._id,
          userId: convexUser._id,
          localPath: effectiveLocalPath,
        })
      }

      let openCheck: ProjectOpenReplicaCheckResult | null = null

      if (effectiveLocalPath) {
        setSyncMessage('Checking sync status...')
        const check = await runProjectOpenReplicaCheck({
          projectId: String(project._id),
          projectPath: effectiveLocalPath,
        })
        openCheck = check

        if (check.totalChanges > 0) {
          setSyncState('syncing')
          if (check.hasConflicts) {
            setSyncMessage(`${check.plan.conflicts.length} conflict${check.plan.conflicts.length === 1 ? '' : 's'} detected`)
          } else if (check.likelyLocalWipe) {
            setSyncMessage('Downloading cloud files...')
          } else {
            setSyncMessage('Syncing project files...')
          }
        }
      }

      if (effectiveLocalPath && openCheck && openCheck.totalChanges > 0 && !openCheck.hasConflicts) {
        const shouldContinueToOpen = await executeAutoSyncBeforeOpen(project, effectiveLocalPath, openCheck)
        if (!shouldContinueToOpen) {
          return
        }
      }

      setSyncState('ready')
      setSyncMessage(openCheck?.gateSyncScreen ? 'Opening sync review...' : 'Opening project...')

      setTimeout(() => {
        setOpen(false)
        navigate(buildProjectPath(String(project._id)), {
          state: {
            projectSlug: project.slug,
            projectId: String(project._id),
            projectName: project.name ?? undefined,
            projectTemplate: project.template ?? undefined,
            gateSyncScreen: openCheck?.gateSyncScreen ?? false,
            skipInitialSyncCheck: !(openCheck?.gateSyncScreen ?? false),
          } satisfies ProjectNavigationState,
        })
        resetSyncState()
      }, 200)
    } catch (error) {
      console.error('[ContextSwitcher] Project prep failed:', error)
      const presentedError = formatReplicaSyncError(error, 'Failed to prepare project')
      setSyncState('error')
      setSyncMessage(presentedError.summary)

      setTimeout(() => {
        resetSyncState()
      }, 2000)
    }
  }, [convexUser?._id, executeAutoSyncBeforeOpen, navigate, resetSyncState, syncState, updateMemberLocalPath])

  const handleGoHome = () => {
    navigate('/projects')
  }

  const handleNewProject = () => {
    navigate('/projects/new')
  }

  const handleSwitchWorkspace = () => {
    navigate('/workspaces/select')
  }

  const handleCreateWorkspace = () => {
    navigate('/workspaces/new')
  }

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
                <DropdownMenuItem onClick={handleGoHome} className="gap-2 p-2" disabled={isBusy}>
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
                  className="gap-2 p-2"
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
            <DropdownMenuItem onClick={handleNewProject} className="gap-2 p-2" disabled={isBusy}>
              <div className="flex size-6 items-center justify-center rounded-md bg-transparent">
                <Plus className="size-4" />
              </div>
              <span className="text-muted-foreground font-medium">New Project</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleCreateWorkspace} className="gap-2 p-2" disabled={isBusy}>
              <div className="flex size-6 items-center justify-center rounded-md bg-transparent">
                <Building2 className="size-4" />
              </div>
              <span className="text-muted-foreground font-medium">Create Workspace</span>
            </DropdownMenuItem>
            {organizations.length > 1 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSwitchWorkspace} className="gap-2 p-2" disabled={isBusy}>
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
