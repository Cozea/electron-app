"use client"

import { type ReactNode, memo, useRef, useState, useCallback, useEffect, useMemo } from "react"
import { Outlet, useLocation, useParams } from "react-router-dom"
import { useMutation, useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import { useCachedQuery } from "@/stores/useQueryCache"
import { ProjectSidebar } from "../components/ProjectSidebar"
import { FileTree, type FileTreeHandle } from "../components/FileTree"
import {
    SidebarInset,
    SidebarProvider,
    useSidebar,
} from "@/components/ui/sidebar"
import { UnifiedHeader } from "@/components/layouts/UnifiedHeader"
import { SearchCommand } from "@/components/shared/SearchCommand"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { AssistantPanel } from "@/components/assistant/AssistantPanel"
import { useChatPanelStore } from "@/stores/useChatPanelStore"
import { useAssistantPanelStore } from "@/stores/useAssistantPanelStore"
import { useFileTabsStore } from "@/stores/useFileTabsStore"
import { useTerminalStore } from "@/stores/useTerminalStore"
import { useAuth } from "@/contexts/AuthContext"
import { cn } from "@/lib/utils"
import { ProjectSyncProvider } from "../contexts/ProjectSyncContext"
import { useProjectPresence } from "@/hooks/useProjectPresence"
import { useDiagnosticsBridge } from "@/hooks/useDiagnosticsBridge"
import { useDependenciesMonitor } from "@/hooks/useDependenciesMonitor"
import { useProjectHeaderStore } from "@/stores/useProjectHeaderStore"
import { EditorTabs } from "@/features/editor/components/EditorTabs"
import { ProjectPathRecoveryScreen } from "../components/ProjectPathRecoveryScreen"
import { Loader2 } from "lucide-react"

interface PathRecoveryChoice {
    previousPath: string
    targetPath: string
    targetPathExists: boolean
    projectsDirectory: string
}

interface StoredPathPreference {
    acceptedExternalPath: string
    projectsDirectory: string
}

function normalizePath(value: string): string {
    return value.replace(/\\/g, "/").replace(/\/+$/, "")
}

function pathIsInsideDirectory(candidate: string, directory: string): boolean {
    const normalizedCandidate = normalizePath(candidate)
    const normalizedDirectory = normalizePath(directory)
    return (
        normalizedCandidate === normalizedDirectory ||
        normalizedCandidate.startsWith(`${normalizedDirectory}/`)
    )
}

function buildPathPreferenceKey(projectId: string, userId: string): string {
    return `cozea:path-preference:${projectId}:${userId}`
}

function getProjectSubpageLabel(pathname: string, slug?: string): string | null {
    if (!slug) return null
    const basePath = `/projects/${slug}`
    if (pathname === basePath || pathname === `${basePath}/`) return null

    if (!pathname.startsWith(basePath)) return null
    const rest = pathname.slice(basePath.length).replace(/^\/+/, "")
    const segment = rest.split("/")[0] ?? ""

    switch (segment) {
        case "pages":
            return "Pages"
        case "backend":
            return "Backend Studio"
        case "dependencies":
            return "Dependencies"
        case "changes":
            return "Changes"
        case "settings":
            return "Settings"
        case "database":
            return "Database"
        case "tasks":
            return "Tasks"
        default:
            return null
    }
}

interface ProjectLayoutHeaderProps {
    breadcrumbs: { label: string; href?: string }[]
    header?: ReactNode
    breadcrumbAddon?: ReactNode
    isSecondarySidebarVisible: boolean
    insetLeft?: number
    insetRight?: number
    compactHeaderActions?: boolean
}

const ProjectLayoutHeader = memo(function ProjectLayoutHeader({
    breadcrumbs,
    header,
    breadcrumbAddon,
    isSecondarySidebarVisible,
    insetLeft = 0,
    insetRight = 0,
    compactHeaderActions = true,
}: ProjectLayoutHeaderProps) {
    const { state } = useSidebar()
    const areAllSidebarsCollapsed = state === "collapsed" && !isSecondarySidebarVisible

    return (
        <UnifiedHeader
            breadcrumbs={breadcrumbs}
            header={header}
            breadcrumbAddon={breadcrumbAddon}
            leftWindowControlsInset={areAllSidebarsCollapsed}
            contentInsetLeft={insetLeft}
            contentInsetRight={insetRight}
            compactHeaderActions={compactHeaderActions}
        />
    )
})


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
    const memberLocalPath = freshMemberLocalPath
    const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)

    const [effectiveLocalPath, setEffectiveLocalPath] = useState<string | null>(null)
    const [pathRecoveryChoice, setPathRecoveryChoice] = useState<PathRecoveryChoice | null>(null)
    const [isResolvingPath, setIsResolvingPath] = useState(false)
    const [pathResolutionError, setPathResolutionError] = useState<string | null>(null)

    useEffect(() => {
        setEffectiveLocalPath(null)
        setPathRecoveryChoice(null)
        setPathResolutionError(null)
    }, [project?._id, convexUser?._id, slug])

    const resolvePathPreference = useCallback(async () => {
        if (!project?._id || !convexUser?._id || !slug) {
            setEffectiveLocalPath(null)
            setPathRecoveryChoice(null)
            setPathResolutionError(null)
            return
        }

        if (memberLocalPath === undefined) {
            return
        }

        setIsResolvingPath(true)
        setPathResolutionError(null)

        try {
            const storedPath = memberLocalPath ?? null
            if (!storedPath) {
                setPathRecoveryChoice(null)
                setEffectiveLocalPath(null)
                return
            }

            const settings = await window.electronAPI.settings.get()
            const projectsDirectory = settings.projectsDirectory
            const normalizedStoredPath = normalizePath(storedPath)
            const normalizedProjectsDirectory = normalizePath(projectsDirectory)
            const preferenceKey = buildPathPreferenceKey(project._id.toString(), convexUser._id.toString())

            if (pathIsInsideDirectory(normalizedStoredPath, normalizedProjectsDirectory)) {
                localStorage.removeItem(preferenceKey)
                setPathRecoveryChoice(null)
                setEffectiveLocalPath(storedPath)
                return
            }

            const storedPreferenceRaw = localStorage.getItem(preferenceKey)
            if (storedPreferenceRaw) {
                try {
                    const storedPreference = JSON.parse(storedPreferenceRaw) as StoredPathPreference
                    if (
                        normalizePath(storedPreference.acceptedExternalPath) === normalizedStoredPath &&
                        normalizePath(storedPreference.projectsDirectory) === normalizedProjectsDirectory
                    ) {
                        setPathRecoveryChoice(null)
                        setEffectiveLocalPath(storedPath)
                        return
                    }
                } catch {
                    localStorage.removeItem(preferenceKey)
                }
            }

            const [previousPathExists, existingTargetPath] = await Promise.all([
                window.electronAPI.project.pathExists(storedPath),
                window.electronAPI.project.getLocalPath(slug),
            ])

            if (!previousPathExists) {
                let nextPath = existingTargetPath
                if (!nextPath) {
                    const created = await window.electronAPI.project.createFolder({
                        slug,
                        initGit: true,
                    })
                    if (!created.success || !created.localPath) {
                        throw new Error(created.error || "Failed to create project folder in current directory")
                    }
                    nextPath = created.localPath
                }

                await updateMemberLocalPath({
                    projectId: project._id,
                    userId: convexUser._id,
                    localPath: nextPath,
                })
                localStorage.removeItem(preferenceKey)
                setPathRecoveryChoice(null)
                setEffectiveLocalPath(nextPath)
                return
            }

            const targetPath =
                existingTargetPath ??
                `${projectsDirectory.replace(/[\\/]+$/, "")}/${slug}`

            setEffectiveLocalPath(null)
            setPathRecoveryChoice({
                previousPath: storedPath,
                targetPath,
                targetPathExists: Boolean(existingTargetPath),
                projectsDirectory,
            })
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "Failed to resolve local project directory"
            setPathResolutionError(message)
            setPathRecoveryChoice(null)
            setEffectiveLocalPath(memberLocalPath ?? null)
        } finally {
            setIsResolvingPath(false)
        }
    }, [convexUser?._id, memberLocalPath, project?._id, slug, updateMemberLocalPath])

    useEffect(() => {
        void resolvePathPreference()
    }, [resolvePathPreference])

    const handleUsePreviousDirectory = useCallback(() => {
        if (!project?._id || !convexUser?._id || !pathRecoveryChoice) return
        const preferenceKey = buildPathPreferenceKey(project._id.toString(), convexUser._id.toString())
        const payload: StoredPathPreference = {
            acceptedExternalPath: pathRecoveryChoice.previousPath,
            projectsDirectory: pathRecoveryChoice.projectsDirectory,
        }
        localStorage.setItem(preferenceKey, JSON.stringify(payload))
        setPathRecoveryChoice(null)
        setPathResolutionError(null)
        setEffectiveLocalPath(pathRecoveryChoice.previousPath)
    }, [convexUser?._id, pathRecoveryChoice, project?._id])

    const handleUseCurrentDirectory = useCallback(async () => {
        if (!project?._id || !convexUser?._id || !slug || !pathRecoveryChoice) return

        setIsResolvingPath(true)
        setPathResolutionError(null)

        try {
            let targetPath = await window.electronAPI.project.getLocalPath(slug)
            if (!targetPath) {
                const created = await window.electronAPI.project.createFolder({
                    slug,
                    initGit: true,
                })
                if (!created.success || !created.localPath) {
                    throw new Error(created.error || "Failed to create project folder in current directory")
                }
                targetPath = created.localPath
            }

            if (
                normalizePath(pathRecoveryChoice.previousPath) !== normalizePath(targetPath)
            ) {
                const copyResult = await window.electronAPI.project.copyDirectorySnapshot({
                    sourcePath: pathRecoveryChoice.previousPath,
                    targetPath,
                })
                if (!copyResult.success) {
                    throw new Error(copyResult.error || "Failed to copy project files to the new directory")
                }
            }

            await updateMemberLocalPath({
                projectId: project._id,
                userId: convexUser._id,
                localPath: targetPath,
            })

            const preferenceKey = buildPathPreferenceKey(project._id.toString(), convexUser._id.toString())
            localStorage.removeItem(preferenceKey)
            setPathRecoveryChoice(null)
            setEffectiveLocalPath(targetPath)
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "Failed to switch project directory"
            setPathResolutionError(message)
        } finally {
            setIsResolvingPath(false)
        }
    }, [convexUser?._id, pathRecoveryChoice, project?._id, slug, updateMemberLocalPath])

    const previousEffectivePathRef = useRef<string | null>(null)
    useEffect(() => {
        if (!slug || !effectiveLocalPath) {
            previousEffectivePathRef.current = effectiveLocalPath
            return
        }

        const previousPath = previousEffectivePathRef.current
        previousEffectivePathRef.current = effectiveLocalPath

        if (previousPath && normalizePath(previousPath) === normalizePath(effectiveLocalPath)) {
            return
        }

        const fileTabsStore = useFileTabsStore.getState()
        fileTabsStore.actions.rebaseProjectPaths(slug, previousPath, effectiveLocalPath)
    }, [effectiveLocalPath, slug])

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

            // Clear any stale terminal tabs in renderer state so we don't
            // keep dead terminal IDs after project path changes.
            useTerminalStore.getState().actions.reset()
        }
    }, [effectiveLocalPath])

    // Real-time presence tracking
    useProjectPresence({
        projectId: project?._id,
        userId: convexUser?._id,
        userName: convexUser?.firstName || convexUser?.email || null,
        userEmail: convexUser?.email || null,
        userAvatarUrl: convexUser?.profileImageUrl,
    })

    // File tree ref for refresh functionality
    const fileTreeRef = useRef<FileTreeHandle>(null)
    const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [isSecondarySidebarVisible, setIsSecondarySidebarVisible] = useState(true)

    const fileTreeNode = useMemo(() => <FileTree ref={fileTreeRef} />, [])

    const handleRefreshFiles = useCallback(() => {
        if (fileTreeRef.current) {
            fileTreeRef.current.refresh()
            setIsRefreshing(true)
            // Reset refreshing state after a short delay.
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current)
            }
            refreshTimeoutRef.current = setTimeout(() => setIsRefreshing(false), 500)
        }
    }, [])

    useEffect(() => {
        return () => {
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current)
            }
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

    // Determine if we can enable sync (need project + user data + resolved path decision)
    const hasSyncIdentities = Boolean(project?._id && convexUser?._id && slug) && memberLocalPath !== undefined
    const canSync = hasSyncIdentities && !isResolvingPath
    const headerContent = useProjectHeaderStore((state) => state.header)
    const breadcrumbAddon = useProjectHeaderStore((state) => state.breadcrumbAddon)
    const hideBreadcrumbs = useProjectHeaderStore((state) => state.hideBreadcrumbs)
    const insetLeft = useProjectHeaderStore((state) => state.insetLeft)
    const insetRight = useProjectHeaderStore((state) => state.insetRight)

    // Main layout content
    const subpageLabel = useMemo(
        () => getProjectSubpageLabel(location.pathname, slug),
        [location.pathname, slug]
    )
    const breadcrumbs = useMemo(
        () =>
            (hideBreadcrumbs || isFilesView)
                ? []
                : [
                    { label: "Projects", href: "/projects" },
                    ...(project?.name ? [{ label: project.name, href: slug ? `/projects/${slug}` : undefined }] : []),
                    ...(subpageLabel ? [{ label: subpageLabel }] : []),
                ],
        [hideBreadcrumbs, isFilesView, project?.name, slug, subpageLabel]
    )
    const headerSlot = useMemo(
        () =>
            isFilesView ? (
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    {headerContent}
                    <div className="min-w-0 flex-1 overflow-x-auto scrollbar-hide">
                        <EditorTabs />
                    </div>
                </div>
            ) : headerContent,
        [headerContent, isFilesView]
    )
    const showHeader = breadcrumbs.length > 0 || Boolean(headerSlot) || Boolean(breadcrumbAddon)
    const isAnyPanelFullscreen = chatPanelMode === 'fullscreen' || assistantPanelMode === 'fullscreen'

    if (pathRecoveryChoice) {
        return (
            <ProjectPathRecoveryScreen
                projectName={project?.name}
                previousPath={pathRecoveryChoice.previousPath}
                targetPath={pathRecoveryChoice.targetPath}
                targetPathExists={pathRecoveryChoice.targetPathExists}
                onUsePreviousPath={handleUsePreviousDirectory}
                onUseTargetPath={handleUseCurrentDirectory}
                onRetry={() => void resolvePathPreference()}
                isBusy={isResolvingPath}
                error={pathResolutionError}
            />
        )
    }

    const layoutContent = (
        <SidebarProvider>
            <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
                {/* Main content */}
                <div className="flex-1 flex min-h-0 overflow-hidden relative">
                    <ProjectSidebar
                        color="currentColor"
                        user={user}
                        onLogout={logout}
                        fileTree={fileTreeNode}
                        onRefreshFiles={handleRefreshFiles}
                        isRefreshing={isRefreshing}
                        onCreateFile={handleCreateFile}
                        onCreateFolder={handleCreateFolder}
                        onSecondaryVisibilityChange={setIsSecondarySidebarVisible}
                        projectId={project?._id ?? null}
                    />
                    <SidebarInset color="currentColor" className="flex flex-row flex-1 min-w-0 overflow-hidden">
                        <div
                            className="relative flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden"
                            style={{
                                flex: isAnyPanelFullscreen ? '0 0 0' : '1 1 0',
                                opacity: isAnyPanelFullscreen ? 0 : 1,
                            }}
                        >
                            <ProjectLayoutHeader
                                breadcrumbs={breadcrumbs}
                                header={headerSlot ?? undefined}
                                breadcrumbAddon={breadcrumbAddon ?? undefined}
                                isSecondarySidebarVisible={isSecondarySidebarVisible}
                                insetLeft={insetLeft}
                                insetRight={insetRight}
                                compactHeaderActions={!isFilesView}
                            />
                            <div
                                className={cn(
                                    // `min-w-0` prevents the main content from overflowing under the right panels
                                    // when it contains wide children (iframes, editors, etc.).
                                    "app-scrollbar flex flex-1 flex-col min-h-0 min-w-0 overflow-y-auto overflow-x-hidden transition-all duration-300 ease-in-out",
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
                            projectId={project?._id ?? null}
                            projectName={project?.name}
                            projectSlug={slug}
                        />
                    </SidebarInset>
                </div >
                {isResolvingPath && hasSyncIdentities && (
                    <div className="pointer-events-none absolute left-0 right-0 top-12 z-20 flex justify-center px-4">
                        <div className="flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Resolving project directory...
                        </div>
                    </div>
                )}
                <SearchCommand />
            </div>
        </SidebarProvider >
    )

    // Wrap with sync provider if we have all the required data
    if (canSync && project && convexUser && slug) {
        return (
            <ProjectSyncProvider
                key={project._id}
                projectId={project._id}
                userId={convexUser._id}
                userName={convexUser.firstName || convexUser.email || "User"}
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
