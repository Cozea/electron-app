"use client"

import * as React from "react"
import { useNavigate, useParams, useLocation } from "react-router-dom"
import { useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import {
    ListTodo,
    AppWindow,
    Files,
    Rss,
    Box,
    Database,
    Server,
    Settings,
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
import { useProjectPagesStore } from "@/stores/useProjectPagesStore"

// Placeholders / Components
import { PagesList } from "./PagesList"

// Helper to get/set last seen timestamp for sync feed
function getSyncFeedLastSeen(projectSlug: string): number {
    const key = `sync-feed-last-seen-${projectSlug}`
    const stored = localStorage.getItem(key)
    return stored ? parseInt(stored, 10) : 0
}

export function markSyncFeedAsSeen(projectSlug: string): void {
    const key = `sync-feed-last-seen-${projectSlug}`
    localStorage.setItem(key, Date.now().toString())
}

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
}

// Route mappings for all navigation items
const routeMap: Record<string, string> = {
    "Tasks": "tasks",
    // Platform group (with secondary panels)
    "Pages": "pages",
    "Files": "",  // Default/index route shows file editor
    "Sync Feed": "changes",
    // Development group
    "Dependencies": "dependencies",
    "Database": "database",
    "Backend Studio": "backend",
    // Settings
    "Settings": "settings",
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
            { title: "Pages", icon: AppWindow },
            { title: "Files", icon: Files },
            { title: "Sync Feed", icon: Rss }
        ]
    },
    {
        title: "Development",
        items: [
            { title: "Dependencies", icon: Box },
            { title: "Database", icon: Database, alpha: true },
            { title: "Backend Studio", icon: Server, alpha: true }
        ]
    },
    {
        title: "Settings",
        items: [
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
    className,
    ...props
}: ProjectSidebarProps) {
    const navigate = useNavigate()
    const { slug } = useParams<{ slug: string }>()
    const location = useLocation()
    const { currentOrganization, convexUserId } = useAuth()
    const pagesListOpen = useProjectPagesStore((s) => s.pagesListOpen)
    const setPagesListOpen = useProjectPagesStore((s) => s.actions.setPagesListOpen)

    const isFilesRoute = Boolean(slug && (location.pathname === `/projects/${slug}` || location.pathname === `/projects/${slug}/`))
    const isPagesRoute = Boolean(slug && location.pathname === `/projects/${slug}/pages`)
    const isSettingsRoute = Boolean(slug && location.pathname.startsWith(`/projects/${slug}/settings`))

    // Top-level active selection (e.g. "Files", "Tasks")
    const [activeTab, setActiveTab] = React.useState<string | null>(() => {
        if (isFilesRoute) return "Files"
        if (isPagesRoute) return "Pages"
        if (isSettingsRoute) return "Settings"
        return null
    })

    // Keep rail selection in sync with route (e.g. when navigating to /pages)
    React.useEffect(() => {
        if (isPagesRoute) setActiveTab("Pages")
        else if (isSettingsRoute) setActiveTab("Settings")
        else if (isFilesRoute) setActiveTab("Files")
        else setActiveTab(null)
    }, [isFilesRoute, isPagesRoute, isSettingsRoute])

    // Track last seen timestamp for sync feed (triggers re-render when updated)
    const [lastSeenTimestamp, setLastSeenTimestamp] = React.useState(() =>
        slug ? getSyncFeedLastSeen(slug) : 0
    )

    // Update lastSeenTimestamp when slug changes
    React.useEffect(() => {
        if (slug) {
            setLastSeenTimestamp(getSyncFeedLastSeen(slug))
        }
    }, [slug])

    // Resolve project ID once (avoid duplicate org/project queries when parent already has it).
    const convexOrg = useQuery(
        api.organizations.getByWorkosId,
        providedProjectId
            ? 'skip'
            : currentOrganization?.organizationId
                ? { workosId: currentOrganization.organizationId }
                : 'skip'
    )

    // Get project by slug
    const project = useQuery(
        api.projects.getBySlug,
        providedProjectId
            ? 'skip'
            : convexOrg?._id && slug
                ? { organizationId: convexOrg._id, slug }
                : 'skip'
    )
    const resolvedProjectId = providedProjectId ?? project?._id ?? null

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
    const [isResizing, setIsResizing] = React.useState(false)
    const resizeStartRef = React.useRef<{ startX: number; startWidth: number } | null>(null)
    const fileScrollRef = React.useRef<HTMLDivElement | null>(null)
    const [showFileTopFade, setShowFileTopFade] = React.useState(false)
    const [showFileBottomFade, setShowFileBottomFade] = React.useState(false)

    React.useEffect(() => {
        secondaryWidthRef.current = secondaryWidth
    }, [secondaryWidth])

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
        resizeStartRef.current = {
            startX: e.clientX,
            startWidth: secondaryWidth
        }
        setIsResizing(true)
    }, [secondaryWidth])

    // Handle resize drag
    React.useEffect(() => {
        if (!isResizing) return

        const handleMouseMove = (e: MouseEvent) => {
            if (!resizeStartRef.current) return

            // Calculate delta from start position
            const delta = e.clientX - resizeStartRef.current.startX
            const newWidth = resizeStartRef.current.startWidth + delta
            const clampedWidth = Math.max(MIN_SECONDARY_WIDTH, Math.min(MAX_SECONDARY_WIDTH, newWidth))
            setSecondaryWidth(clampedWidth)
        }

        const handleMouseUp = () => {
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
        }
    }, [isResizing])

    React.useEffect(() => {
        if (activeTab !== 'Files') {
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
    }, [activeTab, updateFileScrollFades])

    const isSecondarySidebarVisible =
        (activeTab === "Files" && isFilesRoute) ||
        (isPagesRoute && pagesListOpen)

    React.useEffect(() => {
        onSecondaryVisibilityChange?.(isSecondarySidebarVisible)
    }, [isSecondarySidebarVisible, onSecondaryVisibilityChange])

    return (
        <div className={cn("flex h-full titlebar-drag-region", className)}>
            {/* 1. Primary Icon Rail Sidebar */}
            <div style={{ "--sidebar-width": "14rem" } as React.CSSProperties} className="h-full">
                <Sidebar
                    collapsible="icon"
                    className="w-56 shrink-0 z-20 h-screen titlebar-no-drag"
                    {...props}
                >
                    <SidebarHeader className="mt-9 titlebar-drag-region">
                        <div className="titlebar-no-drag">
                            <ContextSwitcher />
                        </div>
                    </SidebarHeader>

                    <SidebarContent className="group-data-[collapsible=icon]:mt-9">
                        {NAV_GROUPS.map((group) => (
                            <SidebarGroup key={group.title}>
                                <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                                <SidebarGroupContent>
                                    <SidebarMenu>
                                        {group.items.map((item) => {
                                            // Determine interaction type
                                            const hasSecondaryPanel = ['Files', 'Pages'].includes(item.title)
                                            const isActive = activeTab === item.title
                                            const isSyncFeed = item.title === 'Sync Feed'
                                            const showUnreadBadge = isSyncFeed && unreadCount !== undefined && unreadCount > 0

                                            return (
                                                <SidebarMenuItem key={item.title}>
                                                    <SidebarMenuButton
                                                        tooltip={item.title}
                                                        isActive={isActive}
                                                        onClick={() => {
                                                            // Navigate to the route
                                                            const route = routeMap[item.title]
                                                            if (route !== undefined && slug) {
                                                                navigate(`/projects/${slug}${route ? `/${route}` : ''}`)
                                                            }

                                                            // Mark sync feed as seen when clicking
                                                            if (isSyncFeed && slug) {
                                                                markSyncFeedAsSeen(slug)
                                                                setLastSeenTimestamp(Date.now())
                                                            }

                                                            if (item.title === 'Pages') {
                                                                setActiveTab('Pages')
                                                                setPagesListOpen(false) // Pages list closed by default when entering page view
                                                            } else if (hasSecondaryPanel) {
                                                                setActiveTab(isActive ? null : item.title)
                                                            } else {
                                                                setActiveTab(null)
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
                                                            <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 font-normal">
                                                                alpha
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
                        <div className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
                            <NavUser user={user} onLogout={onLogout} />
                        </div>
                    </SidebarFooter>
                    <SidebarRail />
                </Sidebar>
            </div>

            {/* 2. Secondary Sidebar (Context Panel) - Resizable, width animates for smooth transition */}
            <div
                style={{
                    "--sidebar-width": `${secondaryWidth}px`,
                    width: isSecondarySidebarVisible ? secondaryWidth : 0,
                    minWidth: 0,
                    transition: 'width 200ms ease-in-out',
                    overflow: 'hidden',
                } as React.CSSProperties}
                className="h-full hidden md:flex relative shrink-0"
            >
                {isSecondarySidebarVisible && (
                    <>
                        <Sidebar
                            side="left"
                            variant="sidebar"
                            collapsible="none"
                            className="shrink-0 h-full bg-sidebar flex-1 min-w-0 titlebar-no-drag relative sidebar-fade-border sidebar-fade-border-right"
                        >
                            <SidebarHeader className="flex flex-row items-center justify-between px-3 h-9 titlebar-drag-region">
                                <div className="ml-auto flex items-center gap-2 titlebar-no-drag">
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
                                        onClick={() => isPagesRoute ? setPagesListOpen(false) : setActiveTab(null)}
                                        className="h-6 w-6 text-secondary-foreground/60 hover:text-secondary-foreground flex items-center justify-center"
                                        aria-label="Close secondary sidebar"
                                    >
                                        <Plus className="h-4 w-4 rotate-45" />
                                    </button>
                                </div>
                            </SidebarHeader>
                            <SidebarContent className="h-full overflow-hidden pt-2">
                                {activeTab === 'Files' ? (
                                    <div className="relative h-full">
                                        <div
                                            ref={fileScrollRef}
                                            className="h-full overflow-y-auto overflow-x-hidden"
                                        >
                                            {fileTree ? fileTree : <div className="p-4 text-sm text-destructive">Initializing files...</div>}
                                        </div>
                                        <div
                                            className={cn(
                                                "pointer-events-none absolute left-0 right-0 top-0 h-5 bg-gradient-to-b from-sidebar via-sidebar/80 to-transparent transition-opacity duration-150",
                                                showFileTopFade ? "opacity-100" : "opacity-0"
                                            )}
                                        />
                                        <div
                                            className={cn(
                                                "pointer-events-none absolute left-0 right-0 bottom-0 h-5 bg-gradient-to-t from-sidebar via-sidebar/80 to-transparent transition-opacity duration-150",
                                                showFileBottomFade ? "opacity-100" : "opacity-0"
                                            )}
                                        />
                                    </div>
                                ) : (
                                    <>
                                        {(activeTab === 'Pages' || isPagesRoute) && <PagesList />}
                                    </>
                                )}
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
                                "absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity",
                                "flex items-center justify-center h-8 w-3 rounded-sm bg-border",
                                isResizing && "opacity-100"
                            )}>
                                <GripVertical className="h-3 w-3 text-muted-foreground" />
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
