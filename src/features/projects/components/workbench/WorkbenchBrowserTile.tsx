import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview"
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  Lock,
  Minus,
  Plus,
  RefreshCcw,
  Search,
  SquareTerminal,
  X,
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
import type { BrowserStorageScope } from "@shared/browserHostTypes"

interface WorkbenchBrowserTileProps {
  tileId: string
  url: string
  storageScope?: BrowserStorageScope
  workspaceId?: string
  linkedDevServerTileId?: string | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
  onUrlCommitted: (url: string) => void
  onTitleObserved: (title: string) => void
  onNewPageRequest?: (url: string) => void
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
  storageScope = "workspace",
  workspaceId,
  linkedDevServerTileId: _linkedDevServerTileId,
  panelApi,
  containerApi,
  onUrlCommitted,
  onTitleObserved,
  onNewPageRequest,
}: WorkbenchBrowserTileProps) {
  const isMac = useMemo(() => navigator.platform.toLowerCase().includes("mac"), [])
  const [draftUrl, setDraftUrl] = useState(url)
  const [isFindVisible, setIsFindVisible] = useState(false)
  const [findQuery, setFindQuery] = useState("")
  const [findMatchCase, setFindMatchCase] = useState(false)
  const urlInputRef = useRef<HTMLInputElement | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const { hostRef, state, boundsReady, actions } = useWorkbenchBrowserView({
    tileId,
    url,
    storageScope,
    workspaceId,
    persistModel: true,
    onUrlObserved: (nextUrl) => {
      onUrlCommitted(nextUrl)
    },
    onTitleObserved: (title) => {
      onTitleObserved(title)
    },
    onNewPageRequest: (request) => {
      onNewPageRequest?.(request.url)
    },
    onCommand: (command) => {
      if (command.type === "focus-url") {
        focusUrlInput()
        return
      }
      if (command.type === "show-find") {
        openFind(command.query)
        return
      }
      setIsFindVisible(false)
      void actions.stopFindInPage(true)
    },
  })

  useEffect(() => {
    setDraftUrl(url)
  }, [url])

  useEffect(() => {
    if (url) return
    setIsFindVisible(false)
    setFindQuery("")
  }, [url])

  const canInteract = useMemo(() => Boolean(url), [url])
  const hasFindQuery = useMemo(() => findQuery.trim().length > 0, [findQuery])
  const findResultLabel = useMemo(() => {
    if (!hasFindQuery) return ""
    if (state.find.matches > 0) {
      return `${Math.max(state.find.activeMatchOrdinal, 1)}/${state.find.matches}`
    }
    return state.find.finalUpdate ? "0/0" : "..."
  }, [hasFindQuery, state.find.activeMatchOrdinal, state.find.finalUpdate, state.find.matches])

  const submitDraftUrl = () => {
    const normalized = normalizeUrlInput(draftUrl)
    if (!normalized) return
    onUrlCommitted(normalized)
  }

  const focusUrlInput = useCallback(() => {
    panelApi.setActive()
    window.requestAnimationFrame(() => {
      urlInputRef.current?.focus()
      urlInputRef.current?.select()
    })
  }, [panelApi])

  const openFind = useCallback((nextQuery?: string) => {
    panelApi.setActive()
    setIsFindVisible(true)
    if (typeof nextQuery === "string") {
      const normalized = nextQuery.trim()
      if (normalized) {
        setFindQuery(normalized)
      }
    }
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [panelApi])

  const closeFind = useCallback((keepSelection = true) => {
    setIsFindVisible(false)
    void actions.stopFindInPage(keepSelection)
  }, [actions])

  const findNext = useCallback(() => {
    if (!hasFindQuery) return
    void actions.findInPage(findQuery, {
      forward: true,
      recompute: false,
      matchCase: findMatchCase,
    })
  }, [actions, findMatchCase, findQuery, hasFindQuery])

  const findPrevious = useCallback(() => {
    if (!hasFindQuery) return
    void actions.findInPage(findQuery, {
      forward: false,
      recompute: false,
      matchCase: findMatchCase,
    })
  }, [actions, findMatchCase, findQuery, hasFindQuery])

  useEffect(() => {
    if (!isFindVisible) return
    const trimmedQuery = findQuery.trim()
    if (!trimmedQuery) {
      void actions.stopFindInPage(false)
      return
    }

    const timeout = window.setTimeout(() => {
      void actions.findInPage(trimmedQuery, {
        forward: true,
        recompute: true,
        matchCase: findMatchCase,
      })
    }, 40)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [actions, findMatchCase, findQuery, isFindVisible])

  const handleKeyDownCapture = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable)
      const primaryModifier = isMac ? event.metaKey : event.ctrlKey
      const key = event.key.toLowerCase()

      if (primaryModifier && key === "l") {
        event.preventDefault()
        focusUrlInput()
        return
      }

      if (primaryModifier && key === "f") {
        event.preventDefault()
        openFind()
        return
      }

      if (primaryModifier && key === "r") {
        event.preventDefault()
        void actions.reload(event.shiftKey)
        return
      }

      if (primaryModifier && key === "g") {
        event.preventDefault()
        if (event.shiftKey) {
          findPrevious()
        } else {
          findNext()
        }
        return
      }

      if (primaryModifier && (event.key === "=" || event.key === "+")) {
        event.preventDefault()
        void actions.zoomIn()
        return
      }

      if (primaryModifier && event.key === "-") {
        event.preventDefault()
        void actions.zoomOut()
        return
      }

      if (primaryModifier && event.key === "0") {
        event.preventDefault()
        void actions.resetZoom()
        return
      }

      if (event.key === "F3") {
        event.preventDefault()
        if (event.shiftKey) {
          findPrevious()
        } else {
          findNext()
        }
        return
      }

      if (!isEditableTarget && event.altKey && !primaryModifier && !event.shiftKey) {
        if (event.key === "ArrowLeft") {
          event.preventDefault()
          void actions.goBack()
          return
        }
        if (event.key === "ArrowRight") {
          event.preventDefault()
          void actions.goForward()
          return
        }
      }

      if (event.key === "Escape" && isFindVisible) {
        event.preventDefault()
        closeFind(true)
      }
    },
    [
      actions,
      closeFind,
      findNext,
      findPrevious,
      focusUrlInput,
      isFindVisible,
      isMac,
      openFind,
    ],
  )

  const toolbar = (
    <div className="flex min-w-0 w-full items-center gap-2">
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!state.canGoBack}
          onClick={() => {
            void actions.goBack()
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
            void actions.goForward()
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
          onClick={(event) => {
            void actions.reload(event.altKey || event.shiftKey)
          }}
          aria-label="Reload"
          title="Reload page. Hold Alt or Shift for hard reload."
        >
          <RefreshCcw className={cn("h-3.5 w-3.5", state.isLoading && "animate-spin")} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7", isFindVisible && "text-foreground")}
          disabled={!canInteract}
          onClick={() => {
            openFind()
          }}
          aria-label="Find in page"
          title={`Find in page (${isMac ? "Cmd" : "Ctrl"}+F)`}
        >
          <Search className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex flex-1 min-w-0 items-center justify-center">
        <div className="relative w-full min-w-[240px]">
          {state.favicon ? (
            <img
              src={state.favicon}
              alt=""
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-sm object-contain"
            />
          ) : draftUrl.startsWith("https://") ? (
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          ) : null}
          <Input
            ref={urlInputRef}
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
              "h-7 border-0 bg-muted/20 text-center text-xs shadow-none transition-colors hover:bg-muted/35 focus-visible:bg-muted/30 focus-visible:ring-1 focus-visible:ring-ring",
              (draftUrl.startsWith("https://") || state.favicon) ? "pl-9" : "px-3",
            )}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!state.canZoomOut}
          onClick={() => {
            void actions.zoomOut()
          }}
          aria-label="Zoom out"
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-7 min-w-[3rem] px-2 text-[11px] tabular-nums text-muted-foreground"
          onClick={() => {
            void actions.resetZoom()
          }}
          aria-label="Reset zoom"
          title="Reset zoom"
        >
          {Math.round(state.zoomFactor * 100)}%
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!state.canZoomIn}
          onClick={() => {
            void actions.zoomIn()
          }}
          aria-label="Zoom in"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7", state.isDevToolsOpen && "text-foreground")}
          onClick={() => {
            void actions.toggleDevTools()
          }}
          aria-label="Toggle developer tools"
          title="Toggle developer tools"
        >
          <SquareTerminal className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!canInteract}
          onClick={() => {
            void actions.openExternal()
          }}
          aria-label="Open in external browser"
          title="Open in external browser"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )

  return (
    <div className="h-full min-h-0" onKeyDownCapture={handleKeyDownCapture}>
      <WorkbenchTileChrome
        title={state.title || "Browser"}
        panelApi={panelApi}
        containerApi={containerApi}
        controls={toolbar}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-content-surface p-px">
          {isFindVisible ? (
            <div className="shrink-0 border-b border-border/60 bg-content-surface px-3 py-2">
              <div className="ml-auto flex w-full max-w-md items-center gap-1 rounded-xl border border-border/60 bg-muted/20 p-1 shadow-sm">
                <Search className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <Input
                  ref={findInputRef}
                  value={findQuery}
                  onChange={(event) => setFindQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      if (event.shiftKey) {
                        findPrevious()
                      } else {
                        findNext()
                      }
                    }
                  }}
                  placeholder="Find in page"
                  className="h-8 border-0 bg-transparent px-2 text-xs shadow-none focus-visible:ring-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-8 min-w-0 shrink-0 px-2 text-[11px] text-muted-foreground",
                    findMatchCase && "bg-muted text-foreground",
                  )}
                  onClick={() => {
                    setFindMatchCase((current) => !current)
                  }}
                  aria-label="Match case"
                  title="Match case"
                >
                  Aa
                </Button>
                <div className="min-w-[3.25rem] px-1 text-right text-[11px] tabular-nums text-muted-foreground">
                  {findResultLabel}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={!hasFindQuery}
                  onClick={() => {
                    findPrevious()
                  }}
                  aria-label="Find previous"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={!hasFindQuery}
                  onClick={() => {
                    findNext()
                  }}
                  aria-label="Find next"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    closeFind(true)
                  }}
                  aria-label="Close find"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : null}

          <div className="relative min-h-0 flex-1 overflow-hidden bg-content-surface">
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
              <div className="absolute inset-px z-[100] flex items-center justify-center bg-content-surface p-6 text-center">
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
                  "absolute inset-px overflow-hidden bg-content-surface",
                  (!boundsReady || state.loadError) ? "pointer-events-none opacity-0" : "opacity-100",
                )}
              />
            ) : null}
          </div>
        </div>
      </WorkbenchTileChrome>
    </div>
  )
}
