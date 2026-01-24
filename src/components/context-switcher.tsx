"use client"

import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ChevronsUpDown, FolderOpen, Home, Plus } from 'lucide-react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
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

export function ContextSwitcher() {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const location = useLocation()
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()

  // Get Convex organization
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId
      ? { workosId: currentOrganization.organizationId }
      : 'skip'
  )

  // Get current project
  const currentProject = useQuery(
    api.projects.getBySlug,
    convexOrg?._id && slug ? { organizationId: convexOrg._id, slug } : 'skip'
  )

  // Get recent projects
  const projects = useQuery(
    api.projects.listForOrganization,
    convexOrg?._id ? { organizationId: convexOrg._id } : 'skip'
  )

  // Get recent projects (up to 4, sorted by last updated)
  const recentProjects = projects
    ? [...projects]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 4)
    : []

  // Determine if we're in a project context
  const isInProject = location.pathname.startsWith('/projects/') && slug

  // Organization info
  const organization = {
    name: currentOrganization?.organizationName || 'My Workspace',
    // Get plan from Convex org subscription, capitalize it
    plan: convexOrg?.subscription?.plan
      ? convexOrg.subscription.plan.charAt(0).toUpperCase() + convexOrg.subscription.plan.slice(1)
      : 'Free',
  }

  const handleProjectSelect = (projectSlug: string) => {
    navigate(`/projects/${projectSlug}`)
  }

  const handleGoHome = () => {
    navigate('/projects')
  }

  const handleNewProject = () => {
    navigate('/projects/new')
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
                {isInProject ? (
                  <FolderOpen className="size-4" />
                ) : (
                  <span className="text-xs font-bold">
                    {organization.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {isInProject ? currentProject?.name : organization.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {isInProject ? currentProject?.template || 'Project' : `${organization.plan}`}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            {isInProject && (
              <>
                <DropdownMenuItem onClick={handleGoHome} className="gap-2 p-2">
                  <div className="flex size-6 items-center justify-center rounded-md border">
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
            {recentProjects.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                No projects yet
              </div>
            ) : (
              recentProjects.map((project) => (
                <DropdownMenuItem
                  key={project._id}
                  onClick={() => handleProjectSelect(project.slug)}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <FolderOpen className="size-3.5 shrink-0" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{project.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {project.template || 'Project'}
                    </div>
                  </div>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleNewProject} className="gap-2 p-2">
              <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                <Plus className="size-4" />
              </div>
              <span className="text-muted-foreground font-medium">New Project</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
