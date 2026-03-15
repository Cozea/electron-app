"use client"

import { type ReactNode, memo, useRef, useState, useCallback, useEffect, useMemo } from "react"
import { Outlet, useLocation, useParams } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useMutation, useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useCachedQuery } from "@/stores/useQueryCache"
import { ProjectSidebar } from "../components/ProjectSidebar"
import { FileTree, type FileTreeHandle } from "../components/FileTree"
import {
    SidebarInset,
    SidebarProvider,
    useOptionalSidebar,
} from "@/components/ui/sidebar"
import { UnifiedHeader } from "@/components/layouts/UnifiedHeader"
import { SearchCommand } from "@/components/shared/SearchCommand"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { AssistantPanel } from "@/components/assistant/AssistantPanel"
import { ChatHistorySidebar } from "@/components/assistant/ChatHistorySidebar"
import { useChatPanelStore } from "@/stores/useChatPanelStore"
import { useAssistantPanelStore } from "@/stores/useAssistantPanelStore"
import { useFileTabsStore } from "@/stores/useFileTabsStore"
import { usePageContextStore } from "@/stores/usePageContextStore"
import { useTerminalStore } from "@/stores/useTerminalStore"
import { useAuth } from "@/contexts/AuthContext"
import { cn } from "@/lib/utils"
import { ProjectSyncProvider } from "../contexts/ProjectSyncContext"
import { useProjectPresence } from "@/hooks/useProjectPresence"
import { useDiagnosticsBridge } from "@/hooks/useDiagnosticsBridge"
import { useDependenciesMonitor } from "@/hooks/useDependenciesMonitor"
import { ensureVscodeServicesInitialized } from "@/lib/editor/vscodeServices"
import { setVscodeWorkspaceProjectPath } from "@/lib/editor/vscodeFileSystemBridge"
import { useProjectHeaderStore } from "@/stores/useProjectHeaderStore"
import { EditorTabs } from "@/features/editor/components/EditorTabs"
import { ProjectPathRecoveryScreen } from "../components/ProjectPathRecoveryScreen"
import { GripVertical, Loader2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { PresenceAvatarGroup } from "@/components/presence/PresenceAvatarGroup"
import type { PresenceUser } from "@/hooks/useProjectPresence"
import { hasRecentProjectOpenSync } from "@/features/projects/lib/recentProjectOpenSync"
import { logGitOpenDebug } from "@/lib/git/gitOpenDebug"
import { buildLegacyProjectPath, buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"

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

function getProjectSubpageLabel(pathname: string, basePath: string | null): string | null {
    if (!basePath) return null
    if (pathname === basePath || pathname === `${basePath}/`) return null

    if (!pathname.startsWith(basePath)) return null
    const rest = pathname.slice(basePath.length).replace(/^\/+/, "")
    const segment = rest.split("/")[0] ?? ""

    switch (segment) {
        case "pages":
            return "Previews"
        case "backend":
            return "Backend Studio"
        case "dependencies":
            return "Dependencies"
        case "changes":
            return "Changes"
        case "settings":
            return "Settings"
        case "team":
            return "Team"
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
    rightAddon?: ReactNode
    className?: string
    isSecondarySidebarVisible: boolean
    insetLeft?: number
    insetRight?: number
    compactHeaderActions?: boolean
    projectInviteContext?: {
        projectId: Id<"projects"> | null
        projectName?: string | null
    } | null
}

const ProjectLayoutHeader = memo(function ProjectLayoutHeader({
    breadcrumbs,
    header,
    breadcrumbAddon,
    rightAddon,
    className,
    isSecondarySidebarVisible,
    insetLeft = 0,
    insetRight = 0,
    compactHeaderActions = true,
    projectInviteContext = null,
}: ProjectLayoutHeaderProps) {
    const sidebar = useOptionalSidebar()
    const areAllSidebarsCollapsed = sidebar?.state === "collapsed" && !isSecondarySidebarVisible

    return (
        <UnifiedHeader
            breadcrumbs={breadcrumbs}
            header={header}
            breadcrumbAddon={breadcrumbAddon}
            rightAddon={rightAddon}
            className={className}
            leftWindowControlsInset={areAllSidebarsCollapsed}
            contentInsetLeft={insetLeft}
            contentInsetRight={insetRight}
            compactHeaderActions={compactHeaderActions}
            projectInviteContext={projectInviteContext}
        />
    )
})


interface ProjectLayoutProps {
    children?: ReactNode
    breadcrumbs?: { label: string; href?: string }[]
}

interface ProjectLayoutLocationState {
    syncMode?: 'replica' | 'git'
    pendingTeamSetup?: Array<{
        email: string
        name?: string
        role: 'project_manager' | 'developer' | 'designer' | 'viewer'
        isCurrentUser?: boolean
        profileImageUrl?: string | null
    }>
}

const FULLSCREEN_SIDEBAR_COLLAPSE_DELAY_MS = 70
const ASSISTANT_HISTORY_SIDEBAR_WIDTH_KEY = 'assistant-history-sidebar-width'
const ASSISTANT_HISTORY_SIDEBAR_DEFAULT_WIDTH = 224
const ASSISTANT_HISTORY_SIDEBAR_MIN_WIDTH = 200
const ASSISTANT_HISTORY_SIDEBAR_MAX_WIDTH = 320

interface SidebarFullscreenSyncProps {
    assistantPanelMode: 'closed' | 'panel' | 'fullscreen'
}

function SidebarFullscreenSync({ assistantPanelMode }: SidebarFullscreenSyncProps) {
    const sidebar = useOptionalSidebar()

    useEffect(() => {
        if (!sidebar) return

        const { isMobile, open, setOpen, setOpenMobile } = sidebar

        if (assistantPanelMode !== 'fullscreen') return

        if (isMobile) {
            setOpenMobile(false)
            return
        }

        if (!open) return

        const collapseTimer = window.setTimeout(() => {
            setOpen(false)
        }, FULLSCREEN_SIDEBAR_COLLAPSE_DELAY_MS)

        return () => {
            window.clearTimeout(collapseTimer)
        }
    }, [assistantPanelMode, sidebar])

    return null
}

export function ProjectLayout({
    children, // NOTE: Router uses Outlet, but we keep children in case used as wrapper
}: ProjectLayoutProps) {
    const isWindowsClient = typeof window !== "undefined" && window.electronAPI?.platform === "win32"
    const { convexUserId, user, logout } = useAuth()
    const { preferredConvexOrganizationId } = useScopedAppContext()
    const location = useLocation()
    const navigate = useViewTransitionNavigate()
    const { slug: routeSlug, projectId: routeProjectId } = useParams<{ slug?: string; projectId?: string }>()
    const locationState = (location.state as ProjectLayoutLocationState | null) ?? null
    const initialSyncMode = locationState?.syncMode ?? null

    const chatPanelMode = useChatPanelStore((state) => state.mode)
    const assistantPanelMode = useAssistantPanelStore((state) => state.mode)

    // Get project data (with caching)
    const freshProjectById = useQuery(
        api.projects.getAccessibleById,
        routeProjectId && convexUserId
            ? { projectId: routeProjectId as Id<"projects">, userId: convexUserId }
            : "skip"
    )
    const freshProjectBySlug = useQuery(
        api.projects.getAccessibleBySlug,
        !routeProjectId && routeSlug && convexUserId
            ? {
                slug: routeSlug,
                userId: convexUserId,
                preferredOrganizationId: preferredConvexOrganizationId,
            }
            : "skip"
    )
    const freshProject = routeProjectId
        ? freshProjectById
        : freshProjectBySlug?.status === "ok"
            ? freshProjectBySlug.project
            : null
    const project = useCachedQuery(
        `layout-project-${routeProjectId ?? routeSlug}`,
        freshProject
    )
    const projectIdForSyncBypass = routeProjectId ?? (project?._id ? String(project._id) : null)
    const shouldSkipInitialSyncCheck =
        initialSyncMode === 'git' ||
        project?.syncMode === 'git' ||
        (projectIdForSyncBypass ? hasRecentProjectOpenSync(projectIdForSyncBypass) : false)
    useEffect(() => {
        if (!project?._id) {
            return
        }

        logGitOpenDebug('project_layout:route_state', {
            projectId: String(project._id),
            routeProjectId: routeProjectId ?? null,
            routeSlug: routeSlug ?? null,
            syncMode: project.syncMode ?? null,
            initialSyncMode,
            shouldSkipInitialSyncCheck,
            projectIdForSyncBypass,
        })
    }, [initialSyncMode, project?._id, project?.syncMode, projectIdForSyncBypass, routeProjectId, routeSlug, shouldSkipInitialSyncCheck])
    const projectSlug = project?.slug ?? routeSlug ?? null
    const projectBasePath = routeProjectId
        ? buildProjectPath(routeProjectId)
        : project?._id
            ? buildProjectPath(String(project._id))
            : projectSlug
                ? buildLegacyProjectPath(projectSlug)
                : null

    // Get per-user local path for this project (machine-specific) (with caching)
    const freshMemberLocalPath = useQuery(
        api.projectMembers.getMemberLocalPath,
        project?._id && convexUserId
            ? { projectId: project._id, userId: convexUserId }
            : "skip"
    )
    const memberLocalPath = freshMemberLocalPath
    const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)
    const applyInitialTeamSetup = useMutation(api.projects.applyInitialTeamSetup)

    const [effectiveLocalPath, setEffectiveLocalPath] = useState<string | null>(null)
    const [pathRecoveryChoice, setPathRecoveryChoice] = useState<PathRecoveryChoice | null>(null)
    const [isResolvingPath, setIsResolvingPath] = useState(false)
    const [pathResolutionError, setPathResolutionError] = useState<string | null>(null)
    const appliedInitialTeamSetupKeysRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        setEffectiveLocalPath(null)
        setPathRecoveryChoice(null)
        setPathResolutionError(null)
    }, [project?._id, convexUserId, projectSlug])

    const pendingTeamSetup = locationState?.pendingTeamSetup ?? []
    const pendingTeamSetupReady =
        pendingTeamSetup.length > 0 &&
        project?._id &&
        convexUserId &&
        memberLocalPath !== undefined &&
        !isResolvingPath &&
        !pathResolutionError &&
        effectiveLocalPath !== null

    useEffect(() => {
        if (!pendingTeamSetupReady || !project?._id || !convexUserId) {
            return
        }

        const pendingKey = `${String(project._id)}:${pendingTeamSetup
            .map((member) => `${member.email}:${member.role}`)
            .sort()
            .join('|')}`

        if (appliedInitialTeamSetupKeysRef.current.has(pendingKey)) {
            return
        }
        appliedInitialTeamSetupKeysRef.current.add(pendingKey)

        let cancelled = false

        void (async () => {
            try {
                await applyInitialTeamSetup({
                    projectId: project._id,
                    actorUserId: convexUserId,
                    team: pendingTeamSetup,
                })

                if (cancelled) {
                    return
                }

                const nextState = locationState?.syncMode
                    ? { syncMode: locationState.syncMode }
                    : null
                navigate(`${location.pathname}${location.search}${location.hash}`, {
                    replace: true,
                    state: nextState,
                })
            } catch (error) {
                console.warn('[ProjectLayout] Failed to apply deferred initial team setup:', error)
                appliedInitialTeamSetupKeysRef.current.delete(pendingKey)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [
        applyInitialTeamSetup,
        convexUserId,
        effectiveLocalPath,
        isResolvingPath,
        location.hash,
        location.pathname,
        location.search,
        locationState?.syncMode,
        memberLocalPath,
        navigate,
        pathResolutionError,
        pendingTeamSetup,
        pendingTeamSetupReady,
        project?._id,
    ])

    const resolvePathPreference = useCallback(async () => {
        if (!project?._id || !convexUserId || !projectSlug) {
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
            const preferenceKey = buildPathPreferenceKey(project._id.toString(), convexUserId.toString())

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
                window.electronAPI.project.getLocalPath({
                    slug: projectSlug,
                    projectId: project?._id ? String(project._id) : undefined,
                }),
            ])

            if (!previousPathExists) {
                let nextPath = existingTargetPath
                if (!nextPath) {
                    const created = await window.electronAPI.project.createFolder({
                        slug: projectSlug,
                        initGit: true,
                    })
                    if (!created.success || !created.localPath) {
                        throw new Error(created.error || "Failed to create project folder in current directory")
                    }
                    nextPath = created.localPath
                }

                await updateMemberLocalPath({
                    projectId: project._id,
                    userId: convexUserId,
                    localPath: nextPath,
                })
                localStorage.removeItem(preferenceKey)
                setPathRecoveryChoice(null)
                setEffectiveLocalPath(nextPath)
                return
            }

            const targetPath =
                existingTargetPath ??
                `${projectsDirectory.replace(/[\\/]+$/, "")}/${projectSlug}`

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
    }, [convexUserId, memberLocalPath, project?._id, projectSlug, updateMemberLocalPath])

    useEffect(() => {
        void resolvePathPreference()
    }, [resolvePathPreference])

    const handleUsePreviousDirectory = useCallback(() => {
        if (!project?._id || !convexUserId || !pathRecoveryChoice) return
        const preferenceKey = buildPathPreferenceKey(project._id.toString(), convexUserId.toString())
        const payload: StoredPathPreference = {
            acceptedExternalPath: pathRecoveryChoice.previousPath,
            projectsDirectory: pathRecoveryChoice.projectsDirectory,
        }
        localStorage.setItem(preferenceKey, JSON.stringify(payload))
        setPathRecoveryChoice(null)
        setPathResolutionError(null)
        setEffectiveLocalPath(pathRecoveryChoice.previousPath)
    }, [convexUserId, pathRecoveryChoice, project?._id])

    const handleUseCurrentDirectory = useCallback(async () => {
        if (!project?._id || !convexUserId || !projectSlug || !pathRecoveryChoice) return

        setIsResolvingPath(true)
        setPathResolutionError(null)

        try {
            let targetPath = await window.electronAPI.project.getLocalPath({
                slug: projectSlug,
                projectId: project?._id ? String(project._id) : undefined,
            })
            if (!targetPath) {
                const created = await window.electronAPI.project.createFolder({
                    slug: projectSlug,
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
                userId: convexUserId,
                localPath: targetPath,
            })

            const preferenceKey = buildPathPreferenceKey(project._id.toString(), convexUserId.toString())
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
    }, [convexUserId, pathRecoveryChoice, project?._id, projectSlug, updateMemberLocalPath])

    const previousEffectivePathRef = useRef<string | null>(null)
    useEffect(() => {
        if (!projectSlug || !effectiveLocalPath) {
            previousEffectivePathRef.current = effectiveLocalPath
            return
        }

        const previousPath = previousEffectivePathRef.current
        previousEffectivePathRef.current = effectiveLocalPath

        if (previousPath && normalizePath(previousPath) === normalizePath(effectiveLocalPath)) {
            return
        }

        const fileTabsStore = useFileTabsStore.getState()
        fileTabsStore.actions.rebaseProjectPaths(projectSlug, previousPath, effectiveLocalPath)
    }, [effectiveLocalPath, projectSlug])

    useDiagnosticsBridge(effectiveLocalPath)
    useDependenciesMonitor(effectiveLocalPath)

    useEffect(() => {
        setVscodeWorkspaceProjectPath(effectiveLocalPath)
        if (effectiveLocalPath) {
            void ensureVscodeServicesInitialized()
        }
        return () => {
            setVscodeWorkspaceProjectPath(null)
        }
    }, [effectiveLocalPath])

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

    const activeProjectFile = useFileTabsStore((state) =>
        projectSlug ? state.projectTabs[projectSlug]?.activeFile ?? null : null
    )
    const currentPreviewPage = usePageContextStore((state) => state.currentPage)
    const isPagesRoute = Boolean(
        projectBasePath && location.pathname.startsWith(`${projectBasePath}/pages`)
    )
    const presenceActiveFile = isPagesRoute
        ? currentPreviewPage?.filePath ?? null
        : activeProjectFile
    const presenceActiveRoute = isPagesRoute
        ? currentPreviewPage?.route ?? null
        : null

    // Real-time presence tracking
    const { otherUsers: presenceUsers } = useProjectPresence({
        projectId: project?._id,
        userId: convexUserId,
        userName: user?.firstName || user?.email || null,
        userEmail: user?.email || null,
        userAvatarUrl: user?.profileImageUrl || null,
        activeFile: presenceActiveFile,
        activeRoute: presenceActiveRoute,
    })

    const handlePresenceUserClick = useCallback(
        (presenceUser: PresenceUser) => {
            if (!projectBasePath) return
            navigate(`${projectBasePath}/changes?userId=${encodeURIComponent(presenceUser.userId)}`)
        },
        [navigate, projectBasePath]
    )

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
    const projectTabs = useFileTabsStore(state => projectSlug ? state.projectTabs[projectSlug] : null)
    const hasOpenFiles = (projectTabs?.openFiles?.length || 0) > 0

    // Check if we are on views that need full-bleed content (no padding)
    const isPagesView = location.pathname.endsWith('/pages')
    const isBackendStudioView = location.pathname.endsWith('/backend')
    const isDependenciesView = location.pathname.endsWith('/dependencies')
    const isChangesView = location.pathname.endsWith('/changes')
    const isFilesView = Boolean(
        projectBasePath && (location.pathname === projectBasePath || location.pathname === `${projectBasePath}/`)
    )
    // Remove padding for Editor (has files), Pages, Studio, Dependencies, and Changes
    const shouldRemovePadding = hasOpenFiles || isPagesView || isBackendStudioView || isDependenciesView || isChangesView

    // Determine if we can enable sync (need project + user data + resolved path decision)
    const hasSyncIdentities = Boolean(project?._id && convexUserId && projectSlug) && memberLocalPath !== undefined
    const canSync = hasSyncIdentities && !isResolvingPath
    const {
        header: headerContent,
        breadcrumbAddon,
        hideBreadcrumbs,
        insetLeft,
        insetRight,
    } = useProjectHeaderStore(
        useShallow((state) => ({
            header: state.header,
            breadcrumbAddon: state.breadcrumbAddon,
            hideBreadcrumbs: state.hideBreadcrumbs,
            insetLeft: state.insetLeft,
            insetRight: state.insetRight,
        }))
    )

    // Main layout content
    const subpageLabel = useMemo(
        () => getProjectSubpageLabel(location.pathname, projectBasePath),
        [location.pathname, projectBasePath]
    )
    const breadcrumbs = useMemo(
        () =>
            (hideBreadcrumbs || isFilesView)
                ? []
                : [
                    { label: "Projects", href: "/projects" },
                    ...(project?.name ? [{ label: project.name, href: projectBasePath ?? undefined }] : []),
                    ...(subpageLabel ? [{ label: subpageLabel }] : []),
                ],
        [hideBreadcrumbs, isFilesView, project?.name, projectBasePath, subpageLabel]
    )
    const headerSlot = useMemo(
        () =>
            isFilesView ? (
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    {headerContent}
                    <div className="min-w-0 flex-1">
                        <EditorTabs />
                    </div>
                </div>
            ) : headerContent,
        [headerContent, isFilesView]
    )
    const [assistantHistorySidebarWidth, setAssistantHistorySidebarWidth] = useState(() => {
        if (typeof window === 'undefined') return ASSISTANT_HISTORY_SIDEBAR_DEFAULT_WIDTH
        const stored = localStorage.getItem(ASSISTANT_HISTORY_SIDEBAR_WIDTH_KEY)
        if (!stored) return ASSISTANT_HISTORY_SIDEBAR_DEFAULT_WIDTH
        const parsed = Number.parseInt(stored, 10)
        if (!Number.isFinite(parsed)) return ASSISTANT_HISTORY_SIDEBAR_DEFAULT_WIDTH
        return Math.max(
            ASSISTANT_HISTORY_SIDEBAR_MIN_WIDTH,
            Math.min(ASSISTANT_HISTORY_SIDEBAR_MAX_WIDTH, parsed)
        )
    })
    const [isResizingAssistantHistorySidebar, setIsResizingAssistantHistorySidebar] = useState(false)
    const assistantHistorySidebarWidthRef = useRef(assistantHistorySidebarWidth)
    const assistantHistoryPendingWidthRef = useRef<number | null>(null)
    const assistantHistoryResizeRafRef = useRef<number | null>(null)
    const assistantHistoryResizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null)

    useEffect(() => {
        assistantHistorySidebarWidthRef.current = assistantHistorySidebarWidth
    }, [assistantHistorySidebarWidth])

    const flushPendingAssistantHistoryWidth = useCallback(() => {
        if (assistantHistoryPendingWidthRef.current == null) return
        const nextWidth = assistantHistoryPendingWidthRef.current
        assistantHistoryPendingWidthRef.current = null
        if (nextWidth === assistantHistorySidebarWidthRef.current) return
        assistantHistorySidebarWidthRef.current = nextWidth
        setAssistantHistorySidebarWidth(nextWidth)
    }, [])

    useEffect(() => {
        if (!isResizingAssistantHistorySidebar) return

        const scheduleWidthUpdate = (width: number) => {
            assistantHistoryPendingWidthRef.current = width
            if (assistantHistoryResizeRafRef.current !== null) return
            assistantHistoryResizeRafRef.current = window.requestAnimationFrame(() => {
                assistantHistoryResizeRafRef.current = null
                flushPendingAssistantHistoryWidth()
            })
        }

        const handleMouseMove = (event: MouseEvent) => {
            const resizeStart = assistantHistoryResizeStartRef.current
            if (!resizeStart) return
            const delta = event.clientX - resizeStart.startX
            const nextWidth = resizeStart.startWidth + delta
            const clampedWidth = Math.max(
                ASSISTANT_HISTORY_SIDEBAR_MIN_WIDTH,
                Math.min(ASSISTANT_HISTORY_SIDEBAR_MAX_WIDTH, nextWidth)
            )
            scheduleWidthUpdate(Math.round(clampedWidth))
        }

        const handleMouseUp = () => {
            if (assistantHistoryResizeRafRef.current !== null) {
                window.cancelAnimationFrame(assistantHistoryResizeRafRef.current)
                assistantHistoryResizeRafRef.current = null
            }
            flushPendingAssistantHistoryWidth()
            setIsResizingAssistantHistorySidebar(false)
            assistantHistoryResizeStartRef.current = null
            localStorage.setItem(
                ASSISTANT_HISTORY_SIDEBAR_WIDTH_KEY,
                assistantHistorySidebarWidthRef.current.toString()
            )
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
            if (assistantHistoryResizeRafRef.current !== null) {
                window.cancelAnimationFrame(assistantHistoryResizeRafRef.current)
                assistantHistoryResizeRafRef.current = null
            }
        }
    }, [flushPendingAssistantHistoryWidth, isResizingAssistantHistorySidebar])

    useEffect(() => {
        return () => {
            if (assistantHistoryResizeRafRef.current !== null) {
                window.cancelAnimationFrame(assistantHistoryResizeRafRef.current)
            }
        }
    }, [])

    const handleAssistantHistoryResizeStart = useCallback((event: React.MouseEvent) => {
        event.preventDefault()
        assistantHistoryPendingWidthRef.current = null
        assistantHistoryResizeStartRef.current = {
            startX: event.clientX,
            startWidth: assistantHistorySidebarWidthRef.current,
        }
        setIsResizingAssistantHistorySidebar(true)
    }, [])

    const rightHeaderAddon = useMemo(
        () =>
            presenceUsers.length > 0 ? (
                <PresenceAvatarGroup
                    users={presenceUsers}
                    maxVisible={4}
                    onUserClick={handlePresenceUserClick}
                />
            ) : null,
        [handlePresenceUserClick, presenceUsers]
    )
    const showHeader =
        breadcrumbs.length > 0 ||
        Boolean(headerSlot) ||
        Boolean(breadcrumbAddon) ||
        Boolean(rightHeaderAddon)
    const isAnyPanelFullscreen = chatPanelMode === 'fullscreen' || assistantPanelMode === 'fullscreen'
    const showAssistantHistorySidebar = assistantPanelMode === 'fullscreen'

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
            <SidebarFullscreenSync assistantPanelMode={assistantPanelMode} />
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
                    {showAssistantHistorySidebar ? (
                        <div
                            style={{
                                "--sidebar-width": `${assistantHistorySidebarWidth}px`,
                                width: assistantHistorySidebarWidth,
                                minWidth: assistantHistorySidebarWidth,
                            } as React.CSSProperties}
                            className="relative hidden h-full shrink-0 overflow-hidden md:flex"
                        >
                            <ChatHistorySidebar projectId={project?._id ?? null} />
                            <div
                                onMouseDown={handleAssistantHistoryResizeStart}
                                className={cn(
                                    "absolute right-0 top-0 bottom-0 z-50 hidden w-1 cursor-col-resize md:block group",
                                    "hover:bg-primary/20 active:bg-primary/30",
                                    isResizingAssistantHistorySidebar && "bg-primary/30"
                                )}
                                aria-hidden="true"
                            >
                                <div
                                    className={cn(
                                        "absolute right-0 top-1/2 flex h-8 w-3 -translate-y-1/2 items-center justify-center rounded-sm bg-border opacity-0 transition-opacity",
                                        "group-hover:opacity-100",
                                        isResizingAssistantHistorySidebar && "opacity-100"
                                    )}
                                >
                                    <GripVertical className="h-3 w-3 text-muted-foreground" />
                                </div>
                            </div>
                        </div>
                    ) : null}
                    <SidebarInset
                        color="currentColor"
                        className="flex flex-row flex-1 min-w-0 overflow-hidden md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none"
                    >
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
                                rightAddon={rightHeaderAddon ?? undefined}
                                className={
                                    isPagesView
                                        ? isWindowsClient
                                            ? "bg-background/65 backdrop-blur-xl supports-[backdrop-filter]:bg-background/50"
                                            : "bg-transparent backdrop-blur-xl"
                                        : undefined
                                }
                                isSecondarySidebarVisible={isSecondarySidebarVisible}
                                insetLeft={insetLeft}
                                insetRight={insetRight}
                                compactHeaderActions={!isFilesView}
                                projectInviteContext={{
                                    projectId: project?._id ?? null,
                                    projectName: project?.name ?? null,
                                }}
                            />
                            <div
                                className={cn(
                                    // `min-w-0` prevents the main content from overflowing under the right panels
                                    // when it contains wide children (iframes, editors, etc.).
                                    "flex flex-1 flex-col min-h-0 min-w-0 overflow-y-auto overflow-x-hidden transition-all duration-300 ease-in-out",
                                    shouldRemovePadding ? "p-0" : "p-4",
                                    showHeader && "pt-10"
                                )}
                                style={undefined}
                            >
                                {children || <Outlet />}
                            </div>
                        </div>
                        <ChatPanel />
                        <AssistantPanel
                            className="[--assistant-surface:var(--content-surface)]"
                            projectPath={effectiveLocalPath ?? undefined}
                            projectId={project?._id ?? null}
                            projectName={project?.name}
                            projectSlug={projectSlug}
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
    if (canSync && project && convexUserId && projectSlug) {
        return (
            <ProjectSyncProvider
                key={project._id}
                projectId={project._id}
                userId={convexUserId}
                userName={user?.firstName || user?.email || "User"}
                projectSlug={projectSlug}
                localPath={effectiveLocalPath}
                lastSyncAt={project.lastSyncAt}
                onFilesChanged={handleRefreshFiles}
                skipInitialSyncCheck={shouldSkipInitialSyncCheck}
            >
                {layoutContent}
            </ProjectSyncProvider>
        )
    }

    // Render without sync if data isn't available yet
    return layoutContent
}
