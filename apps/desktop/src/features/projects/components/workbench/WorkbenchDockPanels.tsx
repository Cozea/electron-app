import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import type {
  IDockviewHeaderActionsProps,
  IDockviewPanelHeaderProps,
  IDockviewPanelProps,
  IWatermarkPanelProps,
} from "dockview-react"
import type { ContextMenuItem } from "@cozea/assistant-contracts"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Toggle } from "@/components/ui/toggle"
import { BrowserNavigationControls } from "@/features/projects/browser/BrowserNavigationControls"
import { BrowserPreviewActionsForTile } from "@/features/projects/browser/BrowserPreviewActions"
import {
  browserAddressDisplayValue,
  resolveBrowserAddressSubmission,
} from "@/features/projects/browser/browserAddressState"
import { useBrowserSurfaceStateStore } from "@/features/projects/browser/browserSurfaceStateStore"
import { runtimePreviewBrowserSurfaceTabId } from "@/features/projects/browser/runtimePreviewBrowserSurface"
import { isExternallyOpenableBrowserUrl } from "@/features/projects/browser/urlInput"
import {
  DEFAULT_DEV_SERVER_RUN,
  buildDevServerRunKey,
  isDevServerRunActive,
  startDevServerRun,
  stopDevServerRun,
  useDevServerRunStore,
} from "@/features/projects/devserver/devServerRunStore"
import {
  buildLocalDevServerUrl,
  dispatchDevServerTileCommand,
  isSameDevServerPreviewUrl,
} from "@/features/projects/devserver/devServerTileCommands"
import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import { ProjectDevAppIcon } from "@/features/devapps/components/ProjectDevAppIcon"
import { PublishedDevAppIcon } from "@/features/devapps/components/PublishedDevAppIcon"
import {
  getDevAppForAssistantProvider,
  getDevAppForSurfaceTileType,
} from "@/features/devapps/registry"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import { useWorkbenchDockHeaderControls } from "@/features/projects/components/workbench/workbenchDockHeaderControls"
import { useChangesSidebarStore } from "@/stores/useChangesSidebarStore"
import {
  type WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord,
  type WorkbenchBrowserTile as WorkbenchBrowserTileRecord,
  type WorkbenchDevServerTile as WorkbenchDevServerTileRecord,
  type WorkbenchLlamaTile as WorkbenchLlamaTileRecord,
  type WorkbenchMobileSimulatorTile as WorkbenchMobileSimulatorTileRecord,
  type WorkbenchOrgDevAppTile as WorkbenchOrgDevAppTileRecord,
  type WorkbenchSelectionTile as WorkbenchSelectionTileRecord,
  type WorkbenchTile,
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"
import {
  type WorkbenchDockPanelParams,
  useWorkbenchDockRuntime,
} from "@/features/projects/components/workbench/WorkbenchDockRuntimeContext"
import { resolveProjectDevAppRuntimeTarget } from "@/features/projects/lib/projectDevAppRuntime"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { useTranslation } from "@/lib/i18n"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  CommandLineIcon as __SquareTerminalHugeIcon,
  ComputerVideoIcon as __ComputerVideoHugeIcon,
  LinkSquare02Icon as __ExternalLinkHugeIcon,
  LockIcon as __LockHugeIcon,
  ArrowExpand01Icon as __MaximizeHugeIcon,
  ArrowShrink01Icon as __RestoreHugeIcon,
  Cancel01Icon as __XHugeIcon,
  Layout04Icon as __Layout04HugeIcon,
  PlayIcon as __PlayHugeIcon,
  Refresh01Icon as __RefreshCcwHugeIcon,
  StopIcon as __SquareHugeIcon,
} from "@hugeicons/core-free-icons"

const changesSuspenseFallback = <div className="h-full bg-content-surface" aria-hidden="true" />

const loadWorkbenchAssistantChatTile = () =>
  import("@/features/projects/components/workbench/WorkbenchAssistantChatTile").then((m) => ({
    default: m.WorkbenchAssistantChatTile,
  }))
const loadWorkbenchBrowserTile = () =>
  import("@/features/projects/components/workbench/WorkbenchBrowserTile").then((m) => ({
    default: m.WorkbenchBrowserTile,
  }))
const loadWorkbenchDevServerTile = () =>
  import("@/features/projects/components/workbench/WorkbenchDevServerTile").then((m) => ({
    default: m.WorkbenchDevServerTile,
  }))
const loadWorkbenchMobileSimulatorTile = () =>
  import("@/features/projects/components/workbench/WorkbenchDevServerTile").then((m) => ({
    default: m.WorkbenchMobileSimulatorTile,
  }))
