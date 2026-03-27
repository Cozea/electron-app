import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import {
    useProjectPagesStore,
    type PreviewTimelineEvent,
    type ServerStatus,
} from '@/stores/useProjectPagesStore'
import { useProjectHeader } from '@/hooks/useProjectHeader'
import { PREVIEW_SCREENSHOT_REQUEST_EVENT, usePageContextStore } from '@/stores/usePageContextStore'
import { useVisualEditorStore } from '@/stores/useVisualEditorStore'

import { useProblemsStore } from '@/stores/useProblemsStore'
import { findBestPreviewRouteIndex, resolveNavigationPathFromBridge } from '@/lib/previewRouteMatching'
import {
  injectBridgeScript,
  sendBridgeMessage,
  type BridgeMessage,
  type ElementContextMenuData,
  type SelectedElementData,
} from '@/utils/previewBridge'
import { FocusedProjectPreview } from '@/features/projects/components/previews/FocusedProjectPreview'
import { IosSimulatorViewport } from '@/features/projects/components/previews/IosSimulatorViewport'
import { ProjectPreviewRouteBar } from '@/features/projects/components/previews/ProjectPreviewRouteBar'
import { ProjectPreviewToolbar } from '@/features/projects/components/previews/ProjectPreviewToolbar'
import { ServerControl } from '../components/ServerControl'
import { TerminalPanel } from '../components/TerminalPanel'
import { useOptionalProjectSyncContext } from '../contexts/ProjectSyncContext'
import { useProjectRouteScan } from '../hooks/useProjectRouteScan'
import { VisualEditorSidebar } from '@/components/visual-editor/VisualEditorSidebar'
import { Button } from '@/components/ui/button'
import {
  FileText,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMutation } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { captureAndUploadProjectPreviewFromUrl } from '@/lib/captureProjectPreview'
import type { PreviewFailureReason } from '@shared/electronApiTypes'
import type { AvailableExternalBrowser, AvailableExternalBrowserResult, ExternalBrowserId } from '@shared/electronApiTypes'
import type { AvailableExternalEditor, ExternalEditorId } from '@shared/electronApiTypes'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { useIosNativePreview } from '@/features/projects/hooks/useIosNativePreview'
import {
  openProjectFileInExternalEditor,
  PREVIEW_EDITOR_PREFERENCE_KEY,
  readStoredExternalEditorPreference,
  resolvePreferredExternalEditorId,
} from '@/features/projects/lib/externalEditorPreference'
import { getPreviewFailurePresentation } from '@/features/projects/lib/previewFailurePresentation'
import { buildDirectVisualEdit } from '@/features/projects/lib/visualEditorPersistence'
import type { TaskOverlayLocationState, TaskOverlayPayload } from '@/features/projects/lib/taskFocusOverlay'
import type { Framework } from '@/utils/projectDetector'

function normalizePreviewPath(path?: string | null): string {
    if (!path) return '/'
    return path.startsWith('/') ? path : `/${path}`
}

function isChromeErrorUrl(url?: string | null): boolean {
    return typeof url === 'string' && url.startsWith('chrome-error://')
}

type PreviewEmbedMode = 'standard' | 'credentialless'

type VisualSaveFeedbackTone = 'default' | 'destructive' | 'success' | 'warning'

interface VisualSaveFeedback {
    isSaving: boolean
    message: string | null
    tone: VisualSaveFeedbackTone
}

const BRIDGE_READY_TIMEOUT_MS = 2500
const PREVIEW_BROWSER_PREFERENCE_KEY = 'cozea.preview.browser'

