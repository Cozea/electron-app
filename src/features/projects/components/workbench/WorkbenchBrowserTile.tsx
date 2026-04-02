import { useEffect, useMemo, useState } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview"
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Lock,
  RefreshCcw,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import { useWorkbenchBrowserView } from "@/features/projects/components/workbench/useWorkbenchBrowserView"
import { cn } from "@/lib/utils"

interface WorkbenchBrowserTileProps {
  tileId: string
  url: string
  linkedDevServerTileId?: string | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
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
  panelApi,
  containerApi,
  onUrlCommitted,
  onTitleObserved,
}: WorkbenchBrowserTileProps) {
  const [draftUrl, setDraftUrl] = useState(url)
  const { hostRef, state, boundsReady } = useWorkbenchBrowserView({
    tileId,
    url,
    onUrlObserved: (nextUrl) => {
      onUrlCommitted(nextUrl)
    },
    onTitleObserved: (title) => {
      onTitleObserved(title)
    },
  })

  useEffect(() => {
    setDraftUrl(url)
  }, [url])

  const canInteract = useMemo(() => Boolean(url), [url])

  const submitDraftUrl = () => {
    const normalized = normalizeUrlInput(draftUrl)
    if (!normalized) return
    onUrlCommitted(normalized)
  }

  const toolbar = (
    <div className="flex min-w-0 w-full items-center gap-2">
      <div className="flex shrink-0 items-center gap-1 w-[92px]">
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

      <div className="flex flex-1 min-w-0 items-center justify-center">
        <div className="relative w-full min-w-[240px]">
          {draftUrl.startsWith("https://") ? (
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          ) : null}
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
            className={cn(
              "h-7 border-0 bg-background/50 text-center text-xs shadow-none transition-colors hover:bg-background/80 focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring",
              draftUrl.startsWith("https://") ? "pl-9" : "px-3",
            )}
          />
        </div>
      </div>
      
      {/* Spacer balances the right side with the left side to perfectly center the input within the entire tile (accounting for window controls) */}
      <div className="w-[24px] shrink-0" />
    </div>
  )

  return (
    <WorkbenchTileChrome
      title={state.title || "Browser"}
      panelApi={panelApi}
      containerApi={containerApi}
      controls={toolbar}
    >
      <div className="relative h-full min-h-0 overflow-hidden bg-background p-px">
        {!url ? (
          <div className="flex h-full w-full items-center justify-center p-6">
            <Empty className="w-full max-w-md py-8">
              <EmptyHeader>
                <EmptyMedia className="h-auto w-auto rounded-none bg-transparent [&>svg]:h-7 [&>svg]:w-7 [&>svg]:text-muted-foreground">
                  <Globe className="h-7 w-7" />
                </EmptyMedia>
                <EmptyTitle className="text-base font-medium">No page loaded yet</EmptyTitle>
                <EmptyDescription>
                  Enter a URL above or open a linked dev server in this tile.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : null}
        {url && state.loadError ? (
          <div className="absolute inset-px z-[100] flex items-center justify-center bg-background p-6 text-center">
            <div className="max-w-md space-y-2">
              <div className="text-sm font-medium text-foreground">
                This page could not be loaded.
              </div>
              <div className="text-xs text-muted-foreground">{state.loadError}</div>
            </div>
          </div>
        ) : null}
        {url ? (
          <div
            ref={hostRef}
            className={cn(
              "absolute inset-px overflow-hidden bg-background",
              (!boundsReady || state.loadError) ? "opacity-0 pointer-events-none" : "opacity-100",
            )}
          />
        ) : null}
      </div>
    </WorkbenchTileChrome>
  )
}