const loadWorkbenchLlamaTile = () =>
  import("@/features/projects/components/workbench/WorkbenchLlamaTile").then((m) => ({
    default: m.WorkbenchLlamaTile,
  }))
const loadWorkbenchOrgDevAppTile = () =>
  import("@/features/projects/components/workbench/WorkbenchOrgDevAppTile").then((m) => ({
    default: m.WorkbenchOrgDevAppTile,
  }))
const loadWorkbenchSelectionTile = () =>
  import("@/features/projects/components/workbench/WorkbenchSelectionTile").then((m) => ({
    default: m.WorkbenchSelectionTile,
  }))
const loadWorkbenchTerminalTile = () =>
  import("@/features/projects/components/workbench/WorkbenchTerminalTile").then((m) => ({
    default: m.WorkbenchTerminalTile,
  }))

const LazyWorkbenchAssistantChatTile = lazy(loadWorkbenchAssistantChatTile)
const LazyWorkbenchBrowserTile = lazy(loadWorkbenchBrowserTile)
const LazyWorkbenchDevServerTile = lazy(loadWorkbenchDevServerTile)
const LazyWorkbenchLlamaTile = lazy(loadWorkbenchLlamaTile)
const LazyWorkbenchMobileSimulatorTile = lazy(loadWorkbenchMobileSimulatorTile)
const LazyWorkbenchOrgDevAppTile = lazy(loadWorkbenchOrgDevAppTile)
const LazyWorkbenchSelectionTile = lazy(loadWorkbenchSelectionTile)
const LazyWorkbenchTerminalTile = lazy(loadWorkbenchTerminalTile)
const LazyChangesPage = lazy(() =>
  import("@/features/projects/pages/ChangesPage").then((m) => ({
    default: m.ChangesPage,
  })),
)

function WorkbenchPlaceholder(props: { title: string; description: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{props.title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{props.description}</p>
      </div>
    </div>
  )
}

function MissingTilePlaceholder() {
  return (
    <WorkbenchPlaceholder
      title="Panel unavailable"
      description="This workbench panel no longer exists in the current session."
    />
  )
}

function resolveTabTileTypeLabel(tile: WorkbenchTile | null): string {
  switch (tile?.type) {
    case "assistantChat":
      return "Agent"
    case "browser":
      return "Browser"
    case "terminal":
      return "Terminal"
    case "devServer":
      return "Dev Server"
    case "llama":
      return "Llama"
    case "mobileSimulator":
      return "Simulator"
    case "orgDevApp":
      return "DevApp"
    case "selection":
      return "Add"
    default:
      return "Panel"
  }
}

function WorkbenchDockTabIcon({ tile }: { tile: WorkbenchTile | null }) {
  if (tile?.type === "devServer" && tile.devAppId) {
    return (
      <span className="size-4 shrink-0 overflow-hidden rounded-[3px]">
        <ProjectDevAppIcon publicationId={tile.devAppId} name={tile.title} />
      </span>
    )
  }

  if (tile?.type === "orgDevApp") {
    return (
      <span className="size-4 shrink-0 overflow-hidden rounded-[3px]">
        <PublishedDevAppIcon name={tile.title} logoDataUrl={tile.logoDataUrl} />
      </span>
    )
  }

  const devApp =
    tile?.type === "assistantChat"
      ? getDevAppForAssistantProvider(tile.provider ?? null)
      : tile?.type === "browser" ||
          tile?.type === "terminal" ||
          tile?.type === "devServer" ||
          tile?.type === "mobileSimulator"
        ? getDevAppForSurfaceTileType(tile.type)
        : null

  if (!devApp) {
    return (
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/45"
        aria-hidden="true"
      />
    )
  }

  return (
    <span className="size-4 shrink-0 overflow-hidden rounded-[3px]">
      <DevAppIcon app={devApp} />
    </span>
  )
}

function isChromeOwnedSurface(component: string | undefined, tile: WorkbenchTile | null): boolean {
  const surface = tile?.type ?? component
  return surface === "browser" || surface === "devServer" || surface === "mobileSimulator"
}

function useWorkbenchTile(
  projectId: string,
  laneId: string,
  workspaceId: string | null,
  tileId: string,
): WorkbenchTile | null {
  return useProjectWorkbenchStore((state) => {
    const workbench = selectProjectWorkbench(projectId, laneId, workspaceId)(state)
    return workbench?.tiles[tileId] ?? null
  })
}

function useSyncPanelTitle(
  api: IDockviewPanelProps<WorkbenchDockPanelParams>["api"],
  title: string | undefined,
) {
  useEffect(() => {
    if (!title) return
    api.setTitle(title)
  }, [api, title])
}

export const WorkbenchDockTab = memo(function WorkbenchDockTab(
  props: IDockviewPanelHeaderProps<WorkbenchDockPanelParams>,
) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.workspaceId,
    props.params.tileId,
  )
  const title = tile?.title ?? props.api.title ?? resolveTabTileTypeLabel(tile)
  const active = props.api.isActive
  // Collapse to the mini pill only while the dock header carries the tile's
  // identity (URL bar etc.). Chrome-owned surfaces render their header
  // controls directly from the dock header now, so that holds whenever the
  // tile record exists; without a record the header renders nothing and an
  // empty pill would read as a broken header.
  const chromeOwnedSurface = isChromeOwnedSurface(props.api.component, tile) && tile !== null

  if (chromeOwnedSurface) {
    return (
      <div
        className="cozea-workbench-tab cozea-workbench-tab--chrome-owned flex h-full w-full min-w-0 max-w-full items-center justify-center px-1"
        title={title}
      >
        <WorkbenchDockTabIcon tile={tile} />
        <span className="sr-only">{title}</span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "cozea-workbench-tab flex h-full w-full min-w-0 max-w-full items-center gap-1.5 px-2 text-[12px] overflow-hidden",
        active ? "text-foreground" : "text-muted-foreground",
      )}
      title={title}
    >
      <WorkbenchDockTabIcon tile={tile} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {tile?.type === "assistantChat" && tile.model ? (
        <span className="hidden max-w-20 shrink-0 truncate rounded-sm bg-secondary px-1 text-[10px] text-muted-foreground group-hover:inline-flex">
          {tile.model}
        </span>
      ) : tile?.type ? (
        <span className="hidden shrink-0 rounded-sm bg-secondary px-1 text-[10px] text-muted-foreground group-hover:inline-flex">
          {resolveTabTileTypeLabel(tile)}
        </span>
      ) : null}
    </div>
  )
})

