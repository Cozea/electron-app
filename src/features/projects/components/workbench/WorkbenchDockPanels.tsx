import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { IDockviewPanelProps } from "dockview"

import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
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

const panelSuspenseFallback = (
  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading panel…</div>
)
const DEFAULT_BACKGROUND_UI_DETACH_MS = 45_000
const DEFAULT_VISIBLE_BACKGROUND_HYDRATE_DELAY_MS = 250
const ASSISTANT_BACKGROUND_UI_DETACH_MS = null
const SELECTION_BACKGROUND_UI_DETACH_MS = 0

const LazyWorkbenchAssistantChatTile = lazy(() =>
  import("@/features/projects/components/workbench/WorkbenchAssistantChatTile").then((m) => ({
    default: m.WorkbenchAssistantChatTile,
  })),
)
const LazyWorkbenchBrowserTile = lazy(() =>
  import("@/features/projects/components/workbench/WorkbenchBrowserTile").then((m) => ({
    default: m.WorkbenchBrowserTile,
  })),
)
const LazyWorkbenchDevServerTile = lazy(() =>
  import("@/features/projects/components/workbench/WorkbenchDevServerTile").then((m) => ({
    default: m.WorkbenchDevServerTile,
  })),
)
const LazyWorkbenchMobileSimulatorTile = lazy(() =>
  import("@/features/projects/components/workbench/WorkbenchDevServerTile").then((m) => ({
    default: m.WorkbenchMobileSimulatorTile,
  })),
)
const LazyWorkbenchSelectionTile = lazy(() =>
  import("@/features/projects/components/workbench/WorkbenchSelectionTile").then((m) => ({
    default: m.WorkbenchSelectionTile,
  })),
)
const LazyWorkbenchTerminalTile = lazy(() =>
  import("@/features/projects/components/workbench/WorkbenchTerminalTile").then((m) => ({
    default: m.WorkbenchTerminalTile,
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

function DormantTilePlaceholder(props: { title: string }) {
  return (
    <WorkbenchPlaceholder
      title={props.title}
      description="Runtime state is retained. Select this tile to attach the UI."
    />
  )
}

function usePanelUiHydration(
  api: IDockviewPanelProps<WorkbenchDockPanelParams>["api"],
  options: {
    detachAfterHiddenMs: number | null
    visibleHydrateDelayMs: number
  },
) {
  const detachTimerRef = useRef<number | null>(null)
  const hydrateTimerRef = useRef<number | null>(null)
  const [shouldHydrate, setShouldHydrate] = useState(() => {
    if (api.isActive) return true
    if (!api.isVisible) return false
    return options.visibleHydrateDelayMs <= 0
  })

  useEffect(() => {
    const clearDetachTimer = () => {
      if (detachTimerRef.current === null) return
      window.clearTimeout(detachTimerRef.current)
      detachTimerRef.current = null
    }
    const clearHydrateTimer = () => {
      if (hydrateTimerRef.current === null) return
      window.clearTimeout(hydrateTimerRef.current)
      hydrateTimerRef.current = null
    }

    const hydrateNow = () => {
      clearDetachTimer()
      clearHydrateTimer()
      setShouldHydrate(true)
    }

    const scheduleVisibleHydration = () => {
      clearDetachTimer()
      clearHydrateTimer()
      if (api.isActive || options.visibleHydrateDelayMs <= 0) {
        hydrateNow()
        return
      }

      hydrateTimerRef.current = window.setTimeout(() => {
        hydrateTimerRef.current = null
        setShouldHydrate(true)
      }, options.visibleHydrateDelayMs)
    }

    const scheduleDetach = () => {
      clearDetachTimer()
      clearHydrateTimer()
      if (options.detachAfterHiddenMs === null) {
        return
      }

      if (options.detachAfterHiddenMs <= 0) {
        setShouldHydrate(false)
        return
      }

      detachTimerRef.current = window.setTimeout(() => {
        detachTimerRef.current = null
        setShouldHydrate(false)
      }, options.detachAfterHiddenMs)
    }

    if (api.isActive) {
      hydrateNow()
    } else if (api.isVisible) {
      scheduleVisibleHydration()
    } else {
      scheduleDetach()
    }

    const visibilityDisposable = api.onDidVisibilityChange((event) => {
      if (event.isVisible) {
        scheduleVisibleHydration()
        return
      }

      scheduleDetach()
    })
    const activeDisposable = api.onDidActiveChange((event) => {
      if (!event.isActive) {
        return
      }

      hydrateNow()
    })

    return () => {
      clearDetachTimer()
      clearHydrateTimer()
      visibilityDisposable.dispose()
      activeDisposable.dispose()
    }
  }, [api, options.detachAfterHiddenMs, options.visibleHydrateDelayMs])

  return shouldHydrate
}

function TileUiHydrationBoundary({
  children,
  detachAfterHiddenMs = DEFAULT_BACKGROUND_UI_DETACH_MS,
  panelApi,
  title,
  visibleHydrateDelayMs = DEFAULT_VISIBLE_BACKGROUND_HYDRATE_DELAY_MS,
}: {
  children: ReactNode
  detachAfterHiddenMs?: number | null
  panelApi: IDockviewPanelProps<WorkbenchDockPanelParams>["api"]
  title: string
  visibleHydrateDelayMs?: number
}) {
  const shouldHydrate = usePanelUiHydration(panelApi, {
    detachAfterHiddenMs,
    visibleHydrateDelayMs,
  })

  if (!shouldHydrate) {
    return <DormantTilePlaceholder title={title} />
  }

  return <Suspense fallback={panelSuspenseFallback}>{children}</Suspense>
}

function MissingTilePlaceholder() {
  return (
    <WorkbenchPlaceholder
      title="Panel unavailable"
      description="This workbench panel no longer exists in the current session."
    />
  )
}

function useWorkbenchTile(
  projectId: string,
  laneId: string,
  projectPath: string | null,
  tileId: string,
): WorkbenchTile | null {
  return useProjectWorkbenchStore((state) => {
    const workbench = selectProjectWorkbench(projectId, laneId, projectPath)(state)
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

const SelectionPanel = memo(function SelectionPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const runtime = useWorkbenchDockRuntime()
  const storedTile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.projectPath,
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
      runtime.projectPath,
    )(state)
    if (!wb || wb.order.length !== 1) return false
    const sole = wb.tiles[wb.order[0]]
    return sole?.type === "selection"
  })

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "selection") {
    return (
      <WorkbenchTileChrome
        title="Add DevApp"
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
      <TileUiHydrationBoundary
        detachAfterHiddenMs={SELECTION_BACKGROUND_UI_DETACH_MS}
        panelApi={props.api}
        title={selectionTile.title}
      >
        <LazyWorkbenchSelectionTile
          tile={selectionTile}
          singletonEmptyWorkbench={singletonEmptyWorkbench}
          projectName={runtime.projectName}
          projectPath={runtime.projectPath}
          onChoose={(request) => {
            runtime.onResolveSelectionTile(selectionTile.id, request)
          }}
        />
      </TileUiHydrationBoundary>
    </WorkbenchTileChrome>
  )
})

const BrowserPanel = memo(function BrowserPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.projectPath,
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
    <TileUiHydrationBoundary panelApi={props.api} title={tile.title}>
      <LazyWorkbenchBrowserTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        tile={tile as WorkbenchBrowserTileRecord}
        projectPath={runtime.projectPath}
        workspaceId={runtime.workspaceId}
        workbenchSession={runtime.workbenchSession}
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </TileUiHydrationBoundary>
  )
})

const TerminalPanel = memo(function TerminalPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.projectPath,
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
    <TileUiHydrationBoundary panelApi={props.api} title={tile.title}>
      <LazyWorkbenchTerminalTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        tileId={props.params.tileId}
        projectPath={runtime.projectPath}
        workbenchSession={runtime.workbenchSession}
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </TileUiHydrationBoundary>
  )
})

