import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { DashboardLayout } from '../components/layouts/DashboardLayout'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { ProjectCard } from '../features/projects/components/ProjectCard'
import {
  Plus,
  ArrowUpDown,
  Loader2,
  FileCode,
  Hammer,
  Archive,
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
import { IconFolderCode } from '@tabler/icons-react'

type SortOption = 'last_modified' | 'name' | 'created'
type StatusFilter = 'all' | 'active' | 'draft' | 'building' | 'archived'

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  return 'Just now'
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'active':
      return <Badge variant="default" className="bg-green-600">Active</Badge>
    case 'draft':
      return <Badge variant="secondary">Draft</Badge>
    case 'generating':
    case 'building':
      return (
        <Badge variant="secondary" className="bg-blue-600 text-white">
          <Hammer className="h-3 w-3 mr-1 animate-pulse" />
          Building
        </Badge>
      )
    case 'archived':
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <Archive className="h-3 w-3 mr-1" />
          Archived
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function getStackBadges(project: { stack?: { backend?: string; hosting?: string; aiProvider?: string } }) {
  const badges: string[] = []
  if (project.stack?.backend) badges.push(project.stack.backend)
  if (project.stack?.hosting) badges.push(project.stack.hosting)
  if (project.stack?.aiProvider && project.stack.aiProvider !== 'none') {
    badges.push(project.stack.aiProvider)
  }
  return badges
}

export function Projects() {
  const { user, logout, currentOrganization } = useAuth()
  const navigate = useNavigate()
  const [sortBy, setSortBy] = useState<SortOption>('last_modified')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Get Convex organization by WorkOS ID
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )

  // Query projects from Convex using the Convex org ID
  const projects = useQuery(
    api.projects.listForOrganization,
    convexOrg?._id ? { organizationId: convexOrg._id } : 'skip'
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

  const isLoading = convexOrg === undefined || (convexOrg && projects === undefined)
  const hasProjects = projects && projects.length > 0
  const isEmptyState = !isLoading && !hasProjects

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Projects' }]}
    >
      <TooltipProvider>
      {/* Page Header with Filters - hidden in empty state */}
      {!isEmptyState && (
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Projects</h1>
            <p className="text-muted-foreground">
              Create and manage your AI-powered projects
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Status Filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <FileCode className="h-4 w-4" />
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
                <Button variant="outline" size="sm" className="gap-2">
                  <ArrowUpDown className="h-4 w-4" />
                  Sort
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSortBy('last_modified')}>Last modified</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('name')}>Name</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('created')}>Created date</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button className="gap-2" onClick={() => navigate('/projects/new')}>
              <Plus className="h-4 w-4" />
              New Project
            </Button>
          </div>
        </div>
      )}

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
        /* Grid View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-10">
          {filteredProjects.map((project) => (
            <ProjectCard key={project._id} project={project} />
          ))}
        </div>
      )}
    </TooltipProvider>
  </DashboardLayout>
)
}
