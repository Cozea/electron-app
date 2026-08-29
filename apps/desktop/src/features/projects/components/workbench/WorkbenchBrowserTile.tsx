import {

  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react"
import type { ContextMenuItem } from "@cozea/assistant-contracts"
import type { DockviewApi, DockviewPanelApi } from "dockview-react"

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
import {
  getWorkbenchBrowserDisplayError,
  useWorkbenchBrowserView,
} from "@/features/projects/components/workbench/useWorkbenchBrowserView"
import { useWorkbenchPanelActivityMode } from "@/features/projects/components/workbench/useWorkbenchPanelActivityMode"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { cn } from "@/lib/utils"
import { dispatchBrowserFocusUrl, normalizeUrlInput } from "@/features/projects/browser/urlInput"
import {
  type WorkbenchBrowserTile as WorkbenchBrowserTileRecord,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"

import { HugeiconsIcon } from '@hugeicons/react'
import { MoreVerticalIcon as __EllipsisVerticalHugeIcon, ArrowLeft01Icon as __ArrowLeftHugeIcon, ArrowRight01Icon as __ArrowRightHugeIcon, Cancel01Icon as __XHugeIcon, ChevronDoubleCloseIcon as __ChevronDownHugeIcon, ChevronDoubleCloseIcon as __ChevronUpHugeIcon, Globe02Icon as __GlobeHugeIcon, LockIcon as __LockHugeIcon } from '@hugeicons/core-free-icons'

interface WorkbenchBrowserTileProps {
  projectId: string
  laneId: string
  tile: WorkbenchBrowserTileRecord
  workspaceId: string | null
  workbenchSessionKey: string | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
}

async function showNativeBrowserHeaderMenu<T extends string>(
  event: MouseEvent<HTMLElement>,
  items: readonly ContextMenuItem<T>[],
): Promise<T | null> {
  event.preventDefault()
  event.stopPropagation()
  if (items.length === 0) return null

  const rect = event.currentTarget.getBoundingClientRect()
  const position = {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.bottom),
  }

  return showDesktopContextMenu(items, position)
}

export function WorkbenchBrowserTile({
  projectId,
  laneId,
  tile,
  workspaceId,
  workbenchSessionKey,
  panelApi,
  containerApi,
}: WorkbenchBrowserTileProps) {
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions)
  const panelActivity = useWorkbenchPanelActivityMode(panelApi)
  const isMac = useMemo(() => navigator.platform.toLowerCase().includes("mac"), [])
  const [draftUrl, setDraftUrl] = useState(tile.url)
  const [isFindVisible, setIsFindVisible] = useState(false)
  const [findQuery, setFindQuery] = useState("")
  const [findMatchCase] = useState(false)
  const urlInputRef = useRef<HTMLInputElement | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const {
    hostRef,
    state,
    boundsReady,
    overlayPaused,
    placeholderScreenshot,
    actions,
  } = useWorkbenchBrowserView({
    tileId: tile.id,
    url: tile.url,
    sessionKey: workbenchSessionKey,
    projectId,
    laneId,
    workspaceId: workspaceId ?? undefined,
    visible: panelActivity.visible,
    persistModel: true,
    onUrlObserved: (nextUrl) => {
      workbenchActions.updateBrowserTile(projectId, laneId, tile.id, { url: nextUrl }, workspaceId)
    },
    onTitleObserved: (title) => {
      workbenchActions.updateTileTitle(projectId, laneId, tile.id, title, workspaceId)
    },
    onFaviconObserved: (favicon) => {
      workbenchActions.updateBrowserTile(projectId, laneId, tile.id, { favicon }, workspaceId)
    },
    onNewPageRequest: (request) => {
      const nextTileId = workbenchActions.addTile(projectId, laneId, "browser", {
        url: request.url,
        storageScope: tile.storageScope ?? "workspace",
      }, workspaceId)
      workbenchActions.setActiveTile(projectId, laneId, nextTileId, workspaceId)
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
  const displayError = getWorkbenchBrowserDisplayError(state)

  useEffect(() => {
    setDraftUrl(tile.url)
  }, [tile.url])

  useEffect(() => {
    if (tile.url) return
    setIsFindVisible(false)
    setFindQuery("")
  }, [tile.url])

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
    workbenchActions.updateBrowserTile(projectId, laneId, tile.id, {
      url: normalized,
      title: "Browser",
    }, workspaceId)
  }

  const focusUrlInput = useCallback(() => {
    panelApi.setActive()
    // The address bar lives in the dock header (BrowserPanelHeaderControls)
    // and owns its own input; ask it to focus instead of touching a local ref.
    window.requestAnimationFrame(() => {
      dispatchBrowserFocusUrl(tile.id)
    })
  }, [panelApi, tile.id])

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
    (event: KeyboardEvent<HTMLDivElement>) => {
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
    [actions, closeFind, findNext, findPrevious, focusUrlInput, isFindVisible, isMac, openFind],
  )

  const navChipClass =
    "h-7 w-7 shrink-0 rounded-md border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
  const browserHeaderControls = (
    <div className="flex min-w-0 items-center gap-1.5">
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
        <HugeiconsIcon icon={__ArrowLeftHugeIcon} className="h-3.5 w-3.5" />
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
        <HugeiconsIcon icon={__ArrowRightHugeIcon} className="h-3.5 w-3.5" />
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md bg-secondary px-2">
        {state.favicon ? (
          <img
            src={state.favicon}
            alt=""
            className="size-[18px] shrink-0 rounded-sm object-contain"
          />
        ) : draftUrl.startsWith("https://") ? (
          <HugeiconsIcon icon={__LockHugeIcon} className="size-[18px] shrink-0 text-muted-foreground" />
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
          placeholder="Search or enter address"
          className={cn(
            "h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs shadow-none dark:bg-transparent",
            "placeholder:text-muted-foreground/45 focus-visible:ring-0",
          )}
        />
      </div>
    </div>
  )

  const browserHeaderActions = (
    <>
      {isFindVisible ? (
        <div className="flex items-center gap-0.5 rounded-full bg-secondary px-1.5">
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
            placeholder="Find"
            className="h-7 w-24 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <span className="min-w-[2.5rem] text-right text-[10px] tabular-nums text-muted-foreground">
            {findResultLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md"
            disabled={!hasFindQuery}
            onClick={() => {
              findPrevious()
            }}
            aria-label="Find previous"
          >
            <HugeiconsIcon icon={__ChevronUpHugeIcon} className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md"
            disabled={!hasFindQuery}
            onClick={() => {
              findNext()
            }}
            aria-label="Find next"
          >
            <HugeiconsIcon icon={__ChevronDownHugeIcon} className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md"
            onClick={() => {
              closeFind(true)
            }}
            aria-label="Close find"
          >
            <HugeiconsIcon icon={__XHugeIcon} className="h-3 w-3" />
          </Button>
        </div>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 hover:bg-accent hover:text-foreground"
        aria-label="Browser options"
        onClick={async (event) => {
          const items: ContextMenuItem<
            | "reload"
            | "hard-reload"
            | "find"
            | "open-external"
            | "devtools"
            | "zoom-out"
            | "zoom-reset"
            | "zoom-in"
            | "divider-1"
            | "divider-2"
          >[] = [
            { id: "reload", label: "Reload page" },
            { id: "hard-reload", label: "Hard reload" },
            { id: "divider-2", label: "", type: "separator" },
            { id: "find", label: `Find in page (${isMac ? "Cmd" : "Ctrl"}+F)` },
            { id: "open-external", label: "Open in external browser" },
            { id: "devtools", label: state.isDevToolsOpen ? "Hide Devtools" : "Show Devtools" },
            { id: "divider-1", label: "", type: "separator" },
            { id: "zoom-out", label: "Zoom out" },
            { id: "zoom-reset", label: `Reset zoom (${Math.round(state.zoomFactor * 100)}%)` },
            { id: "zoom-in", label: "Zoom in" },
          ]

          const action = await showNativeBrowserHeaderMenu(event, items)
          if (!action) return

          switch (action) {
            case "reload":
              void actions.reload(false)
              break
            case "hard-reload":
              void actions.reload(true)
              break
            case "find":
              openFind()
              break
            case "open-external":
              void actions.openExternal()
              break
            case "devtools":
              void actions.toggleDevTools()
              break
            case "zoom-out":
              void actions.zoomOut()
              break
            case "zoom-reset":
              void actions.resetZoom()
              break
            case "zoom-in":
              void actions.zoomIn()
              break
          }
        }}
      >
        <HugeiconsIcon icon={__EllipsisVerticalHugeIcon} className="h-4 w-4" />
      </Button>
    </>
  )

  return (
    <div className="h-full min-h-0" data-workbench-browser-tile="true" onKeyDownCapture={handleKeyDownCapture}>
      <WorkbenchTileChrome
        title={state.title || "Browser"}
        panelApi={panelApi}
        containerApi={containerApi}
        hideTitlePill
        tileType="browser"
        controls={browserHeaderControls}
        actions={browserHeaderActions}
      >
        <div data-workbench-browser-content="true" className="relative flex h-full min-h-0 flex-col overflow-hidden bg-content-surface">
          <div className="relative min-h-0 flex-1 overflow-hidden bg-content-surface">
            {!tile.url ? (
              <div className="flex h-full w-full items-center justify-center p-6">
                <Empty className="w-full max-w-md py-8">
                  <EmptyHeader>
                    <EmptyMedia className="h-auto w-auto rounded-none bg-transparent [&>svg]:h-7 [&>svg]:w-7 [&>svg]:text-muted-foreground">
                      <HugeiconsIcon icon={__GlobeHugeIcon} className="h-7 w-7" />
                    </EmptyMedia>
                    <EmptyTitle className="text-base font-medium">No page loaded yet</EmptyTitle>
                    <EmptyDescription>
                      Type a URL in the address bar and press Enter, or press {isMac ? "⌘L" : "Ctrl+L"} to focus it.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            ) : null}
            {tile.url && displayError ? (
              <div className="absolute top-[1px] bottom-[1px] left-[1px] right-[1px] z-[100] flex items-center justify-center bg-content-surface p-6 text-center">
                <div className="max-w-md space-y-2">
                  <div className="text-sm font-medium text-foreground">
                    {state.httpError
                      ? `Page returned HTTP ${state.httpStatusCode ?? "error"}`
                      : "This page could not be loaded."}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {state.httpError
                      ? `${displayError}. The page produced no visible error document.`
                      : displayError}
                  </div>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void actions.reload()}>
                    Reload
                  </Button>
                </div>
              </div>
            ) : null}
            {tile.url && placeholderScreenshot && !displayError ? (
              <div className="absolute top-[1px] bottom-[1px] left-[1px] right-[1px] z-[85] overflow-hidden rounded-[inherit] bg-content-surface pointer-events-none">
                <div
                  className="absolute inset-0 bg-no-repeat"
                  style={{ backgroundImage: `url("${placeholderScreenshot}")`, backgroundSize: '100% 100%' }}
                  aria-hidden
                />
              </div>
            ) : null}
            {tile.url && overlayPaused && !placeholderScreenshot && !displayError ? (
              <div className="absolute top-[1px] bottom-[1px] left-[1px] right-[1px] z-[90] overflow-hidden rounded-[inherit] bg-content-surface pointer-events-none">
                <div className="absolute inset-0 bg-background/18 backdrop-blur-[1px]" aria-hidden />
              </div>
            ) : null}
            {tile.url ? (
              <div
                ref={hostRef}
                className={cn(
                  "absolute top-[1px] bottom-[1px] left-[1px] right-[1px] overflow-hidden bg-content-surface",
                  (!boundsReady || displayError) ? "pointer-events-none opacity-0" : "opacity-100",
                )}
              />
            ) : null}
          </div>
        </div>
      </WorkbenchTileChrome>
    </div>
  )
}
