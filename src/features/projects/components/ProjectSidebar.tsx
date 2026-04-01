"use client"

import * as React from "react"
import { useParams, useLocation } from '@/lib/router'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import {
    Settings,
    Users,
    LayoutGrid,
} from "lucide-react"
import { cn } from "@/lib/utils"

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarGroupContent,
    SidebarRail,
} from "@/components/ui/sidebar"
import { NavUser } from "@/components/nav-user"
import { ContextSwitcher } from "@/components/context-switcher"
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
    "Workbench": "workbench",
    // Settings
    "Team": "team",
    "Settings": "settings",
}

function getActiveTabFromPathname(pathname: string, base: string | null): string | null {
    if (!base) return null

    if (pathname === base || pathname === `${base}/`) return "Workbench"
    if (pathname === `${base}/workbench` || pathname.startsWith(`${base}/workbench/`)) return "Workbench"
    if (pathname === `${base}/pages` || pathname.startsWith(`${base}/pages/`)) return "Workbench"
    if (pathname === `${base}/tasks` || pathname.startsWith(`${base}/tasks/`)) return "Workbench"
    if (pathname === `${base}/changes` || pathname.startsWith(`${base}/changes/`)) return "Workbench"
    if (pathname === `${base}/team` || pathname.startsWith(`${base}/team/`)) return "Team"
    if (pathname.startsWith(`${base}/settings`)) return "Settings"

    return null
}

const projectRoutePreloaders: Record<string, () => Promise<unknown>> = {
    "Workbench": () => import("@/features/projects/pages/ProjectWorkbenchPage"),
    "Team": () => import("@/features/projects/pages/ProjectTeamPage"),
    "Settings": () => import("@/features/projects/pages/ProjectSettingsPage"),
}

const NAV_GROUPS = [
    {
        title: "Platform",
        items: [
            { title: "Workbench", icon: LayoutGrid },
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
    const { slug, projectId: routeProjectId } = useParams()
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
    // Keep rail selection in sync with route.
    React.useEffect(() => {
        setActiveTab(routeActiveTab)
    }, [routeActiveTab])

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

    const resolvedProjectId = providedProjectId ?? project?._id ?? null
    const navigationBasePath = resolvedProjectId
        ? buildProjectPath(String(resolvedProjectId))
        : slug
            ? buildLegacyProjectPath(slug)
            : null

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

                                            return (
                                                <SidebarMenuItem key={item.title}>
                                                    <SidebarMenuButton
                                                        tooltip={item.title}
                                                        isActive={isActive}
                                                        onMouseEnter={() => preloadProjectTab(item.title)}
                                                            onFocus={() => preloadProjectTab(item.title)}
                                                            onPointerDown={() => preloadProjectTab(item.title)}
                                                            onClick={() => {
                                                                preloadProjectTab(item.title)

                                                                // Navigate to the route
                                                                const route = routeMap[item.title]
                                                                if (route !== undefined && navigationBasePath) {
                                                                    navigate(`${navigationBasePath}${route ? `/${route}` : ''}`)
                                                                }

                                                                setActiveTab(item.title)
                                                            }}
                                                        >
                                                            <item.icon className="transition-opacity group-data-[active=true]:opacity-100 opacity-70 shrink-0" />
                                                            <span className="truncate group-data-[collapsible=icon]:hidden">{item.title}</span>
                                                    </SidebarMenuButton>
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
