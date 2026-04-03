import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview"
import type {
  AvailableExternalBrowser,
  AvailableExternalBrowserResult,
  ExternalBrowserId,
} from "@shared/electronApiTypes"
import { AppWindow, ChevronDown, Eye, Play, RefreshCcw, Square, SquareTerminal } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import { useWorkbenchBrowserView } from "@/features/projects/components/workbench/useWorkbenchBrowserView"
import {
  getEffectiveExternalBrowserId,
  getExternalBrowserIcon,
  getVisibleExternalBrowsers,
  PREVIEW_BROWSER_PREFERENCE_KEY,
  PREVIEW_DESTINATION_PREFERENCE_KEY,
  readStoredExternalBrowserPreference,
  readStoredPreviewDestinationPreference,
  type PreviewDestination,
  resolvePreferredExternalBrowserId,
} from "@/features/projects/lib/externalBrowserPreference"
import { useDevServerManager } from "@/hooks/useDevServerManager"
import { cn } from "@/lib/utils"
import type { WorkbenchDevServerTile } from "@/stores/useProjectWorkbenchStore"

interface WorkbenchDevServerTileProps {
  tile: WorkbenchDevServerTile
  projectPath: string | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
  onLinkedBrowserReady: (url: string) => void
}

export function WorkbenchDevServerTile({
  tile,
  projectPath,
  panelApi,
  containerApi,
  onLinkedBrowserReady,
}: WorkbenchDevServerTileProps) {
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview")
  const [availableBrowsers, setAvailableBrowsers] = useState<AvailableExternalBrowser[]>([
    { id: "system", name: "System Default" },
  ])
  const [defaultBrowserId, setDefaultBrowserId] = useState<ExternalBrowserId>("system")
  const [selectedBrowserId, setSelectedBrowserId] = useState<ExternalBrowserId>(() => readStoredExternalBrowserPreference())
  const [previewDestination, setPreviewDestination] = useState<PreviewDestination>(() => readStoredPreviewDestinationPreference())
  const devServer = useDevServerManager({
    projectPath,
    autoStart: false,
  })
  const previewUrl = devServer.url ?? (devServer.port ? `http://localhost:${devServer.port}` : "")
  const previewTileId = useMemo(() => `${tile.id}::preview`, [tile.id])
  const showEmbeddedPreview = viewMode === "preview" && previewDestination === "cozea"
  const { hostRef, state: previewState, boundsReady } = useWorkbenchBrowserView({
    tileId: previewTileId,
    url: showEmbeddedPreview ? previewUrl : "",
    visible: showEmbeddedPreview,
  })
  const lastExternalPreviewKeyRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadAvailableBrowsers = async () => {
      try {
        const result = await window.electronAPI.shell.listAvailableBrowsers() as AvailableExternalBrowserResult
        if (cancelled || result.browsers.length === 0) return
        setAvailableBrowsers(result.browsers)
        setDefaultBrowserId(result.defaultBrowserId)
      } catch (error) {
        console.error("[WorkbenchDevServerTile] Failed to load available browsers", error)
      }
    }

    void loadAvailableBrowsers()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const resolvedBrowserId = resolvePreferredExternalBrowserId(availableBrowsers, selectedBrowserId)
    if (resolvedBrowserId === selectedBrowserId) return
    setSelectedBrowserId(resolvedBrowserId)
  }, [availableBrowsers, selectedBrowserId])

  useEffect(() => {
    try {
      window.localStorage.setItem(PREVIEW_BROWSER_PREFERENCE_KEY, selectedBrowserId)
    } catch {
      // Ignore local storage failures in desktop state.
    }
  }, [selectedBrowserId])

  useEffect(() => {
    try {
      window.localStorage.setItem(PREVIEW_DESTINATION_PREFERENCE_KEY, previewDestination)
    } catch {
      // Ignore local storage failures in desktop state.
    }
  }, [previewDestination])

  useEffect(() => {
    if (!previewUrl || !tile.linkedBrowserTileId) return
    onLinkedBrowserReady(previewUrl)
  }, [onLinkedBrowserReady, previewUrl, tile.linkedBrowserTileId])

  const visibleBrowsers = useMemo(() => {
    return getVisibleExternalBrowsers(availableBrowsers, defaultBrowserId)
  }, [availableBrowsers, defaultBrowserId])

  const effectiveBrowserId = useMemo(() => {
    return getEffectiveExternalBrowserId(selectedBrowserId, defaultBrowserId)
  }, [defaultBrowserId, selectedBrowserId])

  const effectiveSelectedBrowser = useMemo(() => {
    return (
      visibleBrowsers.find((browser) => browser.id === effectiveBrowserId)
      ?? availableBrowsers.find((browser) => browser.id === effectiveBrowserId)
      ?? availableBrowsers[0]
      ?? { id: "system" as const, name: "System Default" }
    )
  }, [availableBrowsers, effectiveBrowserId, visibleBrowsers])

  const PreviewIcon = previewDestination === "cozea"
    ? Eye
    : getExternalBrowserIcon(effectiveBrowserId)

  const openPreviewExternally = useCallback(
    async (force = false) => {
      if (!previewUrl) return

      const nextKey = `${effectiveBrowserId}:${previewUrl}`
      if (!force && lastExternalPreviewKeyRef.current === nextKey) {
        return
      }

      lastExternalPreviewKeyRef.current = nextKey
      const result = await window.electronAPI.shell.openInBrowser({
        url: previewUrl,
        browserId: effectiveBrowserId,
      })

      if (!result.success) {
        lastExternalPreviewKeyRef.current = null
        console.error("[WorkbenchDevServerTile] Failed to open preview in browser", result.error)
      }
    },
    [effectiveBrowserId, previewUrl]
  )

  useEffect(() => {
    if (!previewUrl) {
      lastExternalPreviewKeyRef.current = null
      return
    }

    if (previewDestination !== "external" || viewMode !== "preview") {
      return
    }

    void openPreviewExternally()
  }, [openPreviewExternally, previewDestination, previewUrl, viewMode])

  const handlePreviewDestinationChange = useCallback((value: string) => {
    if (value === "cozea") {
      setPreviewDestination("cozea")
      return
    }

    setSelectedBrowserId(value as ExternalBrowserId)
    setPreviewDestination("external")
  }, [])

  const chromeControls = (
    <div className="flex min-w-0 items-center">
      <div className="inline-flex h-8 items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex h-full w-9 items-center justify-center border-0 bg-transparent text-muted-foreground/80 transition-colors",
                "hover:text-foreground",
              )}
              aria-label="Choose preview destination"
              title={
                previewDestination === "cozea"
                  ? "Choose preview destination"
                  : `Choose preview destination (currently ${effectiveSelectedBrowser.name})`
              }
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Preview in</div>
            <DropdownMenuRadioGroup
              value={previewDestination === "cozea" ? "cozea" : effectiveBrowserId}
              onValueChange={handlePreviewDestinationChange}
            >
              <DropdownMenuRadioItem value="cozea">
                <AppWindow className="mr-2 h-4 w-4 text-muted-foreground" />
                Cozea
              </DropdownMenuRadioItem>
              {visibleBrowsers.map((browser) => {
                const BrowserIcon = getExternalBrowserIcon(browser.id)
                return (
                  <DropdownMenuRadioItem key={browser.id} value={browser.id}>
                    {createElement(BrowserIcon, { className: "mr-2 h-4 w-4 text-muted-foreground" })}
                    {browser.name}
                  </DropdownMenuRadioItem>
                )
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="mx-1 h-4 w-px bg-border/45" aria-hidden />
        <button
          type="button"
          className={cn(
            "relative flex h-full min-w-11 items-center justify-center border-0 bg-transparent px-3 text-muted-foreground/75 transition-colors",
            "hover:text-foreground",
            viewMode === "preview" &&
              "text-foreground after:absolute after:bottom-1 after:left-3 after:right-3 after:h-0.5 after:rounded-full after:bg-foreground",
          )}
          onClick={() => {
            setViewMode("preview")
            if (previewDestination === "external") {
              void openPreviewExternally(true)
            }
          }}
          aria-pressed={viewMode === "preview"}
          aria-label={previewDestination === "cozea" ? "Preview in Cozea" : `Preview in ${effectiveSelectedBrowser.name}`}
          title={previewDestination === "cozea" ? "Preview in Cozea" : `Preview in ${effectiveSelectedBrowser.name}`}
        >
          {createElement(PreviewIcon, { className: "h-4 w-4" })}
        </button>
        <div className="mx-1 h-4 w-px bg-border/45" aria-hidden />
        <button
          type="button"
          className={cn(
            "relative flex h-full min-w-11 items-center justify-center border-0 bg-transparent px-3 text-muted-foreground/75 transition-colors",
            "hover:text-foreground",
            viewMode === "code" &&
              "text-foreground after:absolute after:bottom-1 after:left-3 after:right-3 after:h-0.5 after:rounded-full after:bg-foreground",
          )}
          onClick={() => setViewMode("code")}
          aria-pressed={viewMode === "code"}
          aria-label="Code"
          title="Code"
        >
          <SquareTerminal className="h-4 w-4" />
        </button>
      </div>
    </div>
  )

  const chromeActions = projectPath ? (
    <>
      {devServer.isRunning ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!previewUrl}
            onClick={() => {
              if (!previewUrl) return
              if (previewDestination === "external") {
                void openPreviewExternally(true)
                return
              }
              void window.electronAPI.workbenchBrowser.reload({ tileId: previewTileId })
            }}
            aria-label={previewDestination === "external" ? `Open preview in ${effectiveSelectedBrowser.name} again` : "Reload preview"}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => {
              void devServer.stop()
            }}
            aria-label="Stop dev server"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            void devServer.start()
          }}
          aria-label="Start dev server"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
        </Button>
      )}

    </>
  ) : null

  const logsBody =
    devServer.output.length > 0 ? (
      <div className="app-scrollbar h-full overflow-auto p-3">
        <pre className="min-h-full whitespace-pre-wrap font-mono text-[11px] leading-5 text-foreground">
          {devServer.output.join("")}
        </pre>
      </div>
    ) : (
      <div className="flex h-full items-center justify-center p-6">
        <Empty className="w-full max-w-md py-8">
          <EmptyHeader>
            <EmptyTitle className="text-base font-medium">No output yet</EmptyTitle>
            <EmptyDescription>
              Start the dev server to stream logs here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )

  const externalPreviewBody = (
    <div className="flex h-full items-center justify-center p-6">
      <Empty className="w-full max-w-md py-8">
        <EmptyHeader>
          <EmptyMedia className="h-auto w-auto rounded-none bg-transparent [&>svg]:h-7 [&>svg]:w-7 [&>svg]:text-muted-foreground">
            {createElement(getExternalBrowserIcon(effectiveBrowserId), { className: "h-7 w-7" })}
          </EmptyMedia>
          <EmptyTitle className="text-base font-medium">
            {!previewUrl
              ? "No preview yet"
              : `Preview opens in ${effectiveSelectedBrowser.name}`}
          </EmptyTitle>
          <EmptyDescription>
            {!previewUrl
              ? `Start the dev server to open the local preview in ${effectiveSelectedBrowser.name}.`
              : `Cozea is sending this preview to ${effectiveSelectedBrowser.name}. Use refresh to reopen it, or switch back to Cozea to embed it here.`}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )

  const previewBody = (
    <div className="relative h-full min-h-0 overflow-hidden bg-background p-px">
      {!previewUrl ? (
        <div className="flex h-full w-full items-center justify-center p-6">
          <Empty className="w-full max-w-md py-8">
            <EmptyHeader>
              <EmptyMedia className="h-auto w-auto rounded-none bg-transparent [&>svg]:h-7 [&>svg]:w-7 [&>svg]:text-muted-foreground">
                <AppWindow className="h-7 w-7" />
              </EmptyMedia>
              <EmptyTitle className="text-base font-medium">
                {devServer.status === "starting" ? "Starting preview…" : "No preview yet"}
              </EmptyTitle>
              <EmptyDescription>
                {devServer.status === "starting"
                  ? "Waiting for the local dev server to expose a preview URL."
                  : "Start the dev server to load the local preview here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : null}
      {previewUrl && previewState.loadError ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/92 p-6 text-center">
          <div className="max-w-md space-y-2">
            <div className="text-sm font-medium text-foreground">
              This preview could not be loaded.
            </div>
            <div className="text-xs text-muted-foreground">{previewState.loadError}</div>
          </div>
        </div>
      ) : null}
      {previewUrl ? (
        <div
          ref={hostRef}
          className={cn(
            "absolute inset-px overflow-hidden bg-background",
            !boundsReady ? "opacity-70" : "opacity-100",
          )}
        />
      ) : null}
    </div>
  )

  const body = !projectPath ? (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      Open or relink a local project folder to manage a dev server here.
    </div>
  ) : viewMode === "preview"
    ? previewDestination === "cozea"
      ? previewBody
      : externalPreviewBody
    : logsBody

  return (
    <WorkbenchTileChrome
      title={tile.title}
      panelApi={panelApi}
      containerApi={containerApi}
      controls={chromeControls}
      actions={chromeActions}
    >
      <div className="h-full min-h-0 bg-background">{body}</div>
    </WorkbenchTileChrome>
  )
}
