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
    Files,
    Rss,
    Box,
    Database,
    Server,
    Settings,
    Users,
    ChevronDown,
    Plus,
    RefreshCw,
    GripVertical,
    FilePlus,
    FolderPlus
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
    SidebarGroup,
    SidebarGroupLabel,
    SidebarGroupContent,
    SidebarRail,
} from "@/components/ui/sidebar"
import { NavUser } from "@/components/nav-user"
import { ContextSwitcher } from "@/components/context-switcher"
import { ProjectSyncIndicator } from "./ProjectSyncIndicator"
import { getSyncFeedLastSeen, markSyncFeedAsSeen } from "../syncFeedSeen"
import { buildLegacyProjectPath, buildProjectPath } from "../lib/projectRoutes"

// Types
interface ProjectSidebarProps extends React.ComponentProps<typeof Sidebar> {
    user?: {
        email: string
        firstName?: string | null
        lastName?: string | null
        profileImageUrl?: string | null
    } | null
    onLogout?: () => void
    fileTree?: React.ReactNode
    onRefreshFiles?: () => void
    isRefreshing?: boolean
    onCreateFile?: () => void
    onCreateFolder?: () => void
    onSecondaryVisibilityChange?: (isVisible: boolean) => void
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
    "Files": "files",
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
    if (pathname === `${base}/files` || pathname.startsWith(`${base}/files/`)) return "Files"
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
    "Files": () => import("@/features/projects/pages/ProjectDetailPage"),
    "Sync Feed": () => import("@/features/projects/pages/ChangesPage"),
    "Dependencies": () => import("@/features/projects/pages/ProjectDependenciesPage"),
    "Database": () => import("@/features/projects/pages/ProjectDatabasePage"),
    "Backend Studio": () => import("@/features/projects/pages/ProjectBackendStudioPage"),
    "Team": () => import("@/features/projects/pages/ProjectTeamPage"),
    "Settings": () => import("@/features/projects/pages/ProjectSettingsPage"),
}

// Default and constraints for secondary sidebar width
const DEFAULT_SECONDARY_WIDTH = 224 // 14rem = 224px
const MIN_SECONDARY_WIDTH = 180
const MAX_SECONDARY_WIDTH = 400

