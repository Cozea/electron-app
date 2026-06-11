import { Activity, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview"
import type {
  AvailableExternalBrowser,
  AvailableExternalBrowserResult,
  ExternalBrowserId,
} from "@shared/electronApiTypes"
import type { NativePreviewRotation } from "@shared/nativePreviewTypes"

import { appToast } from "@/lib/appToast"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/lib/i18n"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { IosSimulatorViewport } from "@/features/projects/components/previews/IosSimulatorViewport"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import { useWorkbenchBrowserView } from "@/features/projects/components/workbench/useWorkbenchBrowserView"
import { useWorkbenchPanelActivityMode } from "@/features/projects/components/workbench/useWorkbenchPanelActivityMode"
import {
  DEV_SERVER_TILE_COMMAND_EVENT,
  isSameDevServerPreviewUrl,
  type DevServerTileCommand,
} from "@/features/projects/devserver/devServerTileCommands"
import {
  buildDevServerRunKey,
  useDevServerRunStore,
} from "@/features/projects/devserver/devServerRunStore"
import { useIosNativePreview } from "@/features/projects/hooks/useIosNativePreview"
import { KeepAliveTerminalView } from "@/features/projects/terminals/KeepAliveTerminalView"
import { useWorkbenchSessionTerminal } from "@/features/projects/terminals/useWorkbenchSessionTerminal"
import {
  getEffectiveExternalBrowserId,
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
import {
  type WorkbenchDevServerTile as WorkbenchDevServerTileRecord,
  type WorkbenchMobileSimulatorTile as WorkbenchMobileSimulatorTileRecord,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"
import { useTerminalStore } from "@/stores/useTerminalStore"
import { getFrameworkInfo, type Framework } from "@/utils/projectDetector"

import { HugeiconsIcon } from '@hugeicons/react'
import { ComputerVideoIcon as __ComputerVideoHugeIcon } from '@hugeicons/core-free-icons'

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

// Inert placeholder scope used only while the workbench session key hasn't
// resolved yet (enabled stays false, so the scope never accrues state). A
// real key is required for any native-preview activity — fabricated
// `projectId::laneId::unbound` scopes collided across workspaces.
const NATIVE_PREVIEW_PENDING_SCOPE = "cozea::native-preview::pending"

interface WorkbenchDevServerTileProps {
  projectId: string
  laneId: string
  tile: WorkbenchDevServerTileRecord | WorkbenchMobileSimulatorTileRecord
  workspaceId: string | null
  framework: string | null
  storedDevCommand: string | null
  storedDevPort: number | null
  workbenchSessionKey: string | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
  surfaceType: "web" | "mobileSimulator"
}

function WorkbenchRuntimePreviewTile({
  projectId,
  laneId,
  tile,
  workspaceId,
  framework: storedFramework,
  storedDevCommand,
  storedDevPort,
  workbenchSessionKey,
  panelApi,
  containerApi,
  surfaceType,
}: WorkbenchDevServerTileProps) {
  const { t } = useTranslation()
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions)
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
    if (!workspaceId) {
      setResolvedFramework(null)
      return
    }

    let cancelled = false

    void getFrameworkInfo(workspaceId, (storedFramework as Framework | null) ?? null, storedDevCommand, storedDevPort)
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
  }, [workspaceId, storedDevCommand, storedDevPort, storedFramework])

  const framework = resolvedFramework ?? (storedFramework as Framework | null) ?? undefined
  const nativePreviewPlatform = useNativeMobilePreviewMode(framework)
  const supportsIosNativePreview = nativePreviewPlatform === "ios"
  const isMobileSimulatorSurface = surfaceType === "mobileSimulator"
  const usesNativePreview = isMobileSimulatorSurface && supportsIosNativePreview

  const viewMode = tile.viewMode ?? "preview"
  const [previewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop")
  const [availableBrowsers, setAvailableBrowsers] = useState<AvailableExternalBrowser[]>([
    { id: "system", name: "System Default" },
  ])
  const [defaultBrowserId, setDefaultBrowserId] = useState<ExternalBrowserId>("system")
  const [selectedBrowserId, setSelectedBrowserId] = useState<ExternalBrowserId>(() => readStoredExternalBrowserPreference())
  const [previewDestination, setPreviewDestination] = useState<PreviewDestination>(() => readStoredPreviewDestinationPreference())

  const [terminalRetryKey, setTerminalRetryKey] = useState(0)
  const { terminalId, error: terminalError } = useWorkbenchSessionTerminal({
    workspaceId,
    workbenchSessionKey,
    projectId,
    laneId,
    tileId: tile.id,
    terminalKind: "dev-server",
    title: tile.title,
    visible: panelActivity.visible,
    retryKey: terminalRetryKey,
  })

  const devServer = useDevServerManager({
    workspaceId,
    laneId,
    sessionKey: workbenchSessionKey,
    framework,
    terminalId,
    storedDevCommand,
    storedDevPort,
    previewMode: usesNativePreview ? "native" : "web",
    nativePlatform: usesNativePreview ? nativePreviewPlatform : null,
  })
  const previewUrl = devServer.url ?? (devServer.port ? `http://localhost:${devServer.port}` : "")
  const serverStatusForNative = devManagerStatusToServerStatus(devServer.status)
  const nativePreview = useIosNativePreview({
    scopeKey: workbenchSessionKey ?? NATIVE_PREVIEW_PENDING_SCOPE,
    enabled: usesNativePreview && Boolean(workbenchSessionKey),
    workspaceId,
    serverStatus: serverStatusForNative,
    keepAliveOnUnmount: true,
  })
  const nativeStreamUrl = nativePreview.sessionState?.streamUrl ?? null
  const previewServerActive =
    devServer.status === "ready" || devServer.status === "unhealthy" || devServer.status === "starting"

  const previewOverrideUrl = tile.type === "devServer" ? tile.previewOverrideUrl ?? null : null
  const displayUrl = previewOverrideUrl ?? previewUrl

  const terminalShell = (
    <div
      className="h-full min-h-0 w-full"
      style={{ backgroundColor: "var(--terminal-panel-bg, var(--content-surface))" }}
    />
  )

  const showEmbeddedPreview =
    viewMode === "preview" && (isMobileSimulatorSurface || previewDestination === "cozea")
  const showWebEmbeddedPreview = showEmbeddedPreview && !usesNativePreview
  const [suppressPreviewUrl, setSuppressPreviewUrl] = useState(false)
  const {
    hostRef,
    state: previewState,
    boundsReady,
    overlayPaused,
    placeholderScreenshot,
  } = useWorkbenchBrowserView({
    tileId: tile.id,
    url: showWebEmbeddedPreview && !suppressPreviewUrl ? displayUrl : "",
    sessionKey: workbenchSessionKey,
    projectId,
    laneId,
    visible: showWebEmbeddedPreview && panelActivity.visible,
    storageScope: "ephemeral",
    workspaceId: workspaceId ?? undefined,
    persistModel: true,
    onUrlObserved: (nextUrl) => {
      if (tile.type !== "devServer") return
      // In-preview navigation becomes persisted intent; landing back on the
      // server's own URL clears it so the tile follows the server again.
      const runKey = workspaceId ? buildDevServerRunKey(workspaceId, laneId) : null
      const run = runKey ? useDevServerRunStore.getState().runs[runKey] : undefined
      const serverUrl = run?.url ?? (run?.port ? `http://localhost:${run.port}` : "")
      const nextOverride = isSameDevServerPreviewUrl(serverUrl, nextUrl) ? null : nextUrl
      workbenchActions.updateRuntimePreviewTile(
        projectId,
        laneId,
        tile.id,
        { previewOverrideUrl: nextOverride },
        workspaceId,
      )
    },
    onNewPageRequest: (request) => {
      const nextTileId = workbenchActions.addTile(projectId, laneId, "browser", {
        url: request.url,
        storageScope: "workspace",
      }, workspaceId)
      workbenchActions.setActiveTile(projectId, laneId, nextTileId, workspaceId)
    },
  })
  const lastExternalPreviewKeyRef = useRef<string | null>(null)

  /**
   * When the dev server transitions back into `ready` (e.g. after stop -> start),
   * the embedded browser view often keeps an `ERR_CONNECTION_REFUSED` snapshot
   * or stays blank because the URL hasn't actually changed. Briefly suspend the
   * preview URL so the browser view re-initializes and re-syncs bounds, the
   * same effect as navigating to the terminal tab and back.
   */
  const previousDevServerStatusRef = useRef<DevServerStatus>(devServer.status)
  useEffect(() => {
    const previousStatus = previousDevServerStatusRef.current
    previousDevServerStatusRef.current = devServer.status
    if (devServer.status !== "ready" || previousStatus === "ready") {
      return
    }
    if (!showWebEmbeddedPreview) return
    if (!previewUrl) return
    setSuppressPreviewUrl(true)
    const restoreFrame = window.requestAnimationFrame(() => {
      setSuppressPreviewUrl(false)
    })
    return () => {
      window.cancelAnimationFrame(restoreFrame)
    }
  }, [devServer.status, previewUrl, showWebEmbeddedPreview, tile.id])

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
      workspaceId: workspaceId ?? undefined,
      port: devServer.port ?? undefined,
    })
  }, [devServer.port, workspaceId, storedDevCommand, terminalId, tile.title, updateTerminalDisplay])

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
    if (isMobileSimulatorSurface) {
      return
    }
    if (previewDestination !== "cozea") {
      setPreviewDestination("cozea")
      return
    }
    try {
      window.localStorage.setItem(PREVIEW_DESTINATION_PREFERENCE_KEY, previewDestination)
    } catch {
      // Ignore desktop local storage failures.
    }
  }, [isMobileSimulatorSurface, previewDestination])

  useEffect(() => {
    if (!isMobileSimulatorSurface) {
      return
    }

    const locator =
      usesNativePreview && workspaceId && nativePreview.selectedSimulator
        ? {
            workspaceId,
            deviceId: nativePreview.selectedSimulator.udid,
            platform: "ios" as const,
          }
        : null

    void window.electronAPI.workbenchSession
      .setNativePreviewSession({
        sessionKey: workbenchSessionKey,
        projectId,
        laneId,
        locator,
      })
      .catch((error) => {
        console.warn("[WorkbenchDevServerTile] Failed to sync native preview session", error)
      })
  }, [
    isMobileSimulatorSurface,
    usesNativePreview,
    laneId,
    nativePreview.selectedSimulator,
    projectId,
    workspaceId,
    workbenchSessionKey,
  ])

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

  const externalPreviewUrl = usesNativePreview ? nativeStreamUrl ?? previewUrl : previewUrl

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
        appToast.error({
          title: t("workbench.devserver.openBrowserFailed"),
          description: result.error ?? undefined,
        })
      }
    },
    [effectiveBrowserId, externalPreviewUrl, t]
  )

  // The dock header owns the simulator refresh button but only this tile
  // holds the native-preview hook, so the command arrives as a DOM event.
  const refreshSimulators = nativePreview.refreshSimulators
  useEffect(() => {
    if (!isMobileSimulatorSurface) return

    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<DevServerTileCommand>).detail
      if (command?.tileId !== tile.id) return
      if (command.type === "refresh-simulators") {
        void refreshSimulators()
      }
    }
    window.addEventListener(DEV_SERVER_TILE_COMMAND_EVENT, onCommand)
    return () => {
      window.removeEventListener(DEV_SERVER_TILE_COMMAND_EVENT, onCommand)
    }
  }, [isMobileSimulatorSurface, refreshSimulators, tile.id])

  const handleNativeSendTouches = useCallback(
    async (request: {
      type: "start" | "move" | "end"
      touches: Array<{ xRatio: number; yRatio: number }>

      rotation?: NativePreviewRotation
    }) => {
      if (!workspaceId || !nativePreview.selectedSimulator) return
      await window.electronAPI.nativePreview.sendTouches({
        workspaceId,
        deviceId: nativePreview.selectedSimulator.udid,
        platform: "ios",
        ...request,
      })
    },
    [nativePreview.selectedSimulator, workspaceId],
  )

  const handleNativeSendWheel = useCallback(
    async (request: {
      point: { xRatio: number; yRatio: number }
      deltaX: number
      deltaY: number
    }) => {
      if (!workspaceId || !nativePreview.selectedSimulator) return
      await window.electronAPI.nativePreview.sendWheel({
        workspaceId,
        deviceId: nativePreview.selectedSimulator.udid,
        platform: "ios",
        ...request,
      })
    },
    [nativePreview.selectedSimulator, workspaceId],
  )

  const handleNativeSendKey = useCallback(
    async (request: { direction: "down" | "up"; keyCode: number }) => {
      if (!workspaceId || !nativePreview.selectedSimulator) return
      await window.electronAPI.nativePreview.sendKey({
        workspaceId,
        deviceId: nativePreview.selectedSimulator.udid,
        platform: "ios",
        ...request,
      })
    },
    [nativePreview.selectedSimulator, workspaceId],
  )

  useEffect(() => {
    if (!externalPreviewUrl) {
      lastExternalPreviewKeyRef.current = null
      return
    }

    if (isMobileSimulatorSurface) {
      return
    }

    if (previewDestination !== "external" || viewMode !== "preview") {
      return
    }

    void openPreviewExternally()
  }, [externalPreviewUrl, isMobileSimulatorSurface, openPreviewExternally, previewDestination, viewMode])

  const codeBody = terminalError ? (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">{terminalError}</p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => {
          setTerminalRetryKey((current) => current + 1)
        }}
      >
        Retry
      </Button>
    </div>
  ) : !terminalId || viewMode !== "code" || !panelActivity.visible ? (
    terminalShell
  ) : (
    <KeepAliveTerminalView
      terminalId={terminalId}
      workspaceId={workspaceId}
      focused={panelActivity.focused}
    />
  )

  const externalPreviewBody = (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-sm space-y-1">
        <div className="text-sm text-foreground">
          {!externalPreviewUrl
            ? `Preview will open in ${effectiveSelectedBrowser.name}.`
            : `Preview is open in ${effectiveSelectedBrowser.name}.`}
        </div>
        <div className="text-xs text-muted-foreground">
          {!externalPreviewUrl
            ? "Start the dev server to send the local preview there."
            : "Use refresh to reopen it, or switch back to Cozea to embed it here."}
        </div>
      </div>
    </div>
  )

  const nativeUnsupportedBody = (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-sm space-y-1">
        <div className="text-sm text-foreground">No mobile simulator available</div>
        <div className="text-xs text-muted-foreground">
          This project does not expose an iOS simulator preview yet.
        </div>
      </div>
    </div>
  )

  const webEmbeddedPreviewBody = (
    <div className="relative h-full min-h-0 overflow-hidden bg-content-surface">
      {!previewUrl && !previewOverrideUrl ? (
        <div className="absolute top-[1px] bottom-[1px] left-[1px] right-[1px] flex items-center justify-center bg-content-surface p-6 text-center">
          <Empty className="w-full max-w-md py-8">
            <EmptyHeader>
              <EmptyMedia className="h-auto w-auto rounded-none bg-transparent [&>svg]:h-7 [&>svg]:w-7 [&>svg]:text-muted-foreground">
                <HugeiconsIcon icon={__ComputerVideoHugeIcon} className="h-7 w-7" />
              </EmptyMedia>
              <EmptyTitle className="text-base font-medium">
                {devServer.status === "starting" ? "Local preview will attach here." : "No preview yet"}
              </EmptyTitle>
              <EmptyDescription>
                {devServer.status === "starting"
                  ? "The browser shell is ready. As soon as the dev server exposes a URL, the page will appear here."
                  : "Start the dev server to load the local preview here."}
              </EmptyDescription>
              {devServer.status === "starting" ? (
                <div className="flex justify-center pt-2">
                  <div className="cozea-loader" />
                </div>
              ) : null}
            </EmptyHeader>
          </Empty>
        </div>
      ) : null}
      {displayUrl && previewState.loadError ? (
        <div className="pointer-events-none absolute top-[1px] bottom-[1px] left-[1px] right-[1px] z-[100] flex items-center justify-center bg-content-surface p-6 text-center">
          <div className="max-w-md space-y-2">
            <div className="text-sm font-medium text-foreground">
              This preview could not be loaded.
            </div>
            <div className="text-xs text-muted-foreground">{previewState.loadError}</div>
          </div>
        </div>
      ) : null}
      {displayUrl && placeholderScreenshot && !previewState.loadError ? (
        <div className="absolute top-[1px] bottom-[1px] left-[1px] right-[1px] z-[85] overflow-hidden rounded-[inherit] bg-content-surface pointer-events-none">
          <div
            className="absolute inset-0 bg-no-repeat"
            style={{ backgroundImage: `url("${placeholderScreenshot}")`, backgroundSize: '100% 100%' }}
            aria-hidden
          />
        </div>
      ) : null}
      {displayUrl && overlayPaused && !placeholderScreenshot && !previewState.loadError ? (
        <div className="absolute top-[1px] bottom-[1px] left-[1px] right-[1px] z-[90] overflow-hidden rounded-[inherit] bg-content-surface pointer-events-none">
          <div className="absolute inset-0 bg-background/18 backdrop-blur-[1px]" aria-hidden />
        </div>
      ) : null}
      {displayUrl ? (
        <div
          ref={hostRef}
          className={cn(
            "absolute top-[1px] bottom-[1px] left-[1px] right-[1px] overflow-hidden bg-content-surface",
            (!boundsReady || previewState.loadError) ? "pointer-events-none opacity-0" : "opacity-100",
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

  const cozeaEmbeddedPreviewBody = usesNativePreview ? nativeIosPreviewBody : webEmbeddedPreviewBody

  const body = !workspaceId ? (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {isMobileSimulatorSurface
        ? "Open or relink a local project folder to run a mobile simulator here."
        : "Open or relink a local project folder to manage a dev server here."}
    </div>
  ) : (
    <div className="h-full min-h-0 bg-content-surface">
      <Activity
        mode={viewMode === "preview" && panelActivity.visible ? "visible" : "hidden"}
        name={`workbench-devserver-preview-${tile.id}`}
      >
        <div className={cn("h-full min-h-0", viewMode === "preview" ? "block" : "hidden")}>
          {isMobileSimulatorSurface
            ? (supportsIosNativePreview ? nativeIosPreviewBody : nativeUnsupportedBody)
            : (previewDestination === "cozea" ? cozeaEmbeddedPreviewBody : externalPreviewBody)}
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
    <div className="h-full min-h-0" data-workbench-browser-tile="true">
      <WorkbenchTileChrome
        title={tile.title}
        panelApi={panelApi}
        containerApi={containerApi}
        hideTitlePill
        tileType={isMobileSimulatorSurface ? "mobileSimulator" : "devServer"}
      >
        <div data-workbench-browser-content="true" className="h-full min-h-0 bg-content-surface">{body}</div>
      </WorkbenchTileChrome>
    </div>
  )
}

export function WorkbenchDevServerTile(
  props: Omit<WorkbenchDevServerTileProps, "surfaceType"> & {
    tile: WorkbenchDevServerTileRecord
  },
) {
  return <WorkbenchRuntimePreviewTile {...props} surfaceType="web" />
}

export function WorkbenchMobileSimulatorTile(
  props: Omit<WorkbenchDevServerTileProps, "surfaceType"> & {
    tile: WorkbenchMobileSimulatorTileRecord
  },
) {
  return <WorkbenchRuntimePreviewTile {...props} surfaceType="mobileSimulator" />
}
