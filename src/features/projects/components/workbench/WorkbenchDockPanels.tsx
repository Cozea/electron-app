import {
  lazy,
  memo,
  startTransition,
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
import { cn } from "@/lib/utils"

const panelSuspenseFallback = <div className="h-full bg-background" aria-hidden="true" />
const DEFAULT_BACKGROUND_UI_DETACH_MS = 45_000
const DEFAULT_VISIBLE_BACKGROUND_HYDRATE_DELAY_MS = 520
const RUNTIME_VISIBLE_BACKGROUND_HYDRATE_DELAY_MS = 650
const ASSISTANT_VISIBLE_BACKGROUND_HYDRATE_DELAY_MS = 900
const BACKGROUND_UI_HYDRATE_STAGGER_MS = 140
const BACKGROUND_UI_HYDRATE_SEQUENCE_RESET_MS = 1_500
const BACKGROUND_UI_PREFETCH_LEAD_MS = 220
const ASSISTANT_BACKGROUND_UI_DETACH_MS = null
const SELECTION_BACKGROUND_UI_DETACH_MS = 0

type HydratableWorkbenchTileType =
  | "selection"
  | "browser"
  | "terminal"
  | "devServer"
  | "mobileSimulator"
  | "assistantChat"

let backgroundHydrationSequence = 0
let backgroundHydrationResetHandle: number | null = null

function getNextBackgroundHydrationDelay(baseDelayMs: number): number {
  const sequence = backgroundHydrationSequence
  backgroundHydrationSequence = Math.min(backgroundHydrationSequence + 1, 12)
  if (backgroundHydrationResetHandle !== null) {
    window.clearTimeout(backgroundHydrationResetHandle)
  }
  backgroundHydrationResetHandle = window.setTimeout(() => {
    backgroundHydrationSequence = 0
    backgroundHydrationResetHandle = null
  }, BACKGROUND_UI_HYDRATE_SEQUENCE_RESET_MS)
  return baseDelayMs + sequence * BACKGROUND_UI_HYDRATE_STAGGER_MS
}

function scheduleIdleWork(callback: () => void, timeoutMs: number): () => void {
  const win = window as Window & {
    requestIdleCallback?: (
      callback: IdleRequestCallback,
      options?: IdleRequestOptions,
    ) => number
    cancelIdleCallback?: (handle: number) => void
  }
  let cancelled = false
  let idleHandle: number | null = null
  let timeoutHandle: number | null = null

  const run = () => {
    if (!cancelled) {
      callback()
    }
  }

  if (win.requestIdleCallback) {
    idleHandle = win.requestIdleCallback(run, { timeout: timeoutMs })
  } else {
    timeoutHandle = window.setTimeout(run, 0)
  }

  return () => {
    cancelled = true
    if (idleHandle !== null) {
      win.cancelIdleCallback?.(idleHandle)
    }
    if (timeoutHandle !== null) {
      window.clearTimeout(timeoutHandle)
    }
  }
}

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

function preloadWorkbenchTileComponent(tileType: HydratableWorkbenchTileType): void {
  switch (tileType) {
    case "assistantChat":
      void loadWorkbenchAssistantChatTile()
      return
    case "browser":
      void loadWorkbenchBrowserTile()
      return
    case "devServer":
      void loadWorkbenchDevServerTile()
      return
    case "mobileSimulator":
      void loadWorkbenchMobileSimulatorTile()
      return
    case "selection":
      void loadWorkbenchSelectionTile()
      return
    case "terminal":
      void loadWorkbenchTerminalTile()
      return
  }
}

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
      description="Select this tile to reattach the retained UI."
    />
  )
}

