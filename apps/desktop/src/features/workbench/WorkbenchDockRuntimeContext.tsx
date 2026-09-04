import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react"

import type {
  WorkbenchSelectionTile as WorkbenchSelectionTileRecord,
} from "@/lib/workbenchStore"
import type { WorkbenchSelectionLaunchRequest } from "@/features/workbench/model/workbenchSelectionLaunch"
import type { WorkbenchSessionSnapshot } from "@shared/electronApiTypes"

export interface WorkbenchDockPanelParams {
  projectId: string
  laneId: string
  tileId: string
}

export interface WorkbenchDockRuntimeValue {
  projectId: string
  laneId: string
  projectRootPath: string | null
  gitRootPath: string | null
  projectName: string | null
  workspaceId: string | null
  framework: string | null
  storedDevCommand: string | null
  storedDevPort: number | null
  /**
   * Session identity + on-demand snapshot access. The context deliberately
   * does NOT carry the snapshot object: its content (terminal bindings, dev
   * server state, lifecycle) churns without the session changing, and a
   * snapshot here would re-render every dock tile per churn. Render on the
   * key; read content through the getter when an effect/handler needs it.
   */
  workbenchSessionKey: string | null
  /**
   * False while this workbench is kept alive but CSS-hidden behind another
   * project. Dockview panel visibility cannot see that hiding, so tiles that
   * drive native Electron surfaces (browser views, embedded previews) must
   * AND this into their visibility.
   */
  surfaceVisible: boolean
  getWorkbenchSession: () => WorkbenchSessionSnapshot | null
  getSelectionPreviewTile: (tileId: string) => WorkbenchSelectionTileRecord | null
  onDuplicateAssistantTile: (sourceTileId: string) => void
  onResolveSelectionTile: (
    selectionTileId: string,
    request: WorkbenchSelectionLaunchRequest,
  ) => void
  onSplitTile: (sourceTileId: string, direction: "right" | "bottom" | "left" | "top") => void
}

const WorkbenchDockRuntimeContext = createContext<WorkbenchDockRuntimeValue | null>(null)

export function useWorkbenchDockRuntime(): WorkbenchDockRuntimeValue {
  const value = useContext(WorkbenchDockRuntimeContext)
  if (!value) {
    throw new Error("Workbench dock panel rendered outside runtime provider")
  }
  return value
}

export function useOptionalWorkbenchDockRuntime(): WorkbenchDockRuntimeValue | null {
  return useContext(WorkbenchDockRuntimeContext)
}

export function WorkbenchDockRuntimeProvider(props: WorkbenchDockRuntimeValue & {
  children: ReactNode
}) {
  const value = useMemo<WorkbenchDockRuntimeValue>(
    () => ({
      projectId: props.projectId,
      laneId: props.laneId,
      projectRootPath: props.projectRootPath,
      gitRootPath: props.gitRootPath,
      projectName: props.projectName,
      workspaceId: props.workspaceId,
      framework: props.framework,
      storedDevCommand: props.storedDevCommand,
      storedDevPort: props.storedDevPort,
      workbenchSessionKey: props.workbenchSessionKey,
      surfaceVisible: props.surfaceVisible,
      getWorkbenchSession: props.getWorkbenchSession,
      getSelectionPreviewTile: props.getSelectionPreviewTile,
      onDuplicateAssistantTile: props.onDuplicateAssistantTile,
      onResolveSelectionTile: props.onResolveSelectionTile,
      onSplitTile: props.onSplitTile,
    }),
    [
      props.projectId,
      props.laneId,
      props.projectRootPath,
      props.gitRootPath,
      props.projectName,
      props.workspaceId,
      props.framework,
      props.storedDevCommand,
      props.storedDevPort,
      props.workbenchSessionKey,
      props.surfaceVisible,
      props.getWorkbenchSession,
      props.getSelectionPreviewTile,
      props.onDuplicateAssistantTile,
      props.onResolveSelectionTile,
      props.onSplitTile,
    ],
  )

  return (
    <WorkbenchDockRuntimeContext.Provider value={value}>
      {props.children}
    </WorkbenchDockRuntimeContext.Provider>
  )
}