const BrowserPanelHeaderControls = memo(function BrowserPanelHeaderControls({
  tileId,
}: {
  tileId: string
}) {
  return <BrowserNavigationControls tileId={tileId} />
})

/**
 * Header controls for dev-server and simulator panels, rendered directly by
 * the dock header (same rationale as BrowserPanelHeaderControls: registered
 * elements carried dead closures). State comes from the keyed
 * devServerRunStore and the tile record, which header and tile both read —
 * there is no per-instance state to go stale.
 */
const DevServerPanelHeaderControls = memo(function DevServerPanelHeaderControls({
  tileId,
  surface,
}: {
  tileId: string
  surface: "devServer" | "mobileSimulator"
}) {
  const runtime = useWorkbenchDockRuntime()
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions)
  const tile = useWorkbenchTile(runtime.projectId, runtime.laneId, runtime.workspaceId, tileId)
  const runtimeTarget =
    tile?.type === "devServer" ? resolveProjectDevAppRuntimeTarget(tile, runtime) : runtime
  const runKey = runtimeTarget.workspaceId
    ? buildDevServerRunKey(runtimeTarget.workspaceId, runtimeTarget.laneId)
    : null
  const run =
    useDevServerRunStore((state) => (runKey ? state.runs[runKey] : undefined)) ??
    DEFAULT_DEV_SERVER_RUN

  const serverUrl = run.url ?? (run.port ? buildLocalDevServerUrl(run.port) : "")
  const overrideUrl = tile?.type === "devServer" ? (tile.previewOverrideUrl ?? null) : null
  const effectiveOverrideUrl = isSameDevServerPreviewUrl(overrideUrl, serverUrl)
    ? null
    : overrideUrl
  const displayUrl = effectiveOverrideUrl ?? serverUrl
  const viewMode =
    tile?.type === "devServer" || tile?.type === "mobileSimulator"
      ? (tile.viewMode ?? "preview")
      : "preview"

  const runtimeTabId =
    tile?.type === "devServer"
      ? runtimePreviewBrowserSurfaceTabId({
          projectId: runtime.projectId,
          laneId: runtime.laneId,
          workspaceId: runtime.workspaceId,
          workbenchSessionKey: runtime.workbenchSessionKey,
          tile,
        })
      : null
  const browserSurfaceState = useBrowserSurfaceStateStore((state) =>
    runtimeTabId ? state.byTabId[runtimeTabId] : undefined,
  )
  const committedUrl =
    browserSurfaceState && browserSurfaceState.navStatus.kind !== "Idle"
      ? browserSurfaceState.navStatus.url
      : displayUrl

  const [draftUrl, setDraftUrl] = useState(committedUrl)
  const [inputFocused, setInputFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (inputFocused) return
    setDraftUrl(committedUrl)
  }, [committedUrl, inputFocused])

  if (!tile || (tile.type !== "devServer" && tile.type !== "mobileSimulator")) {
    return null
  }

  const setOverrideUrl = (nextOverride: string | null) => {
    workbenchActions.updateRuntimePreviewTile(
      runtime.projectId,
      runtime.laneId,
      tileId,
      { previewOverrideUrl: nextOverride },
      runtime.workspaceId,
    )
  }

  const submitDraftUrl = () => {
    const normalized = resolveBrowserAddressSubmission(draftUrl)
    if (!normalized || !runtimeTabId) return
    setOverrideUrl(isSameDevServerPreviewUrl(serverUrl, normalized) ? null : normalized)
    const preview = window.desktopBridge?.preview
    if (preview) void preview.navigate(runtimeTabId, normalized).catch(() => undefined)
  }

  const viewToggle = (
    <div className="inline-flex h-8 min-w-0 shrink-0 items-center">
      <Toggle
        variant="default"
        size="sm"
        pressed={viewMode === "code"}
        onPressedChange={(pressed) => {
          workbenchActions.updateRuntimePreviewTile(
            runtime.projectId,
            runtime.laneId,
            tileId,
            { viewMode: pressed ? "code" : "preview" },
            runtime.workspaceId,
          )
        }}
        aria-label={viewMode === "code" ? "Switch to preview" : "Switch to code"}
        className="h-7 w-7 p-0"
      >
        <HugeiconsIcon
          icon={viewMode === "code" ? __ComputerVideoHugeIcon : __SquareTerminalHugeIcon}
          className="h-4 w-4"
        />
      </Toggle>
    </div>
  )

  if (surface === "mobileSimulator") {
    return (
      <div className="cozea-workbench-header-controls flex h-full min-w-0 items-center px-1">
        <div className="flex min-w-0 items-center gap-2">{viewToggle}</div>
      </div>
    )
  }

  return (
    <div className="cozea-workbench-header-controls flex h-full min-w-0 items-center px-1">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {viewToggle}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 bg-transparent px-1">
          <HugeiconsIcon
            icon={__LockHugeIcon}
            className="size-3.5 shrink-0 text-muted-foreground/70"
          />
          <Input
            ref={inputRef}
            value={browserAddressDisplayValue({
              committedUrl,
              draft: draftUrl,
              focused: inputFocused,
            })}
            placeholder="Search or enter address"
            onChange={(event: ChangeEvent<HTMLInputElement>) => setDraftUrl(event.target.value)}
            onFocus={() => {
              setDraftUrl(committedUrl)
              setInputFocused(true)
              queueMicrotask(() => inputRef.current?.select())
            }}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault()
                submitDraftUrl()
                event.currentTarget.blur()
              } else if (event.key === "Escape") {
                event.preventDefault()
                setDraftUrl(committedUrl)
                event.currentTarget.blur()
              }
            }}
            className={cn(
              "h-7 min-w-0 flex-1 border-0 border-none bg-transparent px-0 text-xs font-normal text-foreground shadow-none placeholder:text-muted-foreground/60 focus:outline-none focus-visible:border-none focus-visible:ring-0 focus-visible:shadow-none dark:border-none dark:bg-transparent",
            )}
          />
          {isExternallyOpenableBrowserUrl(committedUrl) && !inputFocused ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
              onClick={() => void window.electronAPI.shell.openExternal(committedUrl)}
              aria-label="Open preview externally"
              title="Open preview externally"
            >
              <HugeiconsIcon icon={__ExternalLinkHugeIcon} className="h-3 w-3" />
            </Button>
          ) : null}
          {overrideUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
              onClick={() => {
                setOverrideUrl(null)
                setDraftUrl(serverUrl)
              }}
              aria-label="Back to server URL"
              title="Back to server URL"
            >
              <HugeiconsIcon icon={__XHugeIcon} className="h-3 w-3" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
})