function resolvePreviewEmbedModeForRun(
    serverStatus: ServerStatus,
    runId: string | null,
    previewTimeline: PreviewTimelineEvent[]
): PreviewEmbedMode {
    if ((serverStatus === 'stopped' || serverStatus === 'error') || !runId) return 'standard'

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
    const { convexUserId } = useAuth()
    const location = useLocation()
    const [searchParams, setSearchParams] = useSearchParams()
    const { project } = useAccessibleProject()
    const syncContext = useOptionalProjectSyncContext()
    const projectPath = syncContext?.projectPath ?? null
    const locationState = (location.state as TaskOverlayLocationState | null) ?? null
    const [taskOverlay, setTaskOverlay] = useState<TaskOverlayPayload | null>(
        () => locationState?.taskOverlay ?? null
    )

    // Store state
    const { routes, serverStatus, serverPort, serverLifecycle, previewReadiness, previewTimeline, actions } = useProjectPagesStore()
    const activeServerRunId = serverLifecycle.runId
    const currentPage = usePageContextStore((state) => state.currentPage)
    const inspectedElement = usePageContextStore((state) => state.inspectedElement)
    const setCurrentPage = usePageContextStore((state) => state.setCurrentPage)
    const setInspectedElement = usePageContextStore((state) => state.setInspectedElement)
    const setPreviewScreenshot = usePageContextStore((state) => state.setPreviewScreenshot)
    const setSelectedElement = useVisualEditorStore((state) => state.setSelectedElement)
    const selectedElement = useVisualEditorStore((state) => state.selectedElement)
    const closeVisualEditor = useVisualEditorStore((state) => state.close)
    const inspectorSide = useVisualEditorStore((state) => state.inspectorSide)
    
    
    const addRuntimeProblem = useProblemsStore((state) => state.actions.addRuntimeProblem)

    // Local state
    const [isScanningAI, setIsScanningAI] = useState(false)
    const [inspectorEnabled, setInspectorEnabled] = useState(false)
    const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false)
    const [visualSaveFeedback, setVisualSaveFeedback] = useState<VisualSaveFeedback>({
        isSaving: false,
        message: null,
        tone: 'default',
    })
    const [bridgeReady, setBridgeReady] = useState(false)
    const [bridgeError, setBridgeError] = useState<string | null>(null)
    const [, setBridgeLogs] = useState<Array<{ time: Date; message: string; type: 'info' | 'error' | 'success' }>>([])
    const [previewEmbedMode, setPreviewEmbedMode] = useState<PreviewEmbedMode>(() =>
        resolvePreviewEmbedModeForRun(serverStatus, activeServerRunId, previewTimeline)
    )
    const [previewEmbedBlocked, setPreviewEmbedBlocked] = useState(false)
    const [previewReloadToken, setPreviewReloadToken] = useState(0)

    const [availableBrowsers, setAvailableBrowsers] = useState<AvailableExternalBrowser[]>([
        { id: 'system', name: 'System Default' },
    ])
    const [availableEditors, setAvailableEditors] = useState<AvailableExternalEditor[]>([])
    const [defaultBrowserId, setDefaultBrowserId] = useState<ExternalBrowserId>('system')
    const [selectedBrowserId, setSelectedBrowserId] = useState<ExternalBrowserId>(() => {
        try {
            const stored = window.localStorage.getItem(PREVIEW_BROWSER_PREFERENCE_KEY)
            switch (stored) {
                case 'system':
                case 'safari':
                case 'chrome':
                case 'arc':
                case 'firefox':
                case 'edge':
                case 'brave':
                    return stored
                default:
                    return 'system'
            }
        } catch {
            return 'system'
        }
    })
    const [selectedEditorId, setSelectedEditorId] = useState<ExternalEditorId>(() => {
        return readStoredExternalEditorPreference() ?? 'vscode'
    })
    const [focusedPageIndex, setFocusedPageIndex] = useState<number | null>(() => {
        // Initialize from URL param if present
        const focus = searchParams.get('focus')
        return focus !== null ? parseInt(focus, 10) : null
    })
    const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const focusedPreviewFrameName = 'cozea-focused-preview-frame'
    const selectionHydrationSeqRef = useRef(0)
    const selectionMutationSeqRef = useRef(0)
    const selectedElementBridgeMetaRef = useRef<BridgeMessage['__cozeaBridgeMeta'] | null>(null)
    const bridgeReadyRef = useRef(false)
    const bridgeReadyTimeoutRef = useRef<number | null>(null)
    const previewFallbackAttemptRef = useRef(0)
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

    const selectedElementPathKey = selectedElement?.path?.join('.') ?? null
    const selectedElementSelector = selectedElement?.selector ?? null

    useEffect(() => {
        setVisualSaveFeedback({
            isSaving: false,
            message: null,
            tone: 'default',
        })
    }, [selectedElementPathKey, selectedElementSelector])

    const storedFrameworkInfo = useMemo<{
        framework: Framework
        devCommand?: string
        devPort?: number
    } | null>(() => {
        if (!project?.frameworkInfo) return null
        return {
            framework: project.frameworkInfo.framework as Framework,
            devCommand: project.frameworkInfo.devCommand ?? undefined,
            devPort: project.frameworkInfo.devPort ?? undefined,
        }
    }, [project?.frameworkInfo])

    // Derived state - must be before any effects that use it
    const focusedRoute = focusedPageIndex !== null ? routes[focusedPageIndex] : null
    const previewRoute = focusedRoute
    const isIosNativePreview = storedFrameworkInfo?.framework === 'expo' || storedFrameworkInfo?.framework === 'react-native'
    const previewServerActive = serverStatus === 'running' || serverStatus === 'unhealthy'
    const nativePreview = useIosNativePreview({
        enabled: isIosNativePreview,
        projectPath,
        serverStatus,
    })
    const nativeStreamUrl = nativePreview.sessionState?.streamUrl ?? null
    const focusedPreviewUrl = !isIosNativePreview && previewRoute && serverPort
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
    const entryRouteIndex = useMemo(() => {
        const homeRouteIndex = routes.findIndex((route) => normalizePreviewPath(route.path) === '/')
        return homeRouteIndex >= 0 ? homeRouteIndex : 0
    }, [routes])
    const compatProjectPreviewPath = normalizePreviewPath(previewRoute?.path ?? defaultProjectPreviewPath)
    const projectPreviewCapturePath = useCredentiallessPreview ? compatProjectPreviewPath : defaultProjectPreviewPath
    const projectPreviewCaptureUrl = buildRoutePreviewUrl(projectPreviewCapturePath)
    const previewReady = !isIosNativePreview && bridgeReady && !previewEmbedBlocked
    const nativePreviewReady = isIosNativePreview && Boolean(nativeStreamUrl)
    const recentPreviewTimeline = useMemo(() => {
        return previewTimeline
            .filter((event) => event.category === 'preview' && (!activeServerRunId || !event.runId || event.runId === activeServerRunId))
            .slice(-6)
            .reverse()
    }, [activeServerRunId, previewTimeline])
    const hasPreviewFailure = !isIosNativePreview && Boolean(bridgeError || previewReadiness.lastFailureMessage || previewReadiness.lastFailureReason)
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
    const showPreviewFailureOverlay = !isIosNativePreview && previewServerActive && (
        previewFailurePresentation?.blocked || previewFailurePresentation?.reason === 'network_quality_degraded'
    )
    const previewLoading = isIosNativePreview
        ? (
            Boolean(previewRoute)
            && (
                    serverStatus === 'starting'
                    || nativePreview.simulatorsLoading
                    || nativePreview.sessionLoading
                    || (
                        previewServerActive
                        && nativePreview.selectedSimulator?.state === 'Booted'
                        && !nativePreviewReady
                    )
                )
        )
        : (
            Boolean(previewRoute)
            && !showPreviewFailureOverlay
            && (
                serverStatus === 'starting'
                || (
                    previewServerActive
                    && Boolean(serverPort)
                    && Boolean(focusedPreviewUrl)
                    && !previewReady
                )
            )
        )
    const isFocusedPreview = Boolean(previewRoute)
    const prevProjectPathRef = useRef<string | null>(null)

    useEffect(() => {
        let cancelled = false

        const loadAvailableBrowsers = async () => {
            try {
                const result = await window.electronAPI.shell.listAvailableBrowsers() as AvailableExternalBrowserResult
                if (cancelled || result.browsers.length === 0) return
                setAvailableBrowsers(result.browsers)
                setDefaultBrowserId(result.defaultBrowserId)
            } catch (error) {
                console.error('[PagesPreview] Failed to load available browsers', error)
            }
        }

        const loadAvailableEditors = async () => {
            try {
                const editors = await window.electronAPI.editor.listAvailableEditors()
                if (cancelled) return
                setAvailableEditors(editors)
            } catch (error) {
                console.error('[PagesPreview] Failed to load available editors', error)
            }
        }

        void loadAvailableBrowsers()
        void loadAvailableEditors()

        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        if (availableBrowsers.some((browser) => browser.id === selectedBrowserId)) return
        setSelectedBrowserId('system')
    }, [availableBrowsers, selectedBrowserId])

    useEffect(() => {
        const resolvedEditorId = resolvePreferredExternalEditorId(availableEditors, selectedEditorId)
        if (!resolvedEditorId || resolvedEditorId === selectedEditorId) return
        setSelectedEditorId(resolvedEditorId)
    }, [availableEditors, selectedEditorId])

    useEffect(() => {
        try {
            window.localStorage.setItem(PREVIEW_BROWSER_PREFERENCE_KEY, selectedBrowserId)
        } catch {
            // Ignore localStorage failures in desktop preview state.
        }
    }, [selectedBrowserId])

    useEffect(() => {
        try {
            window.localStorage.setItem(PREVIEW_EDITOR_PREFERENCE_KEY, selectedEditorId)
        } catch {
            // Ignore localStorage failures in desktop preview state.
        }
    }, [selectedEditorId])

    useEffect(() => {
        if ((serverStatus === 'stopped' || serverStatus === 'error') || !activeServerRunId) {
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

    // Reset project-scoped UI state when switching projects (prevents "wrong project" preview/terminals)
    useEffect(() => {
        const prev = prevProjectPathRef.current
        if (prev && prev !== projectPath) {
            // Clear page routes and focused selection
            actions.setRoutes([])
            setFocusedPageIndex(null)
        }

        prevProjectPathRef.current = projectPath
    }, [projectPath, actions])

    const generatePreviewUploadUrl = useMutation(api.projects.generatePreviewUploadUrl)
    const updatePreviewImage = useMutation(api.projects.updatePreviewImage)
    const generatePreviewUploadUrlForUser = useCallback(
        (args: { projectId: Id<'projects'> }) => {
            if (!convexUserId) {
                throw new Error('Missing user context for preview upload')
            }
            return generatePreviewUploadUrl({ ...args, userId: convexUserId })
        },
        [convexUserId, generatePreviewUploadUrl]
    )
    const updatePreviewImageForUser = useCallback(
        (args: { projectId: Id<'projects'>; storageId: Id<'_storage'> }) => {
            if (!convexUserId) {
                throw new Error('Missing user context for preview upload')
            }
            return updatePreviewImage({ ...args, userId: convexUserId })
        },
        [convexUserId, updatePreviewImage]
    )

    const {
        routes: scannedRoutes,
        refreshRoutes,
    } = useProjectRouteScan({
        enabled: true,
        projectPath,
        storedFrameworkInfo,
    })

    useEffect(() => {
        actions.setRoutes(scannedRoutes.map((route) => ({
            ...route,
            status: 'active' as const,
        })))
    }, [actions, scannedRoutes])

    // Capture home page screenshot and upload as project preview (for Projects dashboard showcase)
    const captureAndUploadProjectPreview = useCallback(async () => {
        const projectId = project?._id
        if (!projectId || !projectPreviewCaptureUrl) return
        try {
            await captureAndUploadProjectPreviewFromUrl(
                projectId,
                projectPreviewCaptureUrl,
                generatePreviewUploadUrlForUser,
                updatePreviewImageForUser
            )
        } catch {
            // Silent: preview capture is best-effort for dashboard
        }
    }, [project?._id, projectPreviewCaptureUrl, generatePreviewUploadUrlForUser, updatePreviewImageForUser])

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

    useEffect(() => {
        if (routes.length === 0) return

        setFocusedPageIndex((current) => {
            if (current !== null && current >= 0 && current < routes.length) {
                return current
            }
            return entryRouteIndex
        })
    }, [entryRouteIndex, routes.length])

    // When closing the inspector (X, Escape), disable inspector, close sidebar and context menu
    const handleCloseInspectorSidebar = useCallback(() => {
        setInspectorEnabled(false)
        manualInspectorEnabled.current = false // allow Shift-to-inspect to work again
        setSelectedElement(null)
        setInspectedElement(null)
        closeVisualEditor()
    }, [setSelectedElement, setInspectedElement, closeVisualEditor])

    const handleSelectPreviewRoute = useCallback((routePath: string) => {
        const normalizedRoute = normalizePreviewPath(routePath)
        const routeIndex = routes.findIndex((route) => normalizePreviewPath(route.path) === normalizedRoute)
        if (routeIndex >= 0) {
            setFocusedPageIndex(routeIndex)
        }
    }, [routes])

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
        if (previewServerActive) return
        clearBridgeReadyTimeout()
        setBridgeReady(false)
        setPreviewEmbedBlocked(false)
        previewFallbackAttemptRef.current = 0
        actions.resetPreviewReadiness()
    }, [actions, clearBridgeReadyTimeout, previewServerActive])

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

        const logVisualEditorSelectionPayload = (
            eventName: 'bridge:element-selected' | 'bridge:element-contextmenu',
            data: SelectedElementData | ElementContextMenuData,
            context: {
                origin: string
                sourceWindowName: string | null
                sourceMatchesActiveWindow: boolean
                sourceMatchesByFrameName: boolean
                sourceMatchesByBridgeMeta: boolean
                bridgeMeta: BridgeMessage['__cozeaBridgeMeta']
            },
        ) => {
            const styles = data.computedStyles ?? {}
            console.log(`[VisualEditor][${eventName}]`, {
                origin: context.origin,
                sourceWindowName: context.sourceWindowName,
                sourceMatchesActiveWindow: context.sourceMatchesActiveWindow,
                sourceMatchesByFrameName: context.sourceMatchesByFrameName,
                sourceMatchesByBridgeMeta: context.sourceMatchesByBridgeMeta,
                bridgeMeta: context.bridgeMeta ?? null,
                selector: data.selector,
                tagName: data.tagName,
                className: data.className,
                id: data.id ?? null,
                path: data.path ?? null,
                textContent: data.textContent ?? null,
                computedStyles: {
                    fontFamily: styles.fontFamily ?? null,
                    fontSize: styles.fontSize ?? null,
                    fontWeight: styles.fontWeight ?? null,
                    fontStyle: styles.fontStyle ?? null,
                    lineHeight: styles.lineHeight ?? null,
                    letterSpacing: styles.letterSpacing ?? null,
                    textAlign: styles.textAlign ?? null,
                    textDecoration: styles.textDecoration ?? null,
                    textTransform: styles.textTransform ?? null,
                    color: styles.color ?? null,
                    backgroundColor: styles.backgroundColor ?? null,
                    width: styles.width ?? null,
                    height: styles.height ?? null,
                },
            })
        }

        const hydrateSelectedElementFromInspector = async (
            data: SelectedElementData,
            bridgeMeta: BridgeMessage['__cozeaBridgeMeta'],
        ) => {
            const requestId = ++selectionHydrationSeqRef.current
            selectedElementBridgeMetaRef.current = bridgeMeta ?? null
            setSelectedElement(data)

            const inspectSelection = window.electronAPI?.preview?.inspectSelection
            const targetUrl = bridgeMeta?.href ?? iframeRef.current?.src
            if (!inspectSelection || !targetUrl) return

            try {
                const result = await inspectSelection({
                    url: targetUrl,
                    frameName: bridgeMeta?.frameName ?? focusedPreviewFrameName,
                    bridgeInstanceId: bridgeMeta?.instanceId,
                    selector: data.selector,
                    path: data.path,
                })

                if (!result.success || !result.snapshot) {
                    console.warn(`[VisualEditor][devtools:inspectSelection] Failed to hydrate selection: ${result.error ?? 'Unknown inspector error'}`, {
                        selector: data.selector,
                        error: result.error ?? 'Unknown inspector error',
                    })
                    return
                }

                if (selectionHydrationSeqRef.current !== requestId) return
                console.log('[VisualEditor][devtools:inspectSelection]', result.snapshot)
                setSelectedElement(result.snapshot as SelectedElementData)
            } catch (error) {
                console.warn('[VisualEditor][devtools:inspectSelection] Unexpected failure', {
                    selector: data.selector,
                    error: error instanceof Error ? error.message : String(error),
                })
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
                    if (selectedElement?.path?.length && iframeRef.current) {
                        sendBridgeMessage(iframeRef.current, { type: 'host:enable-inspector' })
                        sendBridgeMessage(iframeRef.current, {
                            type: 'host:restore-selection',
                            payload: {
                                path: selectedElement.path,
                                selector: selectedElement.selector,
                            },
                        })
                    }
                    break

                case 'bridge:dom-snapshot': {
                    const data = payload as { html?: string }
                    if (data.html) {
                        actions.setLatestDomSnapshot(data.html)
                    }
                    break
                }

                case 'bridge:element-selected':
                    logVisualEditorSelectionPayload(
                        'bridge:element-selected',
                        payload as SelectedElementData,
                        {
                            origin: event.origin,
                            sourceWindowName,
                            sourceMatchesActiveWindow,
                            sourceMatchesByFrameName,
                            sourceMatchesByBridgeMeta,
                            bridgeMeta,
                        },
                    )
                    /*  */
                    void hydrateSelectedElementFromInspector(payload as SelectedElementData, bridgeMeta)
                    break
                case 'bridge:selection-cleared':
                    setSelectedElement(null)
                    selectedElementBridgeMetaRef.current = null
                    setInspectedElement(null)
                    closeVisualEditor()
                    break

                case 'bridge:element-contextmenu': {
                    const data = payload as ElementContextMenuData
                    logVisualEditorSelectionPayload(
                        'bridge:element-contextmenu',
                        data,
                        {
                            origin: event.origin,
                            sourceWindowName,
                            sourceMatchesActiveWindow,
                            sourceMatchesByFrameName,
                            sourceMatchesByBridgeMeta,
                            bridgeMeta,
                        },
                    )

                    // Keep visual editor selection in sync
                    closeVisualEditor()
                    /*  */
                    void hydrateSelectedElementFromInspector(data as unknown as SelectedElementData, bridgeMeta)

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

                    if (window.electronAPI?.contextMenu?.showVisualEditorMenu) {
                        void window.electronAPI.contextMenu.showVisualEditorMenu({
                            x: Math.round(x),
                            y: Math.round(y),
                            hasReactSource: !!data.react?.source?.fileName,
                            hasReactStack: !!data.react?.componentStack?.length,
                        }).then(({ action }) => {
                            if (action === 'ask-ai') {
                                const stack = data.react?.componentStack?.join(' > ')
                                const pageInfo = focusedRoute ? `${focusedRoute.path} (${focusedRoute.file})` : undefined
                                const selector = data.selector
                                const prompt = [
                                    'I right-clicked an element in the preview inspector.',
                                    pageInfo ? `Page: ${pageInfo}` : null,
                                    `Selector: ${selector}`,
                                    stack ? `React component stack: ${stack}` : null,
                                    '',
                                    'What I want to change:',
                                ].filter(Boolean).join('\n')
                                console.log(prompt)
                            } else if (action === 'copy-selector') {
                                void navigator.clipboard.writeText(data.selector)
                            } else if (action === 'copy-stack') {
                                const stack = data.react?.componentStack?.join(' > ')
                                if (stack) void navigator.clipboard.writeText(stack)
                            } else if (action === 'open-source') {
                                const fileName = data.react?.source?.fileName
                                if (!fileName) return
                                void openProjectFileInExternalEditor({
                                    availableEditors,
                                    filePath: fileName,
                                    line: data.react?.source?.lineNumber,
                                    column: data.react?.source?.columnNumber,
                                    preferredEditorId: selectedEditorId,
                                    projectPath,
                                }).then((result) => {
                                    if (!result.success) {
                                        console.error('[PagesPreview] Failed to open source from inspector', result.error)
                                    }
                                })
                            }
                        })
                    }

                    break
                }

                case 'bridge:screenshot-ready': {
                    const data = payload as { dataUrl_unused?: string; error?: string }
                    if (data.error) {
                        setBridgeError(data.error)
                    } else if (data.dataUrl_unused && focusedRoute) {
                        /* const attachment: any = {
                            type: 'image',
                            data: data.dataUrl_unused,
                            name: `screenshot-${focusedRoute.path.replace(/\//g, '-') || 'preview'}.png`,
                            mediaType: 'image/png',
                            context: {
                                pagePath: focusedRoute.path,
                                pageFile: focusedRoute.file,
                                projectName: project?.name,
                                serverPort: serverPort ?? undefined,
                            },
                        } */
                        /*  */
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
                    const matchedRoute = matchedIndex !== null ? routes[matchedIndex] : null
                    setCurrentPage({
                        route: navigationPath,
                        filePath: matchedRoute?.file ?? focusedRoute?.file ?? '',
                        componentName: matchedRoute?.name ?? focusedRoute?.name ?? navigationPath,
                        serverPort: serverPort ?? undefined,
                        lastUpdated: Date.now(),
                    })
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
    }, [handleCloseInspectorSidebar, inspectorEnabled, focusedRoute, project?.name, serverPort, setSelectedElement, setInspectedElement, setCurrentPage, routes, focusedPageIndex, shiftInspectorActive, previewReady, closeVisualEditor, addRuntimeProblem, projectPath, isFocusedPreview, addBridgeLog, previewRoute?.path, clearBridgeReadyTimeout, previewEmbedMode, addPreviewTimelineEvent, actions, activeServerRunId, setPreviewFailure, selectedElement, availableEditors, selectedEditorId])

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
    }, [actions, activeServerRunId, addBridgeLog, addPreviewTimelineEvent, clearBridgeReadyTimeout, focusedPreviewUrl, isFocusedPreview, previewEmbedMode, previewRoute?.path, scheduleBridgeReadyTimeout, setPreviewFailure])

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
    }, [addBridgeLog, addPreviewTimelineEvent, clearBridgeReadyTimeout, previewEmbedMode, previewRoute?.path, scheduleBridgeReadyTimeout, setPreviewFailure])

    // Attempt to reinject bridge if not ready
    const ensureBridgeReady = useCallback((): boolean => {
        if (previewReady) return true
        void retryBridgeInjection()
        return false
    }, [previewReady, retryBridgeInjection])

    // Handle screenshot capture
    const handleCaptureScreenshot = useCallback(async () => {
        if (!iframeRef.current || !previewServerActive) return

        if (!previewReady) {
            ensureBridgeReady()
            setBridgeError('Preview bridge not ready. Try again in a moment.')
            return
        }

        setIsCapturingScreenshot(true)
        setBridgeError(null)

        try {
            sendBridgeMessage(iframeRef.current, { type: 'host:hide-overlays' })
            await new Promise((resolve) => setTimeout(resolve, 50))
            
            const iframe = iframeRef.current
            const rect = iframe.getBoundingClientRect()
            
            const result = await window.electronAPI.preview.captureVisibleRegion({
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            })
            
            sendBridgeMessage(iframeRef.current, { type: 'host:show-overlays' })
            
            if (!result.success || !result.base64) {
                setBridgeError(result.error || 'Failed to capture native screenshot')
                setIsCapturingScreenshot(false)
                return
            }
            
             
            if (focusedRoute) {
                /* const attachment: any = {
                    type: 'image',
                    data: dataUrl_unused,
                    name: `screenshot-${focusedRoute.path.replace(/\//g, '-') || 'preview'}.png`,
                    mediaType: 'image/png',
                    context: {
                        pagePath: focusedRoute.path,
                        pageFile: focusedRoute.file,
                        projectName: project?.name,
                        serverPort: serverPort ?? undefined,
                    }
                }
                /*  */
            }
        } catch (error) {
            setBridgeError(error instanceof Error ? error.message : String(error))
            if (iframeRef.current) sendBridgeMessage(iframeRef.current, { type: 'host:show-overlays' })
        } finally {
            setIsCapturingScreenshot(false)
        }
    }, [previewReady, ensureBridgeReady, focusedRoute, previewServerActive, project?.name, serverPort])

    useEffect(() => {
        setPreviewScreenshot({
            visible: Boolean(previewRoute && previewServerActive && serverPort),
            enabled: Boolean(previewReady && !previewEmbedBlocked && previewServerActive && serverPort),
            capturing: isCapturingScreenshot,
        })
    }, [
        isCapturingScreenshot,
        previewEmbedBlocked,
        previewReady,
        previewRoute,
        previewServerActive,
        serverPort,
        setPreviewScreenshot,
    ])

    useEffect(() => {
        return () => {
            setPreviewScreenshot({
                visible: false,
                enabled: false,
                capturing: false,
            })
        }
    }, [setPreviewScreenshot])

    useEffect(() => {
        const handlePreviewScreenshotRequest = () => {
            void handleCaptureScreenshot()
        }

        window.addEventListener(PREVIEW_SCREENSHOT_REQUEST_EVENT, handlePreviewScreenshotRequest)
        return () => {
            window.removeEventListener(PREVIEW_SCREENSHOT_REQUEST_EVENT, handlePreviewScreenshotRequest)
        }
    }, [handleCaptureScreenshot])

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
        const updateSelectionStyles = window.electronAPI?.preview?.updateSelectionStyles
        const targetUrl = selectedElementBridgeMetaRef.current?.href ?? iframeRef.current?.src

        if (!updateSelectionStyles || !targetUrl || !selectedElement) {
            return
        }

        const requestId = ++selectionMutationSeqRef.current

        void updateSelectionStyles({
            url: targetUrl,
            frameName: selectedElementBridgeMetaRef.current?.frameName ?? focusedPreviewFrameName,
            bridgeInstanceId: selectedElementBridgeMetaRef.current?.instanceId,
            selector: selectedElement.selector,
            path: selectedElement.path,
            styles,
        }).then((result) => {
            if (!result.success || !result.snapshot) {
                console.warn(`[VisualEditor][devtools:updateSelectionStyles] Failed: ${result.error ?? 'Unknown mutation error'}`, {
                    selector: selectedElement.selector,
                    styles,
                    error: result.error ?? 'Unknown mutation error',
                })
                return
            }

            if (selectionMutationSeqRef.current !== requestId) return
            setSelectedElement(result.snapshot as SelectedElementData)
        }).catch((error) => {
            console.warn('[VisualEditor][devtools:updateSelectionStyles] Unexpected failure', {
                selector: selectedElement.selector,
                styles,
                error: error instanceof Error ? error.message : String(error),
            })
        })
    }, [focusedPreviewFrameName, selectedElement, setSelectedElement])

    // Handle visual editor text preview
    const handlePreviewText = useCallback((text: string) => {
        const updateSelectionText = window.electronAPI?.preview?.updateSelectionText
        const targetUrl = selectedElementBridgeMetaRef.current?.href ?? iframeRef.current?.src

        if (!updateSelectionText || !targetUrl || !selectedElement) {
            return
        }

        const requestId = ++selectionMutationSeqRef.current

        void updateSelectionText({
            url: targetUrl,
            frameName: selectedElementBridgeMetaRef.current?.frameName ?? focusedPreviewFrameName,
            bridgeInstanceId: selectedElementBridgeMetaRef.current?.instanceId,
            selector: selectedElement.selector,
            path: selectedElement.path,
            text,
        }).then((result) => {
            if (!result.success || !result.snapshot) {
                console.warn(`[VisualEditor][devtools:updateSelectionText] Failed: ${result.error ?? 'Unknown mutation error'}`, {
                    selector: selectedElement.selector,
                    textLength: text.length,
                    error: result.error ?? 'Unknown mutation error',
                })
                return
            }

            if (selectionMutationSeqRef.current !== requestId) return
            setSelectedElement(result.snapshot as SelectedElementData)
        }).catch((error) => {
            console.warn('[VisualEditor][devtools:updateSelectionText] Unexpected failure', {
                selector: selectedElement.selector,
                textLength: text.length,
                error: error instanceof Error ? error.message : String(error),
            })
        })
    }, [focusedPreviewFrameName, selectedElement, setSelectedElement])

    const openVisualEditAssistantFallback = useCallback(() => {
        const { pendingAttributes, pendingChanges, pendingTextChange, selectedElement } = useVisualEditorStore.getState()
        if (!selectedElement) return

        const changes = Object.entries(pendingChanges)
            .map(([prop, value]) => `${prop}: ${value}`)
            .join('; ')
        const attributeChanges = Object.entries(pendingAttributes)
            .map(([attribute, value]) => `${attribute}: ${value}`)
            .join('; ')

        const promptParts = [`Update the element "${selectedElement.selector}"`]
        if (changes.length > 0) {
            promptParts.push(`with styles: ${changes}`)
        }
        if (attributeChanges.length > 0) {
            promptParts.push(`with attributes: ${attributeChanges}`)
        }
        if (pendingTextChange !== null) {
            promptParts.push(`and text content: "${pendingTextChange}"`)
        }
        const prompt = promptParts.join(' ')
        console.log(prompt)
    }, [])

    const handleApplyChanges = useCallback(async () => {
        const visualEditorState = useVisualEditorStore.getState()
        const {
            pendingAttributes,
            pendingChanges,
            pendingTextChange,
            selectedElement: currentSelectedElement,
        } = visualEditorState

        if (!currentSelectedElement || !projectPath || !project?._id || !convexUserId) {
            return
        }

        setVisualSaveFeedback({
            isSaving: true,
            message: 'Saving visual edits…',
            tone: 'default',
        })

        const directEditResult = await buildDirectVisualEdit({
            projectPath,
            currentPageFilePath: currentPage?.filePath ?? null,
            inspectedElement,
            pendingAttributes,
            pendingChanges,
            pendingTextChange,
            selectedElement: currentSelectedElement,
        })

        if (!directEditResult.ok) {
            if (directEditResult.reason === 'unsupported') {
                openVisualEditAssistantFallback()
                setVisualSaveFeedback({
                    isSaving: false,
                    message: `${directEditResult.error} Assistant fallback opened.`,
                    tone: 'warning',
                })
                return
            }

            setVisualSaveFeedback({
                isSaving: false,
                message: directEditResult.error,
                tone: 'destructive',
            })
            return
        }

        const writeResult = await window.electronAPI.sync.writeFiles({
            projectPath,
            files: [{
                path: directEditResult.value.filePath,
                content: directEditResult.value.content,
            }],
            opMeta: {
                projectId: String(project._id),
                actorId: String(convexUserId),
                actorType: 'user',
                source: 'monaco',
            },
        })

        const writeSucceeded = writeResult.successCount === 1 && writeResult.results.every((result) => result.success)
        if (!writeSucceeded) {
            const failure = writeResult.results.find((result) => !result.success)
            setVisualSaveFeedback({
                isSaving: false,
                message: failure?.error ?? 'Failed to persist visual edits.',
                tone: 'destructive',
            })
            return
        }

        visualEditorState.setSelectedElement({
            ...currentSelectedElement,
            className: pendingAttributes.className ?? currentSelectedElement.className,
            id: pendingAttributes.id ?? currentSelectedElement.id,
            textContent: pendingTextChange ?? currentSelectedElement.textContent,
            computedStyles: {
                ...currentSelectedElement.computedStyles,
                ...pendingChanges,
            },
        })
        visualEditorState.clearPendingChanges()
        setVisualSaveFeedback({
            isSaving: false,
            message: null,
            tone: 'default',
        })
    }, [convexUserId, currentPage?.filePath, inspectedElement, openVisualEditAssistantFallback, project?._id, projectPath])

    const handleOpenCode = useCallback(async (file: string, line?: number, column?: number) => {
        const result = await openProjectFileInExternalEditor({
            availableEditors,
            filePath: file,
            line,
            column,
            preferredEditorId: selectedEditorId,
            projectPath,
        })
        if (!result.success) {
            console.error('[PagesPreview] Failed to open file in external editor', result.error)
        }
    }, [availableEditors, projectPath, selectedEditorId])

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

    const externalPreviewUrl = isIosNativePreview ? nativeStreamUrl : focusedPreviewUrl

    const openFocusedPreviewExternally = useCallback(() => {
        if (!externalPreviewUrl) return
        void (async () => {
            const result = await window.electronAPI.shell.openInBrowser({
                url: externalPreviewUrl,
                browserId: selectedBrowserId === 'system' ? defaultBrowserId : selectedBrowserId,
            })
            if (!result.success) {
                console.error('[PagesPreview] Failed to open preview in browser', result.error)
            }
        })()
    }, [defaultBrowserId, externalPreviewUrl, selectedBrowserId])

    const handleNativeSendTouches = useCallback(async (request: {
        type: 'start' | 'move' | 'end'
        touches: Array<{ xRatio: number; yRatio: number }>
        rotation?: 'Portrait' | 'LandscapeLeft' | 'LandscapeRight' | 'PortraitUpsideDown'
    }) => {
        if (!projectPath || !nativePreview.selectedSimulator) {
            return
        }

        await window.electronAPI.nativePreview.sendTouches({
            projectPath,
            deviceId: nativePreview.selectedSimulator.udid,
            platform: 'ios',
            ...request,
        })
    }, [nativePreview.selectedSimulator, projectPath])

    const handleNativeSendWheel = useCallback(async (request: {
        point: { xRatio: number; yRatio: number }
        deltaX: number
        deltaY: number
    }) => {
        if (!projectPath || !nativePreview.selectedSimulator) {
            return
        }

        await window.electronAPI.nativePreview.sendWheel({
            projectPath,
            deviceId: nativePreview.selectedSimulator.udid,
            platform: 'ios',
            ...request,
        })
    }, [nativePreview.selectedSimulator, projectPath])

    const handleNativeSendKey = useCallback(async (request: {
        direction: 'down' | 'up'
        keyCode: number
    }) => {
        if (!projectPath || !nativePreview.selectedSimulator) {
            return
        }

        await window.electronAPI.nativePreview.sendKey({
            projectPath,
            deviceId: nativePreview.selectedSimulator.udid,
            platform: 'ios',
            ...request,
        })
    }, [nativePreview.selectedSimulator, projectPath])

    const headerControls = useMemo(() => (
        <ProjectPreviewToolbar
            availableBrowsers={availableBrowsers}
            availableEditors={availableEditors}
            defaultBrowserId={defaultBrowserId}
            inspectorEnabled={inspectorEnabled}
            onOpenCode={() => {
                if (previewRoute) {
                    void handleOpenCode(previewRoute.file)
                }
            }}
            onOpenExternally={openFocusedPreviewExternally}
            onSelectedEditorChange={setSelectedEditorId}
            onSelectedBrowserChange={setSelectedBrowserId}
            onToggleInspector={toggleInspector}
            inspectorSupported={!isIosNativePreview}
            previewEmbedBlocked={isIosNativePreview ? false : previewEmbedBlocked}
            previewLoading={previewLoading}
            previewReady={isIosNativePreview ? nativePreviewReady : previewReady}
            selectedEditorId={selectedEditorId}
            selectedBrowserId={selectedBrowserId}
            serverRunning={previewServerActive && (isIosNativePreview ? Boolean(nativePreview.selectedSimulator) : Boolean(serverPort))}
            useCredentiallessPreview={useCredentiallessPreview}
        />
    ), [
        availableBrowsers,
        availableEditors,
        defaultBrowserId,
        inspectorEnabled,
        isIosNativePreview,
        nativePreview.selectedSimulator,
        nativePreviewReady,
        previewEmbedBlocked,
        previewLoading,
        previewReady,
        handleOpenCode,
        openFocusedPreviewExternally,
        selectedEditorId,
        selectedBrowserId,
        previewRoute,
        previewServerActive,
        serverPort,
        toggleInspector,
        useCredentiallessPreview,
    ])

    const serverControlBreadcrumbAddon = useMemo(() => (
        <div className="flex items-center gap-2">
            <div className="h-4 w-px shrink-0 bg-border/60" />
            <ServerControl
                projectPath={projectPath}
                projectId={project?._id ?? null}
                storedDevCommand={storedFrameworkInfo?.devCommand}
                storedDevPort={storedFrameworkInfo?.devPort}
                previewMode={isIosNativePreview ? 'native' : 'web'}
                nativePlatform={isIosNativePreview ? 'ios' : null}
            />
        </div>
    ), [
        isIosNativePreview,
        project?._id,
        projectPath,
        storedFrameworkInfo?.devCommand,
        storedFrameworkInfo?.devPort,
    ])

    const focusedPreviewBreadcrumbAddon = useMemo(() => (
        <div className="flex min-w-0 items-center gap-2">
            {headerControls}
            {serverControlBreadcrumbAddon}
        </div>
    ), [headerControls, serverControlBreadcrumbAddon])

    const focusedPreviewCenterAddon = useMemo(() => {
        if (routes.length === 0) return null
        return (
            <ProjectPreviewRouteBar
                currentRoute={previewRoute}
                currentPath={currentPage?.route ?? previewRoute?.path ?? null}
                device={device}
                routes={routes}
                onCycleDevice={() => {
                    setDevice((current) => {
                        if (current === 'desktop') return 'tablet'
                        if (current === 'tablet') return 'mobile'
                        return 'desktop'
                    })
                }}
                onSelectRoute={(route) => handleSelectPreviewRoute(route.path)}
            />
        )
    }, [
        currentPage?.route,
        device,
        handleSelectPreviewRoute,
        previewRoute,
        routes,
    ])

    useProjectHeader(
        null,
        focusedPreviewBreadcrumbAddon,
        focusedPreviewCenterAddon,
        true
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
                "h-[calc(100%+2.5rem)] -mt-10"
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
                        saveFeedback={{
                            message: visualSaveFeedback.message,
                            tone: visualSaveFeedback.tone,
                        }}
                        savePending={visualSaveFeedback.isSaving}
                    />
                )}

                <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
                    {/* Content */}
                    <div className="relative flex-1 overflow-hidden flex flex-col pt-10">
                        {routes.length === 0 ? (
                            /* Empty State */
                            <div
                                key="pages-empty"
                                className="app-scrollbar flex-1 overflow-y-auto px-6 pb-6 pt-16"
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
                                {previewRoute ? (
                                    <div className="absolute inset-0 flex min-h-0 min-w-0 overflow-hidden">
                                        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                                            {isIosNativePreview ? (
                                                <IosSimulatorViewport
                                                    device={device}
                                                    route={previewRoute}
                                                    serverRunning={previewServerActive}
                                                    sessionState={nativePreview.sessionState}
                                                    simulators={nativePreview.iosSimulators}
                                                    selectedSimulatorId={nativePreview.selectedIosSimulatorId}
                                                    simulatorsLoading={nativePreview.simulatorsLoading}
                                                    simulatorsError={nativePreview.simulatorsError}
                                                    sessionLoading={nativePreview.sessionLoading}
                                                    sessionError={nativePreview.sessionError}
                                                    taskOverlay={taskOverlay}
                                                    onSelectSimulator={nativePreview.setSelectedIosSimulatorId}
                                                    onRefreshSimulators={nativePreview.refreshSimulators}
                                                    onOpenExternally={openFocusedPreviewExternally}
                                                    onSendTouches={handleNativeSendTouches}
                                                    onSendWheel={handleNativeSendWheel}
                                                    onSendKey={handleNativeSendKey}
                                                />
                                            ) : (
                                                <FocusedProjectPreview
                                                    credentiallessAttribute={credentiallessAttribute}
                                                    device={device}
                                                    focusedPreviewFrameName={focusedPreviewFrameName}
                                                    focusedPreviewUrl={focusedPreviewUrl}
                                                    iframeRef={iframeRef}
                                                    onIframeError={handleFocusedIframeError}
                                                    onIframeLoad={handleIframeLoad}
                                                    onOpenExternally={openFocusedPreviewExternally}
                                                    onRetryPreview={() => reloadFocusedPreview('manual')}
                                                    previewEmbedBlocked={previewEmbedBlocked}
                                                    previewEmbedMode={previewEmbedMode}
                                                    previewFailureMessage={previewFailurePresentation?.message ?? 'This page blocks iframe embedding in isolated mode.'}
                                                    previewFailureTitle={previewFailurePresentation?.title ?? 'Embedded preview unavailable'}
                                                    previewLoading={previewLoading}
                                                    previewReloadToken={previewReloadToken}
                                                    recentPreviewTimeline={recentPreviewTimeline}
                                                    route={previewRoute}
                                                    serverRunning={previewServerActive && Boolean(serverPort)}
                                                    showPreviewFailureOverlay={showPreviewFailureOverlay}
                                                    taskOverlay={taskOverlay}
                                                />
                                            )}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        )}

                    </div>

                    {/* Terminal Panel */}
                    {projectPath && (
                        <TerminalPanel
                            projectPath={projectPath}
                            onOpenFile={handleOpenCode}
                        />
                    )}
                </div>

                {isFocusedPreview && inspectorSide === 'right' && (
                    <VisualEditorSidebar
                        onPreviewStyle={handlePreviewStyle}
                        onPreviewText={handlePreviewText}
                        onApplyChanges={handleApplyChanges}
                        onClose={handleCloseInspectorSidebar}
                        saveFeedback={{
                            message: visualSaveFeedback.message,
                            tone: visualSaveFeedback.tone,
                        }}
                        savePending={visualSaveFeedback.isSaving}
                    />
                )}
            </div>

            {/* (Removed custom inspector context menu in favor of native Electron menu) */}
        </div>
    )
}