function usePanelUiHydration(
  api: IDockviewPanelProps<WorkbenchDockPanelParams>["api"],
  options: {
    detachAfterHiddenMs: number | null
    tileType: HydratableWorkbenchTileType
    visibleHydrateDelayMs: number
  },
) {
  const detachTimerRef = useRef<number | null>(null)
  const hydrateTimerRef = useRef<number | null>(null)
  const prefetchTimerRef = useRef<number | null>(null)
  const cancelIdleHydrationRef = useRef<(() => void) | null>(null)
  const cancelIdlePrefetchRef = useRef<(() => void) | null>(null)
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
    const clearPrefetchTimer = () => {
      if (prefetchTimerRef.current === null) return
      window.clearTimeout(prefetchTimerRef.current)
      prefetchTimerRef.current = null
    }
    const clearIdleWork = () => {
      cancelIdleHydrationRef.current?.()
      cancelIdleHydrationRef.current = null
      cancelIdlePrefetchRef.current?.()
      cancelIdlePrefetchRef.current = null
    }
    const clearScheduledWork = () => {
      clearDetachTimer()
      clearHydrateTimer()
      clearPrefetchTimer()
      clearIdleWork()
    }
    const setHydrated = (hydrated: boolean, urgent: boolean) => {
      if (urgent) {
        setShouldHydrate(hydrated)
        return
      }
      startTransition(() => {
        setShouldHydrate(hydrated)
      })
    }
    const schedulePrefetch = (delayMs: number) => {
      clearPrefetchTimer()
      cancelIdlePrefetchRef.current?.()
      cancelIdlePrefetchRef.current = null

      prefetchTimerRef.current = window.setTimeout(() => {
        prefetchTimerRef.current = null
        cancelIdlePrefetchRef.current = scheduleIdleWork(
          () => {
            cancelIdlePrefetchRef.current = null
            preloadWorkbenchTileComponent(options.tileType)
          },
          1_000,
        )
      }, Math.max(0, delayMs))
    }

    const hydrateNow = () => {
      clearScheduledWork()
      preloadWorkbenchTileComponent(options.tileType)
      setHydrated(true, true)
    }

    const scheduleVisibleHydration = () => {
      clearScheduledWork()
      if (api.isActive || options.visibleHydrateDelayMs <= 0) {
        hydrateNow()
        return
      }

      const hydrationDelayMs = getNextBackgroundHydrationDelay(options.visibleHydrateDelayMs)
      schedulePrefetch(hydrationDelayMs - BACKGROUND_UI_PREFETCH_LEAD_MS)
      hydrateTimerRef.current = window.setTimeout(() => {
        hydrateTimerRef.current = null
        cancelIdleHydrationRef.current = scheduleIdleWork(
          () => {
            cancelIdleHydrationRef.current = null
            setHydrated(true, false)
          },
          1_200,
        )
      }, hydrationDelayMs)
    }

    const scheduleDetach = () => {
      clearScheduledWork()
      if (options.detachAfterHiddenMs === null) {
        return
      }

      if (options.detachAfterHiddenMs <= 0) {
        setHydrated(false, false)
        return
      }

      detachTimerRef.current = window.setTimeout(() => {
        detachTimerRef.current = null
        setHydrated(false, false)
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
      clearScheduledWork()
      visibilityDisposable.dispose()
      activeDisposable.dispose()
    }
  }, [api, options.detachAfterHiddenMs, options.tileType, options.visibleHydrateDelayMs])

  return shouldHydrate
}

function TileUiHydrationBoundary({
  children,
  detachAfterHiddenMs = DEFAULT_BACKGROUND_UI_DETACH_MS,
  panelApi,
  tileType,
  title,
  visibleHydrateDelayMs = DEFAULT_VISIBLE_BACKGROUND_HYDRATE_DELAY_MS,
}: {
  children: ReactNode
  detachAfterHiddenMs?: number | null
  panelApi: IDockviewPanelProps<WorkbenchDockPanelParams>["api"]
  tileType: HydratableWorkbenchTileType
  title: string
  visibleHydrateDelayMs?: number
}) {
  const shouldHydrate = usePanelUiHydration(panelApi, {
    detachAfterHiddenMs,
    tileType,
    visibleHydrateDelayMs,
  })
  const [showDormantPlaceholder, setShowDormantPlaceholder] = useState(!shouldHydrate)
  const [showHydratedUi, setShowHydratedUi] = useState(shouldHydrate)

  useEffect(() => {
    if (!shouldHydrate) {
      setShowDormantPlaceholder(true)
      setShowHydratedUi(false)
      return
    }

    setShowHydratedUi(true)
    const timer = window.setTimeout(() => {
      setShowDormantPlaceholder(false)
    }, 160)

    return () => {
      window.clearTimeout(timer)
    }
  }, [shouldHydrate])

  return (
    <div className="relative h-full min-h-0">
      {showDormantPlaceholder ? (
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-150 ease-out",
            shouldHydrate ? "opacity-0" : "opacity-100",
          )}
        >
          <DormantTilePlaceholder title={title} />
        </div>
      ) : null}
      {showHydratedUi ? (
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-150 ease-out",
            shouldHydrate ? "opacity-100" : "opacity-0",
          )}
        >
          <Suspense fallback={panelSuspenseFallback}>{children}</Suspense>
        </div>
      ) : null}
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
        tileType="selection"
        title={selectionTile.title}
        visibleHydrateDelayMs={0}
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
    <TileUiHydrationBoundary
      panelApi={props.api}
      tileType="browser"
      title={tile.title}
      visibleHydrateDelayMs={RUNTIME_VISIBLE_BACKGROUND_HYDRATE_DELAY_MS}
    >
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
    <TileUiHydrationBoundary
      panelApi={props.api}
      tileType="terminal"
      title={tile.title}
      visibleHydrateDelayMs={RUNTIME_VISIBLE_BACKGROUND_HYDRATE_DELAY_MS}
    >
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
    <TileUiHydrationBoundary
      panelApi={props.api}
      tileType="devServer"
      title={tile.title}
      visibleHydrateDelayMs={RUNTIME_VISIBLE_BACKGROUND_HYDRATE_DELAY_MS}
    >
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
    <TileUiHydrationBoundary
      panelApi={props.api}
      tileType="mobileSimulator"
      title={tile.title}
      visibleHydrateDelayMs={RUNTIME_VISIBLE_BACKGROUND_HYDRATE_DELAY_MS}
    >
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
      tileType="assistantChat"
      title={tile.title}
      visibleHydrateDelayMs={ASSISTANT_VISIBLE_BACKGROUND_HYDRATE_DELAY_MS}
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