/** Start/Stop/Reload for dev-server and simulator panels (direct render). */
const DevServerPanelHeaderActions = memo(function DevServerPanelHeaderActions({
  tileId,
  surface,
}: {
  tileId: string
  surface: "devServer" | "mobileSimulator"
}) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(runtime.projectId, runtime.laneId, runtime.workspaceId, tileId)
  const runtimeTarget =
    tile?.type === "devServer" ? resolveProjectDevAppRuntimeTarget(tile, runtime) : runtime
  const runKey = runtimeTarget.workspaceId
    ? buildDevServerRunKey(runtimeTarget.workspaceId, runtimeTarget.laneId)
    : null
  const run =
    useDevServerRunStore((state) => (runKey ? state.runs[runKey] : undefined)) ??
    DEFAULT_DEV_SERVER_RUN
  const hasLaunchTerminal = useDevServerRunStore((state) =>
    Boolean(runKey && state.contexts[runKey]?.terminalId),
  )
  const runtimeTabId =
    tile?.type === "devServer"
      ? runtimePreviewBrowserSurfaceTabId({
          projectId: runtime.projectId,
          laneId: runtime.laneId,
          workspaceId: runtime.workspaceId,
          workbenchSessionKey: runtime.workbenchSessionKey,
          tile,
        })
      : null

  if (!runtimeTarget.workspaceId || !runKey) {
    return null
  }

  if (isDevServerRunActive(run.status)) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={surface === "devServer" && !runtimeTabId}
          onClick={() => {
            if (surface === "mobileSimulator") {
              dispatchDevServerTileCommand({ tileId, type: "refresh-simulators" })
              return
            }
            const preview = window.desktopBridge?.preview
            if (preview && runtimeTabId) {
              void preview.refresh(runtimeTabId).catch(() => undefined)
            }
          }}
          aria-label={surface === "mobileSimulator" ? "Refresh simulator" : "Reload preview"}
        >
          <HugeiconsIcon icon={__RefreshCcwHugeIcon} className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={() => {
            void stopDevServerRun(runKey)
          }}
          aria-label="Stop dev server"
        >
          <HugeiconsIcon icon={__SquareHugeIcon} className="h-3.5 w-3.5 fill-current" />
        </Button>
      </>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      disabled={!hasLaunchTerminal}
      title={hasLaunchTerminal ? undefined : "Preparing the dev server"}
      onClick={() => {
        void startDevServerRun(runKey)
      }}
      aria-label="Start dev server"
    >
      <HugeiconsIcon icon={__PlayHugeIcon} className="h-3.5 w-3.5 fill-current" />
    </Button>
  )
})