const DevServerPanel = memo(function DevServerPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.projectPath,
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
    <TileUiHydrationBoundary panelApi={props.api} title={tile.title}>
      <LazyWorkbenchDevServerTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        tile={tile as WorkbenchDevServerTileRecord}
        projectPath={runtime.projectPath}
        workspaceId={runtime.workspaceId}
        framework={runtime.framework}
        storedDevCommand={runtime.storedDevCommand}
        storedDevPort={runtime.storedDevPort}
        workbenchSession={runtime.workbenchSession}
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </TileUiHydrationBoundary>
  )
})

const MobileSimulatorPanel = memo(function MobileSimulatorPanel(
  props: IDockviewPanelProps<WorkbenchDockPanelParams>,
) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.projectPath,
    props.params.tileId,
  )

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "mobileSimulator") {
    return (
      <WorkbenchTileChrome
        title="Mobile Simulator"
        panelApi={props.api}
        containerApi={props.containerApi}
      >
        <MissingTilePlaceholder />
      </WorkbenchTileChrome>
    )
  }

  return (
    <TileUiHydrationBoundary panelApi={props.api} title={tile.title}>
      <LazyWorkbenchMobileSimulatorTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        tile={tile as WorkbenchMobileSimulatorTileRecord}
        projectPath={runtime.projectPath}
        workspaceId={runtime.workspaceId}
        framework={runtime.framework}
        storedDevCommand={runtime.storedDevCommand}
        storedDevPort={runtime.storedDevPort}
        workbenchSession={runtime.workbenchSession}
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </TileUiHydrationBoundary>
  )
})

const AssistantChatPanel = memo(function AssistantChatPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const runtime = useWorkbenchDockRuntime()
  const tile = useWorkbenchTile(
    props.params.projectId,
    props.params.laneId,
    runtime.projectPath,
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
    <TileUiHydrationBoundary
      detachAfterHiddenMs={ASSISTANT_BACKGROUND_UI_DETACH_MS}
      panelApi={props.api}
      title={tile.title}
    >
      <LazyWorkbenchAssistantChatTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        projectPath={runtime.projectPath}
        tile={tile as WorkbenchAssistantChatTileRecord}
        panelApi={props.api}
        containerApi={props.containerApi}
        onDuplicate={runtime.onDuplicateAssistantTile}
      />
    </TileUiHydrationBoundary>
  )
})

export const WORKBENCH_DOCK_COMPONENTS = {
  selection: SelectionPanel,
  browser: BrowserPanel,
  terminal: TerminalPanel,
  devServer: DevServerPanel,
  mobileSimulator: MobileSimulatorPanel,
  assistantChat: AssistantChatPanel,
}
