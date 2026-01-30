"use client"

import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
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
    GripVertical
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

// Placeholders / Components
import { PagesList } from "./PagesList"
import { SettingsSectionsList } from "./SettingsSectionsList"

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

export function ProjectSidebar({ user, onLogout, fileTree, onRefreshFiles, isRefreshing, className, ...props }: ProjectSidebarProps) {
    const navigate = useNavigate()
    const { slug } = useParams<{ slug: string }>()
    const { currentOrganization, convexUserId } = useAuth()

    // Top-level active selection (e.g. "Files", "Tasks")
    // Default to Files per user expectation
    const [activeTab, setActiveTab] = React.useState<string | null>("Files")

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

    // Get Convex organization for project lookup
    const convexOrg = useQuery(
        api.organizations.getByWorkosId,
        currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
    )

    // Get project by slug
    const project = useQuery(
        api.projects.getBySlug,
        convexOrg?._id && slug ? { organizationId: convexOrg._id, slug } : 'skip'
    )

    // Get unread sync feed count
    const unreadCount = useQuery(
        api.activity.getUnreadChangesCount,
        project?._id && convexUserId ? {
            projectId: project._id,
            userId: convexUserId,
            lastSeenTimestamp,
        } : 'skip'
    )

    // Resizable secondary sidebar width (persisted to localStorage)
    const [secondaryWidth, setSecondaryWidth] = React.useState(() => {
        const saved = localStorage.getItem('project-sidebar-secondary-width')
        return saved ? parseInt(saved, 10) : DEFAULT_SECONDARY_WIDTH
    })
    const [isResizing, setIsResizing] = React.useState(false)
    const resizeStartRef = React.useRef<{ startX: number; startWidth: number } | null>(null)

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
            localStorage.setItem('project-sidebar-secondary-width', secondaryWidth.toString())
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
    }, [isResizing, secondaryWidth])

    const navGroups = [
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
    ]

    return (
        <div className={cn("flex h-full app-region-drag bg-sidebar", className)}>
            {/* 1. Primary Icon Rail Sidebar */}
            <div style={{ "--sidebar-width": "14rem" } as React.CSSProperties} className="h-full">
                <Sidebar
                    collapsible="icon"
                    className="w-56 border-r border-border/50 shrink-0 z-20 h-full"
                    {...props}
                >
                    <SidebarHeader className="mt-9">
                        <ContextSwitcher />
                    </SidebarHeader>

                    <SidebarContent className="group-data-[collapsible=icon]:mt-9">
                        {navGroups.map((group) => (
                            <SidebarGroup key={group.title}>
                                <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                                <SidebarGroupContent>
                                    <SidebarMenu>
                                        {group.items.map((item) => {
                                            // Determine interaction type
                                            const hasSecondaryPanel = ['Files', 'Pages', 'Settings'].includes(item.title)
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

                                                            if (hasSecondaryPanel) {
                                                                // Toggle secondary panel for items that have one
                                                                setActiveTab(isActive ? null : item.title)
                                                            } else {
                                                                // Close secondary panel for other items
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

                    <SidebarFooter className="pb-6 group-data-[collapsible=icon]:pb-8">
                        <NavUser user={user} onLogout={onLogout} />
                    </SidebarFooter>
                    <SidebarRail />
                </Sidebar>
            </div>

            {/* 2. Secondary Sidebar (Context Panel) - Resizable */}
            {activeTab && (
                <div
                    style={{
                        "--sidebar-width": `${secondaryWidth}px`,
                        width: secondaryWidth
                    } as React.CSSProperties}
                    className="h-full hidden md:flex relative"
                >
                    <Sidebar
                        side="left"
                        variant="sidebar"
                        collapsible="none"
                        className="animate-in slide-in-from-left-5 duration-200 border-r-0 shrink-0 h-full bg-sidebar flex-1"
                    >
                        <SidebarHeader className="flex flex-row items-center justify-between px-3 h-9">
                            <h3 className="text-sm font-medium">{activeTab}</h3>
                            <div className="flex items-center gap-1">
                                {activeTab === 'Files' && onRefreshFiles && (
                                    <button
                                        onClick={onRefreshFiles}
                                        disabled={isRefreshing}
                                        className="h-6 w-6 rounded-md hover:bg-sidebar-accent flex items-center justify-center"
                                        title="Refresh"
                                    >
                                        <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                                    </button>
                                )}
                                <button
                                    onClick={() => setActiveTab(null)}
                                    className="h-6 w-6 rounded-md hover:bg-sidebar-accent flex items-center justify-center"
                                >
                                    <Plus className="h-4 w-4 rotate-45" />
                                </button>
                            </div>
                        </SidebarHeader>
                        <SidebarContent className="h-full overflow-hidden pt-2">
                            {/* Content based on Active Tab */}
                            {activeTab === 'Files' && (
                                fileTree ? fileTree : <div className="p-4 text-sm text-destructive">Initializing files...</div>
                            )}
                            {activeTab === 'Pages' && <PagesList />}
                            {activeTab === 'Settings' && <SettingsSectionsList />}
                        </SidebarContent>
                    </Sidebar>
                    {/* Resize Handle with border */}
                    <div
                        onMouseDown={handleResizeStart}
                        className={cn(
                            "absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-50 group border-r border-border/50",
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
                </div>
            )}
        </div>
    )
}