export const WorkbenchDockHeaderControls = memo(function WorkbenchDockHeaderControls(
  props: IDockviewHeaderActionsProps,
) {
  const activePanel = props.activePanel
  const registeredHeader = useWorkbenchDockHeaderControls(activePanel?.id)

  if (activePanel?.api.component === "browser") {
    return <BrowserPanelHeaderControls tileId={activePanel.id} />
  }

  if (
    activePanel?.api.component === "devServer" ||
    activePanel?.api.component === "mobileSimulator"
  ) {
    return (
      <DevServerPanelHeaderControls
        tileId={activePanel.id}
        surface={activePanel.api.component === "devServer" ? "devServer" : "mobileSimulator"}
      />
    )
  }

  if (!activePanel || !registeredHeader?.controls) {
    return null
  }

  return (
    <div className="cozea-workbench-header-controls flex h-full min-w-0 items-center px-1">
      {registeredHeader.controls}
    </div>
  )
})

export const WorkbenchDockHeaderActions = memo(function WorkbenchDockHeaderActions(
  props: IDockviewHeaderActionsProps,
) {
  const { t } = useTranslation()
  const runtime = useWorkbenchDockRuntime()
  const activePanel = props.activePanel
  const [isMaximized, setIsMaximized] = useState(() => activePanel?.api.isMaximized() ?? false)

  useEffect(() => {
    setIsMaximized(activePanel?.api.isMaximized() ?? false)

    const disposable = props.containerApi?.onDidMaximizedGroupChange((event) => {
      setIsMaximized(event.isMaximized)
    })

    const groupChangeDisposable = activePanel?.api.onDidGroupChange?.(() => {
      setIsMaximized(activePanel.api.isMaximized())
    })

    return () => {
      disposable?.dispose()
      groupChangeDisposable?.dispose?.()
    }
  }, [props.containerApi, activePanel])

  const registeredHeader = useWorkbenchDockHeaderControls(activePanel?.id)
  const isSoleSelectionTile = useProjectWorkbenchStore((state) => {
    const wb = selectProjectWorkbench(runtime.projectId, runtime.laneId, runtime.workspaceId)(state)
    if (!wb || wb.order.length !== 1) return false
    const sole = wb.tiles[wb.order[0]]
    return sole?.type === "selection"
  })

  if (!activePanel || (isSoleSelectionTile && !isMaximized)) {
    return null
  }

  if (activePanel.api.component === "changes") {
    return null
  }

  const panelActions =
    activePanel.api.component === "devServer" || activePanel.api.component === "mobileSimulator" ? (
      <DevServerPanelHeaderActions
        tileId={activePanel.id}
        surface={activePanel.api.component === "devServer" ? "devServer" : "mobileSimulator"}
      />
    ) : (
      (registeredHeader?.actions ?? null)
    )
  const browserPreviewActions =
    activePanel.api.component === "browser" ||
    activePanel.api.component === "devServer" ||
    activePanel.api.component === "orgDevApp" ? (
      <BrowserPreviewActionsForTile tileId={activePanel.id} />
    ) : null

  return (
    <div className="cozea-workbench-header-actions flex h-full min-w-0 items-center gap-1 px-1">
      {browserPreviewActions}
      {panelActions ? (
        <div className="cozea-workbench-header-panel-actions flex shrink-0 items-center gap-0.5">
          {panelActions}
        </div>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("workbench.layout.optionsLabel")}
            onClick={async (event) => {
              event.preventDefault()
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              const position = {
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.bottom),
              }
              const items: ContextMenuItem<
                "maximize" | "restore" | "splitRight" | "splitLeft" | "splitDown" | "splitUp"
              >[] = [
                {
                  id: isMaximized ? "restore" : "maximize",
                  label: isMaximized
                    ? t("workbench.layout.restore")
                    : t("workbench.layout.maximize"),
                },
                { type: "separator", id: "sep1" as any },
                {
                  id: "splitRight",
                  label: t("workbench.layout.splitRight"),
                },
                {
                  id: "splitLeft",
                  label: t("workbench.layout.splitLeft"),
                },
                { type: "separator", id: "sep2" as any },
                {
                  id: "splitDown",
                  label: t("workbench.layout.splitDown"),
                },
                {
                  id: "splitUp",
                  label: t("workbench.layout.splitUp"),
                },
              ]
              const action = await showDesktopContextMenu(items, position)
              if (!action) return

              switch (action) {
                case "maximize":
                  activePanel.api.maximize()
                  break
                case "restore":
                  activePanel.api.exitMaximized()
                  break
                case "splitRight":
                  runtime.onSplitTile(activePanel.id, "right")
                  break
                case "splitLeft":
                  runtime.onSplitTile(activePanel.id, "left")
                  break
                case "splitDown":
                  runtime.onSplitTile(activePanel.id, "bottom")
                  break
                case "splitUp":
                  runtime.onSplitTile(activePanel.id, "top")
                  break
              }
            }}
          >
            <HugeiconsIcon icon={__Layout04HugeIcon} className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("workbench.layout.optionsLabel")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={
              isMaximized ? t("workbench.layout.restore") : t("workbench.layout.maximize")
            }
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (activePanel.api.isMaximized()) {
                activePanel.api.exitMaximized()
                setIsMaximized(false)
              } else {
                activePanel.api.maximize()
                setIsMaximized(true)
              }
            }}
          >
            <HugeiconsIcon
              icon={isMaximized ? __RestoreHugeIcon : __MaximizeHugeIcon}
              className="h-3.5 w-3.5"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isMaximized ? t("workbench.layout.restore") : t("workbench.layout.maximize")}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={t("workbench.panel.close")}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              activePanel.api.close()
            }}
          >
            <HugeiconsIcon icon={__XHugeIcon} className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("workbench.panel.close")}</TooltipContent>
      </Tooltip>
    </div>
  )
})

