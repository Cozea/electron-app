import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react"

import type {
  WorkbenchSelectionTile as WorkbenchSelectionTileRecord,
} from "@/stores/useProjectWorkbenchStore"
import type { WorkbenchSelectionLaunchRequest } from "@/features/projects/lib/workbenchSelectionLaunch"
import type { WorkbenchSessionSnapshot } from "@shared/electronApiTypes"

export interface WorkbenchDockPanelParams {
  projectId: string
  laneId: string
  tileId: string
}

export interface WorkbenchDockRuntimeValue {
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

export function WorkbenchDockRuntimeProvider(props: WorkbenchDockRuntimeValue & {
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
      onSplitTile: props.onSplitTile,
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
      props.onSplitTile,
    ],
  )

  return (
    <WorkbenchDockRuntimeContext.Provider value={value}>
      {props.children}
    </WorkbenchDockRuntimeContext.Provider>
  )
}
