import {
  createContext,
  lazy,
  memo,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react"
import type { IDockviewPanelProps } from "dockview"

import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import type { WorkbenchSelectionLaunchRequest } from "@/features/projects/lib/workbenchSelectionLaunch"
import {
  type WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord,
  type WorkbenchBrowserTile as WorkbenchBrowserTileRecord,
  type WorkbenchDevServerTile as WorkbenchDevServerTileRecord,
  type WorkbenchMobileSimulatorTile as WorkbenchMobileSimulatorTileRecord,
  type WorkbenchSelectionTile as WorkbenchSelectionTileRecord,
  type WorkbenchTile,
  buildWorkbenchScopeKey,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"
import type { WorkbenchSessionSnapshot } from "@shared/electronApiTypes"

export interface WorkbenchDockPanelParams {
  projectId: string
  laneId: string
  tileId: string
}

interface WorkbenchDockRuntimeValue {
  projectId: string
  laneId: string
  projectPath: string | null
  projectName: string | null
  workspaceId: string | null
  framework: string | null
  storedDevCommand: string | null
  storedDevPort: number | null
  workbenchSession: WorkbenchSessionSnapshot | null
  getSelectionPreviewTile: (tileId: string) => WorkbenchSelectionTileRecord | null
  onDuplicateAssistantTile: (sourceTileId: string) => void
  onResolveSelectionTile: (
    selectionTileId: string,
    request: WorkbenchSelectionLaunchRequest,
  ) => void
}

const WorkbenchDockRuntimeContext = createContext<WorkbenchDockRuntimeValue | null>(null)

const panelSuspenseFallback = (
  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading panel…</div>
)

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

function useWorkbenchDockRuntime(): WorkbenchDockRuntimeValue {
  const value = useContext(WorkbenchDockRuntimeContext)
  if (!value) {
    throw new Error("Workbench dock panel rendered outside runtime provider")
  }
  return value
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

function MissingTilePlaceholder() {
  return (
    <WorkbenchPlaceholder
      title="Panel unavailable"
      description="This workbench panel no longer exists in the current session."
    />
  )
}

function useWorkbenchTile(projectId: string, laneId: string, tileId: string): WorkbenchTile | null {
  return useProjectWorkbenchStore(
    (state) => state.workbenches[buildWorkbenchScopeKey(projectId, laneId)]?.tiles[tileId] ?? null,
  )
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
  const storedTile = useWorkbenchTile(props.params.projectId, props.params.laneId, props.params.tileId)
  const tile =
    storedTile?.type === "selection"
      ? storedTile
      : runtime.getSelectionPreviewTile(props.params.tileId)
  const singletonEmptyWorkbench = useProjectWorkbenchStore((state) => {
    const wb = state.workbenches[buildWorkbenchScopeKey(props.params.projectId, props.params.laneId)]
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
      <Suspense fallback={panelSuspenseFallback}>
        <LazyWorkbenchSelectionTile
          tile={selectionTile}
          singletonEmptyWorkbench={singletonEmptyWorkbench}
          projectName={runtime.projectName}
          projectPath={runtime.projectPath}
          onChoose={(request) => {
            runtime.onResolveSelectionTile(selectionTile.id, request)
          }}
        />
      </Suspense>
    </WorkbenchTileChrome>
  )
})

const BrowserPanel = memo(function BrowserPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const tile = useWorkbenchTile(props.params.projectId, props.params.laneId, props.params.tileId)
  const runtime = useWorkbenchDockRuntime()

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
    <Suspense fallback={panelSuspenseFallback}>
      <LazyWorkbenchBrowserTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        tile={tile as WorkbenchBrowserTileRecord}
        projectPath={runtime.projectPath}
        workspaceId={runtime.workspaceId}
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </Suspense>
  )
})

const TerminalPanel = memo(function TerminalPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const tile = useWorkbenchTile(props.params.projectId, props.params.laneId, props.params.tileId)
  const runtime = useWorkbenchDockRuntime()

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
    <Suspense fallback={panelSuspenseFallback}>
      <LazyWorkbenchTerminalTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        tileId={props.params.tileId}
        projectPath={runtime.projectPath}
        panelApi={props.api}
        containerApi={props.containerApi}
      />
    </Suspense>
  )
})

const DevServerPanel = memo(function DevServerPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const tile = useWorkbenchTile(props.params.projectId, props.params.laneId, props.params.tileId)
  const runtime = useWorkbenchDockRuntime()

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
    <Suspense fallback={panelSuspenseFallback}>
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
    </Suspense>
  )
})

const MobileSimulatorPanel = memo(function MobileSimulatorPanel(
  props: IDockviewPanelProps<WorkbenchDockPanelParams>,
) {
  const tile = useWorkbenchTile(props.params.projectId, props.params.laneId, props.params.tileId)
  const runtime = useWorkbenchDockRuntime()

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
    <Suspense fallback={panelSuspenseFallback}>
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
    </Suspense>
  )
})

const AssistantChatPanel = memo(function AssistantChatPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const tile = useWorkbenchTile(props.params.projectId, props.params.laneId, props.params.tileId)
  const runtime = useWorkbenchDockRuntime()

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
    <Suspense fallback={panelSuspenseFallback}>
      <LazyWorkbenchAssistantChatTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        projectPath={runtime.projectPath}
        tile={tile as WorkbenchAssistantChatTileRecord}
        panelApi={props.api}
        containerApi={props.containerApi}
        onDuplicate={runtime.onDuplicateAssistantTile}
      />
    </Suspense>
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

export function WorkbenchDockRuntimeProvider(props: {
  projectId: string
  laneId: string
  projectPath: string | null
  projectName: string | null
  workspaceId: string | null
  framework: string | null
  storedDevCommand: string | null
  storedDevPort: number | null
  workbenchSession: WorkbenchSessionSnapshot | null
  getSelectionPreviewTile: (tileId: string) => WorkbenchSelectionTileRecord | null
  onDuplicateAssistantTile: (sourceTileId: string) => void
  onResolveSelectionTile: (
    selectionTileId: string,
    request: WorkbenchSelectionLaunchRequest,
  ) => void
  children: ReactNode
}) {
  const value = useMemo<WorkbenchDockRuntimeValue>(
    () => ({
      projectId: props.projectId,
      laneId: props.laneId,
      projectPath: props.projectPath,
      projectName: props.projectName,
      workspaceId: props.workspaceId,
      framework: props.framework,
      storedDevCommand: props.storedDevCommand,
      storedDevPort: props.storedDevPort,
      workbenchSession: props.workbenchSession,
      getSelectionPreviewTile: props.getSelectionPreviewTile,
      onDuplicateAssistantTile: props.onDuplicateAssistantTile,
      onResolveSelectionTile: props.onResolveSelectionTile,
    }),
    [
      props.projectId,
      props.laneId,
      props.projectPath,
      props.projectName,
      props.workspaceId,
      props.framework,
      props.storedDevCommand,
      props.storedDevPort,
      props.workbenchSession,
      props.getSelectionPreviewTile,
      props.onDuplicateAssistantTile,
      props.onResolveSelectionTile,
    ],
  )

  return (
    <WorkbenchDockRuntimeContext.Provider value={value}>
      {props.children}
    </WorkbenchDockRuntimeContext.Provider>
  )
}