export const WorkbenchDockWatermark = memo(function WorkbenchDockWatermark(
  _props: IWatermarkPanelProps,
) {
  return null
})

const SelectionPanel = memo(function SelectionPanel(
  props: IDockviewPanelProps<WorkbenchDockPanelParams>,
) {
  const { t } = useTranslation()
  const runtime = useWorkbenchDockRuntime()
  const storedTile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.workspaceId,
    props.params.tileId,
  )
  const tile =
    storedTile?.type === "selection"
      ? storedTile
      : runtime.getSelectionPreviewTile(props.params.tileId)
  const isSoleSelectionTile = useProjectWorkbenchStore((state) => {
    const wb = selectProjectWorkbench(
      props.params.projectId,
      props.params.laneId,
      runtime.workspaceId,
    )(state)
    if (!wb || wb.order.length !== 1) return false
    const sole = wb.tiles[wb.order[0]]
    return sole?.type === "selection"
  })
  const [isMaximized, setIsMaximized] = useState(() => props.api.isMaximized?.() ?? false)
  useEffect(() => {
    setIsMaximized(props.api.isMaximized?.() ?? false)
    const disposable = props.containerApi.onDidMaximizedGroupChange((event) => {
      if (event.group.id !== props.api.group?.id) return
      setIsMaximized(event.isMaximized)
    })
    const groupChangeDisposable = props.api.onDidGroupChange?.(() => {
      setIsMaximized(props.api.isMaximized?.() ?? false)
    })
    return () => {
      disposable?.dispose?.()
      groupChangeDisposable?.dispose?.()
    }
  }, [props.api, props.containerApi])
  const singletonEmptyWorkbench = isSoleSelectionTile || isMaximized

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "selection") {
    return (
      <WorkbenchTileChrome
        title={t("workbench.selection.addDevApp")}
        panelApi={props.api}
        containerApi={props.containerApi}
        chromeVariant="pill"
        tileType="selection"
        hideWindowActions={isSoleSelectionTile && !isMaximized}
      >
        <MissingTilePlaceholder />
      </WorkbenchTileChrome>
    )
  }

  const selectionTile = tile as WorkbenchSelectionTileRecord

  return (
    <WorkbenchTileChrome
      title={selectionTile.title}
      panelApi={props.api}
      containerApi={props.containerApi}
      chromeVariant="pill"
      tileType="selection"
      hideWindowActions={isSoleSelectionTile && !isMaximized}
      contentClassName="h-full"
    >
      <Suspense fallback={changesSuspenseFallback}>
        <LazyWorkbenchSelectionTile
          tile={selectionTile}
          singletonEmptyWorkbench={singletonEmptyWorkbench}
          projectId={runtime.projectId}
          projectName={runtime.projectName}
          workspaceId={runtime.workspaceId}
          onChoose={(request) => {
            runtime.onResolveSelectionTile(selectionTile.id, request)
          }}
        />
      </Suspense>
    </WorkbenchTileChrome>
  )
})

