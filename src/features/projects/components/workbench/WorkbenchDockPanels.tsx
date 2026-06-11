import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import type {
  IDockviewHeaderActionsProps,
  IDockviewPanelHeaderProps,
  IDockviewPanelProps,
  IWatermarkPanelProps,
} from "dockview"
import type { ContextMenuItem } from "@cozea/assistant-contracts"

import { Button } from "@/components/ui/button"
import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import {
  getDevAppForAssistantProvider,
  getDevAppForSurfaceTileType,
  listLauncherApps,
} from "@/features/devapps/registry"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import { useWorkbenchDockHeaderControls } from "@/features/projects/components/workbench/workbenchDockHeaderControls"
import { useChangesSidebarStore } from "@/stores/useChangesSidebarStore"
import {
  type WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord,
  type WorkbenchBrowserTile as WorkbenchBrowserTileRecord,
  type WorkbenchDevServerTile as WorkbenchDevServerTileRecord,
  type WorkbenchMobileSimulatorTile as WorkbenchMobileSimulatorTileRecord,
  type WorkbenchSelectionTile as WorkbenchSelectionTileRecord,
  type WorkbenchTile,
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"
import {
  type WorkbenchDockPanelParams,
  useWorkbenchDockRuntime,
} from "@/features/projects/components/workbench/WorkbenchDockRuntimeContext"
import { resolveWorkbenchSelectionLaunchRequest } from "@/features/projects/lib/workbenchSelectionLaunch"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { useTranslation } from "@/lib/i18n"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowExpand01Icon as __MaximizeHugeIcon,
  ArrowShrink01Icon as __RestoreHugeIcon,
  Cancel01Icon as __XHugeIcon,
  Layers01Icon as __LayersHugeIcon,
  Layout04Icon as __Layout04HugeIcon,
} from "@hugeicons/core-free-icons"

const changesSuspenseFallback = <div className="h-full bg-background" aria-hidden="true" />

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
const LazyWorkbenchMobileSimulatorTile = lazy(loadWorkbenchMobileSimulatorTile)
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
    case "mobileSimulator":
      return "Simulator"
    case "selection":
      return "Add"
    default:
      return "Panel"
  }
}

function WorkbenchDockTabIcon({ tile }: { tile: WorkbenchTile | null }) {
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
  const chromeOwnedSurface = isChromeOwnedSurface(props.api.component, tile)

  if (chromeOwnedSurface) {
    return (
      <div
        className="cozea-workbench-tab cozea-workbench-tab--chrome-owned flex h-full min-w-0 items-center px-1"
        title={title}
      >
        <span className="sr-only">{title}</span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "cozea-workbench-tab flex h-full min-w-0 items-center gap-1.5 px-2 text-[12px]",
        active ? "text-foreground" : "text-muted-foreground",
      )}
      title={title}
    >
      <WorkbenchDockTabIcon tile={tile} />
      <span className="min-w-0 truncate">{title}</span>
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

export const WorkbenchDockHeaderControls = memo(function WorkbenchDockHeaderControls(
  props: IDockviewHeaderActionsProps,
) {
  const activePanel = props.activePanel
  const registeredHeader = useWorkbenchDockHeaderControls(activePanel?.id)

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
  const isMaximized = activePanel?.api.isMaximized() ?? false
  const registeredHeader = useWorkbenchDockHeaderControls(activePanel?.id)

  if (!activePanel) {
    return null
  }

  if (activePanel.api.component === "changes") {
    return null
  }

  return (
    <div className="cozea-workbench-header-actions flex h-full min-w-0 items-center gap-1 px-1">
      {registeredHeader?.actions ? (
        <div className="cozea-workbench-header-panel-actions flex shrink-0 items-center gap-0.5">
          {registeredHeader.actions}
        </div>
      ) : null}
      <Tooltip>
      <TooltipTrigger asChild>
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={t('workbench.layout.optionsLabel')}
        onClick={async (event) => {
          event.preventDefault()
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          const position = {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.bottom),
          }
          const items: ContextMenuItem<"maximize" | "restore" | "splitRight" | "splitLeft" | "splitDown" | "splitUp">[] = [
            {
              id: isMaximized ? "restore" : "maximize",
              label: isMaximized ? t('workbench.layout.restore') : t('workbench.layout.maximize'),
            },
            { type: "separator", id: "sep1" as any },
            {
              id: "splitRight",
              label: t('workbench.layout.splitRight'),
            },
            {
              id: "splitLeft",
              label: t('workbench.layout.splitLeft'),
            },
            { type: "separator", id: "sep2" as any },
            {
              id: "splitDown",
              label: t('workbench.layout.splitDown'),
            },
            {
              id: "splitUp",
              label: t('workbench.layout.splitUp'),
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
      <TooltipContent side="bottom">{t('workbench.layout.optionsLabel')}</TooltipContent>
      </Tooltip>
      <Tooltip>
      <TooltipTrigger asChild>
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={isMaximized ? t('workbench.layout.restore') : t('workbench.layout.maximize')}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (activePanel.api.isMaximized()) {
            activePanel.api.exitMaximized()
          } else {
            activePanel.api.maximize()
          }
        }}
      >
        <HugeiconsIcon icon={isMaximized ? __RestoreHugeIcon : __MaximizeHugeIcon} className="h-3.5 w-3.5" />
      </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isMaximized ? t('workbench.layout.restore') : t('workbench.layout.maximize')}
      </TooltipContent>
      </Tooltip>
      <Tooltip>
      <TooltipTrigger asChild>
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label={t('workbench.panel.close')}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          activePanel.api.close()
        }}
      >
        <HugeiconsIcon icon={__XHugeIcon} className="h-3.5 w-3.5" />
      </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t('workbench.panel.close')}</TooltipContent>
      </Tooltip>
    </div>
  )
})

