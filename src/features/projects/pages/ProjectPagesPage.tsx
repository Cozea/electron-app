import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation } from 'convex/react'
import { motion } from 'framer-motion'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useProjectPagesStore } from '@/stores/useProjectPagesStore'
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
import { CompactPresenceIndicator, type CompactPresenceUser } from '@/components/presence/CompactPresenceIndicator'

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

function normalizeFilePath(path?: string | null): string | null {
    if (!path) return null
    return path.replace(/\\/g, '/')
}

export function ProjectPagesPage() {
    const { slug } = useParams<{ slug: string }>()
    const navigate = useNavigate()
    const [searchParams, setSearchParams] = useSearchParams()
    const { currentOrganization } = useAuth()
    const syncContext = useOptionalProjectSyncContext()
    const projectPath = syncContext?.projectPath ?? null

    // Store state
    const { routes, serverStatus, serverPort, actions } = useProjectPagesStore()
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
    const [, setBridgeError] = useState<string | null>(null)
    const [, setBridgeLogs] = useState<Array<{ time: Date; message: string; type: 'info' | 'error' | 'success' }>>([])
    const [focusedPageIndex, setFocusedPageIndex] = useState<number | null>(() => {
        // Initialize from URL param if present
        const focus = searchParams.get('focus')
        return focus !== null ? parseInt(focus, 10) : null
    })
    const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
    const [zoom, setZoom] = useState(100)
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
    const [toolbarTooltip, setToolbarTooltip] = useState<'screenshot' | 'inspector' | 'preview' | null>(null)
    const [cachedFocusedRoutePath, setCachedFocusedRoutePath] = useState<string | null>(null)
    const focusedIframeLoadedPathRef = useRef<string | null>(null)
    const focusedPreviewFrameName = 'cozea-focused-preview-frame'

    // Shift-to-inspect: track whether inspector was enabled via Shift key
    const [shiftInspectorActive, setShiftInspectorActive] = useState(false)
    const manualInspectorEnabled = useRef(false)

    // Derived state - must be before any effects that use it
    const focusedRoute = focusedPageIndex !== null ? routes[focusedPageIndex] : null
    const cachedFocusedRoute = useMemo(
        () => cachedFocusedRoutePath ? routes.find((route) => route.path === cachedFocusedRoutePath) ?? null : null,
        [routes, cachedFocusedRoutePath]
    )
    const previewRoute = focusedRoute ?? cachedFocusedRoute
    const previewRouteIndex = useMemo(() => {
        if (focusedPageIndex !== null) return focusedPageIndex
        if (!previewRoute) return null
        const index = routes.findIndex((route) => route.path === previewRoute.path)
        return index >= 0 ? index : null
    }, [focusedPageIndex, previewRoute, routes])
    const isFocusedPreview = focusedPageIndex !== null && Boolean(focusedRoute)
    const shouldElevateInspectorSidebar = isFocusedPreview && visualEditorOpen
    const headerInsetLeft = isFocusedPreview && visualEditorOpen && inspectorSide === 'left' ? visualEditorWidth : 0
    const headerInsetRight = isFocusedPreview && visualEditorOpen && inspectorSide === 'right' ? visualEditorWidth : 0
    const prevProjectPathRef = useRef<string | null>(null)

    useEffect(() => {
        if (focusedRoute?.path) {
            setCachedFocusedRoutePath(focusedRoute.path)
        }
    }, [focusedRoute?.path])

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

    // Get Convex organization
    const convexOrg = useQuery(
        api.organizations.getByWorkosId,
        currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
    )

    // Load project by slug
    const project = useQuery(
        api.projects.getBySlug,
        convexOrg?._id && slug ? { organizationId: convexOrg._id, slug } : 'skip'
    )

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
        if (!serverPort || !projectId) return
        const url = `http://localhost:${serverPort}/`
        try {
            const result = await window.electronAPI.preview.captureScreenshot({
                url,
                width: 1280,
                height: 800,
            })
            if (!result.success || !result.base64) return
            const byteString = atob(result.base64)
            const ab = new ArrayBuffer(byteString.length)
            const ia = new Uint8Array(ab)
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i)
            const blob = new Blob([ab], { type: 'image/png' })
            const uploadUrl = await generatePreviewUploadUrl({ projectId })
            const uploadResponse = await fetch(uploadUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'image/png' },
                body: blob,
            })
            if (!uploadResponse.ok) return
            const data = await uploadResponse.json()
            const storageId = data?.storageId ?? data
            if (!storageId) return
            await updatePreviewImage({ projectId, storageId })
        } catch {
            // Silent: preview capture is best-effort for dashboard
        } finally {
            setIsCapturingPreview(false)
        }
    }, [project?._id, serverPort, generatePreviewUploadUrl, updatePreviewImage])

    const handleUpdateProjectPreview = useCallback(() => {
        if (serverStatus !== 'running' || !project?._id) return
        setIsCapturingPreview(true)
        void captureAndUploadProjectPreview()
    }, [serverStatus, project?._id, captureAndUploadProjectPreview])

    // When dev server becomes ready, capture home page (showcase for Projects page) after delay; retry once later
    useEffect(() => {
        if (serverStatus !== 'running' || !serverPort || !project?._id) return
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
    }, [serverStatus, serverPort, project?._id, captureAndUploadProjectPreview])

    // On exit from Pages page: capture latest home page and replace project showcase
    useEffect(() => {
        return () => {
            if (serverStatus === 'running' && serverPort && project?._id) {
                void captureAndUploadProjectPreview()
            }
        }
    }, [serverStatus, serverPort, project?._id, captureAndUploadProjectPreview])

    // Handle focus query param from PagesList clicks
    useEffect(() => {
        const focus = searchParams.get('focus')
        if (focus !== null && routes.length > 0) {
            const index = parseInt(focus, 10)
            if (index >= 0 && index < routes.length) {
                setFocusedPageIndex(index)
            }
            // Clear the param after setting focus
            const nextParams = new URLSearchParams(searchParams)
            nextParams.delete('focus')
            setSearchParams(nextParams, { replace: true })
        }
    }, [searchParams, routes.length, setSearchParams])

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
        console.log(`[Bridge] ${message}`)
    }, [])

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
                    if (!manualInspectorEnabled.current && bridgeReady) {
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
                    // Bridge is ready
                    setBridgeReady(true)
                    setBridgeError(null)
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
    }, [handleCloseInspectorSidebar, inspectorEnabled, focusedRoute, project?.name, serverPort, setSelectedElement, setInspectedElement, openWithScreenshot, closeAssistantPanel, routes, focusedPageIndex, shiftInspectorActive, bridgeReady, closeVisualEditor, addRuntimeProblem, projectPath, isFocusedPreview, addBridgeLog, previewRoute?.path])

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
            if (e.key === 'Shift' && !e.repeat && isFocusedPreview && !manualInspectorEnabled.current && bridgeReady) {
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
    }, [shiftInspectorActive, bridgeReady, inspectorEnabled, focusedPageIndex, handleCloseInspectorSidebar, setSelectedElement, setInspectedElement, closeVisualEditor, isFocusedPreview])

    // Inject bridge script when iframe loads
    const handleIframeLoad = useCallback(async () => {
        if (previewRoute?.path) {
            focusedIframeLoadedPathRef.current = previewRoute.path
        }
        if (!isFocusedPreview) {
            return
        }

        // Reset bridge state before injection
        setBridgeReady(false)
        setBridgeError(null)
        const frameName = iframeRef.current?.getAttribute('name') || 'unnamed-frame'
        addBridgeLog(`Iframe loaded for ${previewRoute?.path ?? 'unknown route'} [${frameName}], attempting injection...`)

        if (iframeRef.current) {
            try {
                const success = await injectBridgeScript(iframeRef.current)
                if (success) {
                    addBridgeLog('Script injected, waiting for bridge:ready...')
                } else {
                    setBridgeError('Cannot inject into preview (cross-origin)')
                    addBridgeLog('Injection failed: cross-origin restriction', 'error')
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Unknown error'
                setBridgeError(`Injection error: ${msg}`)
                addBridgeLog(`Injection error: ${msg}`, 'error')
            }
        }
    }, [addBridgeLog, previewRoute?.path, isFocusedPreview])

    // Attempt to reinject bridge if not ready
    const retryBridgeInjection = useCallback(async () => {
        if (!iframeRef.current) {
            addBridgeLog('No iframe available', 'error')
            return false
        }

        const frameName = iframeRef.current.getAttribute('name') || 'unnamed-frame'
        addBridgeLog(`Retrying injection for ${previewRoute?.path ?? 'unknown route'} [${frameName}]...`)
        setBridgeError(null)

        try {
            const success = await injectBridgeScript(iframeRef.current)
            if (success) {
                addBridgeLog('Script injected, waiting for bridge:ready...')
                return true
            } else {
                setBridgeError('Cannot inject into preview (cross-origin)')
                addBridgeLog('Injection failed: cross-origin restriction', 'error')
                return false
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error'
            setBridgeError(`Injection error: ${msg}`)
            addBridgeLog(`Injection error: ${msg}`, 'error')
            return false
        }
    }, [addBridgeLog, previewRoute?.path])

    // Attempt to reinject bridge if not ready
    const ensureBridgeReady = useCallback((): boolean => {
        if (bridgeReady) return true
        void retryBridgeInjection()
        return false
    }, [bridgeReady, retryBridgeInjection])

    // Handle screenshot capture
    const handleCaptureScreenshot = useCallback(() => {
        if (!iframeRef.current || serverStatus !== 'running') return

        if (!bridgeReady) {
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
    }, [serverStatus, bridgeReady, ensureBridgeReady])

    // Toggle inspector mode (manual toggle via button)
    const toggleInspector = useCallback(() => {
        if (!inspectorEnabled && !bridgeReady) {
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
    }, [bridgeReady, inspectorEnabled, ensureBridgeReady, setSelectedElement, setInspectedElement, shiftInspectorActive, closeVisualEditor])

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

    const handleOpenInspectedSource = useCallback(() => {
        const fileName = inspectorContextMenu?.reactSource?.fileName
        if (!fileName || !slug) return
        navigate(`/projects/${slug}?path=${encodeURIComponent(fileName)}`)
        closeInspectorContextMenu()
    }, [inspectorContextMenu, closeInspectorContextMenu, navigate, slug])

    const handleOpenCode = (file: string, line?: number, column?: number) => {
        // Use full path when available so Files page can open/select the file in tree and tabs
        const normalizedFile = file.replace(/\\/g, '/')
        const normalizedProject = projectPath ? projectPath.replace(/\\/g, '/').replace(/\/+$/, '') : null
        const isAbsolute = normalizedFile.startsWith('/') || /^[A-Za-z]:\//.test(normalizedFile)
        const pathForUrl = normalizedProject
            ? (isAbsolute || normalizedFile.startsWith(normalizedProject))
                ? normalizedFile
                : `${normalizedProject}/${normalizedFile.replace(/^\/+/, '')}`
            : normalizedFile
        const params = new URLSearchParams()
        params.set('path', pathForUrl)
        if (line) params.set('line', String(line))
        if (column) params.set('column', String(column))
        navigate(`/projects/${slug}?${params.toString()}`)
    }

    const headerControls = useMemo(() => (
        <TooltipProvider delayDuration={300}>
            <div
                ref={headerRef}
                className={cn("flex items-center gap-2", focusedPageIndex !== null && "ml-auto")}
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
                                        onClick={() => setZoom(prev => Math.max(25, prev - 25))}
                                        className="h-7 w-7 rounded-full"
                                        disabled={zoom <= 25}
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
                                        onClick={() => setZoom(prev => Math.min(200, prev + 25))}
                                        className="h-7 w-7 rounded-full"
                                        disabled={zoom >= 200}
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
                                variant="secondary"
                                size="sm"
                                className="h-7 rounded-full px-2 gap-2 bg-sidebar-accent shadow-none"
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
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
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
                            <DropdownMenuItem
                                onClick={() => setZoom(prev => Math.max(25, prev - 25))}
                                disabled={zoom <= 25}
                            >
                                <ZoomOut className="h-4 w-4 mr-2" />
                                Zoom out
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setZoom(100)}>
                                <span className="inline-flex h-4 w-4 mr-2 items-center justify-center text-xs font-mono">
                                    1x
                                </span>
                                Reset to 100%
                                {zoom === 100 && <CheckCircle2 className="h-3 w-3 ml-auto text-green-500" />}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => setZoom(prev => Math.min(200, prev + 25))}
                                disabled={zoom >= 200}
                            >
                                <ZoomIn className="h-4 w-4 mr-2" />
                                Zoom in
                            </DropdownMenuItem>
                            {[25, 50, 75, 100, 125, 150, 200].map((value) => (
                                <DropdownMenuItem key={value} onClick={() => setZoom(value)}>
                                    <span className="font-mono tabular-nums">{value}%</span>
                                    {zoom === value && <CheckCircle2 className="h-3 w-3 ml-auto text-green-500" />}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}

                <div className="flex items-center gap-2 min-w-0">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                    <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem onClick={refreshRoutes}>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Refresh routes
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={retryBridgeInjection}>
                                    <span
                                        className={cn(
                                            "h-2.5 w-2.5 rounded-full shrink-0 mr-2",
                                            bridgeReady ? "bg-green-500" : "bg-amber-500"
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
                                                disabled={isCapturingScreenshot}
                                                onClick={handleCaptureScreenshot}
                                            >
                                                <Camera className={cn(
                                                    "h-3.5 w-3.5",
                                                    isCapturingScreenshot ? "animate-pulse text-primary" : "text-muted-foreground"
                                                )} />
                                            </Button>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="pointer-events-none data-[state=closed]:duration-0">Take Screenshot</TooltipContent>
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
                                                onClick={toggleInspector}
                                            >
                                                <MousePointer2 className={cn("h-3.5 w-3.5", inspectorEnabled ? "text-foreground" : "text-muted-foreground")} />
                                            </Button>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="pointer-events-none data-[state=closed]:duration-0">{inspectorEnabled ? 'Disable Inspector' : 'Enable Inspector'}</TooltipContent>
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
        toolbarDensity,
        device,
        zoom,
        isCapturingScreenshot,
        isCapturingPreview,
        inspectorEnabled,
        toolbarTooltip,
        serverStatus,
        bridgeReady,
        projectPath,
        storedFrameworkInfo?.devCommand,
        storedFrameworkInfo?.devPort,
        refreshRoutes,
        retryBridgeInjection,
        handleCaptureScreenshot,
        toggleInspector,
        handleUpdateProjectPreview,
        setDevice,
        setZoom,
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
                    <div className="flex-1 overflow-hidden flex flex-col">
                        {routes.length === 0 ? (
                            /* Empty State */
                            <motion.div
                                key="pages-empty"
                                initial={{ opacity: 0, y: 8, scale: 0.996 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                                className="app-scrollbar flex-1 overflow-y-auto p-6"
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
                            </motion.div>
                        ) : (
                            <div className="relative flex-1 min-h-0 min-w-0 bg-sidebar/60">
                                {!isFocusedPreview && (
                                <motion.div
                                    initial={false}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                                    className="app-scrollbar absolute inset-0 overflow-y-auto p-6"
                                >
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                        {routes.map((route, index) => {
                                            const routePresenceUsers = getRoutePresenceUsers(route.path, route.file)
                                            return (
                                                <div key={route.path} className="group relative">
                                                    <Card
                                                        className="group relative overflow-hidden border-border/40 bg-card/50 hover:bg-card hover:border-sidebar-primary/20 transition-all duration-300 shadow-sm hover:shadow-md h-[220px] flex flex-col cursor-pointer p-0 gap-0"
                                                        onClick={() => setFocusedPageIndex(index)}
                                                    >
                                                        {/* Preview Area */}
                                                        <div className="flex-1 w-full bg-muted/30 relative overflow-hidden rounded-t-xl">
                                                            {serverStatus === 'running' && serverPort ? (
                                                                <div className="absolute inset-0">
                                                                    <div className="w-full h-full bg-white relative overflow-hidden">
                                                                        <iframe
                                                                            src={`http://localhost:${serverPort}${route.path}`}
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
                                                                            window.open(`http://localhost:${serverPort}${route.path}`, '_blank')
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
                                                                <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0 truncate max-w-[40%] text-right bg-muted/50 px-1.5 py-0.5 rounded">
                                                                    {route.path}
                                                                </span>
                                                            </div>
                                                            <div className="mt-1 flex items-center justify-between gap-2">
                                                                <p className="min-w-0 flex-1 text-[11px] text-muted-foreground line-clamp-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    {route.description ?? ''}
                                                                </p>
                                                                {routePresenceUsers.length > 0 && (
                                                                    <CompactPresenceIndicator
                                                                        users={routePresenceUsers}
                                                                        size="sm"
                                                                        className="shrink-0"
                                                                    />
                                                                )}
                                                            </div>
                                                        </div>
                                                    </Card>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </motion.div>
                                )}

                                {isFocusedPreview && previewRoute && (
                                    <motion.div
                                        initial={false}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                                        className="absolute inset-0 flex overflow-hidden min-h-0 min-w-0"
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
                                                        <div className="relative h-full w-full bg-sidebar/40">
                                                            <iframe
                                                                ref={iframeRef}
                                                                name={focusedPreviewFrameName}
                                                                src={`http://localhost:${serverPort}${previewRoute.path}`}
                                                                className="h-full w-full border-none"
                                                                onLoad={handleIframeLoad}
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

                                                    {/* Action buttons overlay */}
                                                    <div className="pointer-events-none absolute bottom-4 right-4 flex translate-y-2 items-center gap-2 opacity-0 transition-all duration-200 ease-out group-hover/focused-preview:pointer-events-auto group-hover/focused-preview:translate-y-0 group-hover/focused-preview:opacity-100">
                                                        <Button
                                                            variant="secondary"
                                                            size="sm"
                                                            onClick={() => handleOpenCode(previewRoute.file)}
                                                            className="shadow-md"
                                                        >
                                                            <FileText className="h-3.5 w-3.5 mr-1.5" />
                                                            Edit Code
                                                        </Button>
                                                        {serverStatus === 'running' && (
                                                            <Button
                                                                variant="secondary"
                                                                size="sm"
                                                                onClick={() => window.open(`http://localhost:${serverPort}${previewRoute.path}`, '_blank')}
                                                                className="shadow-md"
                                                            >
                                                                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                                                Open
                                                            </Button>
                                                        )}
                                                    </div>

                                                    {/* Page name pill */}
                                                    <div className="absolute bottom-4 left-4 flex items-center gap-2">
                                                        <div className="inline-flex items-center gap-2 rounded-full bg-secondary/80 px-3 py-1 text-sm font-medium text-secondary-foreground shadow-md">
                                                            {previewRoute.name}
                                                        </div>
                                                    </div>
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
                                                                        {serverStatus === 'running' && serverPort ? (
                                                                            <div className="w-full h-full bg-white relative">
                                                                                <iframe
                                                                                    src={`http://localhost:${serverPort}${route.path}`}
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
                                    </motion.div>
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