const BrowserPanel = memo(function BrowserPanel(
  props: IDockviewPanelProps<WorkbenchDockPanelParams>,
) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.workspaceId,
    props.params.tileId,
  )

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "browser") {
    return (
      <WorkbenchTileChrome title="Browser" panelApi={props.api} containerApi={props.containerApi}>
        <MissingTilePlaceholder />
      </WorkbenchTileChrome>
    )
  }

  return (
    <Suspense fallback={changesSuspenseFallback}>
      <LazyWorkbenchBrowserTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        tile={tile as WorkbenchBrowserTileRecord}
        workspaceId={runtime.workspaceId}
        workbenchSessionKey={runtime.workbenchSessionKey}
        surfaceVisible={runtime.surfaceVisible}
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </Suspense>
  )
})

const OrgDevAppPanel = memo(function OrgDevAppPanel(
  props: IDockviewPanelProps<WorkbenchDockPanelParams>,
) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.workspaceId,
    props.params.tileId,
  )

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "orgDevApp") {
    return (
      <WorkbenchTileChrome
        title="DevApp"
        panelApi={props.api}
        containerApi={props.containerApi}
        chromeVariant="pill"
        tileType="orgDevApp"
      >
        <MissingTilePlaceholder />
      </WorkbenchTileChrome>
    )
  }

  return (
    <Suspense fallback={changesSuspenseFallback}>
      <LazyWorkbenchOrgDevAppTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        tile={tile as WorkbenchOrgDevAppTileRecord}
        workspaceId={runtime.workspaceId}
        workbenchSessionKey={runtime.workbenchSessionKey}
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </Suspense>
  )
})

const TerminalPanel = memo(function TerminalPanel(
  props: IDockviewPanelProps<WorkbenchDockPanelParams>,
) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.workspaceId,
    props.params.tileId,
  )

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "terminal") {
    return (
      <WorkbenchTileChrome
        title="Terminal"
        panelApi={props.api}
        containerApi={props.containerApi}
        chromeVariant="pill"
        tileType="terminal"
      >
        <MissingTilePlaceholder />
      </WorkbenchTileChrome>
    )
  }

  return (
    <Suspense fallback={changesSuspenseFallback}>
      <LazyWorkbenchTerminalTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        tileId={props.params.tileId}
        workspaceId={runtime.workspaceId}
        workbenchSessionKey={runtime.workbenchSessionKey}
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </Suspense>
  )
})

