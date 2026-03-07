import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import {
    useProjectPagesStore,
    type PreviewTimelineEvent,
    type ServerStatus,
} from '@/stores/useProjectPagesStore'
import { useProjectHeader } from '@/hooks/useProjectHeader'
import { usePageContextStore } from '@/stores/usePageContextStore'
import { useVisualEditorStore } from '@/stores/useVisualEditorStore'
import { useAssistantPanelStore, type PendingAttachment } from '@/stores/useAssistantPanelStore'
import { useProblemsStore } from '@/stores/useProblemsStore'
import { scanForRoutes } from '@/utils/routeScanner'
import { findBestPreviewRouteIndex, resolveNavigationPathFromBridge } from '@/lib/previewRouteMatching'
import {
    injectBridgeScript,
    sendBridgeMessage,
    type BridgeMessage,
    type SelectedElementData,
    type ElementContextMenuData,
} from '@/utils/previewBridge'
import { ServerControl } from '../components/ServerControl'
import { TaskFocusOverlay } from '../components/TaskFocusOverlay'
import { TerminalPanel } from '../components/TerminalPanel'
import { useOptionalProjectSyncContext } from '../contexts/ProjectSyncContext'
import { VisualEditorSidebar } from '@/components/visual-editor/VisualEditorSidebar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    FileText,
    Monitor,
    Tablet,
    Smartphone,
    ZoomIn,
    ZoomOut,
    RefreshCw,
    AppWindow,
    Loader2,
    LayoutGrid,
    ExternalLink,
    Sparkles,
    Camera,
    MousePointer2,
    CheckCircle2,
    ChevronDown,
    PanelLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { captureAndUploadProjectPreviewFromUrl } from '@/lib/captureProjectPreview'
import { CompactPresenceIndicator, type CompactPresenceUser } from '@/components/presence/CompactPresenceIndicator'
import type { PreviewFailureReason } from '@shared/electronApiTypes'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { getPreviewFailurePresentation } from '@/features/projects/lib/previewFailurePresentation'
import { buildProjectPath } from '@/features/projects/lib/projectRoutes'
import { resolveProjectSourcePath } from '@/features/projects/lib/projectSourcePath'
import type { TaskOverlayLocationState, TaskOverlayPayload } from '@/features/projects/lib/taskFocusOverlay'

interface ProjectPresenceUser extends CompactPresenceUser {
    id: string
    userEmail: string
    activeTab?: string
    activeFile?: string
    activeRoute?: string
}

function normalizeRoutePath(path?: string | null): string | null {
    if (!path) return null
    if (path === '/') return '/'
    return path.replace(/\/+$/, '')
}

function normalizePreviewPath(path?: string | null): string {
    if (!path) return '/'
    return path.startsWith('/') ? path : `/${path}`
}

function normalizeFilePath(path?: string | null): string | null {
    if (!path) return null
    return path.replace(/\\/g, '/')
}

function isChromeErrorUrl(url?: string | null): boolean {
    return typeof url === 'string' && url.startsWith('chrome-error://')
}

type PreviewEmbedMode = 'standard' | 'credentialless'

const BRIDGE_READY_TIMEOUT_MS = 2500
const MIN_ZOOM_PERCENT = 25
const MAX_ZOOM_PERCENT = 200
const ZOOM_STEP_PERCENT = 25

function resolvePreviewEmbedModeForRun(
    serverStatus: ServerStatus,
    runId: string | null,
    previewTimeline: PreviewTimelineEvent[]
): PreviewEmbedMode {
    if (serverStatus !== 'running' || !runId) return 'standard'

    for (let index = previewTimeline.length - 1; index >= 0; index -= 1) {
        const event = previewTimeline[index]
        if (event.category !== 'preview') continue
        if (event.runId !== runId) continue
        if (event.type !== 'fallback_mode') continue

        const targetMode = typeof event.details?.to === 'string' ? event.details.to : null
        if (targetMode === 'credentialless') return 'credentialless'
        if (targetMode === 'standard') return 'standard'
    }

    return 'standard'
}

