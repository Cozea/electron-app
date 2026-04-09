import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview"
import { ArrowLeftIcon as ArrowLeft, ArrowPathIcon as RefreshCcw, ArrowRightIcon as ArrowRight, ArrowTopRightOnSquareIcon as ExternalLink, ArrowUpIcon as ArrowUp, ChevronDownIcon as ChevronDown, ChevronUpIcon as ChevronUp, CommandLineIcon as SquareTerminal, GlobeAltIcon as Globe, LockClosedIcon as Lock, MagnifyingGlassIcon as Search, MinusIcon as Minus, PlusIcon as Plus, XMarkIcon as X } from "@heroicons/react/24/outline"

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
  const [omniHover, setOmniHover] = useState(false)
  const [omniFocused, setOmniFocused] = useState(false)
  const urlInputRef = useRef<HTMLInputElement | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const {
    hostRef,
    state,
    boundsReady,
    overlayPaused,
    overlayPauseReason,
    placeholderScreenshot,
    actions,
  } = useWorkbenchBrowserView({
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

  const handleOmnibarBlurCapture = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) return
    setOmniFocused(false)
  }, [])

  const canInteract = useMemo(() => Boolean(url), [url])
  const showOmniChrome = omniHover || omniFocused || isFindVisible
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
    setOmniFocused(true)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        urlInputRef.current?.focus()
        urlInputRef.current?.select()
      })
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
      window.requestAnimationFrame(() => {
        findInputRef.current?.focus()
        findInputRef.current?.select()
      })
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

  const navChipClass =
    "h-7 w-7 shrink-0 rounded-full border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"

  const trayGhostClass =
    "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"

  const canSubmitUrl = Boolean(normalizeUrlInput(draftUrl))
  const browserViewportInsetClass = showOmniChrome
    ? isFindVisible
      ? "bottom-[12.5rem] sm:bottom-[13.5rem]"
      : "bottom-[8.75rem] sm:bottom-[9.5rem]"
    : "bottom-px"

  const omnibarStack = (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <div className="overflow-hidden rounded-2xl bg-secondary">
        {isFindVisible ? (
          <div className="border-b border-border/30 bg-background/10 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1">
              <Search className="ml-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
                className="h-8 min-w-[8rem] flex-1 border-0 bg-transparent px-2 text-sm shadow-none focus-visible:ring-0"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  trayGhostClass,
                  "h-7 px-2.5",
                  findMatchCase && "bg-accent text-foreground",
                )}
                onClick={() => {
                  setFindMatchCase((current) => !current)
                }}
                aria-label="Match case"
                title="Match case"
              >
                Aa
              </Button>
              <span className="min-w-[3rem] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {findResultLabel}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-full"
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
                className="h-7 w-7 shrink-0 rounded-full"
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
                className="h-7 w-7 shrink-0 rounded-full"
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

        <div
          className={cn(
            "relative px-3 pb-2",
            isFindVisible ? "pt-2.5" : "pt-3",
          )}
        >
          <div className="flex min-h-6 items-center gap-2">
            {state.favicon ? (
              <img
                src={state.favicon}
                alt=""
                className="size-4 shrink-0 rounded-sm object-contain"
              />
            ) : draftUrl.startsWith("https://") ? (
              <Lock className="size-4 shrink-0 text-muted-foreground" />
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
                "h-auto min-h-6 min-w-0 flex-1 appearance-none rounded-none border-0 bg-transparent p-0 text-left text-sm leading-6 shadow-none",
                "placeholder:text-muted-foreground/35",
                "focus-visible:ring-0 focus-visible:outline-none",
              )}
            />
          </div>
        </div>

        <div
          data-browser-omnibar-footer="true"
          className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-2 sm:flex-nowrap"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:min-w-max sm:overflow-visible">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={navChipClass}
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
              className={navChipClass}
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
              className={navChipClass}
              disabled={!canInteract}
              onClick={(event) => {
                void actions.reload(event.altKey || event.shiftKey)
              }}
              aria-label="Reload"
              title="Reload page. Hold Alt or Shift for hard reload."
            >
              <RefreshCcw className={cn("h-3.5 w-3.5", state.isLoading && "animate-spin")} />
            </Button>
          </div>

          <div data-browser-omnibar-actions="right" className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
              disabled={!canSubmitUrl}
              aria-label="Go to URL"
              title="Go to URL"
              onClick={() => {
                submitDraftUrl()
              }}
            >
              <ArrowUp className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-1 pt-1 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(trayGhostClass, isFindVisible && "bg-accent text-foreground")}
            disabled={!canInteract}
            onClick={() => {
              openFind()
            }}
            title={`Find in page (${isMac ? "Cmd" : "Ctrl"}+F)`}
          >
            <Search className="size-3.5 shrink-0" />
            <span>Find</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 rounded-full border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
            disabled={!state.canZoomOut}
            onClick={() => {
              void actions.zoomOut()
            }}
            aria-label="Zoom out"
          >
            <Minus className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={trayGhostClass}
            onClick={() => {
              void actions.resetZoom()
            }}
            aria-label="Reset zoom"
            title="Reset zoom"
          >
            <span className="tabular-nums">{Math.round(state.zoomFactor * 100)}%</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 rounded-full border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
            disabled={!state.canZoomIn}
            onClick={() => {
              void actions.zoomIn()
            }}
            aria-label="Zoom in"
          >
            <Plus className="size-3.5" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(trayGhostClass, state.isDevToolsOpen && "bg-accent text-foreground")}
            onClick={() => {
              void actions.toggleDevTools()
            }}
            title="Toggle developer tools"
          >
            <SquareTerminal className="size-3.5 shrink-0" />
            <span>Devtools</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={trayGhostClass}
            disabled={!canInteract}
            onClick={() => {
              void actions.openExternal()
            }}
            title="Open in external browser"
          >
            <ExternalLink className="size-3.5 shrink-0" />
            <span>Open</span>
          </Button>
      </div>
    </div>
  )

  return (
    <div className="h-full min-h-0" onKeyDownCapture={handleKeyDownCapture}>
      <WorkbenchTileChrome title={state.title || "Browser"} panelApi={panelApi} containerApi={containerApi}>
        <div
          className="relative flex h-full min-h-0 flex-col overflow-hidden bg-content-surface p-px"
          onMouseEnter={() => {
            setOmniHover(true)
          }}
          onMouseLeave={() => {
            setOmniHover(false)
          }}
        >
          <div
            className={cn(
              "pointer-events-none absolute bottom-0 left-0 right-3 z-10 flex flex-col items-center justify-end px-3 sm:right-4 sm:px-5",
              showOmniChrome && "pt-1.5 pb-4 sm:pt-2 sm:pb-5",
            )}
          >
            <div
              className={cn(
                "pointer-events-none h-40 w-full max-w-2xl shrink-0 bg-gradient-to-t from-background/92 via-background/55 to-transparent transition-opacity duration-300",
                showOmniChrome ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
            <div
              className={cn(
                "relative z-[1] w-full max-w-2xl space-y-2 overflow-hidden transition-all duration-200 ease-out",
                showOmniChrome
                  ? "max-h-[min(28rem,85vh)] translate-y-0 opacity-100 pointer-events-auto"
                  : "max-h-0 translate-y-1 opacity-0 pointer-events-none",
              )}
              onFocusCapture={() => {
                setOmniFocused(true)
              }}
              onBlurCapture={handleOmnibarBlurCapture}
            >
              {omnibarStack}
            </div>
          </div>

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
                      Hover this browser panel (or press {isMac ? "⌘L" : "Ctrl+L"}) to show the address bar, or open a
                      linked dev server in this tile.
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
            {url && overlayPaused && !state.loadError ? (
              <div className="absolute inset-px z-[90] overflow-hidden rounded-[inherit] border border-border/40 bg-content-surface">
                {placeholderScreenshot ? (
                  <div
                    className="absolute inset-0 bg-cover bg-top bg-no-repeat"
                    style={{ backgroundImage: `url("${placeholderScreenshot}")` }}
                    aria-hidden
                  />
                ) : null}
                <div className="absolute inset-0 bg-background/18 backdrop-blur-[1px]" aria-hidden />
                <div className="absolute inset-x-4 bottom-4">
                  <div className="mx-auto max-w-sm rounded-2xl border border-border/60 bg-background/88 px-3 py-2 text-center shadow-sm">
                    <div className="text-xs font-medium text-foreground">Browser paused</div>
                    <div className="mt-1 text-[11px] leading-normal text-muted-foreground">
                      {overlayPauseReason
                        ? `Hidden while ${overlayPauseReason} is open.`
                        : "Hidden while a workbench overlay is open."}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            {url ? (
              <div
                ref={hostRef}
                className={cn(
                  "absolute left-px right-px top-px overflow-hidden bg-content-surface",
                  browserViewportInsetClass,
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