const DevServerPanel = memo(function DevServerPanel(
  props: IDockviewPanelProps<WorkbenchDockPanelParams>,
) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.workspaceId,
    props.params.tileId,
  )

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "devServer") {
    return (
      <WorkbenchTileChrome
        title="Dev Server"
        panelApi={props.api}
        containerApi={props.containerApi}
      >
        <MissingTilePlaceholder />
      </WorkbenchTileChrome>
    )
  }

  return (
    <Suspense fallback={changesSuspenseFallback}>
      <LazyWorkbenchDevServerTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        tile={tile as WorkbenchDevServerTileRecord}
        workspaceId={runtime.workspaceId}
        framework={runtime.framework}
        storedDevCommand={runtime.storedDevCommand}
        storedDevPort={runtime.storedDevPort}
        workbenchSessionKey={runtime.workbenchSessionKey}
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </Suspense>
  )
})

const MobileSimulatorPanel = memo(function MobileSimulatorPanel(
  props: IDockviewPanelProps<WorkbenchDockPanelParams>,
) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.workspaceId,
    props.params.tileId,
  )

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "mobileSimulator") {
    return (
      <WorkbenchTileChrome
        title="iOS Simulator"
        panelApi={props.api}
        containerApi={props.containerApi}
      >
        <MissingTilePlaceholder />
      </WorkbenchTileChrome>
    )
  }

  return (
    <Suspense fallback={changesSuspenseFallback}>
      <LazyWorkbenchMobileSimulatorTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        tile={tile as WorkbenchMobileSimulatorTileRecord}
        workspaceId={runtime.workspaceId}
        framework={runtime.framework}
        storedDevCommand={runtime.storedDevCommand}
        storedDevPort={runtime.storedDevPort}
        workbenchSessionKey={runtime.workbenchSessionKey}
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </Suspense>
  )
})

const LlamaPanel = memo(function LlamaPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.workspaceId,
    props.params.tileId,
  )

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "llama") {
    return (
      <WorkbenchTileChrome title="Llama" panelApi={props.api} containerApi={props.containerApi}>
        <MissingTilePlaceholder />
      </WorkbenchTileChrome>
    )
  }

  return (
    <Suspense fallback={changesSuspenseFallback}>
      <LazyWorkbenchLlamaTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        tile={tile as WorkbenchLlamaTileRecord}
        workspaceId={runtime.workspaceId}
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </Suspense>
  )
})

const AssistantChatPanel = memo(function AssistantChatPanel(
  props: IDockviewPanelProps<WorkbenchDockPanelParams>,
) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.workspaceId,
    props.params.tileId,
  )

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "assistantChat") {
    return (
      <WorkbenchTileChrome
        title="AI Agent"
        panelApi={props.api}
        containerApi={props.containerApi}
        chromeVariant="pill"
        tileType="assistantChat"
      >
        <MissingTilePlaceholder />
      </WorkbenchTileChrome>
    )
  }

  return (
    <Suspense fallback={changesSuspenseFallback}>
      <LazyWorkbenchAssistantChatTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        workspaceId={runtime.workspaceId}
        projectRootPath={runtime.projectRootPath}
        tile={tile as WorkbenchAssistantChatTileRecord}
        panelApi={props.api}
        containerApi={props.containerApi}
        onDuplicate={runtime.onDuplicateAssistantTile}
      />
    </Suspense>
  )
})

const ChangesPanel = memo(function ChangesPanel(
  props: IDockviewPanelProps<WorkbenchDockPanelParams>,
) {
  const runtime = useWorkbenchDockRuntime()
  const changesActions = useChangesSidebarStore((state) => state.actions)
  const [titleContent, setTitleContent] = useState<ReactNode>(null)
  const [controlsNode, setControlsNode] = useState<ReactNode>(null)

  useSyncPanelTitle(props.api, "Changes")

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-content-surface"
      data-workbench-changes-panel="true"
    >
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        {titleContent ? <div className="flex shrink-0 items-center">{titleContent}</div> : null}
        <div className="flex min-w-0 flex-1 items-center">{controlsNode}</div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={changesSuspenseFallback}>
          <LazyChangesPage
            presentation="embedded"
            workspaceId={runtime.workspaceId}
            onRequestClose={changesActions.close}
            setChromeTitleContent={setTitleContent}
            setChromeControlsNode={setControlsNode}
            setDockviewMinimumWidth={changesActions.setMinWidth}
          />
        </Suspense>
      </div>
    </div>
  )
})

export const WORKBENCH_DOCK_COMPONENTS = {
  selection: SelectionPanel,
  browser: BrowserPanel,
  terminal: TerminalPanel,
  devServer: DevServerPanel,
  llama: LlamaPanel,
  mobileSimulator: MobileSimulatorPanel,
  orgDevApp: OrgDevAppPanel,
  assistantChat: AssistantChatPanel,
  changes: ChangesPanel,
}
