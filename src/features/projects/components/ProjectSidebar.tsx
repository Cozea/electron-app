"use client"

import * as React from "react"
import { useParams, useLocation } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import {
    ListTodo,
    AppWindow,
    Rss,
    Box,
    Database,
    Server,
    Settings,
    Users,
    ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarGroupContent,
    SidebarRail,
} from "@/components/ui/sidebar"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { NavUser } from "@/components/nav-user"
import { ContextSwitcher } from "@/components/context-switcher"
import { getSyncFeedLastSeen, markSyncFeedAsSeen } from "../syncFeedSeen"
import { buildLegacyProjectPath, buildProjectPath } from "../lib/projectRoutes"
import { useProjectWorkspaceContext } from "@/features/projects/hooks/useProjectWorkspaceContext"

// Types
interface ProjectSidebarProps extends React.ComponentProps<typeof Sidebar> {
    user?: {
        email: string
        firstName?: string | null
        lastName?: string | null
        profileImageUrl?: string | null
    } | null
    onLogout?: () => void
    projectId?: Id<"projects"> | null
    // Backward-compat sink: prevent leaking legacy props to DOM through `...props`.
    presenceUsers?: unknown[]
    presenceCount?: number
}

// Route mappings for all navigation items
const routeMap: Record<string, string> = {
    "Tasks": "tasks",
    // Platform group (with secondary panels)
    "Previews": "pages",
    "Sync Feed": "changes",
    // Development group
    "Dependencies": "dependencies",
    "Database": "database",
    "Backend Studio": "backend",
    // Settings
    "Team": "team",
    "Settings": "settings",
}

function getActiveTabFromPathname(pathname: string, base: string | null): string | null {
    if (!base) return null

    if (pathname === base || pathname === `${base}/`) return "Previews"
    if (pathname === `${base}/pages` || pathname.startsWith(`${base}/pages/`)) return "Previews"
    if (pathname === `${base}/tasks` || pathname.startsWith(`${base}/tasks/`)) return "Tasks"
    if (pathname === `${base}/changes` || pathname.startsWith(`${base}/changes/`)) return "Sync Feed"
    if (pathname === `${base}/dependencies` || pathname.startsWith(`${base}/dependencies/`)) return "Dependencies"
    if (pathname === `${base}/database` || pathname.startsWith(`${base}/database/`)) return "Database"
    if (pathname === `${base}/backend` || pathname.startsWith(`${base}/backend/`)) return "Backend Studio"
    if (pathname === `${base}/team` || pathname.startsWith(`${base}/team/`)) return "Team"
    if (pathname.startsWith(`${base}/settings`)) return "Settings"

    return null
}

const projectRoutePreloaders: Record<string, () => Promise<unknown>> = {
    "Tasks": () => import("@/features/projects/pages/TasksPage"),
    "Previews": () => import("@/features/projects/pages/ProjectPagesPage"),
    "Sync Feed": () => import("@/features/projects/pages/ChangesPage"),
    "Dependencies": () => import("@/features/projects/pages/ProjectDependenciesPage"),
    "Database": () => import("@/features/projects/pages/ProjectDatabasePage"),
    "Backend Studio": () => import("@/features/projects/pages/ProjectBackendStudioPage"),
    "Team": () => import("@/features/projects/pages/ProjectTeamPage"),
    "Settings": () => import("@/features/projects/pages/ProjectSettingsPage"),
}

const NAV_GROUPS = [
    {
        title: "Tasks",
        items: [
            { title: "Tasks", icon: ListTodo }
        ]
    },
    {
        title: "Platform",
        items: [
            { title: "Previews", icon: AppWindow },
            { title: "Sync Feed", icon: Rss }
        ]
    },
    {
        title: "Development",
        items: [
            { title: "Dependencies", icon: Box, beta: true },
            { title: "Database", icon: Database, alpha: true },
            { title: "Backend Studio", icon: Server, alpha: true }
        ]
    },
    {
        title: "Settings",
        items: [
            { title: "Team", icon: Users },
            { title: "Settings", icon: Settings }
        ]
    }
] as const