export const WorkbenchDockWatermark = memo(function WorkbenchDockWatermark(
  _props: IWatermarkPanelProps,
) {
  const { t } = useTranslation()
  const runtime = useWorkbenchDockRuntime()
  const actions = useProjectWorkbenchStore((state) => state.actions)
  const launcherApps = listLauncherApps().filter(
    (app) =>
      app.launch.kind === "assistantChat" ||
      app.launch.kind === "browser" ||
      app.launch.kind === "terminal" ||
      app.launch.kind === "devServer" ||
      app.launch.kind === "mobileSimulator",
  )

  return (
    <div className="flex h-full w-full items-center justify-center bg-transparent p-8">
      <div className="flex w-full max-w-2xl flex-col items-center gap-5 text-center">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <HugeiconsIcon icon={__LayersHugeIcon} className="h-4 w-4 text-muted-foreground" />
          {runtime.projectName ? `Open a tile for ${runtime.projectName}` : "Open a workbench tile"}
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
          {launcherApps.map((app) => (
            <Button
              key={app.id}
              type="button"
              variant="outline"
              className="h-20 flex-col gap-2 rounded-md"
              onClick={() => {
                const launch = resolveWorkbenchSelectionLaunchRequest({ appId: app.id })
                if (launch.action === "openSingletonTile") {
                  actions.openSingletonTile(
                    runtime.projectId,
                    runtime.laneId,
                    launch.tileType,
                    launch.options,
                    runtime.workspaceId,
                  )
                  return
                }
                actions.addTile(
                  runtime.projectId,
                  runtime.laneId,
                  launch.tileType,
                  launch.options,
                  runtime.workspaceId,
                )
              }}
            >
              <span className="size-7 overflow-hidden rounded-md">
                <DevAppIcon app={app} />
              </span>
              <span className="max-w-full truncate text-xs">{app.name}</span>
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("workbench.selection.searchPlaceholder")}
        </p>
      </div>
    </div>
  )
})

const SelectionPanel = memo(function SelectionPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
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
  const singletonEmptyWorkbench = useProjectWorkbenchStore((state) => {
    const wb = selectProjectWorkbench(
      props.params.projectId,
      props.params.laneId,
      runtime.workspaceId,
    )(state)
    if (!wb || wb.order.length !== 1) return false
    const sole = wb.tiles[wb.order[0]]
    return sole?.type === "selection"
  })

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "selection") {
    return (
      <WorkbenchTileChrome
        title={t('workbench.selection.addDevApp')}
        panelApi={props.api}
        containerApi={props.containerApi}
        chromeVariant="pill"
        tileType="selection"
        hideWindowActions={singletonEmptyWorkbench}
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
      hideWindowActions={singletonEmptyWorkbench}
      contentClassName="h-full"
    >
      <Suspense fallback={changesSuspenseFallback}>
        <LazyWorkbenchSelectionTile
          tile={selectionTile}
          singletonEmptyWorkbench={singletonEmptyWorkbench}
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

const BrowserPanel = memo(function BrowserPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
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
      <WorkbenchTileChrome
        title="Browser"
        panelApi={props.api}
        containerApi={props.containerApi}
      >
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
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </Suspense>
  )
})

const TerminalPanel = memo(function TerminalPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
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

const DevServerPanel = memo(function DevServerPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
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
        getWorkbenchSession={runtime.getWorkbenchSession}
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
        getWorkbenchSession={runtime.getWorkbenchSession}
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </Suspense>
  )
})

const AssistantChatPanel = memo(function AssistantChatPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
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

const ChangesPanel = memo(function ChangesPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const runtime = useWorkbenchDockRuntime()
  const changesActions = useChangesSidebarStore((state) => state.actions)
  const [titleContent, setTitleContent] = useState<ReactNode>(null)
  const [controlsNode, setControlsNode] = useState<ReactNode>(null)

  useSyncPanelTitle(props.api, "Changes")

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-workbench-changes-panel="true"
    >
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        {titleContent ? <div className="flex shrink-0 items-center">{titleContent}</div> : null}
        <div className="flex min-w-0 flex-1 items-center">
          {controlsNode}
        </div>
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
  mobileSimulator: MobileSimulatorPanel,
  assistantChat: AssistantChatPanel,
  changes: ChangesPanel,
}
