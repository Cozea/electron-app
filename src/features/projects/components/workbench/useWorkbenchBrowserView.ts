import { useEffect, useRef, useState } from "react"

export interface WorkbenchBrowserViewState {
  tileId: string
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  loadError?: string | null
}

interface UseWorkbenchBrowserViewOptions {
  tileId: string
  url: string
  visible?: boolean
  onUrlObserved?: (url: string) => void
  onTitleObserved?: (title: string) => void
}

interface UseWorkbenchBrowserViewResult {
  hostRef: React.RefObject<HTMLDivElement | null>
  state: WorkbenchBrowserViewState
  boundsReady: boolean
}

export function useWorkbenchBrowserView(
  options: UseWorkbenchBrowserViewOptions,
): UseWorkbenchBrowserViewResult {
  const {
    tileId,
    url,
    visible = true,
    onUrlObserved,
    onTitleObserved,
  } = options
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<WorkbenchBrowserViewState>({
    tileId,
    url,
    title: "Browser",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
  })
  const [boundsReady, setBoundsReady] = useState(false)
  const lastSentBoundsRef = useRef<string | null>(null)
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
        loadError: null,
      }
    })
  }, [tileId, url])

  useEffect(() => {
    const unsubscribe = window.electronAPI.workbenchBrowser.onStateChange((nextState) => {
      if (nextState.tileId !== tileId) return
      setState(nextState)
      if (nextState.url && nextState.url !== url) {
        onUrlObserved?.(nextState.url)
      }
      if (nextState.title && nextState.title !== "Browser") {
        onTitleObserved?.(nextState.title)
      }
    })
    return unsubscribe
  }, [onTitleObserved, onUrlObserved, tileId, url])

  useEffect(() => {
    if (!url) {
      lastSentBoundsRef.current = JSON.stringify({
        tileId,
        visible: false,
      })
      void window.electronAPI.workbenchBrowser.setBounds({
        tileId,
        visible: false,
      })
      setBoundsReady(false)
      return
    }

    void window.electronAPI.workbenchBrowser.ensureTile({ tileId, initialUrl: url })
    if (url !== lastRequestedUrlRef.current) {
      lastRequestedUrlRef.current = url
      void window.electronAPI.workbenchBrowser.navigate({ tileId, url })
    }
  }, [tileId, url])

  useEffect(() => {
    const element = hostRef.current
    if (!element) return

    let frame = 0
    let disposed = false

    const syncBounds = () => {
      const rect = element.getBoundingClientRect()
      
      const x = Math.round(rect.x)
      const y = Math.round(rect.y)
      const right = Math.round(rect.right)
      const bottom = Math.round(rect.bottom)
      
      const width = Math.max(0, right - x)
      const height = Math.max(0, bottom - y)
      
      const nextVisible = visible && Boolean(url) && width > 0 && height > 0
      const payload = nextVisible
        ? {
            tileId,
            visible: true,
            bounds: {
              x,
              y,
              width,
              height,
            },
          }
        : {
            tileId,
            visible: false,
          }
      const signature = JSON.stringify(payload)
      if (signature !== lastSentBoundsRef.current) {
        lastSentBoundsRef.current = signature
        void window.electronAPI.workbenchBrowser.setBounds(payload)
      }
      setBoundsReady(nextVisible)
    }

    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(syncBounds)
    }

    const tick = () => {
      if (disposed) return
      syncBounds()
      frame = requestAnimationFrame(tick)
    }

    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(element)

    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, true)
    frame = requestAnimationFrame(tick)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, true)
      lastSentBoundsRef.current = JSON.stringify({
        tileId,
        visible: false,
      })
      void window.electronAPI.workbenchBrowser.setBounds({
        tileId,
        visible: false,
      })
    }
  }, [tileId, url, visible])

  useEffect(() => {
    return () => {
      void window.electronAPI.workbenchBrowser.destroyTile({ tileId })
    }
  }, [tileId])

  return {
    hostRef,
    state,
    boundsReady,
  }
}
