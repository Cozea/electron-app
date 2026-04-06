import { useEffect, useMemo, useRef, useState } from "react"
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
  visible?: boolean
  overlaySelector?: string
  storageScope?: BrowserStorageScope
  workspaceId?: string
  persistModel?: boolean
  onUrlObserved?: (url: string) => void
  onTitleObserved?: (title: string) => void
  onNewPageRequest?: (request: BrowserNewPageRequest) => void
  onCommand?: (command: BrowserUiCommand) => void
}

interface UseWorkbenchBrowserViewResult {
  hostRef: React.RefObject<HTMLDivElement | null>
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

function isElementRectVisible(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0
}

function isRectOverlapping(a: DOMRect, b: DOMRect): boolean {
  return !(
    a.right <= b.left ||
    b.right <= a.left ||
    a.bottom <= b.top ||
    b.bottom <= a.top
  )
}

export function useWorkbenchBrowserView(
  options: UseWorkbenchBrowserViewOptions,
): UseWorkbenchBrowserViewResult {
  const {
    tileId,
    url,
    visible = true,
    overlaySelector = '[data-workbench-browser-overlay="true"]',
    storageScope = "workspace",
    workspaceId,
    persistModel = false,
    onUrlObserved,
    onTitleObserved,
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
  const [hasOverlappingOverlay, setHasOverlappingOverlay] = useState(false)
  const [overlayPauseReason, setOverlayPauseReason] = useState<string | null>(null)
  const [overlayPaused, setOverlayPaused] = useState(false)
  const [placeholderScreenshot, setPlaceholderScreenshot] = useState<string | null>(null)
  const lastSentBoundsRef = useRef<{ x: number; y: number; w: number; h: number; v: boolean } | null>(null)
  const lastRequestedUrlRef = useRef<string>(url)

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

  useEffect(() => {
    const model = acquireBrowserTileModel(tileId, { persistent: persistModel })
    modelRef.current = model

    const unsubscribe = model.subscribe((nextState) => {
      setState(nextState)
      if (nextState.url && nextState.url !== url) {
        // Treat browser-observed URL changes as already-synced so the follow-up
        // store update does not trigger a redundant navigate() and reload cycle.
        lastRequestedUrlRef.current = nextState.url
        onUrlObserved?.(nextState.url)
      }
      if (nextState.title && nextState.title !== "Browser") {
        onTitleObserved?.(nextState.title)
      }
    })

    void model.initialize({
      initialUrl: url,
      storageScope,
      workspaceId,
    })

    return unsubscribe
  }, [onTitleObserved, onUrlObserved, persistModel, storageScope, tileId, url, workspaceId])

  useEffect(() => {
    if (!onNewPageRequest) return
    const unsubscribe = window.electronAPI.workbenchBrowser.onNewPageRequest((request) => {
      if (request.sourceTileId !== tileId) return
      onNewPageRequest(request)
    })
    return unsubscribe
  }, [onNewPageRequest, tileId])

  useEffect(() => {
    if (!onCommand) return
    const unsubscribe = window.electronAPI.workbenchBrowser.onCommand((command) => {
      if (command.tileId !== tileId) return
      onCommand(command)
    })
    return unsubscribe
  }, [onCommand, tileId])

  useEffect(() => {
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
    const element = hostRef.current
    if (!element) return

    let frame = 0

    const readOverlappingOverlay = () => {
      const hostRect = element.getBoundingClientRect()
      if (!isElementRectVisible(hostRect)) {
        setHasOverlappingOverlay(false)
        setOverlayPauseReason(null)
        return
      }

      const overlays = Array.from(document.querySelectorAll<HTMLElement>(overlaySelector))
      const match = overlays.find((candidate) => {
        if (candidate === element || candidate.contains(element) || element.contains(candidate)) {
          return false
        }
        const style = window.getComputedStyle(candidate)
        if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") {
          return false
        }
        const overlayRect = candidate.getBoundingClientRect()
        if (!isElementRectVisible(overlayRect)) {
          return false
        }
        return isRectOverlapping(hostRect, overlayRect)
      })

      setHasOverlappingOverlay(Boolean(match))
      setOverlayPauseReason(match?.dataset.workbenchBrowserOverlayReason?.trim() || null)
    }

    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(readOverlappingOverlay)
    }

    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(element)
    const mutationObserver = new MutationObserver(schedule)
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "data-workbench-browser-overlay"],
    })

    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, true)
    schedule()

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, true)
    }
  }, [overlaySelector])

  useEffect(() => {
    if (!url) {
      setOverlayPaused(false)
      setOverlayPauseReason(null)
      setPlaceholderScreenshot(null)
    }
  }, [url])

  useEffect(() => {
    if (!overlayPaused && boundsReady) {
      setPlaceholderScreenshot(null)
    }
  }, [boundsReady, overlayPaused])

  useEffect(() => {
    const model = modelRef.current
    if (!model) return

    let cancelled = false

    if (!hasOverlappingOverlay || !url || state.loadError || !boundsReady || state.isLoading) {
      setOverlayPaused(false)
      return () => {
        cancelled = true
      }
    }

    const capturePauseScreenshot = async () => {
      const screenshot = await model.captureScreenshot().catch(() => null)
      if (cancelled) return
      if (screenshot) {
        setPlaceholderScreenshot(screenshot)
        setOverlayPaused(true)
        return
      }
      setOverlayPaused(false)
    }

    void capturePauseScreenshot()

    return () => {
      cancelled = true
    }
  }, [boundsReady, hasOverlappingOverlay, state.isLoading, state.loadError, url])

  useEffect(() => {
    const element = hostRef.current
    if (!element) return
    const model = modelRef.current
    if (!model) return

    let frame = 0

    const syncBounds = () => {
      const rect = element.getBoundingClientRect()
      
      const inset = 1
      const x = Math.ceil(rect.left) + inset
      const y = Math.ceil(rect.top) + inset
      const width = Math.max(0, Math.floor(rect.right) - Math.ceil(rect.left) - inset * 2)
      const height = Math.max(0, Math.floor(rect.bottom) - Math.ceil(rect.top) - inset * 2)

      const stateLoadError = state.loadError
      const nextVisible =
        visible &&
        !overlayPaused &&
        Boolean(url) &&
        !stateLoadError &&
        width > 0 &&
        height > 0
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
      setBoundsReady(nextVisible)
    }

    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(syncBounds)
    }

    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(element)

    window.addEventListener("resize", schedule)
    window.addEventListener("cozea:sidebar-layout-change", schedule as EventListener)
    window.addEventListener("scroll", schedule, true)
    schedule()

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener("resize", schedule)
      window.removeEventListener("cozea:sidebar-layout-change", schedule as EventListener)
      window.removeEventListener("scroll", schedule, true)
      lastSentBoundsRef.current = null
      void model.setVisible(false)
      setBoundsReady(false)
    }
  }, [overlayPaused, tileId, url, visible, state.loadError])

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
