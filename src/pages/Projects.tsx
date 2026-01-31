import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useCachedQuery } from '../stores/useQueryCache'
import { useAuth } from '../contexts/AuthContext'
import { DashboardLayout } from '../components/layouts/DashboardLayout'
import { Button } from '../components/ui/button'
import { ProjectCard } from '../features/projects/components/ProjectCard'
import { ProjectListRow } from '../features/projects/components/ProjectListRow'
import {
  Plus,
  ArrowUpDown,
  Loader2,
  FileCode,
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
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '../components/ui/empty'
import { TooltipProvider } from '../components/ui/tooltip'
import { ButtonGroup } from '../components/ui/button-group'
import { Badge } from '../components/ui/badge'
import { IconFolderCode } from '@tabler/icons-react'

type SortOption = 'last_modified' | 'name' | 'created'
type StatusFilter = 'all' | 'active' | 'draft' | 'building' | 'archived'

export function Projects() {
  const { user, logout, currentOrganization } = useAuth()
  const navigate = useNavigate()
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

  // Query projects from Convex using the Convex org ID (with caching)
  const freshProjects = useQuery(
    api.projects.listForOrganization,
    convexOrg?._id ? { organizationId: convexOrg._id } : 'skip'
  )
  const projects = useCachedQuery(
    `projects-list-${convexOrg?._id}`,
    freshProjects
  )

  // Filter and sort projects
  const filteredProjects = useMemo(() => {
    if (!projects) return []

    let result = projects

    // Filter by status
    if (statusFilter !== 'all') {
      if (statusFilter === 'building') {
        result = result.filter((p) => p.status === 'building' || p.status === 'generating')
      } else {
        result = result.filter((p) => p.status === statusFilter)
      }
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'created':
          return b.createdAt - a.createdAt
        case 'last_modified':
        default:
          return b.updatedAt - a.updatedAt
      }
    })

    return result
  }, [projects, statusFilter, sortBy])

  // Pagination Logic
  const totalPages = Math.ceil(filteredProjects.length / ITEMS_PER_PAGE)
  const paginatedProjects = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
    return filteredProjects.slice(startIndex, startIndex + ITEMS_PER_PAGE)
  }, [filteredProjects, currentPage])

  // Reset page when filter/sort changes
  useMemo(() => {
    setCurrentPage(1)
  }, [statusFilter, sortBy])

  const isLoading = convexOrg === undefined || (convexOrg && projects === undefined)
  const hasProjects = projects && projects.length > 0
  const isEmptyState = !isLoading && !hasProjects

  const headerContent = !isEmptyState && (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">Projects</h1>
        {projects && projects.length > 0 && (
          <Badge variant="secondary" className="text-xs font-normal">
            {projects.length}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <ButtonGroup>
          {/* Status Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2 h-8 px-2 text-xs rounded-r-none border-r-0 focus:z-10">
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
              <Button variant="outline" className="gap-2 h-8 px-2 text-xs rounded-none border-r-0 focus:z-10">
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
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 px-0 rounded-l-none focus:z-10"
            onClick={() => setViewMode(effectiveViewMode === 'grid' ? 'list' : 'grid')}
            disabled={isMobile}
            title={isMobile ? "View fixed to list on small screens" : "Toggle view"}
          >
            {effectiveViewMode === 'grid' ? <List className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
          </Button>
        </ButtonGroup>

        <Button className="gap-2 h-8 px-2 text-xs" onClick={() => navigate('/projects/new')}>
          <Plus className="h-3.5 w-3.5" />
          New Project
        </Button>
      </div>
    </div>
  )

  const showPagination = !isLoading && filteredProjects.length > ITEMS_PER_PAGE

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Projects' }]}
      header={headerContent || undefined}
    >
      <TooltipProvider>

        {/* Loading State */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredProjects.length === 0 ? (
          /* Empty State */
          <Empty className="h-[calc(100vh-12rem)]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconFolderCode />
              </EmptyMedia>
              <EmptyTitle>No Projects Yet</EmptyTitle>
              <EmptyDescription>
                You haven't created any projects yet. Get started by creating your first project.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button className="gap-2" onClick={() => navigate('/projects/new')}>
                <Plus className="h-4 w-4" />
                Create Project
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          /* Projects List */
          effectiveViewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-10">
              {paginatedProjects.map((project) => (
                <ProjectCard key={project._id} project={project} userId={convexUser?._id} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col pb-10">
              <div className="sticky top-12 z-10 bg-background grid grid-cols-12 gap-4 py-2 px-4 border-b text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <div className="col-span-8 sm:col-span-6 md:col-span-5 lg:col-span-4">Name</div>
                <div className="col-span-2 sm:col-span-2 md:col-span-1 text-center">Status</div>
                <div className="hidden md:block md:col-span-4 lg:col-span-3 text-left">Last modified by</div>
                <div className="hidden lg:block lg:col-span-1 text-center">Sync</div>
                <div className="hidden sm:block sm:col-span-3 md:col-span-2 text-right pr-4">Last modified</div>
                <div className="col-span-2 sm:col-span-1"></div>
              </div>
              {/* List Items */}
              {paginatedProjects.map((project) => {
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
              })}
            </div>
          )
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