const NAV_GROUPS = [
    {
        title: "Project",
        items: [
            { title: "Tasks", icon: ListTodo }
        ]
    },
    {
        title: "Platform",
        items: [
            { title: "Previews", icon: AppWindow },
            { title: "Files", icon: Files },
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
    fileTree,
    onRefreshFiles,
    isRefreshing,
    onCreateFile,
    onCreateFolder,
    onSecondaryVisibilityChange,
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
    const isFilesRoute = routeActiveTab === "Files"
    const isBackendStudioRoute = routeActiveTab === "Backend Studio"

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

    // Track last seen timestamp for sync feed (triggers re-render when updated)
    const [lastSeenTimestamp, setLastSeenTimestamp] = React.useState(() =>
        slug ? getSyncFeedLastSeen(slug) : 0
    )

    // Get project context from canonical route first; fallback to legacy slug resolution.
    const projectById = useQuery(
        api.projects.getAccessibleById,
        providedProjectId
            ? 'skip'
            : routeProjectId && convexUserId
                ? { projectId: routeProjectId as Id<"projects">, userId: convexUserId }
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
        routeProjectId
            ? projectById
            : projectBySlug?.status === 'ok'
                ? projectBySlug.project
                : null

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

    // Resizable secondary sidebar width (persisted to localStorage)
    const [secondaryWidth, setSecondaryWidth] = React.useState(() => {
        const saved = localStorage.getItem('project-sidebar-secondary-width')
        return saved ? parseInt(saved, 10) : DEFAULT_SECONDARY_WIDTH
    })
    const secondaryWidthRef = React.useRef(secondaryWidth)
    const pendingWidthRef = React.useRef<number | null>(null)
    const resizeRafRef = React.useRef<number | null>(null)
    const [isResizing, setIsResizing] = React.useState(false)
    const resizeStartRef = React.useRef<{ startX: number; startWidth: number } | null>(null)
    const fileScrollRef = React.useRef<HTMLDivElement | null>(null)
    const [showFileTopFade, setShowFileTopFade] = React.useState(false)
    const [showFileBottomFade, setShowFileBottomFade] = React.useState(false)
    const [fileScrollElement, setFileScrollElement] = React.useState<HTMLDivElement | null>(null)

    React.useEffect(() => {
        secondaryWidthRef.current = secondaryWidth
    }, [secondaryWidth])

    const flushPendingResizeWidth = React.useCallback(() => {
        if (pendingWidthRef.current == null) return
        const nextWidth = pendingWidthRef.current
        pendingWidthRef.current = null
        if (nextWidth === secondaryWidthRef.current) return
        secondaryWidthRef.current = nextWidth
        setSecondaryWidth(nextWidth)
    }, [])

    const updateFileScrollFades = React.useCallback(() => {
        const el = fileScrollRef.current
        if (!el) {
            setShowFileTopFade(false)
            setShowFileBottomFade(false)
            return
        }

        const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
        if (maxScrollTop <= 1) {
            setShowFileTopFade(false)
            setShowFileBottomFade(false)
            return
        }

        setShowFileTopFade(el.scrollTop > 2)
        setShowFileBottomFade(el.scrollTop < maxScrollTop - 2)
    }, [])

    // Start resize - capture initial position and width
    const handleResizeStart = React.useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        pendingWidthRef.current = null
        resizeStartRef.current = {
            startX: e.clientX,
            startWidth: secondaryWidthRef.current
        }
        setIsResizing(true)
    }, [])

    // Handle resize drag
    React.useEffect(() => {
        if (!isResizing) return

        const scheduleWidthUpdate = (width: number) => {
            pendingWidthRef.current = width
            if (resizeRafRef.current !== null) return
            resizeRafRef.current = window.requestAnimationFrame(() => {
                resizeRafRef.current = null
                flushPendingResizeWidth()
            })
        }

        const handleMouseMove = (e: MouseEvent) => {
            if (!resizeStartRef.current) return

            // Calculate delta from start position
            const delta = e.clientX - resizeStartRef.current.startX
            const newWidth = resizeStartRef.current.startWidth + delta
            const clampedWidth = Math.max(MIN_SECONDARY_WIDTH, Math.min(MAX_SECONDARY_WIDTH, newWidth))
            scheduleWidthUpdate(clampedWidth)
        }

        const handleMouseUp = () => {
            if (resizeRafRef.current !== null) {
                window.cancelAnimationFrame(resizeRafRef.current)
                resizeRafRef.current = null
            }
            flushPendingResizeWidth()
            setIsResizing(false)
            resizeStartRef.current = null
            // Persist to localStorage
            localStorage.setItem('project-sidebar-secondary-width', secondaryWidthRef.current.toString())
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)

        // Add cursor style to body during resize
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
            if (resizeRafRef.current !== null) {
                window.cancelAnimationFrame(resizeRafRef.current)
                resizeRafRef.current = null
            }
        }
    }, [flushPendingResizeWidth, isResizing])

    React.useEffect(() => {
        return () => {
            if (resizeRafRef.current !== null) {
                window.cancelAnimationFrame(resizeRafRef.current)
            }
        }
    }, [])

    const isFilesPanelActive = activeTab === 'Files' && isFilesRoute
    const shouldDisableSecondarySidebarMotion =
        isFilesRoute ||
        isBackendStudioRoute ||
        activeTab === 'Files' ||
        activeTab === 'Backend Studio'

    React.useEffect(() => {
        if (!isFilesPanelActive) {
            setShowFileTopFade(false)
            setShowFileBottomFade(false)
            return
        }

        const el = fileScrollRef.current
        if (!el) return

        updateFileScrollFades()

        const onScroll = () => updateFileScrollFades()
        el.addEventListener('scroll', onScroll, { passive: true })

        const resizeObserver = new ResizeObserver(() => updateFileScrollFades())
        resizeObserver.observe(el)

        return () => {
            el.removeEventListener('scroll', onScroll)
            resizeObserver.disconnect()
        }
    }, [isFilesPanelActive, updateFileScrollFades])

    const isSecondarySidebarVisible =
        activeTab === "Files" && isFilesRoute

    React.useEffect(() => {
        setFileScrollElement(fileScrollRef.current)
    }, [isFilesPanelActive, isSecondarySidebarVisible])

    const fileTreeElement = React.useMemo(() => {
        if (!React.isValidElement(fileTree)) return fileTree
        return React.cloneElement(
            fileTree as React.ReactElement<{ isVisible?: boolean; scrollParent?: HTMLElement | null }>,
            {
                isVisible: isFilesPanelActive && isSecondarySidebarVisible,
                scrollParent: fileScrollElement,
            }
        )
    }, [fileTree, fileScrollElement, isFilesPanelActive, isSecondarySidebarVisible])

    React.useEffect(() => {
        onSecondaryVisibilityChange?.(isSecondarySidebarVisible)
    }, [isSecondarySidebarVisible, onSecondaryVisibilityChange])

    return (
        <div className={cn("flex h-full", className)}>
            {/* 1. Primary Icon Rail Sidebar */}
            <div style={{ "--sidebar-width": "14rem" } as React.CSSProperties} className="h-full">
                <Sidebar
                    collapsible="icon"
                    className="w-56 shrink-0 z-20 h-screen sidebar-glass"
                    {...props}
                >
                    <div className="h-10 shrink-0" aria-hidden="true" />
                    <SidebarHeader>
                        <ContextSwitcher />
                    </SidebarHeader>

                    <SidebarContent>
                        {NAV_GROUPS.map((group) => (
                            <SidebarGroup key={group.title}>
                                <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                                <SidebarGroupContent>
                                    <SidebarMenu>
                                        {group.items.map((item) => {
                                            // Determine interaction type
                                            const hasSecondaryPanel = ['Files', 'Previews'].includes(item.title)
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

                                                            if (hasSecondaryPanel) {
                                                                setActiveTab(isActive ? null : item.title)
                                                            } else {
                                                                setActiveTab(item.title)
                                                            }
                                                        }}
                                                    >
                                                        <item.icon className="opacity-60" />
                                                        <span>{item.title}</span>
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
                                                        {hasSecondaryPanel && (
                                                            <ChevronDown className={cn(
                                                                "ml-auto transition-transform duration-200",
                                                                isActive && "-rotate-90"
                                                            )} />
                                                        )}
                                                    </SidebarMenuButton>
                                                </SidebarMenuItem>
                                            )
                                        })}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </SidebarGroup>
                        ))}
                    </SidebarContent>

                    <SidebarFooter className="mt-auto pb-4 group-data-[collapsible=icon]:pb-3">
                        <div className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
                            <ProjectSyncIndicator variant="sidebar" />
                        </div>
                        <div className="hidden pb-2 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-1.5">
                            <ProjectSyncIndicator variant="compact" />
                        </div>
                        <div className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
                            <NavUser user={user} onLogout={onLogout} />
                        </div>
                    </SidebarFooter>
                    <SidebarRail />
                </Sidebar>
            </div>

            {/* 2. Secondary Sidebar (Context Panel) */}
            <div
                style={{
                    "--sidebar-width": `${secondaryWidth}px`,
                    width: isSecondarySidebarVisible ? secondaryWidth : 0,
                    minWidth: 0,
                    transition: shouldDisableSecondarySidebarMotion ? 'none' : 'width 200ms ease-in-out',
                    overflow: 'hidden',
                } as React.CSSProperties}
                className="h-full hidden md:flex relative shrink-0"
            >
                <>
                    <Sidebar
                        side="left"
                        variant="sidebar"
                        collapsible="none"
                        style={{
                            "--sidebar": "var(--left-sidebar-surface)",
                            "--sidebar-surface": "var(--left-sidebar-surface)",
                        } as React.CSSProperties}
                        className="file-tree-panel-border shrink-0 h-full bg-sidebar flex-1 min-w-0 relative border-r border-sidebar-border"
                    >
                        <div className="h-10 shrink-0" aria-hidden="true" />
                        <SidebarHeader className="flex flex-row items-center justify-between px-3 h-9">
                            <div className="ml-auto flex items-center gap-2">
                                {activeTab === 'Files' && onCreateFile && (
                                    <button
                                        onClick={onCreateFile}
                                        className="h-6 w-6 text-secondary-foreground/60 hover:text-secondary-foreground flex items-center justify-center"
                                        title="New File"
                                    >
                                        <FilePlus className="h-3.5 w-3.5" />
                                    </button>
                                )}
                                {activeTab === 'Files' && onCreateFolder && (
                                    <button
                                        onClick={onCreateFolder}
                                        className="h-6 w-6 text-secondary-foreground/60 hover:text-secondary-foreground flex items-center justify-center"
                                        title="New Folder"
                                    >
                                        <FolderPlus className="h-3.5 w-3.5" />
                                    </button>
                                )}
                                {activeTab === 'Files' && onRefreshFiles && (
                                    <button
                                        onClick={onRefreshFiles}
                                        disabled={isRefreshing}
                                        className="h-6 w-6 text-secondary-foreground/60 hover:text-secondary-foreground flex items-center justify-center"
                                        title="Refresh"
                                    >
                                        <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                                    </button>
                                )}
                                <button
                                    onClick={() => setActiveTab(null)}
                                    className="h-6 w-6 text-secondary-foreground/60 hover:text-secondary-foreground flex items-center justify-center"
                                    aria-label="Close secondary sidebar"
                                >
                                    <Plus className="h-4 w-4 rotate-45" />
                                </button>
                            </div>
                        </SidebarHeader>
                        <SidebarContent className="h-full overflow-hidden pt-2">
                            <div className="relative h-full">
                                <div
                                    className={cn(
                                        "absolute inset-0",
                                        isFilesPanelActive ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                                    )}
                                >
                                    <div
                                        ref={fileScrollRef}
                                        className="app-scrollbar h-full overflow-y-auto overflow-x-hidden"
                                    >
                                        {fileTreeElement ? fileTreeElement : <div className="p-4 text-sm text-destructive">Initializing files...</div>}
                                    </div>
                                    <div
                                        className={cn(
                                            "pointer-events-none absolute left-0 right-0 top-0 h-5 bg-gradient-to-b from-sidebar via-sidebar/80 to-transparent",
                                            !shouldDisableSecondarySidebarMotion && "transition-opacity duration-150",
                                            isFilesPanelActive && showFileTopFade ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    <div
                                        className={cn(
                                            "pointer-events-none absolute left-0 right-0 bottom-0 h-5 bg-gradient-to-t from-sidebar via-sidebar/80 to-transparent",
                                            !shouldDisableSecondarySidebarMotion && "transition-opacity duration-150",
                                            isFilesPanelActive && showFileBottomFade ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                </div>

                            </div>
                        </SidebarContent>
                    </Sidebar>
                    {/* Resize Handle with border */}
                    <div
                        onMouseDown={handleResizeStart}
                        className={cn(
                            "absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-50 group",
                            "hover:bg-primary/20 active:bg-primary/30",
                            isResizing && "bg-primary/30"
                        )}
                    >
                        <div className={cn(
                            "absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100",
                            !shouldDisableSecondarySidebarMotion && "transition-opacity",
                            "flex items-center justify-center h-8 w-3 rounded-sm bg-border",
                            isResizing && "opacity-100"
                        )}>
                            <GripVertical className="h-3 w-3 text-muted-foreground" />
                        </div>
                    </div>
                </>
            </div>
        </div>
    )
}
