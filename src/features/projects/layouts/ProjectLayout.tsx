"use client"

import { type ReactNode, memo, useRef, useCallback, useEffect, useMemo } from "react"
import { Outlet, useLocation, useParams } from '@/lib/router'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useMutation, useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useCachedQuery } from "@/stores/useQueryCache"
import { ProjectSidebar } from "../components/ProjectSidebar"
import {
    SidebarInset,
    SidebarProvider,
} from "@/components/ui/sidebar"
import { UnifiedHeader } from "@/components/layouts/UnifiedHeader"
import { StatusBar } from "@/components/StatusBar"
import { TerminalEventBridge } from "@/features/projects/components/TerminalEventBridge"
import { ProjectSyncIndicator } from "@/features/projects/components/ProjectSyncIndicator"
import { usePageContextStore } from "@/stores/usePageContextStore"
import { useTerminalStore } from "@/stores/useTerminalStore"
import { useAuth } from "@/contexts/AuthContext"
import { cn } from "@/lib/utils"
import { ProjectSyncProvider } from "../contexts/ProjectSyncContext"
import { useProjectPresence } from "@/hooks/useProjectPresence"
import { useDiagnosticsBridge } from "@/hooks/useDiagnosticsBridge"
import { ensureVscodeServicesInitialized } from "@/lib/editor/vscodeServices"
import { setVscodeWorkspaceProjectPath } from "@/lib/editor/vscodeFileSystemBridge"
import { useProjectHeaderStore } from "@/stores/useProjectHeaderStore"
import { Building2, FolderKanban, UserRound } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { PresenceAvatarGroup } from "@/components/presence/PresenceAvatarGroup"
import type { PresenceUser } from "@/hooks/useProjectPresence"
import { hasRecentProjectOpenSync } from "@/features/projects/lib/recentProjectOpenSync"
import { logGitOpenDebug } from "@/lib/git/gitOpenDebug"
import { buildLegacyProjectPath, buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import { useLocalProjectPath } from "@/features/projects/hooks/useLocalProjectPath"

function getProjectSubpageLabel(pathname: string, basePath: string | null): string | null {
    if (!basePath) return null
    if (pathname === basePath || pathname === `${basePath}/`) return null

    if (!pathname.startsWith(basePath)) return null
    const rest = pathname.slice(basePath.length).replace(/^\/+/, "")
    const segment = rest.split("/")[0] ?? ""

    switch (segment) {
        case "workbench":
            return "Workbench"
        case "pages":
            return "Workbench"
        case "changes":
            return "Workbench"
        case "conflicts":
            return "Conflicts"
        case "settings":
            return "Settings"
        case "team":
            return "Team"
        case "tasks":
            return "Workbench"
        default:
            return null
    }
}

interface ProjectLayoutHeaderProps {
    breadcrumbs: { label: string; href?: string }[]
    header?: ReactNode
    breadcrumbAddon?: ReactNode
    centerAddon?: ReactNode
    preSearchAddon?: ReactNode
    rightAddon?: ReactNode
    className?: string
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
    centerAddon,
    preSearchAddon,
    rightAddon,
    className,
    insetLeft = 0,
    insetRight = 0,
    compactHeaderActions = true,
    projectInviteContext = null,
}: ProjectLayoutHeaderProps) {
    return (
        <UnifiedHeader
            breadcrumbs={breadcrumbs}
            header={header}
            breadcrumbAddon={breadcrumbAddon}
            centerAddon={centerAddon}
            preSearchAddon={preSearchAddon}
            rightAddon={rightAddon}
            className={className}
            leftWindowControlsInset
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
    syncMode?: 'git'
    localPath?: string | null
    pendingTeamSetup?: Array<{
        email: string
        name?: string
        role: 'project_manager' | 'developer' | 'designer' | 'viewer'
        isCurrentUser?: boolean
        profileImageUrl?: string | null
    }>
}

export function ProjectLayout({
    children, // NOTE: Router uses Outlet, but we keep children in case used as wrapper
}: ProjectLayoutProps) {
    const { convexUserId, user, logout } = useAuth()
    const { preferredConvexOrganizationId, workspaceName, scopeKind } = useScopedAppContext()
    const location = useLocation()
    const navigate = useViewTransitionNavigate()
    const { slug: routeSlug, projectId: routeProjectId } = useParams()
    const locationState = (location.state as ProjectLayoutLocationState | null) ?? null
    const initialSyncMode = locationState?.syncMode ?? null

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

    const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)
    const applyInitialTeamSetup = useMutation(api.projects.applyInitialTeamSetup)
    const appliedInitialTeamSetupKeysRef = useRef<Set<string>>(new Set())
    const mirroredLocalPathRef = useRef<string | null>(null)
    const navigationLocalPath = locationState?.localPath ?? null
    const { localPath: effectiveLocalPath } = useLocalProjectPath({
        initialPath: navigationLocalPath,
        preferInitialPath: Boolean(navigationLocalPath),
        projectId: project?._id ? String(project._id) : routeProjectId,
        projectSlug,
    })

    const pendingTeamSetup = useMemo(() => locationState?.pendingTeamSetup ?? [], [locationState?.pendingTeamSetup])
    const pendingTeamSetupReady =
        pendingTeamSetup.length > 0 &&
        project?._id &&
        convexUserId

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

                const nextState = locationState?.syncMode || navigationLocalPath
                    ? {
                        syncMode: locationState?.syncMode,
                        localPath: navigationLocalPath,
                    }
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
        location.hash,
        location.pathname,
        location.search,
        navigationLocalPath,
        locationState?.syncMode,
        navigate,
        pendingTeamSetup,
        pendingTeamSetupReady,
        project?._id,
    ])

    const rememberResolvedProjectPath = useCallback(async (projectPath: string) => {
        if (!project?._id) {
            return
        }

        const result = await window.electronAPI.project.rememberLocalPath({
            projectId: String(project._id),
            projectPath,
        })

        if (!result.success) {
            console.warn("[ProjectLayout] Failed to persist local project path:", result.error)
        }
    }, [project?._id])

    useEffect(() => {
        if (!effectiveLocalPath || !project?._id || !convexUserId) {
            return
        }

        const mirrorKey = `${String(project._id)}:${convexUserId}:${effectiveLocalPath}`
        if (mirroredLocalPathRef.current === mirrorKey) {
            return
        }
        mirroredLocalPathRef.current = mirrorKey

        void rememberResolvedProjectPath(effectiveLocalPath)
        void updateMemberLocalPath({
            projectId: project._id,
            userId: convexUserId,
            localPath: effectiveLocalPath,
        }).catch((error) => {
            mirroredLocalPathRef.current = null
            console.warn("[ProjectLayout] Failed to mirror local project path to cloud metadata:", error)
        })
    }, [convexUserId, effectiveLocalPath, project?._id, rememberResolvedProjectPath, updateMemberLocalPath])

    useDiagnosticsBridge(effectiveLocalPath)

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
            useTerminalStore.getState().actions.resetProject(projectPath)
        }
    }, [effectiveLocalPath])

    const currentPreviewPage = usePageContextStore((state) => state.currentPage)
    const isPagesRoute = Boolean(
        projectBasePath && location.pathname.startsWith(`${projectBasePath}/pages`)
    )
    const presenceActiveFile = isPagesRoute
        ? currentPreviewPage?.filePath ?? null
        : null
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
            navigate(`${projectBasePath}/workbench?changes=1&userId=${encodeURIComponent(presenceUser.userId)}`)
        },
        [navigate, projectBasePath]
    )

    // Check if we are on views that need full-bleed content (no padding)
    const isWorkbenchView = location.pathname.endsWith('/workbench')
    const isPagesView = location.pathname.endsWith('/pages')
    const isChangesView = location.pathname.endsWith('/changes')
    const shouldRemovePadding = isWorkbenchView || isPagesView || isChangesView

    const {
        header: headerContent,
        breadcrumbAddon,
        centerAddon,
        hideBreadcrumbs,
        insetLeft,
        insetRight,
    } = useProjectHeaderStore(
        useShallow((state) => ({
            header: state.header,
            breadcrumbAddon: state.breadcrumbAddon,
            centerAddon: state.centerAddon,
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
            hideBreadcrumbs
                ? []
                : [
                    { label: "Projects", href: "/projects" },
                    ...(project?.name ? [{ label: project.name, href: projectBasePath ?? undefined }] : []),
                    ...(subpageLabel ? [{ label: subpageLabel }] : []),
                ],
        [hideBreadcrumbs, project?.name, projectBasePath, subpageLabel]
    )
    const headerSlot = headerContent

    const presenceHeaderAddon = useMemo(
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
        Boolean(presenceHeaderAddon)
    const workspaceIcon = scopeKind === 'personal' ? UserRound : Building2
    const statusBar = (
        <StatusBar
            leftAddon={
                project?._id ? (
                    <ProjectSyncIndicator variant="compact" className="h-5 w-5 rounded-sm bg-transparent" />
                ) : null
            }
            leftItems={
                project?.name
                    ? [
                        { icon: FolderKanban, label: project.name },
                        ...(subpageLabel ? [{ icon: FolderKanban, label: subpageLabel }] : []),
                    ]
                    : [{ icon: FolderKanban, label: subpageLabel ?? 'Projects' }]
            }
            rightItems={[
                { icon: workspaceIcon, label: workspaceName },
                { label: 'Cozea' },
            ]}
        />
    )

    const layoutContent = (
        <SidebarProvider>
            <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
                {/* Main content */}
                <div className="flex-1 flex min-h-0 overflow-hidden relative">
                    <ProjectSidebar
                        color="currentColor"
                        user={user}
                        onLogout={logout}
                        projectId={project?._id ?? null}
                    />
                    <SidebarInset
                        color="currentColor"
                        className="flex flex-col flex-1 min-w-0 overflow-hidden md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none"
                    >
                        <ProjectLayoutHeader
                            breadcrumbs={breadcrumbs}
                            header={headerSlot ?? undefined}
                            breadcrumbAddon={breadcrumbAddon ?? undefined}
                            centerAddon={centerAddon ?? undefined}
                            preSearchAddon={presenceHeaderAddon ?? undefined}
                        className="bg-background"
                            insetLeft={insetLeft}
                            insetRight={insetRight}
                            compactHeaderActions
                            projectInviteContext={{
                                projectId: project?._id ?? null,
                                projectName: project?.name ?? null,
                            }}
                        />
                        <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
                            <div
                                className={cn(
                                    // `min-w-0` prevents the main content from overflowing under the right panels
                                    // when it contains wide children (iframes, editors, etc.).
                                    "flex flex-1 flex-col min-h-0 min-w-0 overflow-y-auto overflow-x-hidden",
                                    shouldRemovePadding ? "p-0" : "p-4",
                                    showHeader && "pt-10"
                                )}
                            >
                                {children || <Outlet />}
                            </div>
                            <TerminalEventBridge />
                        </div>
                    </SidebarInset>
                </div >
                {statusBar}
            </div>
        </SidebarProvider >
    )

    return (
        <ProjectSyncProvider
            projectId={project?._id ?? null}
            userId={convexUserId ?? null}
            userName={user?.firstName || user?.email || "User"}
            projectSlug={projectSlug}
            localPath={effectiveLocalPath}
            lastSyncAt={project?.lastSyncAt}
            skipInitialSyncCheck={shouldSkipInitialSyncCheck}
        >
            {layoutContent}
        </ProjectSyncProvider>
    )
}
