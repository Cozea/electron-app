import { Activity, createElement, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview"
import type {
  AvailableExternalBrowser,
  AvailableExternalBrowserResult,
  ExternalBrowserId,
  WorkbenchSessionSnapshot,
} from "@shared/electronApiTypes"
import type { NativePreviewRotation } from "@shared/nativePreviewTypes"
import {
  ArrowPathIcon as RefreshCcw,
  ChevronDownIcon as ChevronDown,
  CommandLineIcon as SquareTerminal,
  ComputerDesktopIcon as AppWindow,
  EyeIcon as Eye,
  PlayIcon as Play,
  StopIcon as Square,
} from "@heroicons/react/24/outline"

import { Button } from "@/components/ui/button"
import { TerminalInstance } from "@/features/projects/components/TerminalInstance"
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
import { IosSimulatorViewport } from "@/features/projects/components/previews/IosSimulatorViewport"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import { useWorkbenchBrowserView } from "@/features/projects/components/workbench/useWorkbenchBrowserView"
import { useWorkbenchPanelActivityMode } from "@/features/projects/components/workbench/useWorkbenchPanelActivityMode"
import { useIosNativePreview } from "@/features/projects/hooks/useIosNativePreview"
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
import { type DevServerStatus, useDevServerManager } from "@/hooks/useDevServerManager"
import { cn } from "@/lib/utils"
import type { PageRoute, ServerStatus } from "@/features/projects/lib/previewRuntimeTypes"
import { type WorkbenchDevServerTile as WorkbenchDevServerTileRecord, useProjectWorkbenchStore } from "@/stores/useProjectWorkbenchStore"
import { useTerminalStore } from "@/stores/useTerminalStore"
import { getFrameworkInfo, type Framework } from "@/utils/projectDetector"

function devManagerStatusToServerStatus(status: DevServerStatus): ServerStatus {
  switch (status) {
    case "idle":
    case "stopped":
      return "stopped"
    case "starting":
      return "starting"
    case "ready":
      return "running"
    case "unhealthy":
      return "unhealthy"
    case "error":
      return "error"
    default:
      return "stopped"
  }
}

function useNativeMobilePreviewMode(framework: string | undefined): "ios" | "android" | null {
  if (framework === "expo" || framework === "react-native") {
    return "ios"
  }
  return null
}

const NATIVE_PREVIEW_ROUTE: PageRoute = {
  name: "App",
  path: "/",
  file: "",
  type: "static",
  status: "active",
}

interface WorkbenchDevServerTileProps {
  projectId: string
  laneId: string
  tile: WorkbenchDevServerTileRecord
  projectPath: string | null
  workspaceId: string | null
  framework: string | null
  storedDevCommand: string | null
  storedDevPort: number | null
  workbenchSession: WorkbenchSessionSnapshot | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
}

export function WorkbenchDevServerTile({
  projectId,
  laneId,
  tile,
  projectPath,
  workspaceId,
  framework: storedFramework,
  storedDevCommand,
  storedDevPort,
  workbenchSession,
  panelApi,
  containerApi,
}: WorkbenchDevServerTileProps) {
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions)
  const registerTerminal = useTerminalStore((state) => state.actions.registerTerminal)
  const replaceTerminalOutput = useTerminalStore((state) => state.actions.replaceTerminalOutput)
  const setTerminalUiAttached = useTerminalStore((state) => state.actions.setTerminalUiAttached)
  const updateTerminalDisplay = useTerminalStore((state) => state.actions.updateTerminalDisplay)
  const panelActivity = useWorkbenchPanelActivityMode(panelApi)
  const [resolvedFramework, setResolvedFramework] = useState<Framework | null>(
    storedFramework && storedFramework !== "unknown" ? (storedFramework as Framework) : null,
  )

  useEffect(() => {
    if (storedFramework && storedFramework !== "unknown") {
      setResolvedFramework(storedFramework as Framework)
      return
    }
    if (!projectPath) {
      setResolvedFramework(null)
      return
    }

    let cancelled = false

    void getFrameworkInfo(projectPath, (storedFramework as Framework | null) ?? null, storedDevCommand, storedDevPort)
      .then((frameworkInfo) => {
        if (cancelled) return
        setResolvedFramework(frameworkInfo.framework)
      })
      .catch(() => {
        if (cancelled) return
        setResolvedFramework(storedFramework && storedFramework !== "unknown" ? (storedFramework as Framework) : null)
      })

    return () => {
      cancelled = true
    }
  }, [projectPath, storedDevCommand, storedDevPort, storedFramework])

  const framework = resolvedFramework ?? (storedFramework as Framework | null) ?? undefined
  const nativePreviewPlatform = useNativeMobilePreviewMode(framework)
  const isIosNativePreview = nativePreviewPlatform === "ios"

  const [viewMode, setViewMode] = useState<"preview" | "code">("preview")
  const [previewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop")
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [availableBrowsers, setAvailableBrowsers] = useState<AvailableExternalBrowser[]>([
    { id: "system", name: "System Default" },
  ])
  const [defaultBrowserId, setDefaultBrowserId] = useState<ExternalBrowserId>("system")
  const [selectedBrowserId, setSelectedBrowserId] = useState<ExternalBrowserId>(() => readStoredExternalBrowserPreference())
  const [previewDestination, setPreviewDestination] = useState<PreviewDestination>(() => readStoredPreviewDestinationPreference())
  const terminalIdRef = useRef<string | null>(null)
  const devServer = useDevServerManager({
    projectPath,
    sessionKey: workbenchSession?.sessionKey ?? null,
    framework,
    terminalId,
    autoStart: false,
    storedDevCommand,
    storedDevPort,
    previewMode: isIosNativePreview ? "native" : "web",
    nativePlatform: nativePreviewPlatform,
    keepAliveOnUnmount: true,
    initialSnapshot: workbenchSession?.devServer ?? null,
  })
  const previewUrl = devServer.url ?? (devServer.port ? `http://localhost:${devServer.port}` : "")
  const nativePreviewScopeKey = workbenchSession?.sessionKey ?? `${projectId}::${laneId}`
  const serverStatusForNative = devManagerStatusToServerStatus(devServer.status)
  const nativePreview = useIosNativePreview({
    scopeKey: nativePreviewScopeKey,
    enabled: isIosNativePreview,
    projectPath,
    serverStatus: serverStatusForNative,
    keepAliveOnUnmount: true,
  })
  const nativeStreamUrl = nativePreview.sessionState?.streamUrl ?? null
  const previewServerActive =
    devServer.status === "ready" || devServer.status === "unhealthy" || devServer.status === "starting"

  const showEmbeddedPreview = viewMode === "preview" && previewDestination === "cozea"
  const showWebEmbeddedPreview = showEmbeddedPreview && !isIosNativePreview
  const {
    hostRef,
    state: previewState,
    boundsReady,
  } = useWorkbenchBrowserView({
    tileId: tile.id,
    url: showWebEmbeddedPreview ? previewUrl : "",
    projectId,
    laneId,
    projectPath,
    visible: showWebEmbeddedPreview && panelActivity.visible,
    storageScope: "ephemeral",
    workspaceId: workspaceId ?? undefined,
    persistModel: true,
    onNewPageRequest: (request) => {
      const nextTileId = workbenchActions.addTile(projectId, laneId, "browser", {
        url: request.url,
        storageScope: "workspace",
      })
      workbenchActions.setActiveTile(projectId, laneId, nextTileId)
    },
  })
  const lastExternalPreviewKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!projectPath) {
      setTerminalId(null)
      setTerminalError(null)
      return
    }

    let cancelled = false

    void (async () => {
      setTerminalError(null)

      await window.electronAPI.workbenchSession.ensureSession({
        projectId,
        laneId,
      })
      if (cancelled) return

      let nextTerminalId = await window.electronAPI.workbenchSession.getTerminalBinding({
        projectId,
        laneId,
        tileId: tile.id,
      })

      let snapshot =
        nextTerminalId
          ? await window.electronAPI.terminal.getSnapshot({ terminalId: nextTerminalId })
          : null

      if (!snapshot || !nextTerminalId) {
        const result = await window.electronAPI.terminal.create({
          projectPath,
          cwd: projectPath,
        })

        if (cancelled) return

        if (!result.success || !result.terminalId) {
          setTerminalError(result.error ?? "Failed to prepare the dev server terminal")
          return
        }

        nextTerminalId = result.terminalId
        await window.electronAPI.workbenchSession.bindTerminal({
          projectId,
          laneId,
          tileId: tile.id,
          terminalId: result.terminalId,
        })
        snapshot = await window.electronAPI.terminal.getSnapshot({
          terminalId: result.terminalId,
        })
      }

      if (!nextTerminalId || cancelled) {
        return
      }

      const info = await window.electronAPI.terminal.getInfo({ terminalId: nextTerminalId })
      if (cancelled) return

      terminalIdRef.current = nextTerminalId
      setTerminalId(nextTerminalId)
      registerTerminal({
        id: nextTerminalId,
        profileId: info?.profileId ?? "default",
        profileName: info?.profileName ?? "Shell",
        title: tile.title,
        projectPath,
        kind: "dev-server",
        surface: "panel",
        status: snapshot?.running === false ? "exited" : "running",
        exitCode: snapshot?.exitCode ?? null,
        hasOutput: Boolean(snapshot?.stdout?.length),
        uiAttached: true,
      })
      updateTerminalDisplay(nextTerminalId, {
        title: tile.title,
        label: storedDevCommand ?? "Dev server",
        command: storedDevCommand ?? undefined,
        kind: "dev-server",
        surface: "panel",
        projectPath,
      })
      replaceTerminalOutput(nextTerminalId, snapshot?.stdout ?? "")
      setTerminalUiAttached(nextTerminalId, true)
    })()

    return () => {
      cancelled = true
      const activeTerminalId = terminalIdRef.current
      if (!activeTerminalId) return
      setTerminalUiAttached(activeTerminalId, false)
      terminalIdRef.current = null
    }
  }, [
    laneId,
    projectId,
    projectPath,
    registerTerminal,
    replaceTerminalOutput,
    setTerminalUiAttached,
    storedDevCommand,
    tile.id,
    tile.title,
    updateTerminalDisplay,
  ])

  useEffect(() => {
    if (!terminalId) {
      return
    }
    setTerminalUiAttached(terminalId, panelActivity.visible)
  }, [panelActivity.visible, setTerminalUiAttached, terminalId])

  useEffect(() => {
    if (!terminalId) {
      return
    }

    updateTerminalDisplay(terminalId, {
      title: tile.title,
      label: storedDevCommand ?? "Dev server",
      command: storedDevCommand ?? undefined,
      kind: "dev-server",
      surface: "panel",
      projectPath: projectPath ?? undefined,
      port: devServer.port ?? undefined,
    })
  }, [devServer.port, projectPath, storedDevCommand, terminalId, tile.title, updateTerminalDisplay])

  useEffect(() => {
    if (!terminalId || !panelActivity.visible) {
      return
    }

    let cancelled = false
    void window.electronAPI.terminal.getSnapshot({ terminalId }).then((snapshot) => {
      if (cancelled) return
      replaceTerminalOutput(terminalId, snapshot?.stdout ?? "")
    }).catch(() => {
      // Ignore snapshot refresh failures when a session is being torn down.
    })

    return () => {
      cancelled = true
    }
  }, [panelActivity.visible, replaceTerminalOutput, terminalId, viewMode])

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
      // Ignore desktop local storage failures.
    }
  }, [selectedBrowserId])

  useEffect(() => {
    try {
      window.localStorage.setItem(PREVIEW_DESTINATION_PREFERENCE_KEY, previewDestination)
    } catch {
      // Ignore desktop local storage failures.
    }
  }, [previewDestination])

  useEffect(() => {
    const locator =
      isIosNativePreview && projectPath && nativePreview.selectedSimulator
        ? {
            projectPath,
            deviceId: nativePreview.selectedSimulator.udid,
            platform: "ios" as const,
          }
        : null

    void window.electronAPI.workbenchSession
      .setNativePreviewSession({
        projectId,
        laneId,
        locator,
      })
      .catch((error) => {
        console.warn("[WorkbenchDevServerTile] Failed to sync native preview session", error)
      })
  }, [isIosNativePreview, laneId, nativePreview.selectedSimulator, projectId, projectPath])

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

  const externalPreviewUrl = isIosNativePreview ? nativeStreamUrl ?? previewUrl : previewUrl

  const openPreviewExternally = useCallback(
    async (force = false) => {
      if (!externalPreviewUrl) return

      const nextKey = `${effectiveBrowserId}:${externalPreviewUrl}`
      if (!force && lastExternalPreviewKeyRef.current === nextKey) {
        return
      }

      lastExternalPreviewKeyRef.current = nextKey
      const result = await window.electronAPI.shell.openInBrowser({
        url: externalPreviewUrl,
        browserId: effectiveBrowserId,
      })

      if (!result.success) {
        lastExternalPreviewKeyRef.current = null
        console.error("[WorkbenchDevServerTile] Failed to open preview in browser", result.error)
      }
    },
    [effectiveBrowserId, externalPreviewUrl]
  )

  const handleNativeSendTouches = useCallback(
    async (request: {
      type: "start" | "move" | "end"
      touches: Array<{ xRatio: number; yRatio: number }>
      rotation?: NativePreviewRotation
    }) => {
      if (!projectPath || !nativePreview.selectedSimulator) return
      await window.electronAPI.nativePreview.sendTouches({
        projectPath,
        deviceId: nativePreview.selectedSimulator.udid,
        platform: "ios",
        ...request,
      })
    },
    [nativePreview.selectedSimulator, projectPath],
  )

  const handleNativeSendWheel = useCallback(
    async (request: {
      point: { xRatio: number; yRatio: number }
      deltaX: number
      deltaY: number
    }) => {
      if (!projectPath || !nativePreview.selectedSimulator) return
      await window.electronAPI.nativePreview.sendWheel({
        projectPath,
        deviceId: nativePreview.selectedSimulator.udid,
        platform: "ios",
        ...request,
      })
    },
    [nativePreview.selectedSimulator, projectPath],
  )

  const handleNativeSendKey = useCallback(
    async (request: { direction: "down" | "up"; keyCode: number }) => {
      if (!projectPath || !nativePreview.selectedSimulator) return
      await window.electronAPI.nativePreview.sendKey({
        projectPath,
        deviceId: nativePreview.selectedSimulator.udid,
        platform: "ios",
        ...request,
      })
    },
    [nativePreview.selectedSimulator, projectPath],
  )

  useEffect(() => {
    if (!externalPreviewUrl) {
      lastExternalPreviewKeyRef.current = null
      return
    }

    if (previewDestination !== "external" || viewMode !== "preview") {
      return
    }

    void openPreviewExternally()
  }, [externalPreviewUrl, openPreviewExternally, previewDestination, viewMode])

  const handlePreviewDestinationChange = useCallback((value: string) => {
    if (value === "cozea") {
      setPreviewDestination("cozea")
      return
    }

    setSelectedBrowserId(value as ExternalBrowserId)
    setPreviewDestination("external")
  }, [])

  const nativePreviewLabel =
    nativePreviewPlatform === "ios"
      ? "Native (iOS)"
      : nativePreviewPlatform === "android"
        ? "Native (Android)"
        : null

  const chromeControls = (
    <div className="flex min-w-0 items-center gap-2">
      <div className="inline-flex h-8 min-w-0 items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "group flex h-full w-9 items-center justify-center border-0 bg-transparent text-muted-foreground/80 transition-colors",
                "hover:text-foreground",
              )}
              aria-label="Choose preview destination"
              title={
                previewDestination === "cozea"
                  ? "Choose preview destination"
                  : `Choose preview destination (currently ${effectiveSelectedBrowser.name})`
              }
            >
              <ChevronDown className="h-4 w-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100" />
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
      {nativePreviewLabel ? (
        <span
          className="inline-flex max-w-[9rem] shrink truncate rounded-md border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          title="Preview uses the device simulator stream instead of the in-app browser."
        >
          {nativePreviewLabel}
        </span>
      ) : null}
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
            disabled={!previewUrl && !isIosNativePreview}
            onClick={() => {
              if (previewDestination === "external") {
                void openPreviewExternally(true)
                return
              }
              if (isIosNativePreview) {
                void nativePreview.refreshSimulators()
                return
              }
              if (!previewUrl) return
              void window.electronAPI.workbenchBrowser.reload({ tileId: tile.id })
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
          disabled={!terminalId}
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

  const codeBody = terminalError ? (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {terminalError}
    </div>
  ) : !terminalId ? (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <RefreshCcw className="h-4 w-4 animate-spin" />
      Preparing terminal…
    </div>
  ) : (
    <div className="h-full min-h-0 pt-1.5 pr-1.5 pb-1.5 pl-2.5">
      <TerminalInstance
        terminalId={terminalId}
        className="h-full workbench-terminal-instance"
        shouldAutoFocus={viewMode === "code" && panelActivity.focused}
        gpuActive={viewMode === "code" && panelActivity.visible}
      />
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
            {!externalPreviewUrl
              ? "No preview yet"
              : `Preview opens in ${effectiveSelectedBrowser.name}`}
          </EmptyTitle>
          <EmptyDescription>
            {!externalPreviewUrl
              ? `Start the dev server to open the local preview in ${effectiveSelectedBrowser.name}.`
              : `Cozea is sending this preview to ${effectiveSelectedBrowser.name}. Use refresh to reopen it, or switch back to Cozea to embed it here.`}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )

  const webEmbeddedPreviewBody = (
    <div className="relative h-full min-h-0 overflow-hidden bg-content-surface p-px">
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
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-content-surface/92 p-6 text-center">
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
            "absolute inset-px overflow-hidden bg-content-surface",
            !boundsReady ? "opacity-70" : "opacity-100",
          )}
        />
      ) : null}
    </div>
  )

  const nativeIosPreviewBody = (
    <div className="relative h-full min-h-0 overflow-hidden bg-content-surface p-px">
      <IosSimulatorViewport
        device={previewDevice}
        route={NATIVE_PREVIEW_ROUTE}
        serverRunning={previewServerActive && Boolean(nativePreview.selectedSimulator)}
        sessionState={nativePreview.sessionState}
        simulators={nativePreview.iosSimulators}
        selectedSimulatorId={nativePreview.selectedIosSimulatorId}
        simulatorsLoading={nativePreview.simulatorsLoading}
        simulatorsError={nativePreview.simulatorsError}
        sessionLoading={nativePreview.sessionLoading}
        sessionError={nativePreview.sessionError}
        taskOverlay={null}
        onSelectSimulator={nativePreview.setSelectedIosSimulatorId}
        onRefreshSimulators={nativePreview.refreshSimulators}
        onOpenExternally={() => void openPreviewExternally(true)}
        onSendTouches={handleNativeSendTouches}
        onSendWheel={handleNativeSendWheel}
        onSendKey={handleNativeSendKey}
      />
    </div>
  )

  const cozeaEmbeddedPreviewBody = isIosNativePreview ? nativeIosPreviewBody : webEmbeddedPreviewBody

  const body = !projectPath ? (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      Open or relink a local project folder to manage a dev server here.
    </div>
  ) : (
    <div className="h-full min-h-0 bg-content-surface">
      <Activity
        mode={viewMode === "preview" && panelActivity.visible ? "visible" : "hidden"}
        name={`workbench-devserver-preview-${tile.id}`}
      >
        <div className={cn("h-full min-h-0", viewMode === "preview" ? "block" : "hidden")}>
          {previewDestination === "cozea" ? cozeaEmbeddedPreviewBody : externalPreviewBody}
        </div>
      </Activity>
      <Activity
        mode={viewMode === "code" && panelActivity.visible ? "visible" : "hidden"}
        name={`workbench-devserver-logs-${tile.id}`}
      >
        <div className={cn("h-full min-h-0", viewMode === "code" ? "block" : "hidden")}>
          {codeBody}
        </div>
      </Activity>
    </div>
  )

  return (
    <WorkbenchTileChrome
      title={tile.title}
      panelApi={panelApi}
      containerApi={containerApi}
      tileType="devServer"
      controls={chromeControls}
      actions={chromeActions}
    >
      <div className="h-full min-h-0 bg-content-surface">{body}</div>
    </WorkbenchTileChrome>
  )
}
