import { Activity, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview-react"
import type {
  AvailableExternalBrowser,
  AvailableExternalBrowserResult,
  DevCommandSuggestion,
  ExternalBrowserId,
} from "@shared/electronApiTypes"
import type { BrowserSurfaceDescriptor } from "@shared/browserSurfaceTypes"
import type { NativePreviewRotation } from "@shared/nativePreviewTypes"

import { appToast } from "@/lib/appToast"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/lib/i18n"
import { BrowserSurfaceSlot } from "@/features/projects/browser/BrowserSurfaceSlot"
import { useDockviewBrowserSurfacePresentation } from "@/features/projects/browser/useDockviewBrowserSurfaceLayer"
import { resolveBrowserPageError } from "@/features/projects/browser/browserPageError"
import { resolveBrowserWorkbenchSessionKey } from "@/features/projects/browser/browserSurfaceIdentity"
import { useBrowserSurfaceStateStore } from "@/features/projects/browser/browserSurfaceStateStore"
import { useHostedBrowserSurface } from "@/features/projects/browser/browserSurfaceRegistry"
import {
  runtimePreviewBrowserSurfaceGeneration,
  runtimePreviewBrowserSurfaceKind,
  runtimePreviewBrowserSurfaceTabId,
} from "@/features/projects/browser/runtimePreviewBrowserSurface"
import { IosSimulatorViewport } from "@/features/projects/components/previews/IosSimulatorViewport"
import { WorkbenchTileChrome } from "@/features/workbench/WorkbenchTileChrome"
import { useWorkbenchPanelActivityMode } from "@/features/workbench/useWorkbenchPanelActivityMode"
import {
  buildLocalDevServerUrl,
  DEV_SERVER_TILE_COMMAND_EVENT,
  isSameDevServerPreviewUrl,
  type DevServerTileCommand,
} from "@/features/dev-server/devServerTileCommands"
import {
  buildDevServerRunKey,
  startDevServerRun,
} from "@/features/dev-server/devServerRunStore"
import {
  EMPTY_DEV_SERVER_AUXILIARY_PROCESSES,
  useDevServerProcessConfigStore,
} from "@/features/dev-server/devServerProcessConfigStore"
import { interruptDevServerSurfaceLease } from "@/features/dev-server/devServerSurfaceController"
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
import { type DevServerStatus, useDevServerManager } from "@/features/dev-server/hooks/useDevServerManager"
import { cn } from "@/lib/utils"
import {
  buildWorkbenchRuntimeTargetIdentity,
  resolveProjectDevAppRuntimeTarget,
  type WorkbenchRuntimeTarget,
} from "@/features/projects/lib/projectDevAppRuntime"
import { releaseProjectDevAppRuntimeTarget } from "@/features/projects/lib/projectDevAppRuntimeLifecycle"
import type { PageRoute, ServerStatus } from "@/features/projects/lib/previewRuntimeTypes"
import {
  type WorkbenchDevServerTile as WorkbenchDevServerTileRecord,
  type WorkbenchMobileSimulatorTile as WorkbenchMobileSimulatorTileRecord,
  useProjectWorkbenchStore,
} from "@/features/workbench/model/workbenchStore"
import { useTerminalStore } from "@/stores/useTerminalStore"
import { getFrameworkInfo, type Framework } from "@/utils/projectDetector"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  CommandLineIcon as __CommandLineHugeIcon,
  ComputerVideoIcon as __ComputerVideoHugeIcon,
  PlayIcon as __PlayHugeIcon,
} from "@hugeicons/core-free-icons"

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
function RuntimePreviewStartState({
  status,
  error,
  requiresCommandSelection,
  commandSuggestions,
  onSelectCommand,
  onRetry,
  onShowLogs,
}: {
  status: DevServerStatus
  error: string | null
  requiresCommandSelection: boolean
  commandSuggestions: DevCommandSuggestion[]
  onSelectCommand: (command: string) => void
  onRetry: () => void
  onShowLogs: () => void
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-content-surface p-6 text-center">
      {status === "starting" ? (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <div className="cozea-loader" />
          <span className="font-medium text-foreground whitespace-nowrap">
            Starting Dev Server…
          </span>
        </div>
      ) : status === "error" ? (
        <div className="w-full max-w-xs space-y-3">
          <div className="flex items-center justify-center gap-2 text-sm">
            <HugeiconsIcon icon={__ComputerVideoHugeIcon} className="size-4 shrink-0 text-destructive" />
            <span className="font-medium text-foreground whitespace-nowrap">
              Dev Server failed to start
            </span>
          </div>
          {error ? <p className="text-xs text-destructive text-center">{error}</p> : null}
          <div className="flex items-center justify-center gap-2 pt-1">
            {!requiresCommandSelection ? (
              <Button type="button" size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="outline" onClick={onShowLogs}>
              Server logs
            </Button>
          </div>
        </div>
      ) : requiresCommandSelection && commandSuggestions.length > 0 ? (
        <div className="w-full max-w-xs space-y-3">
          <div className="flex items-center justify-center gap-2 text-sm">
            <HugeiconsIcon icon={__ComputerVideoHugeIcon} className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-medium text-foreground whitespace-nowrap">
              Select start command:
            </span>
          </div>
          <div className="w-full divide-y divide-border/20 text-left">
            {commandSuggestions.slice(0, 5).map((suggestion) => (
              <button
                key={suggestion.command}
                type="button"
                className="group flex w-full items-center justify-between py-2 text-left transition-colors hover:text-foreground"
                onClick={() => onSelectCommand(suggestion.command)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <HugeiconsIcon icon={__CommandLineHugeIcon} className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                  <span className="font-mono text-xs text-foreground truncate">{suggestion.command}</span>
                </div>
                <HugeiconsIcon icon={__PlayHugeIcon} className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <HugeiconsIcon icon={__ComputerVideoHugeIcon} className="size-4 shrink-0" />
          <span className="font-medium text-foreground whitespace-nowrap">
            Dev Server is stopped
          </span>
        </div>
      )}
    </div>
  )
}

function RuntimePreviewPageError({
  title,
  description,
  url,
  onReload,
}: {
  title: string
  description: string
  url: string
  onReload: () => void
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-content-surface p-6 text-center">
      <div className="w-full max-w-xs space-y-2.5">
        <div className="flex items-center justify-center gap-2 text-sm">
          <HugeiconsIcon icon={__ComputerVideoHugeIcon} className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground whitespace-nowrap">{title}</span>
        </div>
        {description ? (
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        ) : null}
        <p className="font-mono text-[11px] text-muted-foreground/70 truncate" title={url}>
          {url}
        </p>
        <div className="pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onReload}>
            Reload preview
          </Button>
        </div>
      </div>
    </div>
  )
}

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

function useRuntimeWorkbenchSessionKey({
  target,
  currentSessionKey,
}: {
  target: WorkbenchRuntimeTarget
  currentSessionKey: string | null
}): string | null {
  const targetIdentity = buildWorkbenchRuntimeTargetIdentity(target)
  const [sourceSession, setSourceSession] = useState<{
    identity: string
    sessionKey: string
  } | null>(null)

  useEffect(() => {
    if (!target.usesProjectDevAppSource || !target.workspaceId) {
      setSourceSession(null)
      return
    }

    let cancelled = false
    setSourceSession((current) => (current?.identity === targetIdentity ? current : null))

    void window.electronAPI.workbenchSession
      .ensureSession({
        projectId: target.projectId,
        laneId: target.laneId,
        workspaceId: target.workspaceId,
      })
      .then((snapshot) => {
        if (cancelled) return
        setSourceSession({ identity: targetIdentity, sessionKey: snapshot.sessionKey })
      })
      .catch((error) => {
        if (cancelled) return
        console.warn("[ProjectDevApp] Failed to prepare source session", error)
        setSourceSession(null)
      })

    return () => {
      cancelled = true
    }
  }, [
    target.laneId,
    target.projectId,
    target.usesProjectDevAppSource,
    target.workspaceId,
    targetIdentity,
  ])

  if (!target.usesProjectDevAppSource) {
    return currentSessionKey
  }

  return sourceSession?.identity === targetIdentity ? sourceSession.sessionKey : null
}

function WorkbenchRuntimePreviewTile({
  projectId,
  laneId,
  tile,
  workspaceId,
  framework: projectFramework,
  storedDevCommand: projectDevCommand,
  storedDevPort: projectDevPort,
  workbenchSessionKey,
  panelApi,
  containerApi,
  surfaceType,
}: WorkbenchDevServerTileProps) {
  const { t } = useTranslation()
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions)
  const updateTerminalDisplay = useTerminalStore((state) => state.actions.updateTerminalDisplay)
  const panelActivity = useWorkbenchPanelActivityMode(panelApi)
  const surfacePresentation = useDockviewBrowserSurfacePresentation(panelApi, containerApi)
  const runtimeTarget = useMemo(
    () =>
      tile.type === "devServer"
        ? resolveProjectDevAppRuntimeTarget(tile, { projectId, laneId, workspaceId })
        : {
            projectId,
            laneId,
            workspaceId,
            usesProjectDevAppSource: false,
          },
    [laneId, projectId, tile, workspaceId],
  )
  const runtimeSessionKey = useRuntimeWorkbenchSessionKey({
    target: runtimeTarget,
    currentSessionKey: workbenchSessionKey,
  })
  const runtimeProjectId = runtimeTarget.projectId
  const runtimeLaneId = runtimeTarget.laneId
  const runtimeWorkspaceId = runtimeTarget.workspaceId
  const runtimeTargetIdentity = buildWorkbenchRuntimeTargetIdentity(runtimeTarget)
  const runtimeRunKey = runtimeWorkspaceId
    ? buildDevServerRunKey(runtimeWorkspaceId, runtimeLaneId)
    : null
  const previousRuntimeTargetRef = useRef(runtimeTarget)

  useEffect(() => {
    const previousTarget = previousRuntimeTargetRef.current
    const previousIdentity = buildWorkbenchRuntimeTargetIdentity(previousTarget)
    previousRuntimeTargetRef.current = runtimeTarget
    if (previousIdentity === runtimeTargetIdentity) return

    void releaseProjectDevAppRuntimeTarget(previousTarget, tile.id).catch((error) => {
      console.warn("[ProjectDevApp] Failed to release the previous source runtime", error)
    })
  }, [runtimeTarget, runtimeTargetIdentity, tile.id])
  const storedFramework =
    tile.type === "devServer" ? (tile.devAppFramework ?? projectFramework) : projectFramework
  const storedDevCommand =
    tile.type === "devServer" ? (tile.devAppCommand ?? projectDevCommand) : projectDevCommand
  const storedDevPort =
    tile.type === "devServer" ? (tile.devAppPort ?? projectDevPort) : projectDevPort
  const autoStart = tile.type === "devServer" ? (tile.autoStart ?? false) : false
  const devAppReleaseId = tile.type === "devServer" ? (tile.devAppReleaseId ?? null) : null
  const storedCommandSource =
    tile.type === "devServer" && tile.devAppId && tile.devAppCommand ? "devAppRelease" : "detected"
  const markAutoStartConsumed = useCallback(() => {
    workbenchActions.updateRuntimePreviewTile(
      projectId,
      laneId,
      tile.id,
      { autoStart: false },
      workspaceId,
    )
  }, [laneId, projectId, tile.id, workbenchActions, workspaceId])
  const [resolvedFramework, setResolvedFramework] = useState<Framework | null>(
    storedFramework && storedFramework !== "unknown" ? (storedFramework as Framework) : null,
  )

  useEffect(() => {
    if (storedFramework && storedFramework !== "unknown") {
      setResolvedFramework(storedFramework as Framework)
      return
    }
    if (!runtimeWorkspaceId) {
      setResolvedFramework(null)
      return
    }

    let cancelled = false

    void getFrameworkInfo(
      runtimeWorkspaceId,
      (storedFramework as Framework | null) ?? null,
      storedDevCommand,
      storedDevPort,
    )
      .then((frameworkInfo) => {
        if (cancelled) return
        setResolvedFramework(frameworkInfo.framework)
      })
      .catch(() => {
        if (cancelled) return
        setResolvedFramework(
          storedFramework && storedFramework !== "unknown" ? (storedFramework as Framework) : null,
        )
      })

    return () => {
      cancelled = true
    }
  }, [runtimeWorkspaceId, storedDevCommand, storedDevPort, storedFramework])

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
  const [selectedBrowserId, setSelectedBrowserId] = useState<ExternalBrowserId>(() =>
    readStoredExternalBrowserPreference(),
  )
  const [previewDestination, setPreviewDestination] = useState<PreviewDestination>(() =>
    readStoredPreviewDestinationPreference(),
  )

  const [terminalRetryKey, setTerminalRetryKey] = useState(0)
  const [selectedProcessId, setSelectedProcessId] = useState("primary")
  const { terminalId, error: terminalError } = useWorkbenchSessionTerminal({
    workspaceId: runtimeWorkspaceId,
    workbenchSessionKey: runtimeSessionKey,
    projectId: runtimeProjectId,
    laneId: runtimeLaneId,
    tileId: tile.id,
    terminalKind: "dev-server",
    title: tile.title,
    visible: panelActivity.visible,
    retryKey: terminalRetryKey,
  })
  const auxiliaryProcesses = useDevServerProcessConfigStore((state) =>
    runtimeWorkspaceId && tile.type === "devServer" && !tile.devAppId
      ? (state.byWorkspace[runtimeWorkspaceId] ?? EMPTY_DEV_SERVER_AUXILIARY_PROCESSES)
      : EMPTY_DEV_SERVER_AUXILIARY_PROCESSES,
  )

  const devServer = useDevServerManager({
    workspaceId: runtimeWorkspaceId,
    laneId: runtimeLaneId,
    sessionKey: runtimeSessionKey,
    framework,
    terminalId,
    autoStart,
    onAutoStartConsumed: markAutoStartConsumed,
    storedDevCommand,
    storedDevPort,
    storedCommandSource,
    previewMode: usesNativePreview ? "native" : "web",
    nativePlatform: usesNativePreview ? nativePreviewPlatform : null,
    auxiliaryProcesses,
  })
  const previousDevAppReleaseIdRef = useRef(devAppReleaseId)
  const previousRuntimeRunKeyRef = useRef(runtimeRunKey)
  useEffect(() => {
    const previousReleaseId = previousDevAppReleaseIdRef.current
    const previousRunKey = previousRuntimeRunKeyRef.current
    previousDevAppReleaseIdRef.current = devAppReleaseId
    previousRuntimeRunKeyRef.current = runtimeRunKey

    // Initial hydration does not restart because the ref is seeded with the
    // mounted release. Replacing a built-in tile or an older DevApp release
    // does restart after the new launch context is registered so command,
    // framework, and port changes take effect immediately.
    const builtInAutoStartWillHandleTransition =
      !previousReleaseId && (devServer.status === "idle" || devServer.status === "stopped")
    if (
      devAppReleaseId &&
      previousReleaseId !== devAppReleaseId &&
      previousRunKey === runtimeRunKey &&
      !builtInAutoStartWillHandleTransition
    ) {
      void devServer.restart()
    }
  }, [devAppReleaseId, devServer.restart, devServer.status, runtimeRunKey])
  const previewUrl = devServer.url ?? (devServer.port ? buildLocalDevServerUrl(devServer.port) : "")
  const serverStatusForNative = devManagerStatusToServerStatus(devServer.status)
  const nativePreview = useIosNativePreview({
    scopeKey: runtimeSessionKey ?? NATIVE_PREVIEW_PENDING_SCOPE,
    enabled: usesNativePreview && Boolean(runtimeSessionKey),
    workspaceId: runtimeWorkspaceId,
    serverStatus: serverStatusForNative,
    keepAliveOnUnmount: true,
  })
  const nativeStreamUrl = nativePreview.sessionState?.streamUrl ?? null
  const previewServerActive =
    devServer.status === "ready" ||
    devServer.status === "unhealthy" ||
    devServer.status === "starting"

  const previewOverrideUrl = tile.type === "devServer" ? (tile.previewOverrideUrl ?? null) : null
  const effectivePreviewOverrideUrl = isSameDevServerPreviewUrl(previewOverrideUrl, previewUrl)
    ? null
    : previewOverrideUrl
  const displayUrl = effectivePreviewOverrideUrl ?? previewUrl
  const activeDisplayUrl = previewServerActive ? displayUrl : ""
  const runtimeTabId =
    tile.type === "devServer"
      ? runtimePreviewBrowserSurfaceTabId({
          projectId,
          laneId,
          workspaceId,
          workbenchSessionKey,
          tile,
        })
      : null
  const browserSurfaceDescriptor = useMemo<BrowserSurfaceDescriptor | null>(() => {
    if (
      surfaceType !== "web" ||
      tile.type !== "devServer" ||
      !runtimeWorkspaceId ||
      !runtimeTabId
    ) {
      return null
    }
    return {
      runtimeTabId,
      tileId: tile.id,
      workbenchSessionKey: resolveBrowserWorkbenchSessionKey({
        projectId,
        laneId,
        workspaceId,
        workbenchSessionKey,
      }),
      kind: runtimePreviewBrowserSurfaceKind(tile),
      title: tile.title || (tile.devAppId ? "Project DevApp" : "Dev Server"),
      initialUrl: activeDisplayUrl || null,
      storageScope: "ephemeral",
      workspaceId,
      laneId,
      runtimeGeneration: runtimePreviewBrowserSurfaceGeneration(tile),
    }
  }, [
    activeDisplayUrl,
    laneId,
    projectId,
    runtimeTabId,
    runtimeWorkspaceId,
    surfaceType,
    tile,
    workbenchSessionKey,
    workspaceId,
  ])

  useEffect(() => {
    for (const process of devServer.processes) {
      updateTerminalDisplay(process.terminalId, {
        title: process.name,
        label: process.kind === "primary" ? (storedDevCommand ?? "Frontend") : process.name,
        kind: "dev-server",
        surface: "panel",
        workspaceId: runtimeWorkspaceId ?? undefined,
        port: process.kind === "primary" ? (devServer.port ?? undefined) : undefined,
      })
    }
  }, [
    devServer.port,
    devServer.processes,
    runtimeWorkspaceId,
    storedDevCommand,
    updateTerminalDisplay,
  ])

  const logProcesses =
    devServer.processes.length > 0
      ? devServer.processes
      : terminalId
        ? [
            {
              id: "primary",
              name: "Frontend",
              terminalId,
              kind: "primary" as const,
              running: devServer.isRunning,
            },
          ]
        : []
  const selectedLogProcess =
    logProcesses.find((process) => process.id === selectedProcessId) ?? logProcesses[0] ?? null

  useEffect(() => {
    if (!selectedLogProcess) return
    if (selectedProcessId !== selectedLogProcess.id) {
      setSelectedProcessId(selectedLogProcess.id)
    }
  }, [selectedLogProcess, selectedProcessId])
  useHostedBrowserSurface(browserSurfaceDescriptor)
  const browserSurfaceState = useBrowserSurfaceStateStore((state) =>
    runtimeTabId ? state.byTabId[runtimeTabId] : undefined,
  )
  const browserPageError = resolveBrowserPageError(browserSurfaceState)
  const previewBridge = window.desktopBridge?.preview
  const lastAutomaticNavigationRef = useRef({
    runtimeTabId,
    url: activeDisplayUrl || null,
  })

  useEffect(() => {
    if (!runtimeTabId || !previewBridge) return
    const previous = lastAutomaticNavigationRef.current
    if (previous.runtimeTabId !== runtimeTabId) {
      lastAutomaticNavigationRef.current = { runtimeTabId, url: activeDisplayUrl || null }
      return
    }
    const nextUrl = activeDisplayUrl || null
    if (previous.url === nextUrl) return
    lastAutomaticNavigationRef.current = { runtimeTabId, url: nextUrl }
    if (nextUrl) {
      void previewBridge.navigate(runtimeTabId, nextUrl).catch(() => undefined)
    }
  }, [activeDisplayUrl, previewBridge, runtimeTabId])

  const terminalShell = (
    <div
      className="h-full min-h-0 w-full"
      style={{ backgroundColor: "var(--terminal-panel-bg, var(--content-surface))" }}
    />
  )

  const lastExternalPreviewKeyRef = useRef<string | null>(null)

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
      workspaceId: runtimeWorkspaceId ?? undefined,
      port: devServer.port ?? undefined,
    })
  }, [
    devServer.port,
    runtimeWorkspaceId,
    storedDevCommand,
    terminalId,
    tile.title,
    updateTerminalDisplay,
  ])

  useEffect(() => {
    let cancelled = false

    const loadAvailableBrowsers = async () => {
      try {
        const result =
          (await window.electronAPI.shell.listAvailableBrowsers()) as AvailableExternalBrowserResult
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
    const resolvedBrowserId = resolvePreferredExternalBrowserId(
      availableBrowsers,
      selectedBrowserId,
    )
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
      usesNativePreview && runtimeWorkspaceId && nativePreview.selectedSimulator
        ? {
            workspaceId: runtimeWorkspaceId,
            deviceId: nativePreview.selectedSimulator.udid,
            platform: "ios" as const,
          }
        : null

    void window.electronAPI.workbenchSession
      .setNativePreviewSession({
        sessionKey: runtimeSessionKey,
        projectId: runtimeProjectId,
        laneId: runtimeLaneId,
        locator,
      })
      .catch((error) => {
        console.warn("[WorkbenchDevServerTile] Failed to sync native preview session", error)
      })
  }, [
    isMobileSimulatorSurface,
    usesNativePreview,
    nativePreview.selectedSimulator,
    runtimeLaneId,
    runtimeProjectId,
    runtimeSessionKey,
    runtimeWorkspaceId,
  ])

  const visibleBrowsers = useMemo(() => {
    return getVisibleExternalBrowsers(availableBrowsers, defaultBrowserId)
  }, [availableBrowsers, defaultBrowserId])

  const effectiveBrowserId = useMemo(() => {
    return getEffectiveExternalBrowserId(selectedBrowserId, defaultBrowserId)
  }, [defaultBrowserId, selectedBrowserId])

  const effectiveSelectedBrowser = useMemo(() => {
    return (
      visibleBrowsers.find((browser) => browser.id === effectiveBrowserId) ??
      availableBrowsers.find((browser) => browser.id === effectiveBrowserId) ??
      availableBrowsers[0] ?? { id: "system" as const, name: "System Default" }
    )
  }, [availableBrowsers, effectiveBrowserId, visibleBrowsers])

  const externalPreviewUrl = usesNativePreview ? (nativeStreamUrl ?? previewUrl) : previewUrl

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
    [effectiveBrowserId, externalPreviewUrl, t],
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
      if (!runtimeWorkspaceId || !nativePreview.selectedSimulator) return
      await window.electronAPI.nativePreview.sendTouches({
        workspaceId: runtimeWorkspaceId,
        deviceId: nativePreview.selectedSimulator.udid,
        platform: "ios",
        ...request,
      })
    },
    [nativePreview.selectedSimulator, runtimeWorkspaceId],
  )

  const handleNativeSendWheel = useCallback(
    async (request: {
      point: { xRatio: number; yRatio: number }
      deltaX: number
      deltaY: number
    }) => {
      if (!runtimeWorkspaceId || !nativePreview.selectedSimulator) return
      await window.electronAPI.nativePreview.sendWheel({
        workspaceId: runtimeWorkspaceId,
        deviceId: nativePreview.selectedSimulator.udid,
        platform: "ios",
        ...request,
      })
    },
    [nativePreview.selectedSimulator, runtimeWorkspaceId],
  )

  const handleNativeSendKey = useCallback(
    async (request: { direction: "down" | "up"; keyCode: number }) => {
      if (!runtimeWorkspaceId || !nativePreview.selectedSimulator) return
      await window.electronAPI.nativePreview.sendKey({
        workspaceId: runtimeWorkspaceId,
        deviceId: nativePreview.selectedSimulator.udid,
        platform: "ios",
        ...request,
      })
    },
    [nativePreview.selectedSimulator, runtimeWorkspaceId],
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
  }, [
    externalPreviewUrl,
    isMobileSimulatorSurface,
    openPreviewExternally,
    previewDestination,
    viewMode,
  ])

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
  ) : !selectedLogProcess || viewMode !== "code" || !panelActivity.visible ? (
    terminalShell
  ) : (
    <div className="flex h-full min-h-0 flex-col">
      {logProcesses.length > 1 ? (
        <div
          className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 bg-content-surface px-2"
          aria-label="Dev Server process logs"
        >
          {logProcesses.map((process) => (
            <button
              key={process.id}
              type="button"
              className={cn(
                "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                process.id === selectedLogProcess.id
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
              onClick={() => setSelectedProcessId(process.id)}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  process.running ? "bg-emerald-500" : "bg-muted-foreground/50",
                )}
                aria-hidden="true"
              />
              {process.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <KeepAliveTerminalView
          terminalId={selectedLogProcess.terminalId}
          workspaceId={runtimeWorkspaceId}
          focused={panelActivity.focused}
        />
      </div>
    </div>
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

  const reloadEmbeddedPreview = () => {
    if (!runtimeTabId || !previewBridge || !activeDisplayUrl) return
    void previewBridge.navigate(runtimeTabId, activeDisplayUrl).catch(() => undefined)
  }
  const showServerLogs = () => {
    workbenchActions.updateRuntimePreviewTile(
      projectId,
      laneId,
      tile.id,
      { viewMode: "code" },
      workspaceId,
    )
  }
  const webSurfaceVisible =
    Boolean(activeDisplayUrl) &&
    panelActivity.visible &&
    viewMode === "preview" &&
    previewDestination === "cozea" &&
    !browserPageError
  const webEmbeddedPreviewBody = (
    <div className="relative h-full min-h-0 overflow-hidden bg-content-surface">
      {runtimeTabId ? (
        <BrowserSurfaceSlot
          tabId={runtimeTabId}
          visible={webSurfaceVisible}
          borderRadius={surfacePresentation.borderRadius}
          stackingLayer={surfacePresentation.stackingLayer}
          subscribePositionChanges={surfacePresentation.subscribePositionChanges}
          className="absolute inset-0 size-full"
        />
      ) : null}
      {!activeDisplayUrl ? (
        <RuntimePreviewStartState
          status={devServer.status}
          error={devServer.error}
          requiresCommandSelection={devServer.requiresCommandSelection}
          commandSuggestions={devServer.commandSuggestions}
          onSelectCommand={(command) => {
            if (runtimeRunKey) void startDevServerRun(runtimeRunKey, { command })
          }}
          onRetry={() => void devServer.start()}
          onShowLogs={showServerLogs}
        />
      ) : null}
      {browserPageError?.kind === "transport" ? (
        <RuntimePreviewPageError
          title="The preview could not be reached"
          description={`${browserPageError.description} (${browserPageError.code}). The Dev Server process is still managed independently.`}
          url={browserPageError.url}
          onReload={reloadEmbeddedPreview}
        />
      ) : null}
      {browserPageError?.kind === "http" ? (
        <RuntimePreviewPageError
          title={`${browserPageError.diagnostic.statusCode} ${browserPageError.diagnostic.statusText || "HTTP error"}`}
          description="The server returned an empty error response. Its process status is unchanged."
          url={browserPageError.diagnostic.url}
          onReload={reloadEmbeddedPreview}
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

  const body = !runtimeWorkspaceId ? (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {runtimeTarget.usesProjectDevAppSource
        ? t("workbench.selection.localDevAppUnavailableDescription")
        : isMobileSimulatorSurface
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
            ? supportsIosNativePreview
              ? nativeIosPreviewBody
              : nativeUnsupportedBody
            : previewDestination === "cozea"
              ? cozeaEmbeddedPreviewBody
              : externalPreviewBody}
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
    <div
      className="h-full min-h-0"
      data-workbench-browser-tile="true"
      onPointerDownCapture={() => {
        if (tile.type === "devServer") interruptDevServerSurfaceLease(tile.id)
      }}
      onKeyDownCapture={() => {
        if (tile.type === "devServer") interruptDevServerSurfaceLease(tile.id)
      }}
    >
      <WorkbenchTileChrome
        title={tile.title}
        panelApi={panelApi}
        containerApi={containerApi}
        hideTitlePill
        tileType={isMobileSimulatorSurface ? "mobileSimulator" : "devServer"}
        devAppId={tile.type === "devServer" ? tile.devAppId : undefined}
      >
        <div data-workbench-browser-content="true" className="h-full min-h-0 bg-content-surface">
          {body}
        </div>
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
