import { useState, useMemo, useEffect } from 'react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useCachedQuery } from '../stores/useQueryCache'
import { useAuth } from '../contexts/AuthContext'
import { DashboardLayout } from '../components/layouts/DashboardLayout'
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
import {
  logProjectSourceDebug,
  summarizeProjectForDebug,
} from '@/features/projects/lib/projectSourceDebug'


type SortOption = 'last_modified' | 'name' | 'created'
type StatusFilter = 'all' | 'active' | 'draft' | 'building' | 'archived'

export function Projects() {
  const { user, logout, currentOrganization } = useAuth()
  const navigate = useViewTransitionNavigate()
  const [sortBy, setSortBy] = useState<SortOption>('last_modified')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [currentPage, setCurrentPage] = useState(1)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const effectiveViewMode = isMobile ? 'list' : viewMode
  const ITEMS_PER_PAGE = 20
  const isPersonalWorkspace = currentOrganization?.workspaceType === 'personal'

  // Get Convex organization by WorkOS ID (with caching to prevent loading flash)
  const freshOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )
  const convexOrg = useCachedQuery(
    `projects-org-${currentOrganization?.organizationId}`,
    freshOrg
  )

  // Get Convex user by WorkOS ID (needed for delete)
  const convexUser = useQuery(
    api.users.getByWorkosId,
    user?.id ? { workosId: user.id } : 'skip'
  )

  // Get organization members to display names
  const members = useQuery(
    api.organizations.getMembers,
    convexOrg?._id ? { orgId: convexOrg._id } : 'skip'
  )

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

  // Query projects with source based on active workspace type (with caching)
  const freshProjects = useQuery(
    isPersonalWorkspace
      ? api.projects.listForPersonalWorkspaceMemberView
      : api.projects.listForOrganization,
    isPersonalWorkspace
      ? convexUser?._id
        ? { userId: convexUser._id }
        : 'skip'
      : convexOrg?._id
        ? { organizationId: convexOrg._id }
        : 'skip'
  )
  const projects = useCachedQuery(
    isPersonalWorkspace
      ? `projects-list-personal-${convexUser?._id}`
      : `projects-list-org-${convexOrg?._id}`,
    freshProjects
  )
  const normalizedProjects = useMemo(
    () => {
      const rows = projects ?? []
      return rows.filter((project): project is NonNullable<typeof project> => project !== null)
    },
    [projects]
  )

  useEffect(() => {
    logProjectSourceDebug('projects_page:source', {
      authWorkosUserId: user?.id ?? null,
      workspaceType: currentOrganization?.workspaceType ?? null,
      currentOrganizationId: currentOrganization?.organizationId ?? null,
      convexOrganizationId: convexOrg?._id ?? null,
      convexUserId: convexUser?._id ?? null,
      rawProjectCount: Array.isArray(projects) ? projects.length : null,
      normalizedProjectCount: normalizedProjects.length,
      projects: normalizedProjects.map((project) => summarizeProjectForDebug(project)),
    })
  }, [
    convexOrg?._id,
    convexUser?._id,
    currentOrganization?.organizationId,
    currentOrganization?.workspaceType,
    normalizedProjects,
    projects,
  ])

  const filteredProjects = useMemo(() => {
    let result = normalizedProjects

    if (statusFilter !== 'all') {
      if (statusFilter === 'building') {
        result = result.filter((project) => project.status === 'building' || project.status === 'generating')
      } else {
        result = result.filter((project) => project.status === statusFilter)
      }
    }

    return [...result].sort((left, right) => {
      switch (sortBy) {
        case 'name':
          return left.name.localeCompare(right.name)
        case 'created':
          return right.createdAt - left.createdAt
        case 'last_modified':
        default:
          return right.updatedAt - left.updatedAt
      }
    })
  }, [normalizedProjects, statusFilter, sortBy])

  // Pagination Logic
  const totalPages = Math.ceil(filteredProjects.length / ITEMS_PER_PAGE)
  const paginatedProjects = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
    return filteredProjects.slice(startIndex, startIndex + ITEMS_PER_PAGE)
  }, [filteredProjects, currentPage])

  // Reset page when filter/sort changes
  useEffect(() => {
    setCurrentPage(1)
  }, [statusFilter, sortBy])

  const isLoading = isPersonalWorkspace
    ? convexUser === undefined || projects === undefined
    : convexOrg === undefined || (convexOrg && projects === undefined)
  const hasProjects = normalizedProjects.length > 0
  const showProjectControls = hasProjects || isLoading

  const breadcrumbAddon = hasProjects ? (
    <Badge variant="secondary" className="text-xs font-normal">
      {normalizedProjects.length}
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
          <DropdownMenuItem onClick={() => setStatusFilter('all')}>All Status</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setStatusFilter('active')}>Active</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setStatusFilter('draft')}>Draft</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setStatusFilter('building')}>Building</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setStatusFilter('archived')}>Archived</DropdownMenuItem>
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
          <DropdownMenuItem onClick={() => setSortBy('last_modified')}>Last modified</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSortBy('name')}>Name</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSortBy('created')}>Created date</DropdownMenuItem>
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

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                className="gap-2 h-7 px-2 text-xs rounded-full"
                onClick={() => navigate('/projects/new')}
              >
                <Plus className="h-3.5 w-3.5" />
                New Project
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Create new project</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  ) : null

  const showPagination = filteredProjects.length > ITEMS_PER_PAGE

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Projects' }]}
      breadcrumbAddon={breadcrumbAddon}
      header={headerContent || undefined}
    >
      <TooltipProvider>
        {!isLoading && !hasProjects ? (
          <div className="flex min-h-full flex-1 items-center justify-center">
            <div className="w-full p-6 md:p-10">
              <Empty className="py-6">
                <EmptyHeader>
                  <EmptyMedia>
                    <FolderOpen className="h-8 w-8" />
                  </EmptyMedia>
                  <EmptyTitle>Start your first project</EmptyTitle>
                  <EmptyDescription>
                    Create a project to generate a plan, scaffold code, and collaborate with your team.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button className="gap-2" onClick={() => navigate('/projects/new')}>
                    <Plus className="h-4 w-4" />
                    Create Project
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          </div>
        ) : effectiveViewMode === 'grid' ? (
          <div
            className={cn(
              featureFlags.contentVisibility && 'perf-contain-auto',
              'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-10'
            )}
          >
            {paginatedProjects.length > 0 ? (
              paginatedProjects.map((project) => (
                <ProjectCard
                  key={project._id}
                  project={project}
                  userId={convexUser?._id}
                />
              ))
            ) : (
              <div className="col-span-full rounded-xl border border-dashed border-border/60 bg-card/70 p-6 text-sm text-muted-foreground">
                {isLoading
                  ? 'Loading projects...'
                  : statusFilter === 'all'
                    ? 'No projects yet. Create your first project.'
                    : 'No projects match the current filters.'}
              </div>
            )}
          </div>
        ) : (
          <div className={cn(featureFlags.contentVisibility && 'perf-contain-auto', 'pb-10')}>
            <div
              className={cn(
                featureFlags.contentVisibility && 'perf-contain-card',
                'overflow-hidden rounded-2xl bg-secondary/80 px-2 py-1 dark:bg-secondary/40'
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
                          userId={convexUser?._id}
                          creatorName={modifier?.name || 'Unknown'}
                          creatorImage={modifier?.image}
                        />
                      )
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                        {isLoading
                          ? 'Loading projects...'
                          : statusFilter === 'all'
                            ? 'No projects yet. Create your first project.'
                            : 'No projects match the current filters.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {!isLoading && filteredProjects.length === 0 && statusFilter === 'all' && (
              <div className="mt-3 flex justify-end">
                <Button className="gap-2" onClick={() => navigate('/projects/new')}>
                  <Plus className="h-4 w-4" />
                  Create Project
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Floating Pagination Pill */}
        {showPagination && (
          <div className="fixed bottom-8 right-4 z-50 flex items-center gap-1 bg-background/95 backdrop-blur border rounded-full shadow-lg px-1 py-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium px-2 min-w-[4rem] text-center">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </TooltipProvider>
    </DashboardLayout>
  )
}
