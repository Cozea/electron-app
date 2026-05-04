import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"
import type {
  BrowserFindInPageOptions,
  BrowserFindState,
  BrowserNewPageRequest,
  BrowserStorageScope,
  BrowserUiCommand,
} from "@shared/browserHostTypes"

import {
  acquireBrowserTileModel,
  releaseBrowserTileModel,
} from "@/features/projects/browser/browserTileModel"
import {
  NATIVE_SURFACE_OVERLAY_SELECTOR,
  useNativeSurfaceOcclusion,
} from "@/lib/nativeSurfaceOcclusion"

export interface WorkbenchBrowserViewState {
  tileId: string
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  favicon?: string | null
  focused: boolean
  visible: boolean
  isDevToolsOpen: boolean
  storageScope: BrowserStorageScope
  zoomFactor: number
  canZoomIn: boolean
  canZoomOut: boolean
  find: BrowserFindState
  loadError?: string | null
}

interface UseWorkbenchBrowserViewOptions {
  tileId: string
  url: string
  sessionKey?: string | null
  projectId: string
  laneId: string
  visible?: boolean
  overlaySelector?: string
  storageScope?: BrowserStorageScope
  workspaceId?: string
  persistModel?: boolean
  onUrlObserved?: (url: string) => void
  onTitleObserved?: (title: string) => void
  onFaviconObserved?: (favicon: string | null) => void
  onNewPageRequest?: (request: BrowserNewPageRequest) => void
  onCommand?: (command: BrowserUiCommand) => void
}

interface UseWorkbenchBrowserViewResult {
  hostRef: RefObject<HTMLDivElement | null>
  state: WorkbenchBrowserViewState
  boundsReady: boolean
  overlayPaused: boolean
  overlayPauseReason: string | null
  placeholderScreenshot: string | null
  actions: {
    goBack: () => Promise<void>
    goForward: () => Promise<void>
    reload: (hard?: boolean) => Promise<void>
    focus: () => Promise<void>
    toggleDevTools: () => Promise<void>
    openExternal: () => Promise<{ success: boolean; error?: string }>
    zoomIn: () => Promise<void>
    zoomOut: () => Promise<void>
    resetZoom: () => Promise<void>
    findInPage: (text: string, options?: BrowserFindInPageOptions) => Promise<void>
    stopFindInPage: (keepSelection?: boolean) => Promise<void>
    getSelectedText: () => Promise<string>
  }
}