export function ProjectPagesPage() {
    const navigate = useViewTransitionNavigate()
    const location = useLocation()
    const [searchParams, setSearchParams] = useSearchParams()
    const { project, projectIdParam, slugParam } = useAccessibleProject()
    const syncContext = useOptionalProjectSyncContext()
    const projectPath = syncContext?.projectPath ?? null
    const locationState = (location.state as TaskOverlayLocationState | null) ?? null
    const [taskOverlay, setTaskOverlay] = useState<TaskOverlayPayload | null>(
        () => locationState?.taskOverlay ?? null
    )

    // Store state
    const { routes, serverStatus, serverPort, serverLifecycle, previewReadiness, previewTimeline, actions } = useProjectPagesStore()
    const activeServerRunId = serverLifecycle.runId
    const togglePagesListOpen = actions.togglePagesListOpen
    const setCurrentPage = usePageContextStore((state) => state.setCurrentPage)
    const setInspectedElement = usePageContextStore((state) => state.setInspectedElement)
    const setSelectedElement = useVisualEditorStore((state) => state.setSelectedElement)
    const closeVisualEditor = useVisualEditorStore((state) => state.close)
    const inspectorSide = useVisualEditorStore((state) => state.inspectorSide)
    const visualEditorOpen = useVisualEditorStore((state) => state.isOpen)
    const visualEditorWidth = useVisualEditorStore((state) => state.panelWidth)
    const openWithScreenshot = useAssistantPanelStore((state) => state.openWithScreenshot)
    const closeAssistantPanel = useAssistantPanelStore((state) => state.close)
    const addRuntimeProblem = useProblemsStore((state) => state.actions.addRuntimeProblem)

    // Local state
    const [isScanningAI, setIsScanningAI] = useState(false)
    const [inspectorEnabled, setInspectorEnabled] = useState(false)
    const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false)
    const [bridgeReady, setBridgeReady] = useState(false)
    const [bridgeError, setBridgeError] = useState<string | null>(null)
    const [, setBridgeLogs] = useState<Array<{ time: Date; message: string; type: 'info' | 'error' | 'success' }>>([])
    const [previewEmbedMode, setPreviewEmbedMode] = useState<PreviewEmbedMode>(() =>
        resolvePreviewEmbedModeForRun(serverStatus, activeServerRunId, previewTimeline)
    )
    const [previewEmbedBlocked, setPreviewEmbedBlocked] = useState(false)
    const [previewReloadToken, setPreviewReloadToken] = useState(0)
    const [focusedPageIndex, setFocusedPageIndex] = useState<number | null>(() => {
        // Initialize from URL param if present
        const focus = searchParams.get('focus')
        return focus !== null ? parseInt(focus, 10) : null
    })
    const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
    const [zoom, setZoom] = useState(100)
    const [zoomInputValue, setZoomInputValue] = useState('100')
    const [inspectorContextMenu, setInspectorContextMenu] = useState<{
        open: boolean
        x: number
        y: number
        element: SelectedElementData
        reactComponentStack?: string[]
        reactSource?: { fileName?: string; lineNumber?: number; columnNumber?: number } | null
    } | null>(null)
    const thumbnailStripRef = useRef<HTMLDivElement>(null)
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const headerRef = useRef<HTMLDivElement>(null)
    const [headerWidth, setHeaderWidth] = useState<number>(0)
    const isMacClient = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
    const [toolbarTooltip, setToolbarTooltip] = useState<'screenshot' | 'inspector' | 'preview' | null>(null)
    const [cachedFocusedRoutePath, setCachedFocusedRoutePath] = useState<string | null>(null)
    const focusedIframeLoadedPathRef = useRef<string | null>(null)
    const focusedPreviewFrameName = 'cozea-focused-preview-frame'
    const bridgeReadyRef = useRef(false)
    const bridgeReadyTimeoutRef = useRef<number | null>(null)
    const previewFallbackAttemptRef = useRef(0)
    const nonFocusedEmbedProbeKeyRef = useRef<string | null>(null)
    const embedModeHydratedRunIdRef = useRef<string | null>(null)
    const previewCaptureScheduleKeyRef = useRef<string | null>(null)
    const latestPreviewCaptureStateRef = useRef<{
        serverStatus: ServerStatus
        serverPort: number | null
        projectId: string | null
        capture: (() => Promise<void>) | null
    }>({
        serverStatus,
        serverPort,
        projectId: project?._id ?? null,
        capture: null,
    })

    // Shift-to-inspect: track whether inspector was enabled via Shift key
    const [shiftInspectorActive, setShiftInspectorActive] = useState(false)
    const manualInspectorEnabled = useRef(false)

    useEffect(() => {
        // Keep task context through same-route search param cleanup after task-driven navigation.
        if (locationState?.taskOverlay) {
            setTaskOverlay(locationState.taskOverlay)
        }
    }, [locationState?.taskOverlay])

    // Derived state - must be before any effects that use it
    const focusedRoute = focusedPageIndex !== null ? routes[focusedPageIndex] : null
    const cachedFocusedRoute = useMemo(
        () => cachedFocusedRoutePath ? routes.find((route) => route.path === cachedFocusedRoutePath) ?? null : null,
        [routes, cachedFocusedRoutePath]
    )
    const previewRoute = focusedRoute ?? cachedFocusedRoute
    const focusedPreviewUrl = previewRoute && serverPort
        ? `http://localhost:${serverPort}${normalizePreviewPath(previewRoute.path)}`
        : null
    const useCredentiallessPreview = previewEmbedMode === 'credentialless'
    const credentiallessAttribute = useCredentiallessPreview ? '' : undefined
    const buildRoutePreviewUrl = useCallback(
        (routePath: string) => {
            if (!serverPort) return null
            return `http://localhost:${serverPort}${normalizePreviewPath(routePath)}`
        },
        [serverPort]
    )
    const defaultProjectPreviewPath = useMemo(() => {
        const homeRoute = routes.find((route) => normalizePreviewPath(route.path) === '/')
        return normalizePreviewPath(homeRoute?.path ?? routes[0]?.path ?? '/')
    }, [routes])
    const nonFocusedPreviewProbeUrl = useMemo(() => {
        return buildRoutePreviewUrl(defaultProjectPreviewPath)
    }, [buildRoutePreviewUrl, defaultProjectPreviewPath])
    const compatProjectPreviewPath = normalizePreviewPath(previewRoute?.path ?? defaultProjectPreviewPath)
    const projectPreviewCapturePath = useCredentiallessPreview ? compatProjectPreviewPath : defaultProjectPreviewPath
    const projectPreviewCaptureUrl = buildRoutePreviewUrl(projectPreviewCapturePath)
    const previewRouteIndex = useMemo(() => {
        if (focusedPageIndex !== null) return focusedPageIndex
        if (!previewRoute) return null
        const index = routes.findIndex((route) => route.path === previewRoute.path)
        return index >= 0 ? index : null
    }, [focusedPageIndex, previewRoute, routes])
    const previewReady = bridgeReady && previewReadiness.reachable && !previewEmbedBlocked
    const recentPreviewTimeline = useMemo(() => {
        return previewTimeline
            .filter((event) => event.category === 'preview' && (!activeServerRunId || !event.runId || event.runId === activeServerRunId))
            .slice(-6)
            .reverse()
    }, [activeServerRunId, previewTimeline])
    const hasPreviewFailure = Boolean(bridgeError || previewReadiness.lastFailureMessage || previewReadiness.lastFailureReason)
    const previewFailurePresentation = useMemo(() => {
        if (!hasPreviewFailure) return null

        return getPreviewFailurePresentation(
            previewReadiness.lastFailureReason,
            bridgeError ?? previewReadiness.lastFailureMessage,
            { blocked: previewEmbedBlocked, context: 'preview' }
        )
    }, [
        bridgeError,
        hasPreviewFailure,
        previewEmbedBlocked,
        previewReadiness.lastFailureMessage,
        previewReadiness.lastFailureReason,
    ])
    const showPreviewFailureOverlay = serverStatus === 'running' && (
        previewFailurePresentation?.blocked || previewFailurePresentation?.reason === 'network_quality_degraded'
    )
    const isFocusedPreview = focusedPageIndex !== null && Boolean(focusedRoute)
    const shouldElevateInspectorSidebar = isFocusedPreview && visualEditorOpen
    const headerInsetLeft = isFocusedPreview && visualEditorOpen && inspectorSide === 'left' ? visualEditorWidth : 0
    const headerInsetRight = isFocusedPreview && visualEditorOpen && inspectorSide === 'right' ? visualEditorWidth : 0
    const prevProjectPathRef = useRef<string | null>(null)

    const clampZoomPercent = useCallback((value: number) => {
        return Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, Math.round(value)))
    }, [])

    const handleZoomStepDown = useCallback(() => {
        setZoom((previous) => clampZoomPercent(previous - ZOOM_STEP_PERCENT))
    }, [clampZoomPercent])

    const handleZoomStepUp = useCallback(() => {
        setZoom((previous) => clampZoomPercent(previous + ZOOM_STEP_PERCENT))
    }, [clampZoomPercent])

    const commitZoomInput = useCallback(() => {
        const normalized = zoomInputValue.replace('%', '').trim()
        if (!normalized) {
            setZoomInputValue(String(zoom))
            return
        }

        const parsed = Number(normalized)
        if (!Number.isFinite(parsed)) {
            setZoomInputValue(String(zoom))
            return
        }

        const nextZoom = clampZoomPercent(parsed)
        setZoom(nextZoom)
        setZoomInputValue(String(nextZoom))
    }, [clampZoomPercent, zoom, zoomInputValue])

    useEffect(() => {
        setZoomInputValue(String(zoom))
    }, [zoom])

    useEffect(() => {
        if (focusedRoute?.path) {
            setCachedFocusedRoutePath(focusedRoute.path)
        }
    }, [focusedRoute?.path])

    useEffect(() => {
        if (serverStatus !== 'running' || !activeServerRunId) {
            embedModeHydratedRunIdRef.current = null
            return
        }

        if (embedModeHydratedRunIdRef.current === activeServerRunId) return
        embedModeHydratedRunIdRef.current = activeServerRunId

        const resolvedMode = resolvePreviewEmbedModeForRun(
            serverStatus,
            activeServerRunId,
            previewTimeline
        )
        setPreviewEmbedMode(resolvedMode)
    }, [activeServerRunId, previewTimeline, serverStatus])

    useEffect(() => {
        if (!cachedFocusedRoutePath) return
        const stillExists = routes.some((route) => route.path === cachedFocusedRoutePath)
        if (!stillExists) {
            setCachedFocusedRoutePath(null)
            focusedIframeLoadedPathRef.current = null
        }
    }, [routes, cachedFocusedRoutePath])

    useEffect(() => {
        const el = headerRef.current
        if (!el) return

        setHeaderWidth(Math.round(el.getBoundingClientRect().width))

        const resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0]
            if (!entry) return
            setHeaderWidth(Math.round(entry.contentRect.width))
        })

        resizeObserver.observe(el)
        return () => resizeObserver.disconnect()
    }, [])

    const toolbarDensity = useMemo<'full' | 'compact' | 'minimal'>(() => {
        if (headerWidth >= 860) return 'full'
        if (headerWidth >= 640) return 'compact'
        return 'minimal'
    }, [headerWidth])

    // Reset project-scoped UI state when switching projects (prevents "wrong project" preview/terminals)
    useEffect(() => {
        const prev = prevProjectPathRef.current
        if (prev && prev !== projectPath) {
            // Clear page routes and focused selection
            actions.setRoutes([])
            setFocusedPageIndex(null)
            setCachedFocusedRoutePath(null)
            focusedIframeLoadedPathRef.current = null
        }

        prevProjectPathRef.current = projectPath
    }, [projectPath, actions])

    const projectBasePath = useMemo(() => {
        if (project?._id) return buildProjectPath(String(project._id))
        if (projectIdParam) return buildProjectPath(projectIdParam)
        return slugParam ? `/projects/${slugParam}` : null
    }, [project?._id, projectIdParam, slugParam])

    const projectPresenceUsers = useQuery(
        api.projectPresence.getActiveUsers,
        project?._id ? { projectId: project._id } : 'skip'
    ) as ProjectPresenceUser[] | undefined

    const { presenceByRoutePath, presenceByFilePath } = useMemo(() => {
        const byRoutePath = new Map<string, ProjectPresenceUser[]>()
        const byFilePath = new Map<string, ProjectPresenceUser[]>()

        for (const user of projectPresenceUsers ?? []) {
            if (user.activeTab !== 'pages') continue

            const routeKey = normalizeRoutePath(user.activeRoute)
            if (routeKey) {
                const existing = byRoutePath.get(routeKey) ?? []
                existing.push(user)
                byRoutePath.set(routeKey, existing)
            }

            const fileKey = normalizeFilePath(user.activeFile)
            if (fileKey) {
                const existing = byFilePath.get(fileKey) ?? []
                existing.push(user)
                byFilePath.set(fileKey, existing)
            }
        }

        const sortByRecent = (users: ProjectPresenceUser[]) =>
            users.sort(
                (a, b) =>
                    (b.lastActivityAt ?? b.lastHeartbeat) -
                    (a.lastActivityAt ?? a.lastHeartbeat)
            )

        for (const users of byRoutePath.values()) {
            sortByRecent(users)
        }

        for (const users of byFilePath.values()) {
            sortByRecent(users)
        }

        return {
            presenceByRoutePath: byRoutePath,
            presenceByFilePath: byFilePath,
        }
    }, [projectPresenceUsers])

    const getRoutePresenceUsers = useCallback(
        (routePath: string, routeFile: string) => {
            const byRoute = presenceByRoutePath.get(normalizeRoutePath(routePath) ?? '')
            if (byRoute && byRoute.length > 0) {
                return byRoute
            }

            const byFile = presenceByFilePath.get(normalizeFilePath(routeFile) ?? '')
            return byFile ?? []
        },
        [presenceByFilePath, presenceByRoutePath]
    )

    const generatePreviewUploadUrl = useMutation(api.projects.generatePreviewUploadUrl)
    const updatePreviewImage = useMutation(api.projects.updatePreviewImage)

    // Extract stored framework info from project
    const storedFrameworkInfo = useMemo(() => {
        if (!project?.frameworkInfo) return null
        return {
            framework: project.frameworkInfo.framework,
            devCommand: project.frameworkInfo.devCommand,
            devPort: project.frameworkInfo.devPort,
        }
    }, [project?.frameworkInfo])

    const refreshRoutes = useCallback(async () => {
        if (!projectPath) return
        const result = await scanForRoutes(projectPath, storedFrameworkInfo)
        actions.setRoutes(result.routes.map(r => ({ ...r, status: 'active' as const })))
    }, [actions, projectPath, storedFrameworkInfo])

    // Scan for routes when project loads
    useEffect(() => {
        if (projectPath) {
            refreshRoutes()
        }
    }, [projectPath, refreshRoutes])

    // Capture home page screenshot and upload as project preview (for Projects dashboard showcase)
    const [isCapturingPreview, setIsCapturingPreview] = useState(false)
    const captureAndUploadProjectPreview = useCallback(async () => {
        const projectId = project?._id
        if (!projectId || !projectPreviewCaptureUrl) return
        try {
            await captureAndUploadProjectPreviewFromUrl(
                projectId,
                projectPreviewCaptureUrl,
                generatePreviewUploadUrl,
                updatePreviewImage
            )
        } catch {
            // Silent: preview capture is best-effort for dashboard
        } finally {
            setIsCapturingPreview(false)
        }
    }, [project?._id, projectPreviewCaptureUrl, generatePreviewUploadUrl, updatePreviewImage])

    const handleUpdateProjectPreview = useCallback(() => {
        if (serverStatus !== 'running' || !project?._id) return
        setIsCapturingPreview(true)
        void captureAndUploadProjectPreview()
    }, [serverStatus, project?._id, captureAndUploadProjectPreview])

    // When dev server becomes ready, capture home page (showcase for Projects page) after delay; retry once later
    useEffect(() => {
        if (serverStatus !== 'running' || !serverPort || !project?._id || !activeServerRunId) {
            previewCaptureScheduleKeyRef.current = null
            return
        }
        const scheduleKey = `${activeServerRunId}:${projectPreviewCapturePath}`
        if (previewCaptureScheduleKeyRef.current === scheduleKey) return
        previewCaptureScheduleKeyRef.current = scheduleKey
        const t1 = setTimeout(() => {
            void captureAndUploadProjectPreview()
        }, 6000)
        const t2 = setTimeout(() => {
            void captureAndUploadProjectPreview()
        }, 14000)
        return () => {
            clearTimeout(t1)
            clearTimeout(t2)
        }
    }, [
        activeServerRunId,
        serverStatus,
        serverPort,
        project?._id,
        projectPreviewCapturePath,
        captureAndUploadProjectPreview,
    ])

    useEffect(() => {
        latestPreviewCaptureStateRef.current = {
            serverStatus,
            serverPort,
            projectId: project?._id ?? null,
            capture: captureAndUploadProjectPreview,
        }
    }, [captureAndUploadProjectPreview, project?._id, serverPort, serverStatus])

    // On exit from Pages page: capture latest home page and replace project showcase
    useEffect(() => {
        return () => {
            const latest = latestPreviewCaptureStateRef.current
            if (latest.serverStatus === 'running' && latest.serverPort && latest.projectId) {
                void latest.capture?.()
            }
        }
    }, [])

    // Handle route/focus query params from external navigation
    useEffect(() => {
        const routeParam = searchParams.get('route')
        const focus = searchParams.get('focus')
        if (routes.length > 0 && (routeParam !== null || focus !== null)) {
            let resolvedIndex: number | null = null

            if (routeParam !== null) {
                const normalizedRoute = normalizePreviewPath(routeParam)
                const routeIndex = routes.findIndex(
                    (route) => normalizePreviewPath(route.path) === normalizedRoute
                )
                if (routeIndex >= 0) {
                    resolvedIndex = routeIndex
                }
            }

            if (resolvedIndex === null && focus !== null) {
                const index = parseInt(focus, 10)
                if (index >= 0 && index < routes.length) {
                    resolvedIndex = index
                }
            }

            if (resolvedIndex !== null) {
                setFocusedPageIndex(resolvedIndex)
            }

            const nextParams = new URLSearchParams(searchParams)
            nextParams.delete('route')
            nextParams.delete('focus')
            setSearchParams(nextParams, { replace: true })
        }
    }, [searchParams, routes, setSearchParams])

    // When closing the inspector (X, Escape), disable inspector, close sidebar and context menu
    const handleCloseInspectorSidebar = useCallback(() => {
        setInspectorEnabled(false)
        manualInspectorEnabled.current = false // allow Shift-to-inspect to work again
        setSelectedElement(null)
        setInspectedElement(null)
        setInspectorContextMenu(null)
        closeVisualEditor()
    }, [setSelectedElement, setInspectedElement, closeVisualEditor])

    // Arrow keys for navigation in focused view
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement
            const isInteractiveElement =
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.tagName === 'SELECT' ||
                target.isContentEditable ||
                target.closest('[contenteditable="true"]')

            if (focusedPageIndex !== null && !isInteractiveElement) {
                if (e.key === 'ArrowLeft') {
                    setFocusedPageIndex(prev => prev !== null && prev > 0 ? prev - 1 : routes.length - 1)
                } else if (e.key === 'ArrowRight') {
                    setFocusedPageIndex(prev => prev !== null && prev < routes.length - 1 ? prev + 1 : 0)
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [focusedPageIndex, routes.length])

    // Scroll thumbnail into view when focused page changes
    useEffect(() => {
        if (focusedPageIndex !== null && thumbnailStripRef.current) {
            const thumbnail = thumbnailStripRef.current.children[focusedPageIndex] as HTMLElement
            if (thumbnail) {
                thumbnail.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
            }
        }
    }, [focusedPageIndex])

    // Update page context when focused route changes
    useEffect(() => {
        if (focusedRoute) {
            setCurrentPage({
                route: focusedRoute.path,
                filePath: focusedRoute.file,
                componentName: focusedRoute.name,
                serverPort: serverPort ?? undefined,
                lastUpdated: Date.now(),
            })
        } else {
            setCurrentPage(null)
        }
    }, [focusedRoute, serverPort, setCurrentPage])

    useEffect(() => {
        return () => {
            setCurrentPage(null)
        }
    }, [setCurrentPage])

    // Add a log entry
    const addBridgeLog = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info') => {
        setBridgeLogs(prev => [...prev.slice(-9), { time: new Date(), message, type }])
    }, [])

    const addPreviewTimelineEvent = useCallback((event: {
        type: 'probe_succeeded' | 'probe_failed' | 'iframe_loaded' | 'bridge_inject_succeeded' | 'bridge_inject_failed' | 'bridge_ready' | 'bridge_timeout' | 'fallback_mode' | 'iframe_error'
        message: string
        details?: Record<string, unknown>
    }) => {
        actions.addPreviewTimelineEvent({
            category: 'preview',
            runId: activeServerRunId,
            type: event.type,
            message: event.message,
            details: event.details,
        })
    }, [actions, activeServerRunId])

    const setPreviewFailure = useCallback((reason: PreviewFailureReason, message: string, blocked: boolean) => {
        const failure = getPreviewFailurePresentation(reason, message, { blocked, context: 'preview' })
        setBridgeError(failure.message)
        setPreviewEmbedBlocked(failure.blocked)
        actions.setPreviewReadiness({
            runId: activeServerRunId,
            bridgeReady: false,
            embedded: false,
            lastCheckedAt: Date.now(),
            lastFailureReason: failure.reason,
            lastFailureMessage: failure.message,
        })
    }, [actions, activeServerRunId])

    const clearBridgeReadyTimeout = useCallback(() => {
        if (bridgeReadyTimeoutRef.current !== null) {
            window.clearTimeout(bridgeReadyTimeoutRef.current)
            bridgeReadyTimeoutRef.current = null
        }
    }, [])

    const probeFocusedPreviewReachability = useCallback(async (
        url: string,
        source: 'iframe-load' | 'manual-retry' | 'state-sync'
    ): Promise<boolean> => {
        if (!window.electronAPI?.preview?.probeUrl) {
            actions.setPreviewReadiness({
                runId: activeServerRunId,
                reachable: true,
                lastCheckedAt: Date.now(),
            })
            return true
        }

        try {
            const probe = await window.electronAPI.preview.probeUrl({
                url,
                timeoutMs: 2500,
            })

            if (probe.success && probe.reachable) {
                actions.setPreviewReadiness({
                    runId: activeServerRunId,
                    reachable: true,
                    lastCheckedAt: Date.now(),
                    lastFailureReason: null,
                    lastFailureMessage: null,
                })
                addPreviewTimelineEvent({
                    type: 'probe_succeeded',
                    message: `Preview reachable (${source})`,
                    details: {
                        source,
                        statusCode: probe.statusCode,
                    },
                })
                return true
            }

            const failure = getPreviewFailurePresentation(
                probe.reason ?? 'server_unreachable',
                probe.error || 'Preview URL is unreachable',
                { context: 'preview' }
            )
            setPreviewFailure(failure.reason, failure.message, failure.blocked)
            addPreviewTimelineEvent({
                type: 'probe_failed',
                message: failure.message,
                details: {
                    source,
                    reason: failure.reason,
                    rawError: probe.error ?? undefined,
                },
            })
            return false
        } catch (error) {
            const failure = getPreviewFailurePresentation(
                'server_unreachable',
                error instanceof Error ? error.message : 'Preview probe failed',
                { context: 'preview' }
            )
            setPreviewFailure(failure.reason, failure.message, failure.blocked)
            addPreviewTimelineEvent({
                type: 'probe_failed',
                message: failure.message,
                details: {
                    source,
                    reason: failure.reason,
                },
            })
            return false
        }
    }, [actions, activeServerRunId, addPreviewTimelineEvent, setPreviewFailure])

    const scheduleBridgeReadyTimeout = useCallback((mode: PreviewEmbedMode) => {
        clearBridgeReadyTimeout()
        bridgeReadyTimeoutRef.current = window.setTimeout(() => {
            if (bridgeReadyRef.current) return

            addPreviewTimelineEvent({
                type: 'bridge_timeout',
                message: `Bridge handshake timed out in ${mode} mode`,
                details: { mode },
            })
            actions.setPreviewReadiness({
                runId: activeServerRunId,
                bridgeReady: false,
                embedded: false,
                lastCheckedAt: Date.now(),
                lastFailureReason: 'bridge_timeout',
                lastFailureMessage: 'Bridge handshake timed out',
            })

            if (mode === 'standard') {
                if (previewFallbackAttemptRef.current < 1) {
                    previewFallbackAttemptRef.current += 1
                    addBridgeLog('Bridge handshake timed out; switching preview to credentialless mode', 'info')
                    addPreviewTimelineEvent({
                        type: 'fallback_mode',
                        message: 'Switching preview to credentialless fallback mode',
                        details: { from: 'standard', to: 'credentialless', reason: 'bridge_timeout' },
                    })
                    setPreviewEmbedMode('credentialless')
                    setPreviewEmbedBlocked(false)
                    setBridgeError(null)
                    setPreviewReloadToken((value) => value + 1)
                    return
                }
            }

            addBridgeLog('Bridge handshake timed out in credentialless mode; preview marked blocked', 'error')
            setPreviewFailure(
                'bridge_timeout',
                'Embedded preview is blocked by this page policy. Use Open to view it externally.',
                true
            )
        }, BRIDGE_READY_TIMEOUT_MS)
    }, [actions, activeServerRunId, addBridgeLog, addPreviewTimelineEvent, clearBridgeReadyTimeout, setPreviewFailure])

    useEffect(() => {
        bridgeReadyRef.current = bridgeReady
    }, [bridgeReady])

    useEffect(() => {
        return () => {
            clearBridgeReadyTimeout()
        }
    }, [clearBridgeReadyTimeout])

    useEffect(() => {
        if (serverStatus === 'running') return
        clearBridgeReadyTimeout()
        setBridgeReady(false)
        setPreviewEmbedBlocked(false)
        previewFallbackAttemptRef.current = 0
        actions.resetPreviewReadiness()
    }, [actions, clearBridgeReadyTimeout, serverStatus])

    useEffect(() => {
        if (!isFocusedPreview || !focusedPreviewUrl) return
        if (serverStatus !== 'running') return
        void probeFocusedPreviewReachability(focusedPreviewUrl, 'state-sync')
    }, [focusedPreviewUrl, isFocusedPreview, probeFocusedPreviewReachability, serverStatus])

    useEffect(() => {
        if (serverStatus !== 'running') {
            nonFocusedEmbedProbeKeyRef.current = null
            return
        }
        if (isFocusedPreview) return
        if (previewEmbedMode !== 'standard') return
        if (!nonFocusedPreviewProbeUrl) return
        if (!window.electronAPI?.preview?.injectBridge) return

        const probeKey = `${activeServerRunId ?? 'unknown'}:${nonFocusedPreviewProbeUrl}`
        if (nonFocusedEmbedProbeKeyRef.current === probeKey) return
        nonFocusedEmbedProbeKeyRef.current = probeKey

        let cancelled = false
        const runProbe = async () => {
            for (let attempt = 0; attempt < 4; attempt += 1) {
                if (cancelled) return

                const result = await window.electronAPI.preview.injectBridge({
                    url: nonFocusedPreviewProbeUrl,
                })

                if (cancelled) return

                if (result.success) {
                    addPreviewTimelineEvent({
                        type: 'bridge_inject_succeeded',
                        message: 'Non-focused preview probe succeeded',
                        details: {
                            mode: 'standard',
                            source: 'grid-probe',
                            attempt: attempt + 1,
                        },
                    })
                    return
                }

                const reason = result.reason ?? 'bridge_injection_failed'
                const likelyBlocked = Boolean(
                    result.likelyBlocked ?? (reason === 'blocked_response' || reason === 'chrome_error_document')
                )

                if (likelyBlocked) {
                    previewFallbackAttemptRef.current += 1
                    addBridgeLog('Detected blocked standard embed in grid view; switching to credentialless mode', 'info')
                    addPreviewTimelineEvent({
                        type: 'fallback_mode',
                        message: 'Grid preview probe switched to credentialless mode',
                        details: {
                            from: 'standard',
                            to: 'credentialless',
                            reason,
                            source: 'grid-probe',
                        },
                    })
                    setPreviewEmbedMode('credentialless')
                    setPreviewEmbedBlocked(false)
                    setBridgeError(null)
                    setPreviewReloadToken((value) => value + 1)
                    return
                }

                if (attempt < 3) {
                    await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)))
                }
            }
        }

        void runProbe()
        return () => {
            cancelled = true
        }
    }, [
        activeServerRunId,
        addBridgeLog,
        addPreviewTimelineEvent,
        isFocusedPreview,
        nonFocusedPreviewProbeUrl,
        previewEmbedMode,
        serverStatus,
    ])

    // Listen for bridge messages from iframe
    useEffect(() => {
        const getSourceWindowName = (source: MessageEventSource | null): string | null => {
            if (!source) return null
            try {
                const name = (source as { name?: unknown }).name
                return typeof name === 'string' && name.length > 0 ? name : null
            } catch {
                return null
            }
        }

        const handleMessage = (event: MessageEvent<BridgeMessage>) => {
            const messageType = typeof event.data?.type === 'string' ? event.data.type : null
            const bridgeMeta = event.data?.__cozeaBridgeMeta
            const activePreviewWindow = iframeRef.current?.contentWindow
            const sourceWindowName = getSourceWindowName(event.source)
            const sourceMatchesActiveWindow = Boolean(activePreviewWindow && event.source === activePreviewWindow)
            const sourceMatchesByFrameName = sourceWindowName === focusedPreviewFrameName
            const sourceMatchesByBridgeMeta = bridgeMeta?.frameName === focusedPreviewFrameName

            if (
                activePreviewWindow &&
                !sourceMatchesActiveWindow &&
                !sourceMatchesByFrameName &&
                !sourceMatchesByBridgeMeta
            ) {
                if (messageType === 'bridge:ready') {
                    addBridgeLog(
                        `Ignoring bridge:ready from non-focused source (sourceName=${sourceWindowName ?? 'unknown'}, metaFrame=${bridgeMeta?.frameName ?? 'none'}, origin=${event.origin})`,
                        'error'
                    )
                }
                return
            }

            if (messageType === 'bridge:ready' && !sourceMatchesActiveWindow) {
                const via = sourceMatchesByBridgeMeta ? 'bridge-meta' : sourceMatchesByFrameName ? 'source-window-name' : 'unknown'
                addBridgeLog(`Accepted bridge:ready via ${via} fallback`)
            }
            const { type, payload } = event.data || {}

            switch (type) {
                case 'bridge:close-inspector':
                    handleCloseInspectorSidebar()
                    break

                case 'bridge:shift-keydown':
                    if (!isFocusedPreview) break
                    // Shift pressed in iframe: enable inspector (same as window Shift keydown)
                    if (!manualInspectorEnabled.current && previewReady) {
                        setShiftInspectorActive(true)
                        setInspectorEnabled(true)
                    }
                    break

                case 'bridge:shift-keyup':
                    if (!isFocusedPreview) break
                    // Shift released in iframe: only disable inspector if no element selected
                    if (shiftInspectorActive) {
                        const hasSelection = !!useVisualEditorStore.getState().selectedElement
                        setShiftInspectorActive(false)
                        if (!hasSelection) {
                            setInspectorEnabled(false)
                            setSelectedElement(null)
                            setInspectedElement(null)
                            closeVisualEditor()
                        } else {
                            manualInspectorEnabled.current = true // keep inspector on for selected element
                        }
                    }
                    break

                case 'bridge:ready':
                    if (isChromeErrorUrl(typeof bridgeMeta?.href === 'string' ? bridgeMeta.href : null)) {
                        clearBridgeReadyTimeout()
                        setBridgeReady(false)
                        addBridgeLog(`Ignoring bridge:ready from Chromium error document (${bridgeMeta?.href})`, 'error')
                        addPreviewTimelineEvent({
                            type: 'bridge_inject_failed',
                            message: 'Bridge ready came from Chromium error document',
                            details: {
                                href: bridgeMeta?.href,
                            },
                        })

                        if (previewEmbedMode === 'standard') {
                            previewFallbackAttemptRef.current += 1
                            addBridgeLog('Detected blocked standard iframe load; retrying in credentialless mode', 'info')
                            addPreviewTimelineEvent({
                                type: 'fallback_mode',
                                message: 'Switching to credentialless mode after blocked standard iframe',
                                details: {
                                    from: 'standard',
                                    to: 'credentialless',
                                    reason: 'blocked_response',
                                },
                            })
                            setPreviewEmbedMode('credentialless')
                            setPreviewEmbedBlocked(false)
                            setBridgeError(null)
                            setPreviewReloadToken((value) => value + 1)
                            break
                        }

                        setPreviewFailure(
                            'blocked_response',
                            'Embedded preview was blocked by response policy (ERR_BLOCKED_BY_RESPONSE). Use Open to view it externally.',
                            true
                        )
                        break
                    }

                    // Bridge is ready
                    clearBridgeReadyTimeout()
                    setBridgeReady(true)
                    setPreviewEmbedBlocked(false)
                    setBridgeError(null)
                    previewFallbackAttemptRef.current = 0
                    actions.setPreviewReadiness({
                        runId: activeServerRunId,
                        bridgeReady: true,
                        embedded: true,
                        lastCheckedAt: Date.now(),
                        lastFailureReason: null,
                        lastFailureMessage: null,
                    })
                    addPreviewTimelineEvent({
                        type: 'bridge_ready',
                        message: 'Bridge handshake completed',
                        details: {
                            frameName: bridgeMeta?.frameName,
                            href: bridgeMeta?.href,
                        },
                    })
                    addBridgeLog(`bridge:ready received for ${previewRoute?.path ?? 'unknown route'}`, 'success')
                    setBridgeLogs(prev => [...prev.slice(-9), { time: new Date(), message: 'Bridge connected successfully!', type: 'success' }])
                    // Enable inspector if it was already enabled
                    if (inspectorEnabled && iframeRef.current) {
                        sendBridgeMessage(iframeRef.current, { type: 'host:enable-inspector' })
                    }
                    break

                case 'bridge:element-selected':
                    closeAssistantPanel()
                    setSelectedElement(payload as SelectedElementData)
                    break
                case 'bridge:selection-cleared':
                    setSelectedElement(null)
                    setInspectedElement(null)
                    setInspectorContextMenu(null)
                    closeVisualEditor()
                    break

                case 'bridge:element-contextmenu': {
                    const data = payload as ElementContextMenuData

                    // Keep visual editor selection in sync
                    closeAssistantPanel()
                    setSelectedElement(data as unknown as SelectedElementData)

                    // Inject inspected element context for AI
                    setInspectedElement({
                        selector: data.selector,
                        tagName: data.tagName,
                        className: data.className,
                        id: data.id,
                        textContent: data.textContent,
                        htmlSnippet: data.htmlSnippet,
                        reactComponentStack: data.react?.componentStack ?? undefined,
                        reactSource: data.react?.source ?? null,
                        capturedAt: Date.now(),
                    })

                    // Open a context menu at the cursor position (translated into host coords)
                    const iframe = iframeRef.current
                    const rect = iframe?.getBoundingClientRect()
                    const scaleX = rect && iframe?.offsetWidth ? rect.width / iframe.offsetWidth : 1
                    const scaleY = rect && iframe?.offsetHeight ? rect.height / iframe.offsetHeight : 1
                    const x = rect ? rect.left + data.clientX * scaleX : data.clientX
                    const y = rect ? rect.top + data.clientY * scaleY : data.clientY

                    setInspectorContextMenu({
                        open: true,
                        x,
                        y,
                        element: data,
                        reactComponentStack: data.react?.componentStack ?? undefined,
                        reactSource: data.react?.source ?? undefined,
                    })

                    break
                }

                case 'bridge:screenshot-ready': {
                    const data = payload as { dataUrl?: string; error?: string }
                    if (data.error) {
                        setBridgeError(data.error)
                    } else if (data.dataUrl && focusedRoute) {
                        const attachment: PendingAttachment = {
                            type: 'image',
                            data: data.dataUrl,
                            name: `screenshot-${focusedRoute.path.replace(/\//g, '-') || 'preview'}.png`,
                            mediaType: 'image/png',
                            context: {
                                pagePath: focusedRoute.path,
                                pageFile: focusedRoute.file,
                                projectName: project?.name,
                                serverPort: serverPort ?? undefined,
                            },
                        }
                        openWithScreenshot(attachment)
                    }
                    setIsCapturingScreenshot(false)
                    break
                }

                case 'bridge:navigation': {
                    if (!isFocusedPreview) break
                    // Update focused page when user navigates inside the iframe
                    const data = payload as { pathname?: string; url?: string }
                    const navigationPath = resolveNavigationPathFromBridge({
                        pathname: data.pathname,
                        url: data.url,
                    })
                    if (!navigationPath) break
                    const matchedIndex = findBestPreviewRouteIndex(routes, navigationPath)
                    if (matchedIndex !== null && matchedIndex !== focusedPageIndex) {
                        setFocusedPageIndex(matchedIndex)
                    }
                    break
                }

                case 'bridge:runtime-error': {
                    const data = payload as {
                        message?: string
                        stack?: string
                        filename?: string
                        line?: number | null
                        column?: number | null
                    }
                    if (!projectPath) break
                    addRuntimeProblem(projectPath, {
                        message: data.message || 'Runtime error',
                        severity: 'error',
                        source: 'runtime',
                        file: data.filename || undefined,
                        line: data.line ?? undefined,
                        column: data.column ?? undefined,
                    })
                    break
                }

                case 'bridge:console': {
                    const data = payload as {
                        level?: 'error' | 'warn' | 'info' | 'log'
                        message?: string
                        stack?: string
                    }
                    const level = data.level || 'error'
                    const severity = level === 'warn' ? 'warning' : level === 'info' ? 'info' : 'error'
                    if (!projectPath) break
                    addRuntimeProblem(projectPath, {
                        message: data.message || 'Console message',
                        severity,
                        source: 'runtime',
                    })
                    break
                }
            }
        }

        window.addEventListener('message', handleMessage)
        return () => window.removeEventListener('message', handleMessage)
    }, [handleCloseInspectorSidebar, inspectorEnabled, focusedRoute, project?.name, serverPort, setSelectedElement, setInspectedElement, openWithScreenshot, closeAssistantPanel, routes, focusedPageIndex, shiftInspectorActive, previewReady, closeVisualEditor, addRuntimeProblem, projectPath, isFocusedPreview, addBridgeLog, previewRoute?.path, clearBridgeReadyTimeout, previewEmbedMode, addPreviewTimelineEvent, actions, activeServerRunId, setPreviewFailure])

    // Toggle inspector in iframe when inspectorEnabled changes
    useEffect(() => {
        if (iframeRef.current) {
            sendBridgeMessage(iframeRef.current, {
                type: inspectorEnabled ? 'host:enable-inspector' : 'host:disable-inspector',
            })
        }
    }, [inspectorEnabled])

    // Shift-to-inspect: enable inspector while Shift is held; Escape: one-time press to disable inspector
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Shift: enable inspector while held (same as toolbar toggle)
            if (e.key === 'Shift' && !e.repeat && isFocusedPreview && !manualInspectorEnabled.current && previewReady) {
                setShiftInspectorActive(true)
                setInspectorEnabled(true)
            }
            // Escape: one-time press to disable inspector (or exit focused view if inspector off)
            if (e.key === 'Escape') {
                if (inspectorEnabled) {
                    handleCloseInspectorSidebar()
                } else if (focusedPageIndex !== null) {
                    setFocusedPageIndex(null)
                }
            }
        }

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Shift' && isFocusedPreview && shiftInspectorActive) {
                const hasSelection = !!useVisualEditorStore.getState().selectedElement
                setShiftInspectorActive(false)
                if (!hasSelection) {
                    setInspectorEnabled(false)
                    setSelectedElement(null)
                    setInspectedElement(null)
                    closeVisualEditor()
                } else {
                    manualInspectorEnabled.current = true // keep inspector on for selected element
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('keyup', handleKeyUp)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('keyup', handleKeyUp)
        }
    }, [shiftInspectorActive, previewReady, inspectorEnabled, focusedPageIndex, handleCloseInspectorSidebar, setSelectedElement, setInspectedElement, closeVisualEditor, isFocusedPreview])

    // Inject bridge script when iframe loads
    const handleIframeLoad = useCallback(async () => {
        if (previewRoute?.path) {
            focusedIframeLoadedPathRef.current = previewRoute.path
        }
        if (!isFocusedPreview) {
            return
        }

        // Reset bridge state before injection
        clearBridgeReadyTimeout()
        setBridgeReady(false)
        setPreviewEmbedBlocked(false)
        setBridgeError(null)
        actions.setPreviewReadiness({
            runId: activeServerRunId,
            bridgeReady: false,
            embedded: false,
            lastCheckedAt: Date.now(),
        })
        const frameName = iframeRef.current?.getAttribute('name') || 'unnamed-frame'
        addPreviewTimelineEvent({
            type: 'iframe_loaded',
            message: `Iframe loaded for ${previewRoute?.path ?? 'unknown route'}`,
            details: {
                mode: previewEmbedMode,
                frameName,
                url: focusedPreviewUrl,
            },
        })
        addBridgeLog(`Iframe loaded for ${previewRoute?.path ?? 'unknown route'} [${frameName}], attempting injection...`)

        if (focusedPreviewUrl) {
            const reachable = await probeFocusedPreviewReachability(focusedPreviewUrl, 'iframe-load')
            if (!reachable) {
                return
            }
        }

        if (iframeRef.current) {
            try {
                const result = await injectBridgeScript(iframeRef.current)
                if (result.success) {
                    addBridgeLog('Script injected, waiting for bridge:ready...')
                    actions.setPreviewReadiness({
                        runId: activeServerRunId,
                        embedded: false,
                        bridgeReady: false,
                        lastFailureReason: null,
                        lastFailureMessage: null,
                    })
                    addPreviewTimelineEvent({
                        type: 'bridge_inject_succeeded',
                        message: 'Bridge injection succeeded',
                        details: {
                            mode: previewEmbedMode,
                            frameName,
                        },
                    })
                    scheduleBridgeReadyTimeout(previewEmbedMode)
                } else {
                    const errorMessage = result.error ?? 'Cannot inject into preview'
                    const reason = result.reason ?? 'bridge_injection_failed'
                    const failure = getPreviewFailurePresentation(reason, errorMessage, {
                        blocked: Boolean(result.likelyBlocked ?? (reason === 'blocked_response' || reason === 'chrome_error_document')),
                        context: 'preview',
                    })
                    addBridgeLog(`Injection failed: ${failure.message}`, 'error')
                    addPreviewTimelineEvent({
                        type: 'bridge_inject_failed',
                        message: failure.message,
                        details: {
                            reason: failure.reason,
                            mode: previewEmbedMode,
                            headerDiagnostic: result.headerDiagnostic ?? undefined,
                            rawError: result.error ?? undefined,
                        },
                    })

                    if (previewEmbedMode === 'standard' && (result.likelyBlocked || reason === 'blocked_response' || reason === 'chrome_error_document')) {
                        previewFallbackAttemptRef.current += 1
                        addBridgeLog('Switching preview to credentialless compatibility mode', 'info')
                        addPreviewTimelineEvent({
                            type: 'fallback_mode',
                            message: 'Switching preview to credentialless compatibility mode',
                            details: {
                                from: 'standard',
                                to: 'credentialless',
                                reason,
                            },
                        })
                        setPreviewEmbedMode('credentialless')
                        setPreviewEmbedBlocked(false)
                        setBridgeError(null)
                        setPreviewReloadToken((value) => value + 1)
                        return
                    }

                    setPreviewFailure(failure.reason, failure.message, failure.blocked)
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Unknown error'
                const failure = getPreviewFailurePresentation('bridge_injection_failed', `Injection error: ${msg}`, {
                    blocked: true,
                    context: 'preview',
                })
                addPreviewTimelineEvent({
                    type: 'bridge_inject_failed',
                    message: failure.message,
                    details: {
                        reason: failure.reason,
                        mode: previewEmbedMode,
                        rawError: msg,
                    },
                })

                if (previewEmbedMode === 'standard') {
                    previewFallbackAttemptRef.current += 1
                    addBridgeLog(`Injection error in standard mode: ${msg}. Switching to credentialless mode.`, 'info')
                    addPreviewTimelineEvent({
                        type: 'fallback_mode',
                        message: 'Switching to credentialless mode after injection error',
                        details: {
                            from: 'standard',
                            to: 'credentialless',
                            reason: 'bridge_injection_failed',
                        },
                    })
                    setPreviewEmbedMode('credentialless')
                    setPreviewEmbedBlocked(false)
                    setBridgeError(null)
                    setPreviewReloadToken((value) => value + 1)
                    return
                }

                setPreviewFailure(failure.reason, failure.message, failure.blocked)
                addBridgeLog(`Injection error: ${failure.message}`, 'error')
            }
        }
    }, [actions, activeServerRunId, addBridgeLog, addPreviewTimelineEvent, clearBridgeReadyTimeout, focusedPreviewUrl, isFocusedPreview, previewEmbedMode, previewRoute?.path, probeFocusedPreviewReachability, scheduleBridgeReadyTimeout, setPreviewFailure])

    // Attempt to reinject bridge if not ready
    const retryBridgeInjection = useCallback(async () => {
        if (!iframeRef.current) {
            addBridgeLog('No iframe available', 'error')
            return false
        }

        clearBridgeReadyTimeout()
        setBridgeReady(false)
        setPreviewEmbedBlocked(false)
        const frameName = iframeRef.current.getAttribute('name') || 'unnamed-frame'
        addBridgeLog(`Retrying injection for ${previewRoute?.path ?? 'unknown route'} [${frameName}]...`)
        setBridgeError(null)

        if (focusedPreviewUrl) {
            const reachable = await probeFocusedPreviewReachability(focusedPreviewUrl, 'manual-retry')
            if (!reachable) {
                return false
            }
        }

        try {
            const result = await injectBridgeScript(iframeRef.current)
            if (result.success) {
                addBridgeLog('Script injected, waiting for bridge:ready...')
                addPreviewTimelineEvent({
                    type: 'bridge_inject_succeeded',
                    message: 'Manual bridge reinjection succeeded',
                    details: {
                        mode: previewEmbedMode,
                        frameName,
                    },
                })
                scheduleBridgeReadyTimeout(previewEmbedMode)
                return true
            } else {
                const errorMessage = result.error ?? 'Cannot inject into preview'
                const reason = result.reason ?? 'bridge_injection_failed'
                const failure = getPreviewFailurePresentation(reason, errorMessage, {
                    blocked: Boolean(result.likelyBlocked ?? true),
                    context: 'preview',
                })
                addBridgeLog(`Injection failed: ${failure.message}`, 'error')
                addPreviewTimelineEvent({
                    type: 'bridge_inject_failed',
                    message: failure.message,
                    details: {
                        mode: previewEmbedMode,
                        reason: failure.reason,
                        rawError: result.error ?? undefined,
                    },
                })

                if (previewEmbedMode === 'standard' && (result.likelyBlocked || reason === 'blocked_response' || reason === 'chrome_error_document')) {
                    previewFallbackAttemptRef.current += 1
                    addBridgeLog('Switching preview to credentialless compatibility mode', 'info')
                    addPreviewTimelineEvent({
                        type: 'fallback_mode',
                        message: 'Manual retry switched preview to credentialless mode',
                        details: {
                            from: 'standard',
                            to: 'credentialless',
                            reason,
                        },
                    })
                    setPreviewEmbedMode('credentialless')
                    setPreviewEmbedBlocked(false)
                    setBridgeError(null)
                    setPreviewReloadToken((value) => value + 1)
                    return false
                }

                setPreviewFailure(failure.reason, failure.message, failure.blocked)
                return false
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error'
            const failure = getPreviewFailurePresentation('bridge_injection_failed', `Injection error: ${msg}`, {
                blocked: true,
                context: 'preview',
            })
            if (previewEmbedMode === 'standard') {
                previewFallbackAttemptRef.current += 1
                addBridgeLog(`Injection error in standard mode: ${msg}. Switching to credentialless mode.`, 'info')
                addPreviewTimelineEvent({
                    type: 'fallback_mode',
                    message: 'Manual retry switched preview after injection error',
                    details: {
                        from: 'standard',
                        to: 'credentialless',
                        reason: 'bridge_injection_failed',
                    },
                })
                setPreviewEmbedMode('credentialless')
                setPreviewEmbedBlocked(false)
                setBridgeError(null)
                setPreviewReloadToken((value) => value + 1)
                return false
            }

            setPreviewFailure(failure.reason, failure.message, failure.blocked)
            addBridgeLog(`Injection error: ${failure.message}`, 'error')
            addPreviewTimelineEvent({
                type: 'bridge_inject_failed',
                message: failure.message,
                details: {
                    mode: previewEmbedMode,
                    reason: failure.reason,
                    rawError: msg,
                },
            })
            return false
        }
    }, [addBridgeLog, addPreviewTimelineEvent, clearBridgeReadyTimeout, focusedPreviewUrl, previewEmbedMode, previewRoute?.path, probeFocusedPreviewReachability, scheduleBridgeReadyTimeout, setPreviewFailure])

    // Attempt to reinject bridge if not ready
    const ensureBridgeReady = useCallback((): boolean => {
        if (previewReady) return true
        if (focusedPreviewUrl) {
            void probeFocusedPreviewReachability(focusedPreviewUrl, 'state-sync')
        }
        void retryBridgeInjection()
        return false
    }, [focusedPreviewUrl, previewReady, probeFocusedPreviewReachability, retryBridgeInjection])

    // Handle screenshot capture
    const handleCaptureScreenshot = useCallback(() => {
        if (!iframeRef.current || serverStatus !== 'running') return

        if (!previewReady) {
            ensureBridgeReady()
            setBridgeError('Preview bridge not ready. Try again in a moment.')
            return
        }

        setIsCapturingScreenshot(true)
        setBridgeError(null)
        sendBridgeMessage(iframeRef.current, { type: 'host:request-screenshot' })

        // Timeout in case bridge doesn't respond
        setTimeout(() => {
            setIsCapturingScreenshot(capturing => {
                if (capturing) {
                    setBridgeError('Screenshot timed out. Try refreshing the preview.')
                }
                return false
            })
        }, 10000)
    }, [serverStatus, previewReady, ensureBridgeReady])

    // Toggle inspector mode (manual toggle via button)
    const toggleInspector = useCallback(() => {
        if (!inspectorEnabled && !previewReady) {
            ensureBridgeReady()
            setBridgeError('Preview bridge not ready. Try again in a moment.')
            return
        }
        setInspectorEnabled((prev) => {
            const newState = !prev
            // Track manual state for Shift-to-inspect feature
            manualInspectorEnabled.current = newState
            // Clear shift state if user manually toggles
            if (shiftInspectorActive) {
                setShiftInspectorActive(false)
            }
            // Clear selection state and close inspector menu when disabling inspector
            if (!newState) {
                setSelectedElement(null)
                setInspectedElement(null)
                closeVisualEditor()
            }
            return newState
        })
    }, [previewReady, inspectorEnabled, ensureBridgeReady, setSelectedElement, setInspectedElement, shiftInspectorActive, closeVisualEditor])

    // Handle visual editor style preview
    const handlePreviewStyle = useCallback((styles: Record<string, string>) => {
        if (iframeRef.current) {
            sendBridgeMessage(iframeRef.current, {
                type: 'host:update-style',
                payload: { styles },
            })
        }
    }, [])

    // Handle visual editor text preview
    const handlePreviewText = useCallback((text: string) => {
        if (iframeRef.current) {
            sendBridgeMessage(iframeRef.current, {
                type: 'host:update-text',
                payload: { text },
            })
        }
    }, [])

    // Handle apply changes from visual editor
    const handleApplyChanges = useCallback(() => {
        // This would generate a prompt for the AI to apply the CSS changes
        const { pendingChanges, pendingTextChange, selectedElement } = useVisualEditorStore.getState()
        if (!selectedElement) return

        const changes = Object.entries(pendingChanges)
            .map(([prop, value]) => `${prop}: ${value}`)
            .join('; ')

        const prompt = pendingTextChange
            ? `Update the element "${selectedElement.selector}" with styles: ${changes} and text content: "${pendingTextChange}"`
            : `Update the element "${selectedElement.selector}" with styles: ${changes}`

        // Open assistant with the prompt
        useAssistantPanelStore.getState().openWithPrompt(prompt)
    }, [])

    const closeInspectorContextMenu = useCallback(() => {
        setInspectorContextMenu(null)
    }, [])

    const handleAskAIAboutInspectedElement = useCallback(() => {
        if (!inspectorContextMenu) return

        const stack = inspectorContextMenu.reactComponentStack?.join(' > ')
        const pageInfo = focusedRoute ? `${focusedRoute.path} (${focusedRoute.file})` : undefined
        const selector = inspectorContextMenu.element.selector

        const prompt = [
            'I right-clicked an element in the preview inspector.',
            pageInfo ? `Page: ${pageInfo}` : null,
            `Selector: ${selector}`,
            stack ? `React component stack: ${stack}` : null,
            '',
            'What I want to change:',
        ].filter(Boolean).join('\n')

        useAssistantPanelStore.getState().openWithPrompt(prompt)
        closeInspectorContextMenu()
    }, [inspectorContextMenu, focusedRoute, closeInspectorContextMenu])

    const handleCopyInspectedSelector = useCallback(async () => {
        if (!inspectorContextMenu) return
        try {
            await navigator.clipboard.writeText(inspectorContextMenu.element.selector)
        } finally {
            closeInspectorContextMenu()
        }
    }, [inspectorContextMenu, closeInspectorContextMenu])

    const handleCopyInspectedComponentStack = useCallback(async () => {
        const stack = inspectorContextMenu?.reactComponentStack?.join(' > ')
        if (!stack) return
        try {
            await navigator.clipboard.writeText(stack)
        } finally {
            closeInspectorContextMenu()
        }
    }, [inspectorContextMenu, closeInspectorContextMenu])

    const handleOpenInspectedSource = useCallback(async () => {
        const reactSource = inspectorContextMenu?.reactSource
        const fileName = reactSource?.fileName
        if (!fileName || !projectBasePath || !projectPath) return

        const resolvedPath = await resolveProjectSourcePath(fileName, projectPath)
        if (!resolvedPath) return

        const params = new URLSearchParams()
        params.set('path', resolvedPath)
        if (reactSource?.lineNumber) {
            params.set('line', String(reactSource.lineNumber))
        }
        if (reactSource?.columnNumber) {
            params.set('column', String(reactSource.columnNumber))
        }

        navigate(`${projectBasePath}?${params.toString()}`)
        closeInspectorContextMenu()
    }, [closeInspectorContextMenu, inspectorContextMenu, navigate, projectBasePath, projectPath])

    const handleOpenCode = useCallback(async (file: string, line?: number, column?: number) => {
        const normalizedFile = file.replace(/\\/g, '/')
        const normalizedProject = projectPath ? projectPath.replace(/\\/g, '/').replace(/\/+$/, '') : null
        const isAbsolute = normalizedFile.startsWith('/') || /^[A-Za-z]:\//.test(normalizedFile)
        const resolvedRelativePath =
            projectPath
                ? await resolveProjectSourcePath(normalizedFile, projectPath)
                : null
        const pathForUrl = resolvedRelativePath
            ? (normalizedProject ? `${normalizedProject}/${resolvedRelativePath.replace(/^\/+/, '')}` : resolvedRelativePath)
            : normalizedProject
                ? (isAbsolute || normalizedFile.startsWith(normalizedProject))
                    ? normalizedFile
                    : `${normalizedProject}/${normalizedFile.replace(/^\/+/, '')}`
                : normalizedFile
        const params = new URLSearchParams()
        params.set('path', pathForUrl)
        if (line) params.set('line', String(line))
        if (column) params.set('column', String(column))
        if (!projectBasePath) return
        navigate(`${projectBasePath}?${params.toString()}`)
    }, [navigate, projectBasePath, projectPath])

    const reloadFocusedPreview = useCallback((reason: 'manual' | 'fallback' = 'manual') => {
        clearBridgeReadyTimeout()
        setBridgeReady(false)
        setPreviewEmbedBlocked(false)
        setBridgeError(null)
        actions.setPreviewReadiness({
            runId: activeServerRunId,
            bridgeReady: false,
            embedded: false,
            lastCheckedAt: Date.now(),
        })
        if (reason === 'manual') {
            previewFallbackAttemptRef.current = 0
        }
        addPreviewTimelineEvent({
            type: 'fallback_mode',
            message: reason === 'manual' ? 'Manual preview reload requested' : 'Preview reload requested by fallback flow',
            details: {
                reason,
                mode: previewEmbedMode,
            },
        })
        setPreviewReloadToken((value) => value + 1)
    }, [actions, activeServerRunId, addPreviewTimelineEvent, clearBridgeReadyTimeout, previewEmbedMode])

    const handleFocusedIframeError = useCallback(() => {
        const previewUrl = focusedPreviewUrl ?? 'unknown'
        console.error(`[PagesPreview] iframe load error mode=${previewEmbedMode} url=${previewUrl}`)
        setPreviewFailure('iframe_load_error', 'Iframe failed to load preview content. Try Open for direct view.', true)
        addPreviewTimelineEvent({
            type: 'iframe_error',
            message: 'Iframe failed to load preview content',
            details: {
                mode: previewEmbedMode,
                url: previewUrl,
            },
        })
    }, [addPreviewTimelineEvent, focusedPreviewUrl, previewEmbedMode, setPreviewFailure])

    const openFocusedPreviewExternally = useCallback(() => {
        if (!focusedPreviewUrl) return
        window.open(focusedPreviewUrl, '_blank')
    }, [focusedPreviewUrl])

    const headerControls = useMemo(() => (
        <TooltipProvider delayDuration={300}>
            <div
                ref={headerRef}
                className={cn("flex items-center gap-2", focusedPageIndex !== null && !isMacClient && "ml-auto")}
            >
                {focusedPageIndex !== null && (
                    <>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setFocusedPageIndex(null)}
                                    className="gap-2 h-7 px-2"
                                >
                                    <LayoutGrid className="h-3.5 w-3.5" />
                                    {toolbarDensity === 'full' && <span className="text-xs">Grid</span>}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                <p>Back to grid view</p>
                            </TooltipContent>
                        </Tooltip>
                        <div className="h-4 w-px bg-border/60" />
                    </>
                )}

                {focusedPageIndex !== null && toolbarDensity === 'full' && (
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant={device === 'desktop' ? 'secondary' : 'ghost'}
                                        size="icon"
                                        onClick={() => setDevice('desktop')}
                                        className={cn("h-7 w-7 rounded-full", device === 'desktop' && "bg-sidebar-accent shadow-none")}
                                    >
                                        <Monitor className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Desktop</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant={device === 'tablet' ? 'secondary' : 'ghost'}
                                        size="icon"
                                        onClick={() => setDevice('tablet')}
                                        className={cn("h-7 w-7 rounded-full", device === 'tablet' && "bg-sidebar-accent shadow-none")}
                                    >
                                        <Tablet className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Tablet (768px)</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant={device === 'mobile' ? 'secondary' : 'ghost'}
                                        size="icon"
                                        onClick={() => setDevice('mobile')}
                                        className={cn("h-7 w-7 rounded-full", device === 'mobile' && "bg-sidebar-accent shadow-none")}
                                    >
                                        <Smartphone className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Mobile (375px)</TooltipContent>
                            </Tooltip>
                        </div>

                        <div className="h-4 w-px bg-border/60" />

                        <div className="flex items-center gap-0.5">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleZoomStepDown}
                                        className="h-7 w-7 rounded-full"
                                        disabled={zoom <= MIN_ZOOM_PERCENT}
                                    >
                                        <ZoomOut className="h-3.5 w-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Zoom out</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setZoom(100)}
                                        className="h-7 px-2 text-xs font-mono min-w-[3rem]"
                                    >
                                        {zoom}%
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Reset to 100%</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleZoomStepUp}
                                        className="h-7 w-7 rounded-full"
                                        disabled={zoom >= MAX_ZOOM_PERCENT}
                                    >
                                        <ZoomIn className="h-3.5 w-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Zoom in</TooltipContent>
                            </Tooltip>
                        </div>
                    </div>
                )}

                {focusedPageIndex !== null && toolbarDensity !== 'full' && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className={cn(
                                    "group/zoom-trigger h-7 rounded-full overflow-hidden shadow-none transition-colors duration-200 hover:bg-secondary/70 hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-secondary-foreground",
                                    toolbarDensity === 'compact'
                                        ? "px-2 gap-2"
                                        : "min-w-7 px-1.5 gap-0 justify-center"
                                )}
                            >
                                {device === 'desktop' ? (
                                    <Monitor className="h-4 w-4" />
                                ) : device === 'tablet' ? (
                                    <Tablet className="h-4 w-4" />
                                ) : (
                                    <Smartphone className="h-4 w-4" />
                                )}
                                {toolbarDensity === 'compact' && (
                                    <span className="text-xs font-mono tabular-nums min-w-[3rem]">
                                        {zoom}%
                                    </span>
                                )}
                                <span className="zoom-chevron-slot flex w-0 items-center justify-end overflow-hidden opacity-0 transition-all duration-200 group-hover/zoom-trigger:ml-1 group-hover/zoom-trigger:w-4 group-hover/zoom-trigger:opacity-70 group-data-[state=open]/zoom-trigger:ml-1 group-data-[state=open]/zoom-trigger:w-4 group-data-[state=open]/zoom-trigger:opacity-70">
                                    <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]/zoom-trigger:rotate-180" />
                                </span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="center" className="w-56">
                            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                                View
                            </div>
                            <DropdownMenuItem onClick={() => setDevice('desktop')}>
                                <Monitor className="h-4 w-4 mr-2" />
                                Desktop
                                {device === 'desktop' && <CheckCircle2 className="h-3 w-3 ml-auto text-green-500" />}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDevice('tablet')}>
                                <Tablet className="h-4 w-4 mr-2" />
                                Tablet (768px)
                                {device === 'tablet' && <CheckCircle2 className="h-3 w-3 ml-auto text-green-500" />}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDevice('mobile')}>
                                <Smartphone className="h-4 w-4 mr-2" />
                                Mobile (375px)
                                {device === 'mobile' && <CheckCircle2 className="h-3 w-3 ml-auto text-green-500" />}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                                Zoom
                            </div>
                            <div className="px-2 pb-2">
                                <div className="flex h-8 w-full items-center justify-center px-1">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={handleZoomStepDown}
                                        disabled={zoom <= MIN_ZOOM_PERCENT}
                                        aria-label="Zoom out"
                                    >
                                        <ZoomOut className="h-3.5 w-3.5" />
                                    </Button>
                                    <div className="mx-2 h-4 w-px bg-border/60" />
                                    <div className="flex w-14 items-center justify-center gap-0.5">
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={zoomInputValue}
                                            onChange={(event) => {
                                                const next = event.target.value.replace('%', '').trim()
                                                if (next === '' || /^\d{0,3}$/.test(next)) {
                                                    setZoomInputValue(next)
                                                }
                                            }}
                                            onBlur={commitZoomInput}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault()
                                                    commitZoomInput()
                                                    event.currentTarget.blur()
                                                }
                                                if (event.key === 'Escape') {
                                                    event.preventDefault()
                                                    setZoomInputValue(String(zoom))
                                                    event.currentTarget.blur()
                                                }
                                            }}
                                            className="h-6 w-10 border-0 bg-transparent p-0 text-center text-sm font-medium text-foreground outline-none"
                                            aria-label="Zoom percent"
                                        />
                                        <span className="text-[11px] text-muted-foreground">%</span>
                                    </div>
                                    <div className="mx-2 h-4 w-px bg-border/60" />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={handleZoomStepUp}
                                        disabled={zoom >= MAX_ZOOM_PERCENT}
                                        aria-label="Zoom in"
                                    >
                                        <ZoomIn className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}

                <div className="flex items-center gap-2 min-w-0">
                        {serverStatus === 'running' && useCredentiallessPreview && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold leading-none text-amber-950 dark:text-amber-100"
                                        aria-label="Compat preview"
                                    >
                                        !
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Legacy compat preview active</TooltipContent>
                            </Tooltip>
                        )}
                        <DropdownMenu>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Preview actions">
                                            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Preview actions</TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem onClick={refreshRoutes}>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Refresh routes
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={retryBridgeInjection}>
                                    <span
                                            className={cn(
                                                "h-2.5 w-2.5 rounded-full shrink-0 mr-2",
                                                previewReady ? "bg-green-500" : "bg-amber-500"
                                            )}
                                            aria-hidden
                                        />
                                    Retry Bridge Connection
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        {focusedPageIndex !== null && serverStatus === 'running' && (
                            <>
                                {/* Screenshot button */}
                                <Tooltip open={toolbarTooltip === 'screenshot'} onOpenChange={(open) => setToolbarTooltip(open ? 'screenshot' : null)}>
                                    <TooltipTrigger asChild>
                                        <div
                                            className="inline-flex"
                                            onPointerEnter={() => setToolbarTooltip('screenshot')}
                                            onPointerLeave={() => setToolbarTooltip(null)}
                                        >
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                disabled={isCapturingScreenshot || !previewReady || previewEmbedBlocked}
                                                onClick={handleCaptureScreenshot}
                                            >
                                                <Camera className={cn(
                                                    "h-3.5 w-3.5",
                                                    isCapturingScreenshot ? "animate-pulse text-primary" : "text-muted-foreground"
                                                )} />
                                            </Button>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="pointer-events-none data-[state=closed]:duration-0">
                                        {previewEmbedBlocked
                                            ? 'Preview blocked. Open externally.'
                                            : previewReady
                                                ? 'Take Screenshot'
                                                : 'Preview not ready yet'}
                                    </TooltipContent>
                                </Tooltip>

                                {/* Inspector button */}
                                <Tooltip open={toolbarTooltip === 'inspector'} onOpenChange={(open) => setToolbarTooltip(open ? 'inspector' : null)}>
                                    <TooltipTrigger asChild>
                                        <div
                                            className="inline-flex"
                                            onPointerEnter={() => setToolbarTooltip('inspector')}
                                            onPointerLeave={() => setToolbarTooltip(null)}
                                        >
                                            <Button
                                                variant={inspectorEnabled ? "secondary" : "ghost"}
                                                size="icon"
                                                className="h-7 w-7"
                                                disabled={!previewReady || previewEmbedBlocked}
                                                onClick={toggleInspector}
                                            >
                                                <MousePointer2 className={cn("h-3.5 w-3.5", inspectorEnabled ? "text-foreground" : "text-muted-foreground")} />
                                            </Button>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="pointer-events-none data-[state=closed]:duration-0">
                                        {previewEmbedBlocked
                                            ? 'Preview blocked. Open externally.'
                                            : previewReady
                                                ? (inspectorEnabled ? 'Disable Inspector' : 'Enable Inspector')
                                                : 'Preview not ready yet'}
                                    </TooltipContent>
                                </Tooltip>

                                {/* Update project preview (Projects page showcase) */}
                                <Tooltip open={toolbarTooltip === 'preview'} onOpenChange={(open) => setToolbarTooltip(open ? 'preview' : null)}>
                                    <TooltipTrigger asChild>
                                        <div
                                            className="inline-flex"
                                            onPointerEnter={() => setToolbarTooltip('preview')}
                                            onPointerLeave={() => setToolbarTooltip(null)}
                                        >
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                disabled={isCapturingPreview}
                                                onClick={handleUpdateProjectPreview}
                                            >
                                                {isCapturingPreview ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                                ) : (
                                                    <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
                                                )}
                                            </Button>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="pointer-events-none data-[state=closed]:duration-0">Update project preview (Projects page)</TooltipContent>
                                </Tooltip>
                            </>
                        )}
                        <div className="h-4 w-px bg-border/60" />
                        <ServerControl
                            projectPath={projectPath}
                            storedDevCommand={storedFrameworkInfo?.devCommand}
                            storedDevPort={storedFrameworkInfo?.devPort}
                        />
                    </div>
            </div>
        </TooltipProvider>
    ), [
        focusedPageIndex,
        isMacClient,
        toolbarDensity,
        device,
        zoom,
        zoomInputValue,
        isCapturingScreenshot,
        isCapturingPreview,
        inspectorEnabled,
        toolbarTooltip,
        serverStatus,
        previewReady,
        previewEmbedBlocked,
        useCredentiallessPreview,
        projectPath,
        storedFrameworkInfo?.devCommand,
        storedFrameworkInfo?.devPort,
        refreshRoutes,
        retryBridgeInjection,
        handleCaptureScreenshot,
        toggleInspector,
        handleUpdateProjectPreview,
        handleZoomStepDown,
        handleZoomStepUp,
        commitZoomInput,
        setDevice,
        setZoom,
        setZoomInputValue,
        setFocusedPageIndex,
    ])

    useProjectHeader(
        headerControls,
        null,
        focusedPageIndex !== null,
        { insetLeft: headerInsetLeft, insetRight: headerInsetRight }
    )

    // Loading state - show shell immediately
    // Only show 404 if we are loaded (project === null) and explicitly not found
    if (project === null) {
        return (
            <div className="flex flex-col items-center justify-center h-full py-16 space-y-4">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-muted-foreground">Project not found</p>
            </div>
        )
    }

    return (
        <div
            className={cn(
                "flex flex-col bg-background relative",
                shouldElevateInspectorSidebar ? "h-[calc(100%+2.5rem)] -mt-10" : "h-full"
            )}
        >

            {/* Main Content + Inspector + Terminal */}
            <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
                {isFocusedPreview && inspectorSide === 'left' && (
                    <VisualEditorSidebar
                        onPreviewStyle={handlePreviewStyle}
                        onPreviewText={handlePreviewText}
                        onApplyChanges={handleApplyChanges}
                        onClose={handleCloseInspectorSidebar}
                    />
                )}

                <div
                    className={cn(
                        "flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden",
                        shouldElevateInspectorSidebar && "pt-10"
                    )}
                >
                    {/* Content */}
                    <div className="relative flex-1 overflow-hidden flex flex-col">
                        {routes.length === 0 ? (
                            /* Empty State */
                            <div
                                key="pages-empty"
                                className="app-scrollbar flex-1 overflow-y-auto p-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
                            >
                                <div className="flex flex-col items-center justify-center min-h-full text-muted-foreground border-2 border-dashed border-border/50 rounded-xl bg-muted/5">
                                    <FileText className="h-10 w-10 mb-3 opacity-20" />
                                    <p>No pages detected in this project.</p>
                                    <p className="text-xs mb-4">Supports Next.js, Remix, SvelteKit, Nuxt, Astro, and more</p>

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                            if (!projectPath) return
                                            setIsScanningAI(true)
                                            try {
                                                // AI scanning would go here
                                                await refreshRoutes()
                                            } finally {
                                                setIsScanningAI(false)
                                            }
                                        }}
                                        disabled={isScanningAI}
                                    >
                                        {isScanningAI ? (
                                            <>Scanning...</>
                                        ) : (
                                            <>
                                                <Sparkles className="h-3.5 w-3.5 mr-2 text-purple-500" />
                                                Scan with AI
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="relative flex-1 min-h-0 min-w-0 bg-content-surface">
                                {!isFocusedPreview && (
                                <div
                                    className="app-scrollbar absolute inset-0 overflow-y-auto p-6 animate-in fade-in duration-300"
                                >
                                    <div className="grid [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))] gap-6">
                                        {routes.map((route, index) => {
                                            const routePresenceUsers = getRoutePresenceUsers(route.path, route.file)
                                            const routePreviewUrl = buildRoutePreviewUrl(route.path)
                                            return (
                                                <div key={route.path} className="group relative">
                                                    <Card
                                                        className="group relative overflow-hidden border-border/40 bg-card/50 hover:bg-card hover:border-sidebar-primary/20 transition-all duration-300 shadow-sm hover:shadow-md h-[220px] flex flex-col cursor-pointer p-0 gap-0"
                                                        onClick={() => setFocusedPageIndex(index)}
                                                    >
                                                        {/* Preview Area */}
                                                        <div className="flex-1 w-full bg-muted/30 relative overflow-hidden rounded-t-xl">
                                                            {serverStatus === 'running' && routePreviewUrl ? (
                                                                <div className="absolute inset-0">
                                                                    <div className="w-full h-full bg-background relative overflow-hidden">
                                                                        <iframe
                                                                            key={`grid-preview-${previewEmbedMode}-${previewReloadToken}-${route.path}`}
                                                                            src={routePreviewUrl}
                                                                            credentialless={credentiallessAttribute}
                                                                            className="w-[200%] h-[200%] origin-top-left scale-50 border-none pointer-events-none select-none block"
                                                                            tabIndex={-1}
                                                                        />
                                                                        <div className="absolute inset-0 bg-transparent" />
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                                                    <AppWindow className="h-8 w-8 mb-2 text-muted-foreground/20" />
                                                                    <span className="text-xs text-muted-foreground/40 font-medium">Start server to preview</span>
                                                                </div>
                                                            )}

                                                            {/* Dynamic Label */}
                                                            {route.type === 'dynamic' && (
                                                                <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/10 backdrop-blur-sm">
                                                                    Dynamic
                                                                </div>
                                                            )}

                                                            {/* Hover Overlay Actions */}
                                                            <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-2 group-hover:translate-y-0 z-20">
                                                                <Button
                                                                    variant="secondary"
                                                                    size="sm"
                                                                    className="h-7 text-[10px] px-2 shadow-sm bg-background/80 backdrop-blur-sm hover:bg-background"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        handleOpenCode(route.file)
                                                                    }}
                                                                >
                                                                    <FileText className="h-3 w-3 mr-1.5" />
                                                                    Edit
                                                                </Button>

                                                                {serverStatus === 'running' && (
                                                                    <Button
                                                                        variant="secondary"
                                                                        size="icon"
                                                                        className="h-7 w-7 shadow-sm bg-background/80 backdrop-blur-sm hover:bg-background"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            if (!routePreviewUrl) return
                                                                            window.open(routePreviewUrl, '_blank')
                                                                        }}
                                                                    >
                                                                        <ExternalLink className="h-3 w-3" />
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Footer Info */}
                                                        <div className="px-3 py-2 mt-auto">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <h3 className="font-medium text-sm text-foreground/90 truncate" title={route.path}>
                                                                    {route.name}
                                                                </h3>
                                                                <div className="flex shrink-0 items-center gap-1.5">
                                                                    {routePresenceUsers.length > 0 && (
                                                                        <CompactPresenceIndicator
                                                                            users={routePresenceUsers}
                                                                            size="sm"
                                                                            className="shrink-0"
                                                                        />
                                                                    )}
                                                                    <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0 truncate max-w-[40%] text-right bg-muted/50 px-1.5 py-0.5 rounded">
                                                                        {route.path}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="mt-1 min-w-0">
                                                                <p className="min-w-0 flex-1 text-[11px] text-muted-foreground line-clamp-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    {route.description ?? ''}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </Card>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                                )}

                                {isFocusedPreview && previewRoute && (
                                    <div
                                        className="absolute inset-0 flex overflow-hidden min-h-0 min-w-0 animate-in fade-in duration-300"
                                    >
                                        <div className="flex-1 flex flex-col min-h-0 min-w-0">
                                            {/* Preview area */}
                                            <div className="flex-1 flex items-center justify-center min-h-0 pt-4 px-4 pb-4">
                                                <div
                                                    className={cn(
                                                        "group/focused-preview relative bg-card overflow-hidden rounded-xl border border-border/40 shadow-xl transition-[transform,box-shadow,border-color] duration-300 ease-out",
                                                        device === 'desktop' ? "w-full h-full" : "h-full",
                                                        device === 'mobile' && "w-[375px]",
                                                        device === 'tablet' && "w-[768px]"
                                                    )}
                                                    style={{
                                                        transform: `scale(${zoom / 100})`,
                                                        transformOrigin: 'center center'
                                                    }}
                                                >
                                                    {serverStatus === 'running' && serverPort ? (
                                                        <div className="relative h-full w-full bg-content-surface">
                                                            <iframe
                                                                ref={iframeRef}
                                                                key={`focused-preview-${previewEmbedMode}-${previewReloadToken}-${previewRoute.path}`}
                                                                name={focusedPreviewFrameName}
                                                                src={focusedPreviewUrl ?? undefined}
                                                                credentialless={credentiallessAttribute}
                                                                className="h-full w-full border-none"
                                                                onLoad={handleIframeLoad}
                                                                onError={handleFocusedIframeError}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                                            <AppWindow className="h-16 w-16 mb-4 opacity-20" />
                                                            <p className="text-lg">Start dev server for live preview</p>
                                                            <p className="text-sm text-muted-foreground/60 mt-1">{previewRoute.path}</p>
                                                        </div>
                                                    )}

                                                    {/* Dynamic badge */}
                                                    {previewRoute.type === 'dynamic' && (
                                                        <div className="absolute top-3 right-3 px-2 py-1 rounded text-xs uppercase font-bold tracking-wider bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
                                                            Dynamic
                                                        </div>
                                                    )}

                                                    {taskOverlay?.context.kind === 'page' ? (
                                                        <TaskFocusOverlay task={taskOverlay} className="z-30" />
                                                    ) : (
                                                        <div className="pointer-events-none absolute bottom-4 right-4 flex translate-y-2 items-center gap-2 opacity-0 transition-all duration-200 ease-out group-hover/focused-preview:pointer-events-auto group-hover/focused-preview:translate-y-0 group-hover/focused-preview:opacity-100">
                                                            <Button
                                                                variant="secondary"
                                                                size="sm"
                                                                onClick={() => handleOpenCode(previewRoute.file)}
                                                                className="shadow-md"
                                                            >
                                                                <FileText className="h-3.5 w-3.5 mr-1.5" />
                                                                Open
                                                            </Button>
                                                            {serverStatus === 'running' && (
                                                                <Button
                                                                    variant="secondary"
                                                                    size="sm"
                                                                    onClick={openFocusedPreviewExternally}
                                                                    className="shadow-md"
                                                                >
                                                                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                                                    Browser
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Page name pill */}
                                                    <div className="absolute bottom-4 left-4 flex items-center gap-2">
                                                        <div className="inline-flex items-center gap-2 rounded-full bg-secondary/80 px-3 py-1 text-sm font-medium text-secondary-foreground shadow-md">
                                                            {previewRoute.name}
                                                        </div>
                                                    </div>

                                                    {showPreviewFailureOverlay && (
                                                        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/85 backdrop-blur-sm">
                                                            <div className="max-w-md rounded-xl border border-border/80 bg-card p-4 shadow-xl">
                                                                <p className="text-sm font-semibold">
                                                                    {previewFailurePresentation?.title ?? 'Embedded preview unavailable'}
                                                                </p>
                                                                <p className="mt-1 text-xs text-muted-foreground">
                                                                    {previewFailurePresentation?.message ?? 'This page blocks iframe embedding in isolated mode.'}
                                                                </p>
                                                                {recentPreviewTimeline.length > 0 && (
                                                                    <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-2">
                                                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                                            Recent diagnostics
                                                                        </p>
                                                                        <div className="mt-1 space-y-1">
                                                                            {recentPreviewTimeline.slice(0, 3).map((event) => (
                                                                                <p key={event.id} className="text-[11px] leading-4 text-muted-foreground">
                                                                                    {event.message}
                                                                                </p>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                <div className="mt-4 flex items-center gap-2">
                                                                    <Button size="sm" variant="outline" onClick={() => reloadFocusedPreview('manual')}>
                                                                        Retry
                                                                    </Button>
                                                                    <Button size="sm" onClick={openFocusedPreviewExternally}>
                                                                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                                                        Browser
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Thumbnail strip */}
                                            <div className="shrink-0 backdrop-blur-md px-3 py-2">
                                                <div className="flex items-center gap-3">
                                                    <div
                                                        ref={thumbnailStripRef}
                                                        className="app-scrollbar flex-1 flex gap-2 overflow-x-auto pb-0.5"
                                                    >
                                                        {routes.map((route, index) => {
                                                            const routePresenceUsers = getRoutePresenceUsers(route.path, route.file)
                                                            const routePreviewUrl = buildRoutePreviewUrl(route.path)
                                                            return (
                                                                <div
                                                                    key={route.path}
                                                                    onClick={() => setFocusedPageIndex(index)}
                                                                    role="button"
                                                                    tabIndex={0}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                                            e.preventDefault()
                                                                            setFocusedPageIndex(index)
                                                                        }
                                                                    }}
                                                                    className={cn(
                                                                        "group shrink-0 flex flex-col items-center gap-1 transition-all cursor-pointer outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0",
                                                                        index === previewRouteIndex
                                                                            ? "opacity-100"
                                                                            : "opacity-50 hover:opacity-100"
                                                                    )}
                                                                >
                                                                    <div className={cn(
                                                                        "w-24 h-14 rounded border-2 overflow-hidden relative",
                                                                        index === previewRouteIndex
                                                                            ? "border-primary ring-1 ring-primary/20"
                                                                            : "border-border/40 hover:border-border"
                                                                    )}>
                                                                        {serverStatus === 'running' && routePreviewUrl ? (
                                                                            <div className="w-full h-full bg-background relative">
                                                                                <iframe
                                                                                    key={`thumb-preview-${previewEmbedMode}-${previewReloadToken}-${route.path}`}
                                                                                    src={routePreviewUrl}
                                                                                    credentialless={credentiallessAttribute}
                                                                                    className="w-[500%] h-[500%] origin-top-left scale-[0.20] border-none pointer-events-none"
                                                                                    tabIndex={-1}
                                                                                />
                                                                            </div>
                                                                        ) : (
                                                                            <div className="w-full h-full bg-muted/50 flex items-center justify-center">
                                                                                <AppWindow className="h-3 w-3 text-muted-foreground/30" />
                                                                            </div>
                                                                        )}
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.preventDefault()
                                                                                e.stopPropagation()
                                                                                togglePagesListOpen()
                                                                            }}
                                                                            className="absolute top-1 left-1 flex items-center justify-center w-6 h-6 rounded bg-background/90 opacity-0 group-hover:opacity-100 transition-opacity border border-border/50 cursor-pointer shadow-sm"
                                                                            aria-label="Toggle pages list"
                                                                        >
                                                                            <PanelLeft className="h-3.5 w-3.5 text-muted-foreground" />
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.preventDefault()
                                                                                e.stopPropagation()
                                                                                handleOpenCode(route.file)
                                                                            }}
                                                                            className="absolute top-1 right-1 flex items-center justify-center w-6 h-6 rounded bg-background/90 opacity-0 group-hover:opacity-100 transition-opacity border border-border/50 cursor-pointer shadow-sm"
                                                                            aria-label="Open code file"
                                                                        >
                                                                            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                                                                        </button>
                                                                        {routePresenceUsers.length > 0 && (
                                                                            <div className="absolute bottom-1 right-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border/60 bg-background/90 p-[1px] shadow-sm backdrop-blur-sm">
                                                                                <CompactPresenceIndicator
                                                                                    users={routePresenceUsers}
                                                                                    size="xs"
                                                                                    showOverflow={false}
                                                                                    className="gap-0"
                                                                                />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div className="w-24">
                                                                        <span
                                                                            className={cn(
                                                                                "block min-w-0 text-[10px] truncate",
                                                                                index === previewRouteIndex
                                                                                    ? "text-foreground font-medium"
                                                                                    : "text-muted-foreground"
                                                                            )}
                                                                            title={route.name}
                                                                        >
                                                                            {route.name}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                    {previewRouteIndex !== null && (
                                                        <div className="shrink-0 text-xs text-muted-foreground tabular-nums bg-muted/50 px-2.5 py-1 rounded-full">
                                                            {previewRouteIndex + 1}/{routes.length}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                    </div>

                    {/* Terminal Panel */}
                    {projectPath && (
                        <TerminalPanel projectPath={projectPath} onOpenFile={handleOpenCode} />
                    )}
                </div>

                {isFocusedPreview && inspectorSide === 'right' && (
                    <VisualEditorSidebar
                        onPreviewStyle={handlePreviewStyle}
                        onPreviewText={handlePreviewText}
                        onApplyChanges={handleApplyChanges}
                        onClose={handleCloseInspectorSidebar}
                    />
                )}
            </div>

            {/* Inspector right-click menu */}
            {inspectorContextMenu && (
                <DropdownMenu
                    open={inspectorContextMenu.open}
                    onOpenChange={(open) => {
                        if (!open) setInspectorContextMenu(null)
                    }}
                >
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            tabIndex={-1}
                            aria-hidden="true"
                            className="fixed"
                            style={{
                                left: inspectorContextMenu.x,
                                top: inspectorContextMenu.y,
                                width: 1,
                                height: 1,
                                opacity: 0,
                                pointerEvents: 'none',
                            }}
                        />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="right" sideOffset={8} className="w-64">
                        <DropdownMenuItem onClick={handleAskAIAboutInspectedElement}>
                            Ask AI about this element
                        </DropdownMenuItem>
                        {inspectorContextMenu.reactSource?.fileName && (
                            <DropdownMenuItem onClick={handleOpenInspectedSource}>
                                Open component source
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => void handleCopyInspectedSelector()}>
                            Copy selector
                        </DropdownMenuItem>
                        {inspectorContextMenu.reactComponentStack?.length ? (
                            <DropdownMenuItem onClick={() => void handleCopyInspectedComponentStack()}>
                                Copy component stack
                            </DropdownMenuItem>
                        ) : null}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}

        </div>
    )
}
