import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCcw,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface BrowserTileState {
  tileId: string
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

interface WorkbenchBrowserTileProps {
  tileId: string
  url: string
  linkedDevServerTileId?: string | null
  onUrlCommitted: (url: string) => void
  onTitleObserved: (title: string) => void
}

function normalizeUrlInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  if (trimmed.startsWith("localhost") || /^[\w.-]+:\d+/.test(trimmed)) {
    return `http://${trimmed}`
  }
  if (trimmed.includes(" ")) return ""
  return `https://${trimmed}`
}

export function WorkbenchBrowserTile({
  tileId,
  url,
  linkedDevServerTileId: _linkedDevServerTileId,
  onUrlCommitted,
  onTitleObserved,
}: WorkbenchBrowserTileProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [draftUrl, setDraftUrl] = useState(url)
  const [state, setState] = useState<BrowserTileState>({
    tileId,
    url,
    title: "Browser",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  })
  const lastSentBoundsRef = useRef<string | null>(null)
  const lastRequestedUrlRef = useRef<string>(url)
  const [boundsReady, setBoundsReady] = useState(false)

  useEffect(() => {
    setDraftUrl(url)
  }, [url])

  useEffect(() => {
    const unsubscribe = window.electronAPI.workbenchBrowser.onStateChange((nextState) => {
      if (nextState.tileId !== tileId) return
      setState(nextState)
      if (nextState.url && nextState.url !== url) {
        onUrlCommitted(nextState.url)
      }
      if (nextState.title && nextState.title !== "Browser") {
        onTitleObserved(nextState.title)
      }
    })
    return unsubscribe
  }, [onTitleObserved, onUrlCommitted, tileId, url])

  useEffect(() => {
    if (!url) {
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
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect()
        const nextVisible = Boolean(url) && rect.width > 0 && rect.height > 0
        const payload = nextVisible
          ? {
              tileId,
              visible: true,
              bounds: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            }
          : {
              tileId,
              visible: false,
            }
        const signature = JSON.stringify(payload)
        if (signature === lastSentBoundsRef.current) return
        lastSentBoundsRef.current = signature
        void window.electronAPI.workbenchBrowser.setBounds(payload)
        setBoundsReady(nextVisible)
      })
    }

    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(element)

    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, true)
    schedule()

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, true)
      void window.electronAPI.workbenchBrowser.setBounds({
        tileId,
        visible: false,
      })
    }
  }, [tileId, url])

  useEffect(() => {
    return () => {
      void window.electronAPI.workbenchBrowser.destroyTile({ tileId })
    }
  }, [tileId])

  const canInteract = useMemo(() => Boolean(url), [url])

  const submitDraftUrl = () => {
    const normalized = normalizeUrlInput(draftUrl)
    if (!normalized) return
    onUrlCommitted(normalized)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!state.canGoBack}
            onClick={() => {
              void window.electronAPI.workbenchBrowser.goBack({ tileId })
            }}
            aria-label="Back"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!state.canGoForward}
            onClick={() => {
              void window.electronAPI.workbenchBrowser.goForward({ tileId })
            }}
            aria-label="Forward"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!canInteract}
            onClick={() => {
              void window.electronAPI.workbenchBrowser.reload({ tileId })
            }}
            aria-label="Reload"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", state.isLoading && "animate-spin")} />
          </Button>
        </div>

        <div className="relative min-w-0 flex-1">
          <Globe className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                submitDraftUrl()
              }
            }}
            placeholder="Enter a URL or localhost:port"
            className="h-8 border-border/70 bg-background pl-9 pr-3 text-xs"
          />
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!canInteract}
          onClick={() => {
            const targetUrl = state.url || url
            if (!targetUrl) return
            void window.electronAPI.shell.openExternal(targetUrl)
          }}
          aria-label="Open in external browser"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="truncate">{state.url || "No page loaded yet"}</span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {state.isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {state.title || "Browser"}
        </span>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden bg-background">
        {!url ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Enter a URL above or open a linked dev server in this tile.
          </div>
        ) : null}
        <div
          ref={hostRef}
          className={cn(
            "h-full w-full bg-transparent",
            !boundsReady && url ? "opacity-70" : "opacity-100",
          )}
        />
      </div>
    </div>
  )
}
