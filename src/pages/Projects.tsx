import { useState, useMemo, useEffect } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { convex } from '@/lib/convex'
import { useCachedQuery, useQueryCache } from '../stores/useQueryCache'
import { useAuth } from '../contexts/AuthContext'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'
import { Button } from '../components/ui/button'
import { cn } from '@/lib/utils'
import { ProjectCard } from '../features/projects/components/ProjectCard'
import { ProjectListRow } from '../features/projects/components/ProjectListRow'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import {
  Plus,
  ArrowUpDown,
  FileCode,
  FolderOpen,
  LayoutGrid,
  List,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import {
  TooltipProvider,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip'

import { Badge } from '../components/ui/badge'
import { featureFlags } from '@/lib/featureFlags'
import { useProjectCreationMenu } from '@/features/projects/hooks/useProjectCreationMenu'
import { useProjectHeader } from '@/hooks/useProjectHeader'


type SortOption = 'last_modified' | 'name' | 'created'
type StatusFilter = 'all' | 'active' | 'draft' | 'building' | 'archived'
const ITEMS_PER_PAGE = 20
const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)'
const DEFAULT_SORT_BY: SortOption = 'last_modified'
const DEFAULT_STATUS_FILTER: StatusFilter = 'all'
const DEFAULT_PROJECTS_PAGE = 1

function getProjectsPageCacheKey(args: {
  personalScoped: boolean
  userId?: string | null
  organizationId?: string | null
  statusFilter: StatusFilter
  sortBy: SortOption
  page: number
}): string {
  return args.personalScoped
    ? `projects-page-personal-${args.userId ?? 'none'}-${args.statusFilter}-${args.sortBy}-${args.page}`
    : `projects-page-org-${args.organizationId ?? 'none'}-${args.statusFilter}-${args.sortBy}-${args.page}`
}

function getProjectMembersCacheKey(
  organizationId?: string | null,
  userId?: string | null
): string {
  return `projects-members-${organizationId ?? 'none'}-${userId ?? 'none'}`
}

export async function prewarmProjectsPageData(args: {
  personalScoped: boolean
  organizationId?: Id<'organizations'> | null
  userId?: Id<'users'> | null
  canViewWorkspaceMembers?: boolean
  statusFilter?: StatusFilter
  sortBy?: SortOption
  page?: number
  pageSize?: number
}): Promise<void> {
  if (!convex || !args.userId) return

  const statusFilter = args.statusFilter ?? DEFAULT_STATUS_FILTER
  const sortBy = args.sortBy ?? DEFAULT_SORT_BY
  const page = args.page ?? DEFAULT_PROJECTS_PAGE
  const pageSize = args.pageSize ?? ITEMS_PER_PAGE
  const projectsPageCacheKey = getProjectsPageCacheKey({
    personalScoped: args.personalScoped,
    organizationId: args.organizationId,
    userId: args.userId,
    statusFilter,
    sortBy,
    page,
  })

  const queryCache = useQueryCache.getState()
  const pendingQueries: Array<Promise<void>> = []

  if (queryCache.get(projectsPageCacheKey) === undefined) {
    if (args.personalScoped) {
      pendingQueries.push(
        convex
          .query(api.projects.listPageForPersonalWorkspaceMemberView, {
            userId: args.userId,
            statusFilter,
            sortBy,
            page,
            pageSize,
          })
          .then((projectsPage) => {
            if (projectsPage !== undefined) {
              useQueryCache.getState().set(projectsPageCacheKey, projectsPage)
            }
          }),
      )
    } else if (args.organizationId) {
      pendingQueries.push(
        convex
          .query(api.projects.listPageForOrganization, {
            organizationId: args.organizationId,
            userId: args.userId,
            statusFilter,
            sortBy,
            page,
            pageSize,
          })
          .then((projectsPage) => {
            if (projectsPage !== undefined) {
              useQueryCache.getState().set(projectsPageCacheKey, projectsPage)
            }
          }),
      )
    }
  }

  if (!args.personalScoped && args.organizationId && args.canViewWorkspaceMembers) {
    const membersCacheKey = getProjectMembersCacheKey(args.organizationId, args.userId)
    if (queryCache.get(membersCacheKey) === undefined) {
      pendingQueries.push(
        convex
          .query(api.organizations.getMembers, {
            orgId: args.organizationId,
            viewerUserId: args.userId,
          })
          .then((members) => {
            if (members !== undefined) {
              useQueryCache.getState().set(membersCacheKey, members)
            }
          }),
      )
    }
  }

  if (pendingQueries.length === 0) return
  await Promise.allSettled(pendingQueries)
}

export function Projects() {
  const { convexUserId } = useAuth()
  const { personalScoped, workspaceScoped, convexOrg, capabilities, permissions } = useScopedAppContext()
  const { openProjectCreationMenu } = useProjectCreationMenu()
  const [sortBy, setSortBy] = useState<SortOption>(DEFAULT_SORT_BY)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(DEFAULT_STATUS_FILTER)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [currentPage, setCurrentPage] = useState(DEFAULT_PROJECTS_PAGE)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches)

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY)
    const handleChange = () => setIsMobile(mediaQuery.matches)
    handleChange()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }

    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  const effectiveViewMode = isMobile ? 'list' : viewMode

  // Get organization members to display names
  const membersCacheKey = getProjectMembersCacheKey(convexOrg?._id, convexUserId)
  const freshMembers = useQuery(
    api.organizations.getMembers,
    workspaceScoped &&
    convexOrg?._id &&
    convexUserId &&
    permissions.includes('members:view')
      ? { orgId: convexOrg._id, viewerUserId: convexUserId }
      : 'skip'
  )
  const members = useCachedQuery(membersCacheKey, freshMembers)

  const userMap = useMemo(() => {
    if (!members) return {}
    const map: Record<string, { name: string; image?: string }> = {}
    members.forEach((m) => {
      if (m.user) {
        map[m.userId] = {
          name: m.user.firstName || m.user.email.split('@')[0],
          image: m.user.profileImageUrl,
        }
      }
    })
    return map
  }, [members])

  const projectsCacheKey = getProjectsPageCacheKey({
    personalScoped,
    organizationId: convexOrg?._id,
    userId: convexUserId,
    statusFilter,
    sortBy,
    page: currentPage,
  })

  const personalProjectsPage = useQuery(
    api.projects.listPageForPersonalWorkspaceMemberView,
    personalScoped && convexUserId
      ? {
          userId: convexUserId,
          statusFilter,
          sortBy,
          page: currentPage,
          pageSize: ITEMS_PER_PAGE,
        }
      : 'skip'
  )
  const organizationProjectsPage = useQuery(
    api.projects.listPageForOrganization,
    !personalScoped && convexOrg?._id && convexUserId
      ? {
          organizationId: convexOrg._id,
          userId: convexUserId,
          statusFilter,
          sortBy,
          page: currentPage,
          pageSize: ITEMS_PER_PAGE,
        }
      : 'skip'
  )
  const freshProjectsPage = personalScoped ? personalProjectsPage : organizationProjectsPage
  const projectsPage = useCachedQuery(projectsCacheKey, freshProjectsPage)

  const isLoading = personalScoped
    ? convexUserId === null || (freshProjectsPage === undefined && projectsPage === undefined)
    : convexOrg === undefined || (convexOrg && freshProjectsPage === undefined && projectsPage === undefined)
  const paginatedProjects = projectsPage?.items ?? []
  const totalPages = projectsPage?.totalPages ?? 1
  const totalProjects = projectsPage?.total ?? 0
  const displayPage = projectsPage?.page ?? currentPage
  const hasProjects = totalProjects > 0
  const showProjectControls = hasProjects || isLoading
  const canCreateProjects = capabilities.canCreateProjects
  const canStartProjectFlow = canCreateProjects || capabilities.canImportProjects
  const allStatusEmptyMessage = projectsPage?.hasArchivedProjects
    ? 'No active projects. Switch to Archived to view archived projects.'
    : 'No projects yet. Create your first project.'

  const breadcrumbAddon = hasProjects ? (
    <Badge variant="secondary" className="text-xs font-normal">
      {totalProjects}
    </Badge>
  ) : null

  const headerContent = showProjectControls ? (
    <div className="flex items-center gap-2">
      {/* Status Filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="gap-2 h-7 px-2 text-xs rounded-full focus:z-10">
            <FileCode className="h-3.5 w-3.5" />
            {statusFilter === 'all' ? 'All Status' : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => {
            setStatusFilter('all')
            setCurrentPage(1)
          }}>All Status</DropdownMenuItem>
          <DropdownMenuItem onClick={() => {
            setStatusFilter('active')
            setCurrentPage(1)
          }}>Active</DropdownMenuItem>
          <DropdownMenuItem onClick={() => {
            setStatusFilter('draft')
            setCurrentPage(1)
          }}>Draft</DropdownMenuItem>
          <DropdownMenuItem onClick={() => {
            setStatusFilter('building')
            setCurrentPage(1)
          }}>Building</DropdownMenuItem>
          <DropdownMenuItem onClick={() => {
            setStatusFilter('archived')
            setCurrentPage(1)
          }}>Archived</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Sort */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="gap-2 h-7 px-2 text-xs rounded-full focus:z-10">
            <ArrowUpDown className="h-3.5 w-3.5" />
            Sort
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => {
            setSortBy('last_modified')
            setCurrentPage(1)
          }}>Last modified</DropdownMenuItem>
          <DropdownMenuItem onClick={() => {
            setSortBy('name')
            setCurrentPage(1)
          }}>Name</DropdownMenuItem>
          <DropdownMenuItem onClick={() => {
            setSortBy('created')
            setCurrentPage(1)
          }}>Created date</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* View Mode Toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="secondary"
              size="icon"
              className="h-7 w-7 px-0 rounded-full focus:z-10"
              onClick={() => setViewMode(effectiveViewMode === 'grid' ? 'list' : 'grid')}
              disabled={isMobile}
            >
              {effectiveViewMode === 'grid' ? <List className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isMobile ? 'View fixed to list on small screens' : 'Toggle view mode'}
        </TooltipContent>
      </Tooltip>

      {canStartProjectFlow ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  className="gap-2 h-7 px-2 text-xs rounded-full"
                  onClick={(event) => void openProjectCreationMenu(event)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Project
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">Create new project</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  ) : null

  const showPagination = totalProjects > ITEMS_PER_PAGE

  useProjectHeader(headerContent, breadcrumbAddon)

  return (
    <TooltipProvider>
      {!isLoading && !hasProjects ? (
        <div className="flex min-h-full flex-1 items-center justify-center">
          <div className="w-full p-6 md:p-10">
            <Empty className="py-6">
              <EmptyHeader>
                <EmptyMedia>
                  <FolderOpen className="h-8 w-8" />
                </EmptyMedia>
                <EmptyTitle>
                  {canStartProjectFlow
                    ? canCreateProjects
                      ? 'Start your first project'
                      : 'Import your first project'
                    : 'No projects available'}
                </EmptyTitle>
                <EmptyDescription>
                  {canStartProjectFlow
                    ? canCreateProjects
                      ? 'Create a project to generate a plan, scaffold code, and collaborate with your team.'
                      : 'Import an existing project to start working in this workspace.'
                    : 'Projects will appear here when this workspace has active projects you can access.'}
                </EmptyDescription>
              </EmptyHeader>
              {canStartProjectFlow ? (
                <EmptyContent>
                  <Button className="gap-2" onClick={(event) => void openProjectCreationMenu(event)}>
                    <Plus className="h-4 w-4" />
                    {canCreateProjects ? 'Create Project' : 'Import Project'}
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          </div>
        </div>
      ) : effectiveViewMode === 'grid' ? (
        <div
          className={cn(
            featureFlags.contentVisibility && 'perf-contain-auto',
            'grid grid-cols-1 gap-4 pb-10 md:grid-cols-2 lg:grid-cols-3'
          )}
        >
          {paginatedProjects.length > 0 ? (
            paginatedProjects.map((project) => (
              <ProjectCard
                key={project._id}
                project={project}
                userId={convexUserId ?? undefined}
                workspaceScoped={workspaceScoped}
              />
            ))
          ) : (
            <div className="col-span-full rounded-xl border border-dashed border-border/60 bg-card/70 p-6 text-sm text-muted-foreground">
              {isLoading
                ? 'Loading projects...'
                : statusFilter === 'all'
                  ? allStatusEmptyMessage
                  : 'No projects match the current filters.'}
            </div>
          )}
        </div>
      ) : (
        <div className={cn(featureFlags.contentVisibility && 'perf-contain-auto', 'pb-10')}>
          <div
            className={cn(
              featureFlags.contentVisibility && 'perf-contain-card',
              'overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40'
            )}
          >
            <Table className="[&_th]:px-4 [&_td]:px-4">
              <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                <TableRow>
                  <TableHead className="w-[45%] sm:w-[38%] md:w-[32%]">Name</TableHead>
                  <TableHead className="w-[13%] text-center">Status</TableHead>
                  <TableHead className="hidden md:table-cell md:w-[24%]">Last modified by</TableHead>
                  <TableHead className="hidden lg:table-cell lg:w-[11%] text-center">Sync</TableHead>
                  <TableHead className="hidden sm:table-cell sm:w-[14%] text-right">Last modified</TableHead>
                  <TableHead className="w-[10%] text-right" />
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                {paginatedProjects.length > 0 ? (
                  paginatedProjects.map((project) => {
                    const modifier = userMap[project.lastSyncBy || project.createdBy]
                    return (
                      <ProjectListRow
                        key={project._id}
                        project={project}
                        userId={convexUserId ?? undefined}
                        creatorName={modifier?.name || 'Unknown'}
                        creatorImage={modifier?.image}
                        workspaceScoped={workspaceScoped}
                      />
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                      {isLoading
                        ? 'Loading projects...'
                        : statusFilter === 'all'
                          ? allStatusEmptyMessage
                          : 'No projects match the current filters.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {!isLoading && totalProjects === 0 && statusFilter === 'all' && canStartProjectFlow && (
            <div className="mt-3 flex justify-end">
              <Button className="gap-2" onClick={(event) => void openProjectCreationMenu(event)}>
                <Plus className="h-4 w-4" />
                {canCreateProjects ? 'Create Project' : 'Import Project'}
              </Button>
            </div>
          )}
        </div>
      )}

      {showPagination && (
        <div className="fixed bottom-8 right-4 z-50 flex items-center gap-1 rounded-full border bg-background/95 px-1 py-1 shadow-lg backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={() => setCurrentPage(Math.max(1, displayPage - 1))}
            disabled={displayPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[4rem] px-2 text-center text-xs font-medium">
            {displayPage} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={() => setCurrentPage(Math.min(totalPages, displayPage + 1))}
            disabled={displayPage === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </TooltipProvider>
  )
}
