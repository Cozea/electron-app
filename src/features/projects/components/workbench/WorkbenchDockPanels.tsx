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
import {
  type WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord,
  type WorkbenchBrowserTile as WorkbenchBrowserTileRecord,
  type WorkbenchDevServerTile as WorkbenchDevServerTileRecord,
  type WorkbenchSelectionTile as WorkbenchSelectionTileRecord,
  type WorkbenchTile,
  buildWorkbenchScopeKey,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"

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
  onOpenBrowserFromDevServer: (sourceTileId: string, url: string) => void
  onOpenBrowserFromBrowser: (sourceTileId: string, url: string) => void
  onDuplicateAssistantTile: (sourceTileId: string) => void
  onResolveSelectionTile: (
    selectionTileId: string,
    type: "assistantChat" | "browser" | "terminal" | "devServer",
  ) => void
}

const WorkbenchDockRuntimeContext = createContext<WorkbenchDockRuntimeValue | null>(null)

const panelSuspenseFallback = (
  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading panel…</div>
)

const LazyWorkbenchBrowserTile = lazy(() =>
  import("@/features/projects/components/workbench/WorkbenchBrowserTile").then((m) => ({
    default: m.WorkbenchBrowserTile,
  })),
)
const LazyWorkbenchAssistantChatTile = lazy(() =>
  import("@/features/projects/components/workbench/WorkbenchAssistantChatTile").then((m) => ({
    default: m.WorkbenchAssistantChatTile,
  })),
)
const LazyWorkbenchDevServerTile = lazy(() =>
  import("@/features/projects/components/workbench/WorkbenchDevServerTile").then((m) => ({
    default: m.WorkbenchDevServerTile,
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

const BrowserPanel = memo(function BrowserPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const tile = useWorkbenchTile(props.params.projectId, props.params.laneId, props.params.tileId)
  const actions = useProjectWorkbenchStore((state) => state.actions)
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

  const browserTile = tile as WorkbenchBrowserTileRecord

  return (
    <Suspense fallback={panelSuspenseFallback}>
      <LazyWorkbenchBrowserTile
        tileId={browserTile.id}
        url={browserTile.url}
        storageScope={browserTile.storageScope ?? "workspace"}
        workspaceId={props.params.projectId}
        linkedDevServerTileId={browserTile.linkedDevServerTileId}
        panelApi={props.api}
        containerApi={props.containerApi}
        onUrlCommitted={(nextUrl) => {
          actions.updateBrowserTile(props.params.projectId, props.params.laneId, browserTile.id, { url: nextUrl })
        }}
        onTitleObserved={(title) => {
          const normalized = title.trim()
          if (!normalized) return
          actions.updateTileTitle(props.params.projectId, props.params.laneId, browserTile.id, normalized)
        }}
        onNewPageRequest={(nextUrl) => {
          runtime.onOpenBrowserFromBrowser(browserTile.id, nextUrl)
        }}
      />
    </Suspense>
  )
})

const SelectionPanel = memo(function SelectionPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const tile = useWorkbenchTile(props.params.projectId, props.params.laneId, props.params.tileId)
  const runtime = useWorkbenchDockRuntime()
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
        title="Add Tile"
        panelApi={props.api}
        containerApi={props.containerApi}
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
      contentClassName="h-full"
    >
      <Suspense fallback={panelSuspenseFallback}>
        <LazyWorkbenchSelectionTile
          tile={selectionTile}
          singletonEmptyWorkbench={singletonEmptyWorkbench}
          projectName={runtime.projectName}
          projectPath={runtime.projectPath}
          onChoose={(type) => {
            runtime.onResolveSelectionTile(selectionTile.id, type)
          }}
        />
      </Suspense>
    </WorkbenchTileChrome>
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
      >
        <MissingTilePlaceholder />
      </WorkbenchTileChrome>
    )
  }

  return (
    <Suspense fallback={panelSuspenseFallback}>
      <LazyWorkbenchTerminalTile
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
  const actions = useProjectWorkbenchStore((state) => state.actions)

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

  const devServerTile = tile as WorkbenchDevServerTileRecord

  return (
    <Suspense fallback={panelSuspenseFallback}>
      <LazyWorkbenchDevServerTile
        tile={devServerTile}
        projectId={runtime.projectId}
        projectPath={runtime.projectPath}
        panelApi={props.api}
        containerApi={props.containerApi}
        onLinkedBrowserReady={(nextUrl) => {
          if (!devServerTile.linkedBrowserTileId) return
          actions.updateBrowserTile(props.params.projectId, props.params.laneId, devServerTile.linkedBrowserTileId, {
            url: nextUrl,
            linkedDevServerTileId: devServerTile.id,
          })
        }}
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
  assistantChat: AssistantChatPanel,
}

export function WorkbenchDockRuntimeProvider(props: {
  projectId: string
  laneId: string
  projectPath: string | null
  projectName: string | null
  onOpenBrowserFromDevServer: (sourceTileId: string, url: string) => void
  onOpenBrowserFromBrowser: (sourceTileId: string, url: string) => void
  onDuplicateAssistantTile: (sourceTileId: string) => void
  onResolveSelectionTile: (
    selectionTileId: string,
    type: "assistantChat" | "browser" | "terminal" | "devServer",
  ) => void
  children: ReactNode
}) {
  const value = useMemo<WorkbenchDockRuntimeValue>(
    () => ({
      projectId: props.projectId,
      laneId: props.laneId,
      projectPath: props.projectPath,
      projectName: props.projectName,
      onOpenBrowserFromDevServer: props.onOpenBrowserFromDevServer,
      onOpenBrowserFromBrowser: props.onOpenBrowserFromBrowser,
      onDuplicateAssistantTile: props.onDuplicateAssistantTile,
      onResolveSelectionTile: props.onResolveSelectionTile,
    }),
    [
      props.projectId,
      props.laneId,
      props.projectPath,
      props.projectName,
      props.onOpenBrowserFromDevServer,
      props.onOpenBrowserFromBrowser,
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
