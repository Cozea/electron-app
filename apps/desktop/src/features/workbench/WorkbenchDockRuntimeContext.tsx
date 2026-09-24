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
import type { AssistantHistoryEntry } from "@/features/assistant/history/assistantHistory"

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
  getWorkbenchSession: () => WorkbenchSessionSnapshot | null
  getSelectionPreviewTile: (tileId: string) => WorkbenchSelectionTileRecord | null
  onDuplicateAssistantTile: (sourceTileId: string) => void
  onOpenAssistantConversation: (sourceTileId: string, entry: AssistantHistoryEntry, busy: boolean) => void
  onResolveSelectionTile: (
    selectionTileId: string,
    request: WorkbenchSelectionLaunchRequest,
  ) => void
  onSplitTile: (sourceTileId: string, direction: "right" | "bottom" | "left" | "top") => void
}

/**
 * Whether the workbench is on screen, kept apart from the runtime value: it
 * flips every time a page covers the workbench, and only tiles that drive
 * native surfaces or park expensive renderers read it. In the runtime value
 * it re-rendered every tile — assistant chats included — on each flip.
 */
export interface WorkbenchSurfaceVisibility {
  /**
   * False while this workbench is kept alive but CSS-hidden behind another
   * project. Dockview panel visibility cannot see that hiding, so tiles that
   * drive native Electron surfaces (browser views, embedded previews) must
   * AND this into their visibility.
   */
  surfaceVisible: boolean
  /**
   * True for the workbench the user will return to: the visible one, or the
   * last visible one while an ordinary page (Store, Settings, …) covers the
   * surface. False only when another workbench has taken the foreground.
   * Tiles whose renderer is expensive to park and rebuild (terminals) stay
   * attached while this holds, so a trip to a page and back costs nothing.
   */
  surfaceForeground: boolean
}

const WorkbenchDockRuntimeContext = createContext<WorkbenchDockRuntimeValue | null>(null)
const WorkbenchSurfaceVisibilityContext = createContext<WorkbenchSurfaceVisibility | null>(null)

export function useOptionalWorkbenchSurfaceVisibility(): WorkbenchSurfaceVisibility | null {
  return useContext(WorkbenchSurfaceVisibilityContext)
}

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

export function WorkbenchDockRuntimeProvider(props: WorkbenchDockRuntimeValue & WorkbenchSurfaceVisibility & {
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
      getWorkbenchSession: props.getWorkbenchSession,
      getSelectionPreviewTile: props.getSelectionPreviewTile,
      onDuplicateAssistantTile: props.onDuplicateAssistantTile,
      onOpenAssistantConversation: props.onOpenAssistantConversation,
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
      props.getWorkbenchSession,
      props.getSelectionPreviewTile,
      props.onDuplicateAssistantTile,
      props.onOpenAssistantConversation,
      props.onResolveSelectionTile,
      props.onSplitTile,
    ],
  )

  const visibility = useMemo<WorkbenchSurfaceVisibility>(
    () => ({ surfaceVisible: props.surfaceVisible, surfaceForeground: props.surfaceForeground }),
    [props.surfaceVisible, props.surfaceForeground],
  )

  return (
    <WorkbenchDockRuntimeContext.Provider value={value}>
      <WorkbenchSurfaceVisibilityContext.Provider value={visibility}>
        {props.children}
      </WorkbenchSurfaceVisibilityContext.Provider>
    </WorkbenchDockRuntimeContext.Provider>
  )
}