export function useWorkbenchBrowserView(
  options: UseWorkbenchBrowserViewOptions,
): UseWorkbenchBrowserViewResult {
  const {
    tileId,
    url,
    sessionKey = null,
    projectId,
    laneId,
    visible = true,
    overlaySelector = NATIVE_SURFACE_OVERLAY_SELECTOR,
    storageScope = "workspace",
    workspaceId,
    persistModel = false,
    onUrlObserved,
    onTitleObserved,
    onFaviconObserved,
    onNewPageRequest,
    onCommand,
  } = options
  const hostRef = useRef<HTMLDivElement | null>(null)
  const modelRef = useRef<ReturnType<typeof acquireBrowserTileModel> | null>(null)
  const [state, setState] = useState<WorkbenchBrowserViewState>({
    tileId,
    url,
    title: "Browser",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    favicon: null,
    focused: false,
    visible: false,
    isDevToolsOpen: false,
    storageScope,
    zoomFactor: 1,
    canZoomIn: true,
    canZoomOut: true,
    find: {
      query: "",
      visible: false,
      matchCase: false,
      activeMatchOrdinal: 0,
      matches: 0,
      finalUpdate: false,
    },
    loadError: null,
  })
  const [boundsReady, setBoundsReady] = useState(false)
  const [overlayPaused, setOverlayPaused] = useState(false)
  const [placeholderScreenshot, setPlaceholderScreenshot] = useState<string | null>(null)
  const lastSentBoundsRef = useRef<{ x: number; y: number; w: number; h: number; v: boolean } | null>(null)
  const overlayPausedRef = useRef(overlayPaused)
  const scheduleBoundsSyncRef = useRef<(() => void) | null>(null)
  const visibleRef = useRef(visible)
  const activeUrlRef = useRef(url)
  const loadErrorRef = useRef<string | null | undefined>(state.loadError)
  const pauseNativeSurfaceForOverlayRef = useRef<() => void>(() => {})
  visibleRef.current = visible
  activeUrlRef.current = url
  loadErrorRef.current = state.loadError
  pauseNativeSurfaceForOverlayRef.current = () => {
    const model = modelRef.current
    if (!model || !visibleRef.current || !activeUrlRef.current || loadErrorRef.current) return

    overlayPausedRef.current = true
    setOverlayPaused(true)

    const lastBounds = lastSentBoundsRef.current
    if (lastBounds) {
      lastSentBoundsRef.current = { ...lastBounds, v: false }
    }
    void model.setVisible(false)
  }
  const nativeSurfaceOcclusion = useNativeSurfaceOcclusion(hostRef, {
    enabled: visible && Boolean(url),
    overlaySelector,
    onStateChange: (nextState) => {
      if (nextState.occluded) {
        pauseNativeSurfaceForOverlayRef.current()
      }
    },
  })
  const hasOverlappingOverlay = nativeSurfaceOcclusion.occluded
  const overlayPauseReason = nativeSurfaceOcclusion.reason
  const hasMeasuredOverlayRect = nativeSurfaceOcclusion.overlayRect !== null
  const lastRequestedUrlRef = useRef<string>(url)
  /** Latest `url` from React props — avoids stale closures in the model subscriber vs `tile.url`. */
  const committedWorkbenchUrlRef = useRef(url)
  committedWorkbenchUrlRef.current = url

  const onUrlObservedRef = useRef(onUrlObserved)
  const onTitleObservedRef = useRef(onTitleObserved)
  const onFaviconObservedRef = useRef(onFaviconObserved)
  const onNewPageRequestRef = useRef(onNewPageRequest)
  const onCommandRef = useRef(onCommand)

  useEffect(() => {
    onUrlObservedRef.current = onUrlObserved
    onTitleObservedRef.current = onTitleObserved
    onFaviconObservedRef.current = onFaviconObserved
    onNewPageRequestRef.current = onNewPageRequest
    onCommandRef.current = onCommand
  })

  useLayoutEffect(() => {
    overlayPausedRef.current = overlayPaused
    scheduleBoundsSyncRef.current?.()
  }, [overlayPaused])

  useEffect(() => {
    if (!sessionKey) {
      return
    }

    void window.electronAPI.workbenchSession
      .bindBrowser({
        sessionKey,
        projectId,
        laneId,
        tileId,
        browserTileId: tileId,
      })
      .catch((error) => {
        console.warn("[WorkbenchBrowser] Failed to bind browser tile to session", error)
      })
  }, [laneId, projectId, sessionKey, tileId])

  useEffect(() => {
    setState((current) => {
      if (current.tileId === tileId) return current
      return {
        tileId,
        url,
        title: "Browser",
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        favicon: null,
        focused: false,
        visible: false,
        isDevToolsOpen: false,
        storageScope,
        zoomFactor: 1,
        canZoomIn: true,
        canZoomOut: true,
        find: {
          query: "",
          visible: false,
          matchCase: false,
          activeMatchOrdinal: 0,
          matches: 0,
          finalUpdate: false,
        },
        loadError: null,
      }
    })
  }, [storageScope, tileId, url])

  /** Acquire model + subscribe once per tile; URL loads run in the following layout effect so stale error states cannot clobber a new address. */
  useLayoutEffect(() => {
    const model = acquireBrowserTileModel(tileId, { persistent: persistModel })
    modelRef.current = model

    const unsubscribe = model.subscribe((nextState) => {
      setState(nextState)
      // Never push a failed navigation URL into the workbench — it would overwrite a newly typed address.
      if (!nextState.loadError && nextState.url) {
        const committed = committedWorkbenchUrlRef.current
        if (nextState.url !== committed) {
          lastRequestedUrlRef.current = nextState.url
          onUrlObservedRef.current?.(nextState.url)
        }
      }
      if (nextState.title && nextState.title !== "Browser") {
        onTitleObservedRef.current?.(nextState.title)
      }
      onFaviconObservedRef.current?.(nextState.favicon ?? null)
    })

    return unsubscribe
  }, [persistModel, storageScope, tileId, workspaceId])

  useLayoutEffect(() => {
    const unsubscribe = window.electronAPI.workbenchBrowser.onNewPageRequest((request) => {
      if (request.sourceTileId !== tileId) return
      onNewPageRequestRef.current?.(request)
    })
    return unsubscribe
  }, [tileId])

  useEffect(() => {
    const unsubscribe = window.electronAPI.workbenchBrowser.onCommand((command) => {
      if (command.tileId !== tileId) return
      
      if (command.type.startsWith('split-control-')) {
        window.dispatchEvent(new CustomEvent('cozea:split-control', { detail: command }))
        return
      }

      onCommandRef.current?.(command)
    })
    return () => unsubscribe()
  }, [tileId])

  useLayoutEffect(() => {
    const model = modelRef.current
    if (!model) return

    if (!url) {
      lastSentBoundsRef.current = { x: 0, y: 0, w: 0, h: 0, v: false }
      void model.setVisible(false)
      setBoundsReady(false)
      return
    }

    void model.initialize({
      initialUrl: url,
      storageScope,
      workspaceId,
    })
    if (url !== lastRequestedUrlRef.current) {
      lastRequestedUrlRef.current = url
      void model.loadURL(url)
    }
  }, [storageScope, tileId, url, workspaceId])

  useEffect(() => {
    if (!url) {
      overlayPausedRef.current = false
      setOverlayPaused(false)
      setPlaceholderScreenshot(null)
    }
  }, [url])

  useLayoutEffect(() => {
    const model = modelRef.current
    if (!model) return

    let cancelled = false

    if (!hasOverlappingOverlay || !url || state.loadError) {
      overlayPausedRef.current = false
      setOverlayPaused(false)
      scheduleBoundsSyncRef.current?.()
      // Do NOT set placeholderScreenshot(null) here so it stays mounted and prevents un-pause flicker.
      return () => {
        cancelled = true
      }
    }

    pauseNativeSurfaceForOverlayRef.current()
    if (!hasMeasuredOverlayRect) {
      return () => {
        cancelled = true
      }
    }

    const capturePlaceholder = async () => {
      const screenshot = await model.captureScreenshot().catch(() => null)
      if (cancelled) return
      if (screenshot) {
        setPlaceholderScreenshot(screenshot)
      }
    }
    void capturePlaceholder()

    return () => {
      cancelled = true
    }
  }, [hasMeasuredOverlayRect, hasOverlappingOverlay, overlayPauseReason, state.loadError, url])

  useEffect(() => {
    const element = hostRef.current
    const model = modelRef.current
    if (!model) return

    if (!visible || !url) {
      lastSentBoundsRef.current = null
      void model.setVisible(false)
      setBoundsReady(false)
      return
    }

    if (!element) return

    let frame = 0

    const syncBounds = () => {
      const rect = element.getBoundingClientRect()

      const x = Math.round(rect.left)
      const y = Math.round(rect.top)
      const width = Math.max(0, Math.round(rect.right) - x)
      const height = Math.max(0, Math.round(rect.bottom) - y)

      const stateLoadError = state.loadError
      const nextBoundsReady =
        visible &&
        Boolean(url) &&
        !stateLoadError &&
        width > 0 &&
        height > 0

      const nextVisible = nextBoundsReady && !overlayPausedRef.current
      const last = lastSentBoundsRef.current
      if (
        last &&
        last.v === nextVisible &&
        last.x === x &&
        last.y === y &&
        last.w === width &&
        last.h === height
      ) {
        return
      }
      lastSentBoundsRef.current = { x, y, w: width, h: height, v: nextVisible }
      if (nextVisible) {
        void model.layout({ x, y, width, height })
      } else {
        void model.setVisible(false)
      }
      setBoundsReady(nextBoundsReady)
    }

    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(syncBounds)
    }

    scheduleBoundsSyncRef.current = schedule

    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(element)

    window.addEventListener("resize", schedule)
    window.addEventListener("cozea:sidebar-layout-change", schedule as EventListener)
    window.addEventListener("scroll", schedule, true)
    schedule()

    return () => {
      scheduleBoundsSyncRef.current = null
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener("resize", schedule)
      window.removeEventListener("cozea:sidebar-layout-change", schedule as EventListener)
      window.removeEventListener("scroll", schedule, true)
      lastSentBoundsRef.current = null
      void model.setVisible(false)
      setBoundsReady(false)
    }
  }, [tileId, url, visible, state.loadError])

  useEffect(() => {
    return () => {
      if (modelRef.current) {
        modelRef.current = null
      }
      void releaseBrowserTileModel(tileId)
    }
  }, [tileId])

  const actions = useMemo(() => {
    const resolveModel = () => modelRef.current

    return {
      goBack: async () => {
        await resolveModel()?.goBack()
      },
      goForward: async () => {
        await resolveModel()?.goForward()
      },
      reload: async (hard = false) => {
        if (hard) {
          await resolveModel()?.hardReload()
          return
        }
        await resolveModel()?.reload()
      },
      focus: async () => {
        await resolveModel()?.focus()
      },
      toggleDevTools: async () => {
        await resolveModel()?.toggleDevTools()
      },
      openExternal: async () => {
        return (await resolveModel()?.openExternal()) ?? { success: false, error: "Browser unavailable." }
      },
      zoomIn: async () => {
        await resolveModel()?.zoomIn()
      },
      zoomOut: async () => {
        await resolveModel()?.zoomOut()
      },
      resetZoom: async () => {
        await resolveModel()?.resetZoom()
      },
      findInPage: async (text: string, options: BrowserFindInPageOptions = {}) => {
        await resolveModel()?.findInPage(text, options)
      },
      stopFindInPage: async (keepSelection = false) => {
        await resolveModel()?.stopFindInPage(keepSelection)
      },
      getSelectedText: async () => {
        return (await resolveModel()?.getSelectedText()) ?? ""
      },
    }
  }, [])

  return {
    hostRef,
    state,
    boundsReady,
    overlayPaused,
    overlayPauseReason,
    placeholderScreenshot,
    actions,
  }
}
