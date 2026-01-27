"use client"

import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
    LayoutDashboard,
    ListTodo,
    AppWindow,
    Files,
    Activity,
    Box,
    Database,
    Server,
    Settings,
    ChevronRight,
    Plus,
    RefreshCw
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

// Placeholders / Components
import { PagesList } from "./PagesList"

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
    // Dashboard group
    "Dashboard": "",
    "Tasks": "tasks",
    // Platform group (with secondary panels)
    "Pages": "pages",
    "Files": "",  // Default/index route shows file editor
    "Changes": "changes",
    // Development group
    "Dependencies": "dependencies",
    "Database": "database",
    "Backend Studio": "backend",
    // Settings
    "Settings": "settings",
}

export function ProjectSidebar({ user, onLogout, fileTree, onRefreshFiles, isRefreshing, className, ...props }: ProjectSidebarProps) {
    const navigate = useNavigate()
    const { slug } = useParams<{ slug: string }>()

    // Top-level active selection (e.g. "Files", "Dashboard")
    // Default to Files per user expectation
    const [activeTab, setActiveTab] = React.useState<string | null>("Files")

    const navGroups = [
        {
            title: "Dashboard",
            items: [
                { title: "Dashboard", icon: LayoutDashboard },
                { title: "Tasks", icon: ListTodo }
            ]
        },
        {
            title: "Platform",
            items: [
                { title: "Pages", icon: AppWindow },
                { title: "Files", icon: Files },
                { title: "Changes", icon: Activity }
            ]
        },
        {
            title: "Development",
            items: [
                { title: "Dependencies", icon: Box },
                { title: "Database", icon: Database },
                { title: "Backend Studio", icon: Server }
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
                                            const hasSecondaryPanel = ['Files', 'Pages'].includes(item.title)
                                            const isActive = activeTab === item.title

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
                                                        {hasSecondaryPanel && (
                                                            <ChevronRight className={cn(
                                                                "ml-auto transition-transform duration-200",
                                                                isActive && "rotate-90"
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

                    <SidebarFooter className="pb-6">
                        <NavUser user={user} onLogout={onLogout} />
                    </SidebarFooter>
                    <SidebarRail />
                </Sidebar>
            </div>

            {/* 2. Secondary Sidebar (Context Panel) */}
            {activeTab && (
                <div style={{ "--sidebar-width": "14rem" } as React.CSSProperties} className="h-full hidden md:block">
                    <Sidebar
                        side="left"
                        variant="sidebar"
                        collapsible="none"
                        className="w-56 animate-in slide-in-from-left-5 duration-200 border-r border-border/50 shrink-0 h-full bg-sidebar"
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

                            {/* Fallback for others */}
                            {!['Files', 'Pages'].includes(activeTab) && (
                                <div className="p-4 text-sm text-muted-foreground">
                                    {activeTab} content...
                                </div>
                            )}
                        </SidebarContent>
                    </Sidebar>
                </div>
            )}
        </div>
    )
}
