"use client"

import { type ReactNode, useRef, useState, useCallback, useEffect } from "react"
import { Outlet, useLocation, useParams } from "react-router-dom"
import { useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import { useCachedQuery } from "@/stores/useQueryCache"
import { ProjectSidebar } from "../components/ProjectSidebar"
import { FileTree, type FileTreeHandle } from "../components/FileTree"
import {
    SidebarInset,
    SidebarProvider,
} from "@/components/ui/sidebar"
import { UnifiedHeader } from "@/components/layouts/UnifiedHeader"
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
import { useDiagnosticsBridge } from "@/hooks/useDiagnosticsBridge"
import { useDependenciesMonitor } from "@/hooks/useDependenciesMonitor"
import { useProjectHeaderStore } from "@/stores/useProjectHeaderStore"


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

    // Get Convex organization and user for sync (with caching)
    const freshConvexOrg = useQuery(
        api.organizations.getByWorkosId,
        currentOrganization?.organizationId
            ? { workosId: currentOrganization.organizationId }
            : "skip"
    )
    const convexOrg = useCachedQuery(
        `layout-org-${currentOrganization?.organizationId}`,
        freshConvexOrg
    )

    const freshConvexUser = useQuery(
        api.users.getByWorkosId,
        user?.id ? { workosId: user.id } : "skip"
    )
    const convexUser = useCachedQuery(
        `layout-user-${user?.id}`,
        freshConvexUser
    )

    // Get project data (with caching)
    const freshProject = useQuery(
        api.projects.getBySlug,
        convexOrg?._id && slug
            ? { organizationId: convexOrg._id, slug }
            : "skip"
    )
    const project = useCachedQuery(
        `layout-project-${slug}`,
        freshProject
    )

    // Get per-user local path for this project (machine-specific) (with caching)
    const freshMemberLocalPath = useQuery(
        api.projectMembers.getMemberLocalPath,
        project?._id && convexUser?._id
            ? { projectId: project._id, userId: convexUser._id }
            : "skip"
    )
    const memberLocalPath = useCachedQuery(
        `layout-localpath-${project?._id}-${convexUser?._id}`,
        freshMemberLocalPath
    )

    // Per-user local path only (no fallback to shared project.localPath)
    const effectiveLocalPath = memberLocalPath ?? null

    useDiagnosticsBridge(effectiveLocalPath)
    useDependenciesMonitor(effectiveLocalPath)

    // Ensure project-scoped runtime processes don't leak across navigation.
    // - Stops any dev server PTY (devServer API)
    // - Kills any terminals started for this projectPath (terminal API)
    useEffect(() => {
        if (!effectiveLocalPath) return

        return () => {
            const projectPath = effectiveLocalPath

            // Stop dev server if running (ok if already stopped)
            void window.electronAPI.devServer.stop({ projectPath }).catch(() => {
                // ignore
            })

            // Kill all terminals for this project (ok if none)
            void window.electronAPI.terminal
                .list({ projectPath })
                .then((terminalIds) =>
                    Promise.all(
                        terminalIds.map((terminalId) =>
                            window.electronAPI.terminal.kill({ terminalId }).catch(() => null)
                        )
                    )
                )
                .catch(() => {
                    // ignore
                })
        }
    }, [effectiveLocalPath])

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

    const handleCreateFile = useCallback(() => {
        fileTreeRef.current?.startCreateFile()
    }, [])

    const handleCreateFolder = useCallback(() => {
        fileTreeRef.current?.startCreateFolder()
    }, [])

    // Check if we have open files (to remove padding for editor)
    const projectTabs = useFileTabsStore(state => slug ? state.projectTabs[slug] : null)
    const hasOpenFiles = (projectTabs?.openFiles?.length || 0) > 0

    // Check if we are on views that need full-bleed content (no padding)
    const isPagesView = location.pathname.endsWith('/pages')
    const isBackendStudioView = location.pathname.endsWith('/backend')
    const isDependenciesView = location.pathname.endsWith('/dependencies')
    const isChangesView = location.pathname.endsWith('/changes')
    const isFilesView = Boolean(slug && (location.pathname === `/projects/${slug}` || location.pathname === `/projects/${slug}/`))
    // Remove padding for Editor (has files), Pages, Studio, Dependencies, and Changes
    const shouldRemovePadding = hasOpenFiles || isPagesView || isBackendStudioView || isDependenciesView || isChangesView

    // Determine if we can enable sync (need project + user data)
    const canSync = project?._id && convexUser?._id && slug
    const headerContent = useProjectHeaderStore((state) => state.header)
    const breadcrumbAddon = useProjectHeaderStore((state) => state.breadcrumbAddon)
    const hideBreadcrumbs = useProjectHeaderStore((state) => state.hideBreadcrumbs)



    // Main layout content
    const breadcrumbs = (hideBreadcrumbs || isFilesView) ? [] : [
        { label: "Projects", href: "/projects" },
        ...(project?.name ? [{ label: project.name }] : []),
    ]
    const showHeader = breadcrumbs.length > 0 || Boolean(headerContent) || Boolean(breadcrumbAddon)

    const layoutContent = (
        <SidebarProvider
            className="flex flex-col h-screen"
        >
            {/* Main content */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
                <ProjectSidebar
                    color="currentColor"
                    user={user}
                    onLogout={logout}
                    fileTree={<FileTree ref={fileTreeRef} />}
                    onRefreshFiles={handleRefreshFiles}
                    isRefreshing={isRefreshing}
                    onCreateFile={handleCreateFile}
                    onCreateFolder={handleCreateFolder}
                />
                <SidebarInset color="currentColor" className="flex flex-row flex-1 min-w-0 overflow-hidden">
                    <div
                        className="relative flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden"
                        style={{
                            flex: chatPanelMode === 'fullscreen' || assistantPanelMode === 'fullscreen' ? '0 0 0' : '1 1 0',
                            opacity: chatPanelMode === 'fullscreen' || assistantPanelMode === 'fullscreen' ? 0 : 1,
                        }}
                    >
                        <UnifiedHeader
                            breadcrumbs={breadcrumbs}
                            header={headerContent ?? undefined}
                            breadcrumbAddon={breadcrumbAddon ?? undefined}
                        />
                        <div
                            className={cn(
                                // `min-w-0` prevents the main content from overflowing under the right panels
                                // when it contains wide children (iframes, editors, etc.).
                                "flex flex-1 flex-col min-h-0 min-w-0 overflow-y-auto overflow-x-hidden transition-all duration-300 ease-in-out",
                                shouldRemovePadding ? "p-0" : "p-4",
                                showHeader && "pt-10"
                            )}
                        >
                            {children || <Outlet />}
                        </div>
                    </div>
                    <ChatPanel />
                    <AssistantPanel
                        projectPath={effectiveLocalPath ?? undefined}
                        projectName={project?.name}
                        projectSlug={slug}
                    />
                </SidebarInset>
            </div >
            <SearchCommand />
        </SidebarProvider >
    )

    // Wrap with sync provider if we have all the required data
    if (canSync) {
        return (
            <ProjectSyncProvider
                key={project._id}
                projectId={project._id}
                userId={convexUser._id}
                userName={convexUser.firstName || convexUser.email}
                projectSlug={slug}
                localPath={effectiveLocalPath}
                lastSyncAt={project.lastSyncAt}
                onFilesChanged={handleRefreshFiles}
            >
                {layoutContent}
            </ProjectSyncProvider>
        )
    }

    // Render without sync if data isn't available yet
    return layoutContent
}
