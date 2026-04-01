import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react"
import type { IDockviewPanelProps } from "dockview"

import { WorkbenchBrowserTile } from "@/features/projects/components/workbench/WorkbenchBrowserTile"
import { WorkbenchDevServerTile } from "@/features/projects/components/workbench/WorkbenchDevServerTile"
import { WorkbenchTerminalTile } from "@/features/projects/components/workbench/WorkbenchTerminalTile"
import {
  type WorkbenchBrowserTile as WorkbenchBrowserTileRecord,
  type WorkbenchDevServerTile as WorkbenchDevServerTileRecord,
  type WorkbenchTile,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"

export interface WorkbenchDockPanelParams {
  projectId: string
  tileId: string
}

interface WorkbenchDockRuntimeValue {
  projectId: string
  projectPath: string | null
  onOpenBrowserFromDevServer: (sourceTileId: string, url: string) => void
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

function useWorkbenchTile(projectId: string, tileId: string): WorkbenchTile | null {
  return useProjectWorkbenchStore((state) => state.projects[projectId]?.tiles[tileId] ?? null)
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
  const tile = useWorkbenchTile(props.params.projectId, props.params.tileId)
  const actions = useProjectWorkbenchStore((state) => state.actions)

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "browser") {
    return <MissingTilePlaceholder />
  }

  const browserTile = tile as WorkbenchBrowserTileRecord

  return (
    <WorkbenchBrowserTile
      tileId={browserTile.id}
      url={browserTile.url}
      linkedDevServerTileId={browserTile.linkedDevServerTileId}
      onUrlCommitted={(nextUrl) => {
        actions.updateBrowserTile(props.params.projectId, browserTile.id, { url: nextUrl })
      }}
      onTitleObserved={(title) => {
        const normalized = title.trim()
        if (!normalized) return
        actions.updateTileTitle(props.params.projectId, browserTile.id, normalized)
      }}
    />
  )
}

function TerminalPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const tile = useWorkbenchTile(props.params.projectId, props.params.tileId)
  const runtime = useWorkbenchDockRuntime()

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "terminal") {
    return <MissingTilePlaceholder />
  }

  return <WorkbenchTerminalTile projectPath={runtime.projectPath} />
}

function DevServerPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const tile = useWorkbenchTile(props.params.projectId, props.params.tileId)
  const runtime = useWorkbenchDockRuntime()
  const actions = useProjectWorkbenchStore((state) => state.actions)

  useSyncPanelTitle(props.api, tile?.title)

  if (!tile || tile.type !== "devServer") {
    return <MissingTilePlaceholder />
  }

  const devServerTile = tile as WorkbenchDevServerTileRecord

  return (
    <WorkbenchDevServerTile
      tile={devServerTile}
      projectPath={runtime.projectPath}
      onLinkedBrowserReady={(nextUrl) => {
        if (!devServerTile.linkedBrowserTileId) return
        actions.updateBrowserTile(props.params.projectId, devServerTile.linkedBrowserTileId, {
          url: nextUrl,
          linkedDevServerTileId: devServerTile.id,
        })
      }}
      onOpenBrowser={(nextUrl) => runtime.onOpenBrowserFromDevServer(devServerTile.id, nextUrl)}
    />
  )
}

function AssistantChatPanel(props: IDockviewPanelProps<WorkbenchDockPanelParams>) {
  const tile = useWorkbenchTile(props.params.projectId, props.params.tileId)

  useSyncPanelTitle(props.api, tile?.title)

  return (
    <WorkbenchPlaceholder
      title={tile?.title ?? "AI Chat"}
      description="This slot is reserved for the future T3-style chat tile that can create and orchestrate workbench panels."
    />
  )
}

export const WORKBENCH_DOCK_COMPONENTS = {
  browser: BrowserPanel,
  terminal: TerminalPanel,
  devServer: DevServerPanel,
  assistantChat: AssistantChatPanel,
}

export function WorkbenchDockRuntimeProvider(props: {
  projectId: string
  projectPath: string | null
  onOpenBrowserFromDevServer: (sourceTileId: string, url: string) => void
  children: ReactNode
}) {
  return (
    <WorkbenchDockRuntimeContext.Provider
      value={{
        projectId: props.projectId,
        projectPath: props.projectPath,
        onOpenBrowserFromDevServer: props.onOpenBrowserFromDevServer,
      }}
    >
      {props.children}
    </WorkbenchDockRuntimeContext.Provider>
  )
}