export function ProjectSidebar({
    user,
    onLogout,
    projectId: providedProjectId,
    presenceUsers: _presenceUsers,
    presenceCount: _presenceCount,
    className,
    ...props
}: ProjectSidebarProps) {
    const navigate = useViewTransitionNavigate()
    const { slug, projectId: routeProjectId } = useParams<{ slug?: string; projectId?: string }>()
    const location = useLocation()
    const { convexUserId } = useAuth()
    const { preferredConvexOrganizationId } = useScopedAppContext()
    const preloadedTabsRef = React.useRef<Set<string>>(new Set())

    const routeBasePath = React.useMemo(() => {
        if (routeProjectId) return buildProjectPath(routeProjectId)
        if (slug) return buildLegacyProjectPath(slug)
        return null
    }, [routeProjectId, slug])

    const routeActiveTab = React.useMemo(
        () => getActiveTabFromPathname(location.pathname, routeBasePath),
        [location.pathname, routeBasePath]
    )

    const preloadProjectTab = React.useCallback((tabTitle: string) => {
        const preloader = projectRoutePreloaders[tabTitle]
        if (!preloader) return
        if (preloadedTabsRef.current.has(tabTitle)) return

        preloadedTabsRef.current.add(tabTitle)
        void preloader().catch(() => {
            preloadedTabsRef.current.delete(tabTitle)
        })
    }, [])

    // Top-level active selection (e.g. "Files", "Tasks")
    const [activeTab, setActiveTab] = React.useState<string | null>(routeActiveTab)
    const [tasksExpanded, setTasksExpanded] = React.useState(true)

    // Keep rail selection in sync with route.
    React.useEffect(() => {
        setActiveTab(routeActiveTab)
    }, [routeActiveTab])

    // Track last seen timestamp for sync feed (triggers re-render when updated)
    const [lastSeenTimestamp, setLastSeenTimestamp] = React.useState(() =>
        slug ? getSyncFeedLastSeen(slug) : 0
    )

    // Get project context from canonical route first; fallback to legacy slug resolution.
    const projectById = useQuery(
        api.projects.getAccessibleById,
        convexUserId && (providedProjectId || routeProjectId)
            ? {
                projectId: (providedProjectId ?? (routeProjectId as Id<"projects">)),
                userId: convexUserId,
            }
            : 'skip'
    )
    const projectBySlug = useQuery(
        api.projects.getAccessibleBySlug,
        providedProjectId
            ? "skip"
            : !routeProjectId && slug && convexUserId
                ? {
                    slug,
                    userId: convexUserId,
                    preferredOrganizationId: preferredConvexOrganizationId,
                }
                : 'skip'
    )
    const project =
        (providedProjectId || routeProjectId)
            ? projectById
            : projectBySlug?.status === 'ok'
                ? projectBySlug.project
                : null

    const projectWorkspace = useProjectWorkspaceContext(project)
    const isPersonalProject = projectWorkspace.isPersonalWorkspace

    // Update lastSeenTimestamp when project identity changes
    React.useEffect(() => {
        const feedSlug = slug ?? project?.slug
        if (feedSlug) {
            setLastSeenTimestamp(getSyncFeedLastSeen(feedSlug))
        }
    }, [project?.slug, slug])
    const resolvedProjectId = providedProjectId ?? project?._id ?? null
    const navigationBasePath = resolvedProjectId
        ? buildProjectPath(String(resolvedProjectId))
        : slug
            ? buildLegacyProjectPath(slug)
            : null

    // Get unread sync feed count
    const unreadCount = useQuery(
        api.activity.getUnreadChangesCount,
        resolvedProjectId && convexUserId ? {
            projectId: resolvedProjectId,
            userId: convexUserId,
            lastSeenTimestamp,
        } : 'skip'
    )
    const projectTasks = useQuery(
        api.projectTasks.listForProject,
        resolvedProjectId && convexUserId
            ? {
                projectId: resolvedProjectId,
                viewerUserId: convexUserId,
            }
            : 'skip'
    )
    const sidebarTaskItems = React.useMemo(() => {
        const tasks = projectTasks ?? []
        return tasks
            .filter((task) => task.status !== 'done')
            .slice(0, 6)
    }, [projectTasks])

    return (
        <div className={cn("flex h-full", className)}>
            {/* 1. Primary Icon Rail Sidebar */}
            <div style={{ "--sidebar-width": "14rem" } as React.CSSProperties} className="h-full">
                <Sidebar
                    collapsible="icon"
                    className="h-full w-56 shrink-0 z-20 bg-content-surface"
                    {...props}
                >
                    <div className="h-10 shrink-0" aria-hidden="true" />
                    <SidebarHeader>
                        <ContextSwitcher />
                    </SidebarHeader>

                    <SidebarContent>
                        {NAV_GROUPS.map((group) => {
                            const visibleItems = group.items.filter((item) => {
                                if (item.title === 'Team' && isPersonalProject) {
                                    return false
                                }
                                return true
                            })

                            if (visibleItems.length === 0) {
                                return null
                            }

                            return (
                                <SidebarGroup key={group.title}>
                                    <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                                    <SidebarGroupContent>
                                        <SidebarMenu>
                                            {visibleItems.map((item) => {
                                                const isActive = activeTab === item.title
                                                const isSyncFeed = item.title === 'Sync Feed'
                                                const showUnreadBadge = isSyncFeed && unreadCount !== undefined && unreadCount > 0

                                            return (
                                                <SidebarMenuItem key={item.title}>
                                                    <SidebarMenuButton
                                                        tooltip={item.title}
                                                        isActive={isActive}
                                                        onMouseEnter={() => preloadProjectTab(item.title)}
                                                            onFocus={() => preloadProjectTab(item.title)}
                                                            onPointerDown={() => preloadProjectTab(item.title)}
                                                            onClick={() => {
                                                                if (item.title === 'Tasks') {
                                                                    setTasksExpanded((current) => (isActive ? !current : true))
                                                                }
                                                                preloadProjectTab(item.title)

                                                                // Navigate to the route
                                                                const route = routeMap[item.title]
                                                                if (route !== undefined && navigationBasePath) {
                                                                    navigate(`${navigationBasePath}${route ? `/${route}` : ''}`)
                                                                }

                                                                // Mark sync feed as seen when clicking
                                                                if (isSyncFeed && project?.slug) {
                                                                    markSyncFeedAsSeen(project.slug)
                                                                    setLastSeenTimestamp(Date.now())
                                                                }

                                                                setActiveTab(item.title)
                                                            }}
                                                        >
                                                            <item.icon className="transition-opacity group-data-[active=true]:opacity-100 opacity-70" />
                                                            <span>{item.title}</span>
                                                            {item.title === 'Tasks' ? (
                                                                <ChevronDown className={cn('ml-auto h-3.5 w-3.5 transition-transform', tasksExpanded ? 'rotate-0' : '-rotate-90')} />
                                                            ) : null}
                                                            {showUnreadBadge && (
                                                                <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4 font-medium bg-primary text-primary-foreground">
                                                                    {unreadCount > 99 ? '99+' : unreadCount}
                                                                </Badge>
                                                            )}
                                                            {'alpha' in item && item.alpha && (
                                                                <Badge variant="secondary" className="sidebar-stage-badge text-[10px] px-1 py-0 h-4 font-normal">
                                                                    alpha
                                                                </Badge>
                                                            )}
                                                        {'beta' in item && item.beta && (
                                                            <Badge variant="secondary" className="sidebar-stage-badge text-[10px] px-1 py-0 h-4 font-normal">
                                                                beta
                                                            </Badge>
                                                        )}
                                                    </SidebarMenuButton>
                                                    {item.title === 'Tasks' ? (
                                                        <Collapsible open={tasksExpanded} onOpenChange={setTasksExpanded}>
                                                            <CollapsibleContent>
                                                                <SidebarMenuSub>
                                                                    {projectTasks === undefined ? (
                                                                        <SidebarMenuSubItem>
                                                                            <SidebarMenuSubButton asChild>
                                                                                <span>Loading tasks…</span>
                                                                            </SidebarMenuSubButton>
                                                                        </SidebarMenuSubItem>
                                                                    ) : sidebarTaskItems.length > 0 ? (
                                                                        sidebarTaskItems.map((task) => (
                                                                            <SidebarMenuSubItem key={String(task._id)}>
                                                                                <SidebarMenuSubButton
                                                                                    asChild
                                                                                    isActive={activeTab === 'Tasks'}
                                                                                >
                                                                                    <button
                                                                                        type="button"
                                                                                        title={task.title}
                                                                                        onClick={() => {
                                                                                            const route = routeMap[item.title]
                                                                                            if (route !== undefined && navigationBasePath) {
                                                                                                navigate(`${navigationBasePath}${route ? `/${route}` : ''}`)
                                                                                            }
                                                                                            setActiveTab(item.title)
                                                                                        }}
                                                                                    >
                                                                                        <span>{task.title}</span>
                                                                                    </button>
                                                                                </SidebarMenuSubButton>
                                                                            </SidebarMenuSubItem>
                                                                        ))
                                                                    ) : (
                                                                        <SidebarMenuSubItem>
                                                                            <SidebarMenuSubButton asChild>
                                                                                <span>No open tasks</span>
                                                                            </SidebarMenuSubButton>
                                                                        </SidebarMenuSubItem>
                                                                    )}
                                                                </SidebarMenuSub>
                                                            </CollapsibleContent>
                                                        </Collapsible>
                                                    ) : null}
                                                </SidebarMenuItem>
                                            )
                                        })}
                                        </SidebarMenu>
                                    </SidebarGroupContent>
                                </SidebarGroup>
                            )
                        })}
                    </SidebarContent>

                    <SidebarFooter className="mt-auto pb-4 group-data-[collapsible=icon]:pb-3">
                        <div className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
                            <NavUser user={user} onLogout={onLogout} />
                        </div>
                    </SidebarFooter>
                    <SidebarRail />
                </Sidebar>
            </div>
        </div>
    )
}
