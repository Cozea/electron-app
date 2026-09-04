/**
 * The contract between the workbench and the capabilities it hosts.
 *
 * Tile shapes and tile identity are shared vocabulary: browser and devapps
 * describe the same dev-server tile the workbench persists, and the devapp
 * registry names the tile types it can render as. While these lived inside
 * workbenchStore, saying "a dev server tile" meant importing the workbench
 * feature and its 1,600-line store.
 *
 * The store still owns workbench state. This file owns only the shapes.
 */

import type { BrowserStorageScope } from "@shared/browserTileTypes"
import type {
  ProviderInteractionMode,
  ProviderInstanceId,
  ProviderKind,
  RuntimeMode,
} from "@cozea/assistant-contracts"

export type WorkbenchTileType =
  | "browser"
  | "memory"
  | "terminal"
  | "devServer"
  | "llama"
  | "mobileSimulator"
  | "orgDevApp"
  | "devAppPreview"
  | "selection"
  | "tasks"
  | "assistantChat"

export type RenderableWorkbenchTileType = Exclude<WorkbenchTileType, "tasks">

/**
 * The name a tile carries before anything renames it.
 *
 * These sit with the tile types rather than in the shell registry because
 * creating a tile needs a title and nothing else the registry knows. The
 * registry still owns everything about how a tile is presented and reads its
 * titles from here, so there is one spelling of "Dev Server".
 */
export const WORKBENCH_TILE_DEFAULT_TITLES: Record<WorkbenchTileType, string> = {
  browser: "Browser",
  terminal: "Terminal",
  devServer: "Dev Server",
  memory: "Memory",
  llama: "Llama",
  mobileSimulator: "Mobile Simulator",
  orgDevApp: "DevApp",
  devAppPreview: "DevApp (development)",
  selection: "Add DevApp",
  tasks: "Tasks",
  assistantChat: "AI Agent",
}

export type WorkbenchRuntimePreviewViewMode = "preview" | "code"

export type WorkbenchSelectionTileMode =
  | "emptyState"
  | "edgePreview"
  | "seamPreview"
  | "junctionPreview"
export type WorkbenchSelectionTileEdge = "left" | "right" | "top" | "bottom"
export type WorkbenchSelectionPreviewScope = "local" | "full-span"
export type WorkbenchSelectionPreviewTargetKind = "edge" | "seam" | "junction"

interface WorkbenchBaseTile {
  id: string
  type: WorkbenchTileType
  title: string
  createdAt: number
}

export interface WorkbenchBrowserTile extends WorkbenchBaseTile {
  type: "browser"
  url: string
  favicon?: string | null
  storageScope?: BrowserStorageScope
}

export interface WorkbenchOrgDevAppTile extends WorkbenchBaseTile {
  type: "orgDevApp"
  url: string
  /** Durable publication identity. Empty legacy values fail closed and must be reopened. */
  devAppRef: string
  publicationId: string
  organizationId?: string
  contentHash: string
  entryPath: string
  runtimeKind?: "static" | "service"
  logoDataUrl?: string | null
  storageScope?: BrowserStorageScope
}

/**
 * An unpublished DevApp being developed in this project.
 *
 * Carries only the path relative to the workspace root. The absolute location is never
 * persisted and never crosses to the renderer: main joins this against the root that
 * authorization returns, so a tile restored from stored state cannot name a directory
 * outside the project it belongs to.
 */
export interface WorkbenchDevAppPreviewTile extends WorkbenchBaseTile {
  type: "devAppPreview"
  relativePath: string
  /** Source identity for cross-project integration testing; never an absolute path. */
  sourceProjectId?: string | null
  sourceWorkspaceId?: string | null
  devAppRef?: string | null
  /** Assigned by the host on open; absent until then. */
  sourceId?: string | null
}

export interface WorkbenchTerminalTile extends WorkbenchBaseTile {
  type: "terminal"
}

export interface WorkbenchDevServerTile extends WorkbenchBaseTile {
  type: "devServer"
  viewMode?: WorkbenchRuntimePreviewViewMode
  /** Surface created for agent preview automation; the runtime remains workspace/lane-scoped. */
  agentManaged?: boolean
  /**
   * URL the user navigated the embedded preview to, when it differs from the
   * dev server's own URL. Persisted intent: survives remounts, cleared
   * explicitly ("back to server URL") or by navigating back to the base.
   */
  previewOverrideUrl?: string | null
  /** Private project DevApp identity and immutable release snapshot. */
  devAppId?: string
  devAppReleaseId?: string
  devAppReleaseVersion?: number
  /** Source runtime retained when this local DevApp is opened from another project. */
  devAppProjectId?: string
  devAppWorkspaceId?: string
  devAppLaneId?: string
  /** Launch-context overrides captured when the DevApp release was created. */
  devAppFramework?: string
  devAppCommand?: string
  devAppPort?: number
  autoStart?: boolean
}

export interface WorkbenchMobileSimulatorTile extends WorkbenchBaseTile {
  type: "mobileSimulator"
  viewMode?: WorkbenchRuntimePreviewViewMode
}

export interface WorkbenchLlamaTile extends WorkbenchBaseTile {
  type: "llama"
}

export interface WorkbenchMemoryTile extends WorkbenchBaseTile {
  type: "memory"
}

export interface WorkbenchSelectionTile extends WorkbenchBaseTile {
  type: "selection"
  mode: WorkbenchSelectionTileMode
  edge?: WorkbenchSelectionTileEdge | null
  referenceTileId?: string | null
  adjacentTileId?: string | null
  previewScope?: WorkbenchSelectionPreviewScope | null
  previewTargetKind?: WorkbenchSelectionPreviewTargetKind | null
  previewTargetId?: string | null
}

export interface WorkbenchTasksTile extends WorkbenchBaseTile {
  type: "tasks"
}

export interface WorkbenchAssistantChatTile extends WorkbenchBaseTile {
  type: "assistantChat"
  viewMode?: "chat" | "artifacts"
  assistantProjectId?: string | null
  threadId?: string | null
  provider?: ProviderKind
  providerInstanceId?: ProviderInstanceId
  model?: string | null
  runtimeMode?: RuntimeMode
  interactionMode?: ProviderInteractionMode
  agentLabel?: string | null
  laneBinding?: "sessionWorkspace" | "threadWorktree"
}

export type WorkbenchTile =
  | WorkbenchBrowserTile
  | WorkbenchTerminalTile
  | WorkbenchDevServerTile
  | WorkbenchLlamaTile
  | WorkbenchMemoryTile
  | WorkbenchMobileSimulatorTile
  | WorkbenchOrgDevAppTile
  | WorkbenchDevAppPreviewTile
  | WorkbenchSelectionTile
  | WorkbenchTasksTile
  | WorkbenchAssistantChatTile
