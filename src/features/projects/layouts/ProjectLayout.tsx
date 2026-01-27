"use client"

import { type ReactNode, useRef, useState, useCallback } from "react"
import { Outlet, useLocation, useParams } from "react-router-dom"
import { useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import { ProjectSidebar } from "../components/ProjectSidebar"
import { FileTree, type FileTreeHandle } from "../components/FileTree"
import { SiteHeader } from "@/components/layout/SiteHeader"
import {
    SidebarInset,
    SidebarProvider,
} from "@/components/ui/sidebar"
import { StatusBar } from "@/components/StatusBar"
import { SearchCommand } from "@/components/shared/SearchCommand"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { AssistantPanel } from "@/components/assistant/AssistantPanel"
import { useChatPanelStore } from "@/stores/useChatPanelStore"
import { useAssistantPanelStore } from "@/stores/useAssistantPanelStore"
import { useFileTabsStore } from "@/stores/useFileTabsStore"
import { useAuth } from "@/contexts/AuthContext"
import { cn } from "@/lib/utils"
import { ProjectSyncProvider } from "../contexts/ProjectSyncContext"
import { useProjectPresence } from "@/hooks/useProjectPresence"
import { Loader2 } from "lucide-react"

interface ProjectLayoutProps {
    children?: ReactNode
    breadcrumbs?: { label: string; href?: string }[]
}

export function ProjectLayout({
    children, // NOTE: Router uses Outlet, but we keep children in case used as wrapper
}: ProjectLayoutProps) {
    const { user, logout, currentOrganization } = useAuth()
    const location = useLocation()
    const { slug } = useParams<{ slug: string }>()

    const chatPanelMode = useChatPanelStore((state) => state.mode)
    const assistantPanelMode = useAssistantPanelStore((state) => state.mode)

    // Get Convex organization and user for sync
    const convexOrg = useQuery(
        api.organizations.getByWorkosId,
        currentOrganization?.organizationId
            ? { workosId: currentOrganization.organizationId }
            : "skip"
    )

    const convexUser = useQuery(
        api.users.getByWorkosId,
        user?.id ? { workosId: user.id } : "skip"
    )

    // Get project data
    const project = useQuery(
        api.projects.getBySlug,
        convexOrg?._id && slug
            ? { organizationId: convexOrg._id, slug }
            : "skip"
    )

    // Get per-user local path for this project (machine-specific)
    const memberLocalPath = useQuery(
        api.projectMembers.getMemberLocalPath,
        project?._id && convexUser?._id
            ? { projectId: project._id, userId: convexUser._id }
            : "skip"
    )

    // Per-user local path only (no fallback to shared project.localPath)
    const effectiveLocalPath = memberLocalPath ?? null

    // Real-time presence tracking
    const { otherUsers: presenceUsers } = useProjectPresence({
        projectId: project?._id,
        userId: convexUser?._id,
        userName: convexUser?.firstName || convexUser?.email || null,
        userEmail: convexUser?.email || null,
        userAvatarUrl: convexUser?.profileImageUrl,
    })

    // File tree ref for refresh functionality
    const fileTreeRef = useRef<FileTreeHandle>(null)
    const [isRefreshing, setIsRefreshing] = useState(false)

    const handleRefreshFiles = useCallback(() => {
        if (fileTreeRef.current) {
            fileTreeRef.current.refresh()
            setIsRefreshing(true)
            // Reset refreshing state after a short delay
            setTimeout(() => setIsRefreshing(false), 500)
        }
    }, [])

    // Check if we have open files (to remove padding for editor)
    const projectTabs = useFileTabsStore(state => slug ? state.projectTabs[slug] : null)
    const hasOpenFiles = (projectTabs?.openFiles?.length || 0) > 0

    // Check if we are on the pages view or backend studio (simplified logic for now)
    const isPagesView = location.pathname.endsWith('/pages')
    const isBackendStudioView = location.pathname.endsWith('/backend')
    // Remove padding for Editor (has files), Pages, and Studio
    const shouldRemovePadding = hasOpenFiles || isPagesView || isBackendStudioView

    // Determine if we can enable sync (need project + user data)
    const canSync = project?._id && convexUser?._id && slug

    // Check if queries are still loading (undefined = loading in Convex)
    const isLoadingData =
        (currentOrganization?.organizationId && convexOrg === undefined) ||
        (user?.id && convexUser === undefined) ||
        (convexOrg?._id && slug && project === undefined)

    // Show loading screen while waiting for data to determine sync status
    if (isLoadingData) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-background">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading project...</p>
                </div>
            </div>
        )
    }

    // Main layout content
    const layoutContent = (
        <SidebarProvider
            className="flex flex-col h-screen"
        >
            <SiteHeader
                breadcrumbs={[
                    { label: "Projects", href: "/projects" },
                    ...(project?.name ? [{ label: project.name }] : []),
                ]}
                presenceUsers={presenceUsers}
            />
            {/* Main content - mt-9 accounts for fixed h-9 header */}
            <div className="flex-1 flex min-h-0 overflow-hidden mt-9">
                <ProjectSidebar
                    color="currentColor"
                    className="!top-9 !h-[calc(100svh-56px)]"
                    user={user}
                    onLogout={logout}
                    fileTree={<FileTree ref={fileTreeRef} />}
                    onRefreshFiles={handleRefreshFiles}
                    isRefreshing={isRefreshing}
                />
                <SidebarInset color="currentColor" className="flex flex-row flex-1 min-w-0 overflow-hidden">
                    <div
                        className={cn(
                            "flex flex-1 flex-col min-h-0 overflow-y-auto transition-all duration-300 ease-in-out",
                            shouldRemovePadding ? "p-0" : "p-4"
                        )}
                        style={{
                            flex: chatPanelMode === 'fullscreen' || assistantPanelMode === 'fullscreen' ? '0 0 0' : '1 1 0',
                            opacity: chatPanelMode === 'fullscreen' || assistantPanelMode === 'fullscreen' ? 0 : 1,
                        }}
                    >
                        {children || <Outlet />}
                    </div>
                    <ChatPanel />
                    <AssistantPanel
                      projectPath={effectiveLocalPath ?? undefined}
                      projectName={project?.name}
                      projectSlug={slug}
                    />
                </SidebarInset>
            </div >
            <StatusBar />
            <SearchCommand />
        </SidebarProvider >
    )

    // Wrap with sync provider if we have all the required data
    if (canSync) {
        return (
            <ProjectSyncProvider
                projectId={project._id}
                userId={convexUser._id}
                userName={convexUser.firstName || convexUser.email}
                projectSlug={slug}
                localPath={effectiveLocalPath}
                lastSyncAt={project.lastSyncAt}
            >
                {layoutContent}
            </ProjectSyncProvider>
        )
    }

    // Render without sync if data isn't available yet
    return layoutContent
}
