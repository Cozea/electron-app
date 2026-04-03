import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react"
import type { IDockviewPanelProps } from "dockview"

import { WorkbenchBrowserTile } from "@/features/projects/components/workbench/WorkbenchBrowserTile"
import { WorkbenchAssistantChatTile } from "@/features/projects/components/workbench/WorkbenchAssistantChatTile"
import { WorkbenchDevServerTile } from "@/features/projects/components/workbench/WorkbenchDevServerTile"
import { WorkbenchSelectionTile } from "@/features/projects/components/workbench/WorkbenchSelectionTile"
import { WorkbenchTerminalTile } from "@/features/projects/components/workbench/WorkbenchTerminalTile"
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
  onOpenBrowserFromDevServer: (sourceTileId: string, url: string) => void
  onDuplicateAssistantTile: (sourceTileId: string) => void
  onResolveSelectionTile: (
    selectionTileId: string,
    type: "assistantChat" | "browser" | "terminal" | "devServer",
  ) => void
}

const WorkbenchDockRuntimeContext = createContext<WorkbenchDockRuntimeValue | null>(null)

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

function BrowserPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const tile = useWorkbenchTile(props.params.projectId, props.params.laneId, props.params.tileId)
  const actions = useProjectWorkbenchStore((state) => state.actions)

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
    <WorkbenchBrowserTile
      tileId={browserTile.id}
      url={browserTile.url}
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
    />
  )
}

function SelectionPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const tile = useWorkbenchTile(props.params.projectId, props.params.laneId, props.params.tileId)
  const runtime = useWorkbenchDockRuntime()

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "selection") {
    return <MissingTilePlaceholder />
  }

  const selectionTile = tile as WorkbenchSelectionTileRecord

  return (
    <WorkbenchSelectionTile
      tile={selectionTile}
      onChoose={(type) => {
        runtime.onResolveSelectionTile(selectionTile.id, type)
      }}
    />
  )
}

function TerminalPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
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
    <WorkbenchTerminalTile
      projectPath={runtime.projectPath}
      panelApi={props.api}
      containerApi={props.containerApi}
    />
  )
}

function DevServerPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
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
    <WorkbenchDevServerTile
      tile={devServerTile}
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
  )
}

function AssistantChatPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
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
      <WorkbenchAssistantChatTile
        projectId={props.params.projectId}
        laneId={props.params.laneId}
        projectPath={runtime.projectPath}
        tile={tile as WorkbenchAssistantChatTileRecord}
        panelApi={props.api}
      containerApi={props.containerApi}
      onDuplicate={runtime.onDuplicateAssistantTile}
    />
  )
}

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
  onOpenBrowserFromDevServer: (sourceTileId: string, url: string) => void
  onDuplicateAssistantTile: (sourceTileId: string) => void
  onResolveSelectionTile: (
    selectionTileId: string,
    type: "assistantChat" | "browser" | "terminal" | "devServer",
  ) => void
  children: ReactNode
}) {
  return (
    <WorkbenchDockRuntimeContext.Provider
      value={{
        projectId: props.projectId,
        laneId: props.laneId,
        projectPath: props.projectPath,
        onOpenBrowserFromDevServer: props.onOpenBrowserFromDevServer,
        onDuplicateAssistantTile: props.onDuplicateAssistantTile,
        onResolveSelectionTile: props.onResolveSelectionTile,
      }}
    >
      {props.children}
    </WorkbenchDockRuntimeContext.Provider>
  )
}
