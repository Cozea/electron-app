import type {
  ProviderInteractionMode,
  ProviderInstanceId,
  ProviderKind,
  RuntimeMode,
} from "@cozea/assistant-contracts"
import type { BrowserStorageScope } from "@shared/browserHostTypes"
import type { SerializedDockview } from "dockview-react"
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"

import {
  buildLegacyWorkspaceIdentityKey,
  buildWorkspaceIdentityKey,
  normalizeWorkspaceId,
} from "@/features/projects/workspaces/workspaceIdentity"
import { markCozeaInteractionEnd, markCozeaInteractionStart } from "@/lib/performance/marks"

const PERSIST_DEBOUNCE_MS = 500

function createDebouncedStorage(backing: Storage): StateStorage & { flush: () => void } {
  let pending: string | null = null
  let pendingKey: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending !== null && pendingKey !== null) {
      backing.setItem(pendingKey, pending)
      pending = null
      pendingKey = null
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", flush)
  }

  return {
    getItem(name) {
      return backing.getItem(name)
    },
    setItem(name, value) {
      pendingKey = name
      pending = value
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        flush()
      }, PERSIST_DEBOUNCE_MS)
    },
    removeItem(name) {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
      pendingKey = null
      backing.removeItem(name)
    },
    flush,
  }
}

export function flushWorkbenchStorage(): void {
  if (typeof workbenchStorage === "object" && "flush" in workbenchStorage) {
    (workbenchStorage as { flush: () => void }).flush()
  }
}

function createMemoryStorage(): StateStorage {
  const items = new Map<string, string>()
  return {
    getItem(name) {
      return items.get(name) ?? null
    },
    setItem(name, value) {
      items.set(name, value)
    },
    removeItem(name) {
      items.delete(name)
    },
  }
}

const workbenchStorage =
  typeof window === "undefined"
    ? createMemoryStorage()
    : createDebouncedStorage(window.localStorage)

export type WorkbenchTileType =
  | "browser"
  | "terminal"
  | "devServer"
  | "mobileSimulator"
  | "orgDevApp"
  | "selection"
  | "tasks"
  | "assistantChat"

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
  publicationId: string
  organizationId?: string
  contentHash: string
  entryPath: string
  logoDataUrl?: string | null
  storageScope?: BrowserStorageScope
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
  | WorkbenchMobileSimulatorTile
  | WorkbenchOrgDevAppTile
  | WorkbenchSelectionTile
  | WorkbenchTasksTile
  | WorkbenchAssistantChatTile

export interface WorkbenchProjectState {
  projectId: string
  laneId: string
  workspaceId: string | null
  tiles: Record<string, WorkbenchTile>
  order: string[]
  activeTileId: string | null
  layout: SerializedDockview | null
  layoutResetKey: number
}

export interface WorkbenchSidebarAssistantTileSummary {
  id: string
  type: "assistantChat"
  title: string
  provider?: ProviderKind
  threadId?: string | null
}

export interface WorkbenchSidebarSurfaceTileSummary {
  id: string
  type: Exclude<WorkbenchTileType, "assistantChat" | "selection" | "tasks">
  title: string
  favicon?: string | null
  devAppId?: string
}

export interface WorkbenchLaneSidebarSummary {
  laneId: string
  activeTileId: string | null
  agents: WorkbenchSidebarAssistantTileSummary[]
  surfaces: WorkbenchSidebarSurfaceTileSummary[]
}

export interface CreateTileOptions {
  title?: string
  url?: string
  storageScope?: BrowserStorageScope
  devAppId?: string | null
  devAppReleaseId?: string | null
  devAppReleaseVersion?: number | null
  devAppProjectId?: string | null
  devAppWorkspaceId?: string | null
  devAppLaneId?: string | null
  devAppFramework?: string | null
  devAppCommand?: string | null
  devAppPort?: number | null
  orgDevAppPublicationId?: string | null
  orgDevAppOrganizationId?: string | null
  orgDevAppContentHash?: string | null
  orgDevAppEntryPath?: string | null
  orgDevAppLogoDataUrl?: string | null
  autoStart?: boolean
  /** Add the surface without changing the user's active Dockview tab. */
  activate?: boolean
  agentManaged?: boolean
  selectionMode?: WorkbenchSelectionTileMode
  selectionEdge?: WorkbenchSelectionTileEdge | null
  selectionReferenceTileId?: string | null
  selectionAdjacentTileId?: string | null
  selectionPreviewScope?: WorkbenchSelectionPreviewScope | null
  selectionPreviewTargetKind?: WorkbenchSelectionPreviewTargetKind | null
  selectionPreviewTargetId?: string | null
  assistantProjectId?: string | null
  threadId?: string | null
  provider?: ProviderKind
  providerInstanceId?: ProviderInstanceId
  model?: string | null
  runtimeMode?: RuntimeMode
  interactionMode?: ProviderInteractionMode
  agentLabel?: string | null
  laneBinding?: "sessionWorkspace" | "threadWorktree"
  assistantViewMode?: "chat" | "artifacts"
}

interface PersistedWorkbenchState {
  workbenches: Record<string, PersistedWorkbenchRecord>
}

interface LegacyPersistedWorkbenchState {
  projects?: Record<string, PersistedWorkbenchRecord>
}

type PersistedWorkbenchRecord = WorkbenchProjectState & {
  projectPath?: string | null
}

interface ProjectWorkbenchState extends PersistedWorkbenchState {
  actions: {
    ensureWorkbench: (projectId: string, laneId: string, workspaceId?: string | null) => void
    resetWorkbench: (projectId: string, laneId: string, workspaceId?: string | null) => void
    removeProject: (projectId: string) => void
    cloneWorkspaceState: (
      projectId: string,
      fromWorkspace?: string | null,
      toWorkspace?: string | null,
    ) => void
    addTile: (
      projectId: string,
      laneId: string,
      type: WorkbenchTileType,
      options?: CreateTileOptions,
      workspaceId?: string | null,
    ) => string
    openSingletonTile: (
      projectId: string,
      laneId: string,
      type: Extract<WorkbenchTileType, "devServer" | "mobileSimulator">,
      options?: CreateTileOptions,
      workspaceId?: string | null,
    ) => string
    removeTile: (projectId: string, laneId: string, tileId: string, workspaceId?: string | null) => void
    setActiveTile: (projectId: string, laneId: string, tileId: string | null, workspaceId?: string | null) => void
    setLayoutSnapshot: (
      projectId: string,
      laneId: string,
      layout: SerializedDockview | null,
      workspaceId?: string | null,
    ) => void
    updateAssistantTile: (
      projectId: string,
      laneId: string,
      tileId: string,
        patch: Partial<
        Pick<
          WorkbenchAssistantChatTile,
          | "title"
          | "viewMode"
          | "assistantProjectId"
          | "threadId"
          | "provider"
          | "providerInstanceId"
          | "model"
          | "runtimeMode"
          | "interactionMode"
          | "agentLabel"
          | "laneBinding"
        >
      >,
      workspaceId?: string | null,
    ) => void
    updateBrowserTile: (
      projectId: string,
      laneId: string,
      tileId: string,
      patch: Partial<Pick<WorkbenchBrowserTile, "url" | "title" | "favicon" | "storageScope">>,
      workspaceId?: string | null,
    ) => void
    updateRuntimePreviewTile: (
      projectId: string,
      laneId: string,
      tileId: string,
      patch: Partial<{
        viewMode: WorkbenchRuntimePreviewViewMode
        previewOverrideUrl: string | null
        autoStart: boolean
      }>,
      workspaceId?: string | null,
    ) => void
    updateTileTitle: (
      projectId: string,
      laneId: string,
      tileId: string,
      title: string,
      workspaceId?: string | null,
    ) => void
  }
}

export const DEFAULT_WORKBENCH_LANE_ID = "collab"

const TILE_TITLES: Record<WorkbenchTileType, string> = {
  browser: "Browser",
  terminal: "Terminal",
  devServer: "Dev Server",
  mobileSimulator: "Mobile Simulator",
  orgDevApp: "DevApp",
  selection: "Add DevApp",
  tasks: "Tasks",
  assistantChat: "AI Agent",
}

function normalizeLaneId(laneId: string | null | undefined): string {
  const normalized = laneId?.trim()
  return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKBENCH_LANE_ID
}

function buildLegacyWorkbenchScopeKey(projectId: string, laneId?: string | null): string {
  return buildLegacyWorkspaceIdentityKey(projectId, normalizeLaneId(laneId))!
}

export function buildWorkbenchScopeKey(
  projectId: string,
  laneId?: string | null,
  workspaceId?: string | null,
): string {
  const normalizedWorkspace = normalizeWorkspaceId(workspaceId)
  if (!normalizedWorkspace) {
    return buildLegacyWorkbenchScopeKey(projectId, laneId)
  }

  return buildWorkspaceIdentityKey(projectId, normalizedWorkspace, normalizeLaneId(laneId))!
}

function resolveWorkbenchScopeKey(
  workbenches: Record<string, WorkbenchProjectState>,
  projectId: string,
  laneId?: string | null,
  workspaceId?: string | null,
): string {
  const normalizedLaneId = normalizeLaneId(laneId)
  const normalizedWorkspace = normalizeWorkspaceId(workspaceId)
  const pathAwareScopeKey = buildWorkbenchScopeKey(projectId, normalizedLaneId, normalizedWorkspace)
  if (normalizedWorkspace && workbenches[pathAwareScopeKey]) {
    return pathAwareScopeKey
  }

  const legacyScopeKey = buildLegacyWorkbenchScopeKey(projectId, normalizedLaneId)
  if (workbenches[legacyScopeKey]) {
    return legacyScopeKey
  }

  if (!normalizedWorkspace) {
    const matchingScopeKeys = Object.entries(workbenches)
      .filter(([, workbench]) =>
        workbench.projectId === projectId &&
        normalizeLaneId(workbench.laneId) === normalizedLaneId,
      )
      .map(([scopeKey]) => scopeKey)

    if (matchingScopeKeys.length > 0) {
      return pickMostRecentlyUsedWorkbenchScopeKey(workbenches, matchingScopeKeys)
    }
  }

  return pathAwareScopeKey
}

function getWorkbenchActivityTime(workbench: WorkbenchProjectState | null | undefined): number {
  if (!workbench) {
    return 0
  }

  return Math.max(
    0,
    ...Object.values(workbench.tiles ?? {}).map((tile) =>
      typeof tile.createdAt === "number" ? tile.createdAt : 0,
    ),
  )
}

function pickMostRecentlyUsedWorkbenchScopeKey(
  workbenches: Record<string, WorkbenchProjectState>,
  scopeKeys: string[],
): string {
  return [...scopeKeys].sort((left, right) => {
    const rightActivity = getWorkbenchActivityTime(workbenches[right])
    const leftActivity = getWorkbenchActivityTime(workbenches[left])
    if (rightActivity !== leftActivity) {
      return rightActivity - leftActivity
    }
    return left.localeCompare(right)
  })[0]!
}

function promoteLegacyWorkbenchIfNeeded(
  workbenches: Record<string, WorkbenchProjectState>,
  projectId: string,
  laneId?: string | null,
  workspaceId?: string | null,
): string {
  const normalizedWorkspace = normalizeWorkspaceId(workspaceId)
  if (!normalizedWorkspace) {
    return buildLegacyWorkbenchScopeKey(projectId, laneId)
  }

  const pathAwareScopeKey = buildWorkbenchScopeKey(projectId, laneId, normalizedWorkspace)
  if (workbenches[pathAwareScopeKey]) {
    const existing = workbenches[pathAwareScopeKey]
    if (existing.workspaceId !== normalizedWorkspace) {
      workbenches[pathAwareScopeKey] = {
        ...existing,
        workspaceId: normalizedWorkspace,
      }
    }
    return pathAwareScopeKey
  }

  const legacyScopeKey = buildLegacyWorkbenchScopeKey(projectId, laneId)
  if (!workbenches[legacyScopeKey]) {
    return pathAwareScopeKey
  }

  workbenches[pathAwareScopeKey] = sanitizeWorkbenchState({
    ...workbenches[legacyScopeKey],
    workspaceId: normalizedWorkspace,
  })
  delete workbenches[legacyScopeKey]
  return pathAwareScopeKey
}

function resolveMutableWorkbenchState(
  workbenches: Record<string, WorkbenchProjectState>,
  projectId: string,
  laneId?: string | null,
  workspaceId?: string | null,
  options?: {
    createIfMissing?: boolean
  },
): {
  scopeKey: string
  normalizedLaneId: string
  normalizedWorkspace: string | null
  workbench: WorkbenchProjectState | null
} {
  const normalizedLaneId = normalizeLaneId(laneId)
  const normalizedWorkspace = normalizeWorkspaceId(workspaceId)
  const scopeKey = normalizedWorkspace
    ? promoteLegacyWorkbenchIfNeeded(workbenches, projectId, normalizedLaneId, normalizedWorkspace)
    : resolveWorkbenchScopeKey(workbenches, projectId, normalizedLaneId, null)

  let workbench = workbenches[scopeKey] ?? null

  if (!workbench && options?.createIfMissing !== false) {
    workbench = createDefaultWorkbenchState(projectId, normalizedLaneId, normalizedWorkspace)
    workbenches[scopeKey] = workbench
    return {
      scopeKey,
      normalizedLaneId,
      normalizedWorkspace,
      workbench,
    }
  }

  if (workbench) {
    workbench.projectId = projectId
    workbench.laneId = normalizedLaneId
    if (normalizedWorkspace && workbench.workspaceId !== normalizedWorkspace) {
      workbench.workspaceId = normalizedWorkspace
    }
  }

  return {
    scopeKey,
    normalizedLaneId,
    normalizedWorkspace,
    workbench,
  }
}

function createTileId(type: WorkbenchTileType): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${type}-${crypto.randomUUID()}`
  }
  return `${type}-${Date.now()}-${Math.round(Math.random() * 100_000)}`
}

function nextLayoutResetKey(): number {
  return Date.now()
}

function isSerializedDockview(value: unknown): value is SerializedDockview {
  if (!value || typeof value !== "object") return false
  return "grid" in value && "panels" in value
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function normalizeDevAppReleaseVersion(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined
}

function normalizeDevAppPort(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535
    ? value
    : undefined
}

function applyDevAppMetadata(
  tile: WorkbenchDevServerTile,
  options: CreateTileOptions,
): void {
  const devAppId = normalizeOptionalString(options.devAppId)

  if (!devAppId) {
    delete tile.devAppId
    delete tile.devAppReleaseId
    delete tile.devAppReleaseVersion
    delete tile.devAppProjectId
    delete tile.devAppWorkspaceId
    delete tile.devAppLaneId
    delete tile.devAppFramework
    delete tile.devAppCommand
    delete tile.devAppPort
    delete tile.autoStart
    tile.title = normalizeOptionalString(options.title) ?? TILE_TITLES.devServer
    return
  }

  tile.devAppId = devAppId
  tile.devAppReleaseId = normalizeOptionalString(options.devAppReleaseId)
  tile.devAppReleaseVersion = normalizeDevAppReleaseVersion(options.devAppReleaseVersion)
  tile.devAppProjectId = normalizeOptionalString(options.devAppProjectId)
  tile.devAppWorkspaceId = normalizeOptionalString(options.devAppWorkspaceId)
  tile.devAppLaneId = normalizeOptionalString(options.devAppLaneId)
  tile.devAppFramework = normalizeOptionalString(options.devAppFramework)
  tile.devAppCommand = normalizeOptionalString(options.devAppCommand)
  tile.devAppPort = normalizeDevAppPort(options.devAppPort)
  tile.autoStart = typeof options.autoStart === "boolean" ? options.autoStart : undefined

  const title = normalizeOptionalString(options.title)
  if (title) {
    tile.title = title
  }
}

function createTile(type: WorkbenchTileType, options: CreateTileOptions = {}): WorkbenchTile {
  const createdAt = Date.now()
  const id = createTileId(type)
  const title = options.title?.trim() || TILE_TITLES[type]

  switch (type) {
    case "browser":
      return {
        id,
        type,
        title,
        createdAt,
        url: options.url?.trim() || "",
        favicon: null,
        storageScope: options.storageScope ?? "workspace",
      }
    case "terminal":
      return { id, type, title, createdAt }
    case "devServer": {
      const tile: WorkbenchDevServerTile = {
        id,
        type,
        title,
        createdAt,
        agentManaged: options.agentManaged === true ? true : undefined,
      }
      applyDevAppMetadata(tile, options)
      return tile
    }
    case "mobileSimulator":
      return { id, type, title, createdAt }
    case "orgDevApp":
      return {
        id,
        type,
        title,
        createdAt,
        url: options.url?.trim() || "",
        publicationId:
          normalizeOptionalString(options.orgDevAppPublicationId) ||
          normalizeOptionalString(options.devAppId) ||
          "",
        organizationId: normalizeOptionalString(options.orgDevAppOrganizationId),
        contentHash: normalizeOptionalString(options.orgDevAppContentHash) || "",
        entryPath: normalizeOptionalString(options.orgDevAppEntryPath) || "index.html",
        logoDataUrl: options.orgDevAppLogoDataUrl ?? null,
        storageScope: options.storageScope ?? "orgDevApp",
      }
    case "selection":
      return {
        id,
        type,
        title,
        createdAt,
        mode: options.selectionMode ?? "emptyState",
        edge: options.selectionEdge ?? null,
        referenceTileId: options.selectionReferenceTileId ?? null,
        adjacentTileId: options.selectionAdjacentTileId ?? null,
        previewScope: options.selectionPreviewScope ?? null,
        previewTargetKind: options.selectionPreviewTargetKind ?? null,
        previewTargetId: options.selectionPreviewTargetId ?? null,
      }
    case "tasks":
      return { id, type, title, createdAt }
    case "assistantChat":
      return {
        id,
        type,
        title,
        createdAt,
        assistantProjectId: options.assistantProjectId ?? null,
        threadId: options.threadId ?? null,
        provider: options.provider,
        providerInstanceId: options.providerInstanceId,
        model: options.model ?? null,
        runtimeMode: options.runtimeMode ?? "full-access",
        interactionMode: options.interactionMode ?? "default",
        agentLabel: options.agentLabel ?? null,
        laneBinding: options.laneBinding ?? "sessionWorkspace",
        viewMode: options.assistantViewMode ?? "chat",
      }
    default:
      return { id, type, title, createdAt }
  }
}

function buildAssistantTileTitle(
  workbench: WorkbenchProjectState,
  requestedTitle?: string,
): string {
  const normalized = requestedTitle?.trim()
  if (normalized) {
    return normalized
  }

  const assistantCount = workbench.order.reduce((count, tileId) => {
    return workbench.tiles[tileId]?.type === "assistantChat" ? count + 1 : count
  }, 0)

  return assistantCount <= 0 ? TILE_TITLES.assistantChat : `${TILE_TITLES.assistantChat} ${assistantCount + 1}`
}

function createDefaultWorkbenchState(
  projectId: string,
  laneId: string,
  workspaceId?: string | null,
): WorkbenchProjectState {
  const normalizedLaneId = normalizeLaneId(laneId)

  return {
    projectId,
    laneId: normalizedLaneId,
    workspaceId: normalizeWorkspaceId(workspaceId),
    activeTileId: null,
    layout: null,
    layoutResetKey: nextLayoutResetKey(),
    order: [],
    tiles: {},
  }
}

function isEmptySelectionWorkbench(workbench: WorkbenchProjectState | null | undefined): boolean {
  if (!workbench) return false
  if (workbench.order.length === 0) return true
  if (workbench.order.length !== 1) return false

  const onlyTile = workbench.tiles[workbench.order[0]!]
  return onlyTile?.type === "selection" && onlyTile.mode === "emptyState"
}

function readWorkbenchWorkspaceId(workbench: PersistedWorkbenchRecord): string | null {
  return normalizeWorkspaceId(workbench.workspaceId ?? workbench.projectPath)
}

function sanitizeWorkbenchState(workbench: PersistedWorkbenchRecord): WorkbenchProjectState {
  const workspaceId = readWorkbenchWorkspaceId(workbench)
  const sanitizedTiles: Record<string, WorkbenchTile> = {}
  let removedObsoleteTile = false

  for (const [tileId, tile] of Object.entries(workbench.tiles ?? {})) {
    const tileType = (tile as { type?: string } | null)?.type
    if (
      !tile ||
      tileType === "tasks" ||
      tileType === "changes"
    ) {
      removedObsoleteTile = true
      continue
    }

    if (tile.type === "browser") {
      sanitizedTiles[tileId] = {
        ...tile,
        url: tile.url ?? "",
        favicon: tile.favicon ?? null,
        storageScope: tile.storageScope ?? "workspace",
      }
      continue
    }

    if (tile.type === "assistantChat") {
      const normalizedLaneBinding =
        tile.laneBinding === "threadWorktree"
          ? "threadWorktree"
          : "sessionWorkspace"
      sanitizedTiles[tileId] = {
        ...tile,
        assistantProjectId: tile.assistantProjectId ?? null,
        threadId: tile.threadId ?? null,
        providerInstanceId: tile.providerInstanceId,
        model: tile.model ?? null,
        runtimeMode: tile.runtimeMode ?? "full-access",
        interactionMode: tile.interactionMode ?? "default",
        agentLabel: tile.agentLabel ?? null,
        laneBinding: normalizedLaneBinding,
        viewMode: tile.viewMode === "artifacts" ? "artifacts" : "chat",
      }
      continue
    }

    if (tile.type === "devServer") {
      const devAppId = normalizeOptionalString(tile.devAppId)
      const sanitizedTile: WorkbenchDevServerTile = {
        ...tile,
        agentManaged: tile.agentManaged === true ? true : undefined,
        viewMode: tile.viewMode === "code" ? "code" : "preview",
        previewOverrideUrl:
          typeof tile.previewOverrideUrl === "string"
            ? normalizeOptionalString(tile.previewOverrideUrl) ?? null
            : null,
        devAppId,
        devAppReleaseId: devAppId
          ? normalizeOptionalString(tile.devAppReleaseId)
          : undefined,
        devAppReleaseVersion: devAppId
          ? normalizeDevAppReleaseVersion(tile.devAppReleaseVersion)
          : undefined,
        devAppProjectId: devAppId
          ? normalizeOptionalString(tile.devAppProjectId)
          : undefined,
        devAppWorkspaceId: devAppId
          ? normalizeOptionalString(tile.devAppWorkspaceId)
          : undefined,
        devAppLaneId: devAppId
          ? normalizeOptionalString(tile.devAppLaneId)
          : undefined,
        devAppFramework: devAppId
          ? normalizeOptionalString(tile.devAppFramework)
          : undefined,
        devAppCommand: devAppId
          ? normalizeOptionalString(tile.devAppCommand)
          : undefined,
        devAppPort: devAppId ? normalizeDevAppPort(tile.devAppPort) : undefined,
        autoStart:
          devAppId && typeof tile.autoStart === "boolean"
            ? tile.autoStart
            : undefined,
      }

      for (const key of [
        "devAppId",
        "devAppReleaseId",
        "devAppReleaseVersion",
        "devAppProjectId",
        "devAppWorkspaceId",
        "devAppLaneId",
        "devAppFramework",
        "devAppCommand",
        "devAppPort",
        "autoStart",
      ] as const) {
        if (sanitizedTile[key] === undefined) {
          delete sanitizedTile[key]
        }
      }

      sanitizedTiles[tileId] = sanitizedTile
      continue
    }

    if (tile.type === "selection") {
      sanitizedTiles[tileId] = {
        ...tile,
        edge: tile.edge ?? null,
        referenceTileId: tile.referenceTileId ?? null,
        adjacentTileId: tile.adjacentTileId ?? null,
        previewScope: tile.previewScope ?? null,
        previewTargetKind: tile.previewTargetKind ?? null,
        previewTargetId: tile.previewTargetId ?? null,
      }
      continue
    }

    sanitizedTiles[tileId] = tile
  }

  let sanitizedOrder = (workbench.order ?? []).filter((tileId) => Boolean(sanitizedTiles[tileId]))

  // React StrictMode used to replay the URL `openTile=assistantChat` effect
  // before its replace-navigation settled. The two placeholder agents were
  // created in the same tick (typically the exact same millisecond) and then
  // persisted as if the user had opened them separately. Collapse only these
  // machine-speed, default-titled runs; a person cannot intentionally create
  // two panels inside this window, and custom-titled agents are never touched.
  const duplicateAssistantGroups: string[][] = []
  let currentDuplicateGroup: string[] = []
  for (const tileId of sanitizedOrder) {
    const tile = sanitizedTiles[tileId]
    const previousTileId = currentDuplicateGroup[currentDuplicateGroup.length - 1]
    const previousTile = previousTileId ? sanitizedTiles[previousTileId] : null
    const isGeneratedAssistant =
      tile?.type === "assistantChat" && /^AI Agent(?: \d+)?$/.test(tile.title)
    const followsSameTickAssistant =
      isGeneratedAssistant &&
      previousTile?.type === "assistantChat" &&
      /^AI Agent(?: \d+)?$/.test(previousTile.title) &&
      Math.abs(tile.createdAt - previousTile.createdAt) <= 25

    if (followsSameTickAssistant) {
      currentDuplicateGroup.push(tileId)
      continue
    }

    if (currentDuplicateGroup.length > 1) {
      duplicateAssistantGroups.push(currentDuplicateGroup)
    }
    currentDuplicateGroup = isGeneratedAssistant ? [tileId] : []
  }
  if (currentDuplicateGroup.length > 1) {
    duplicateAssistantGroups.push(currentDuplicateGroup)
  }

  for (const group of duplicateAssistantGroups) {
    const keepTileId = group.includes(workbench.activeTileId ?? "")
      ? workbench.activeTileId!
      : group.findLast((tileId) => {
          const tile = sanitizedTiles[tileId]
          return tile?.type === "assistantChat" && Boolean(tile.threadId)
        }) ?? group[0]!

    for (const tileId of group) {
      if (tileId === keepTileId) continue
      delete sanitizedTiles[tileId]
      removedObsoleteTile = true
    }
  }
  if (duplicateAssistantGroups.length > 0) {
    sanitizedOrder = sanitizedOrder.filter((tileId) => Boolean(sanitizedTiles[tileId]))
  }

  const nonSelectionTileIds = sanitizedOrder.filter((tileId) => sanitizedTiles[tileId]?.type !== "selection")
  const selectionTileIds = sanitizedOrder.filter((tileId) => sanitizedTiles[tileId]?.type === "selection")

  if (nonSelectionTileIds.length > 0 && selectionTileIds.length > 0) {
    for (const tileId of selectionTileIds) {
      delete sanitizedTiles[tileId]
    }
    sanitizedOrder = nonSelectionTileIds
  } else if (nonSelectionTileIds.length === 0) {
    return createDefaultWorkbenchState(workbench.projectId, workbench.laneId, workspaceId)
  }

  if (sanitizedOrder.length === 0) {
    return createDefaultWorkbenchState(workbench.projectId, workbench.laneId, workspaceId)
  }

  const sanitizedActiveTileId =
    workbench.activeTileId && sanitizedTiles[workbench.activeTileId]
      ? workbench.activeTileId
      : (sanitizedOrder[0] ?? null)

  // Transient selection tiles can appear while the user is adding/splitting panels.
  // We strip them from persisted metadata, but they should not invalidate the
  // rest of the Dockview layout because that would cause split orientation and
  // sizing to fall back to the default rebuild on the next load.
  const shouldResetLayout = removedObsoleteTile

  return {
    projectId: workbench.projectId,
    laneId: normalizeLaneId(workbench.laneId),
    workspaceId,
    activeTileId: sanitizedActiveTileId,
    layout:
      shouldResetLayout
        ? null
        : isSerializedDockview(workbench.layout)
          ? workbench.layout
          : null,
    layoutResetKey:
      shouldResetLayout
        ? nextLayoutResetKey()
        : typeof workbench.layoutResetKey === "number"
          ? workbench.layoutResetKey
          : 0,
    order: sanitizedOrder,
    tiles: sanitizedTiles,
  }
}

function workbenchHasRealTiles(workbench: WorkbenchProjectState): boolean {
  return workbench.order.some((tileId) => {
    const tile = workbench.tiles[tileId]
    return Boolean(tile) && tile!.type !== "selection"
  })
}

function sanitizePersistedWorkbenches(
  workbenches: Record<string, PersistedWorkbenchRecord> | undefined,
): Record<string, WorkbenchProjectState> {
  const sanitizedEntries: Array<[string, WorkbenchProjectState]> = []

  for (const [, workbench] of Object.entries(workbenches ?? {})) {
    if (!workbench?.projectId) continue
    const sanitizedWorkbench = sanitizeWorkbenchState({
      ...workbench,
      laneId: normalizeLaneId(workbench.laneId),
    })
    sanitizedEntries.push([
      buildWorkbenchScopeKey(
        sanitizedWorkbench.projectId,
        sanitizedWorkbench.laneId,
        readWorkbenchWorkspaceId(sanitizedWorkbench),
      ),
      sanitizedWorkbench,
    ])
  }

  // Drop dead legacy (workspace-less) benches: once a workspace-scoped bench
  // exists for the same project+lane the legacy one is permanently shadowed
  // (reads prefer the scoped key, the legacy-promotion bridge only fires when
  // the scoped bench is missing), and empty/selection-only legacy benches are
  // junk left behind by pre-fix null-scope writes. Tiled, unshadowed legacy
  // benches stay — promoteLegacyWorkbenchIfNeeded adopts them on first write.
  const scopedLanes = new Set(
    sanitizedEntries
      .filter(([, workbench]) => readWorkbenchWorkspaceId(workbench))
      .map(([, workbench]) => `${workbench.projectId}::${workbench.laneId}`),
  )
  const keptEntries = sanitizedEntries.filter(([, workbench]) => {
    if (readWorkbenchWorkspaceId(workbench)) return true
    const laneKey = `${workbench.projectId}::${workbench.laneId}`
    if (scopedLanes.has(laneKey)) return false
    return workbenchHasRealTiles(workbench)
  })

  // Drop ghost lane-siblings: the lane id derives from a branch comparison,
  // and a mis-resolved branch (collab vs branch:*) used to mint an empty bench
  // beside the real one for the same project+workspace. A selection-only bench
  // whose sibling has real tiles is that artifact — keeping it means users can
  // land on it and see "everything closed". Content benches are never touched
  // (multiple tiled lanes per workspace is the intended per-branch feature).
  const contentByProjectWorkspace = new Set(
    keptEntries
      .filter(([, workbench]) => readWorkbenchWorkspaceId(workbench) && workbenchHasRealTiles(workbench))
      .map(([, workbench]) => `${workbench.projectId}::${readWorkbenchWorkspaceId(workbench)}`),
  )
  const dedupedEntries = keptEntries.filter(([, workbench]) => {
    const workspaceId = readWorkbenchWorkspaceId(workbench)
    if (!workspaceId || workbenchHasRealTiles(workbench)) return true
    return !contentByProjectWorkspace.has(`${workbench.projectId}::${workspaceId}`)
  })

  return Object.fromEntries(dedupedEntries)
}

function cloneWorkbenchState(workbench: WorkbenchProjectState, workspaceId: string): WorkbenchProjectState {
  return sanitizeWorkbenchState({
    ...workbench,
    workspaceId,
    order: [...workbench.order],
    tiles: Object.fromEntries(
      Object.entries(workbench.tiles).map(([tileId, tile]) => [tileId, { ...tile }] as const),
    ),
  })
}

export function migratePersistedWorkbenchState(
  persistedState: unknown,
): PersistedWorkbenchState {
  if (!persistedState || typeof persistedState !== "object") {
    return { workbenches: {} }
  }

  const typedState = persistedState as PersistedWorkbenchState & LegacyPersistedWorkbenchState

  if ("workbenches" in typedState && typedState.workbenches && typeof typedState.workbenches === "object") {
    return {
      workbenches: sanitizePersistedWorkbenches(typedState.workbenches),
    }
  }

  const migratedWorkbenches = Object.fromEntries(
    Object.entries(typedState.projects ?? {}).flatMap(([projectId, workbench]) => {
      if (!workbench) return []
      const sanitizedWorkbench = sanitizeWorkbenchState({
        ...workbench,
        projectId: workbench.projectId ?? projectId,
        laneId: normalizeLaneId(workbench.laneId),
      })
      return [[
        buildWorkbenchScopeKey(
          sanitizedWorkbench.projectId,
          sanitizedWorkbench.laneId,
          readWorkbenchWorkspaceId(sanitizedWorkbench),
        ),
        sanitizedWorkbench,
      ]]
    }),
  )

  return {
    workbenches: migratedWorkbenches,
  }
}

export function selectProjectWorkbench(
  projectId: string | null | undefined,
  laneId?: string | null,
  workspaceId?: string | null,
) {
  return (state: ProjectWorkbenchState): WorkbenchProjectState | null => {
    if (!projectId) return null
    const scopeKey = resolveWorkbenchScopeKey(state.workbenches, projectId, laneId, workspaceId)
    return state.workbenches[scopeKey] ?? null
  }
}

export function selectProjectLaneWorkbenches(projectId: string | null | undefined) {
  return (state: ProjectWorkbenchState): Record<string, WorkbenchProjectState> => {
    if (!projectId) return {}

    const byLane: Record<string, WorkbenchProjectState> = {}
    for (const workbench of Object.values(state.workbenches)) {
      if (workbench.projectId !== projectId) {
        continue
      }

      const laneId = normalizeLaneId(workbench.laneId)
      const existing = byLane[laneId]
      if (!existing || getWorkbenchActivityTime(workbench) >= getWorkbenchActivityTime(existing)) {
        byLane[laneId] = workbench
      }
    }

    return byLane
  }
}

export function buildWorkbenchLaneSidebarSummary(
  workbench: WorkbenchProjectState,
): WorkbenchLaneSidebarSummary {
  const agents: WorkbenchSidebarAssistantTileSummary[] = []
  const surfaces: WorkbenchSidebarSurfaceTileSummary[] = []

  for (const tileId of workbench.order) {
    const tile = workbench.tiles[tileId]
    if (!tile || tile.type === "selection" || tile.type === "tasks") {
      continue
    }

    if (tile.type === "assistantChat") {
      agents.push({
        id: tile.id,
        type: tile.type,
        title: tile.title,
        provider: tile.provider,
        threadId: tile.threadId ?? null,
      })
      continue
    }

    surfaces.push({
      id: tile.id,
      type: tile.type,
      title: tile.title,
      favicon: tile.type === "browser" ? (tile.favicon ?? null) : null,
      ...(tile.type === "devServer" && tile.devAppId
        ? { devAppId: tile.devAppId }
        : tile.type === "orgDevApp" && tile.publicationId
          ? { devAppId: tile.publicationId }
          : {}),
    })
  }

  return {
    laneId: workbench.laneId,
    activeTileId: workbench.activeTileId,
    agents,
    surfaces,
  }
}

export function selectVisibleActiveWorkbenchTileId(
  projectId: string | null | undefined,
  laneId?: string | null,
  workspaceId?: string | null,
) {
  return (state: ProjectWorkbenchState): string | null => {
    if (!projectId) return null

    const scopeKey = resolveWorkbenchScopeKey(state.workbenches, projectId, laneId, workspaceId)
    const workbench = state.workbenches[scopeKey] ?? null
    if (!workbench?.activeTileId) return null

    const activeTile = workbench.tiles[workbench.activeTileId]
    if (!activeTile || activeTile.type === "selection" || activeTile.type === "tasks") {
      return null
    }

    return activeTile.id
  }
}

export const useProjectWorkbenchStore = create<ProjectWorkbenchState>()(
  persist(
    immer((set) => ({
      workbenches: {},
      actions: {
        ensureWorkbench: (projectId, laneId, workspaceId) => {
          if (!projectId) return

          set((state) => {
            // resolveMutableWorkbenchState creates the workbench when missing,
            // promotes legacy scope keys, and fixes identity fields. Existing
            // workbenches are already sanitized at hydration (see
            // migratePersistedWorkbenchState), so reassigning a rebuilt object
            // here would notify every store subscriber on every call — e.g.
            // each sidebar click re-rendered all workbench tiles.
            resolveMutableWorkbenchState(state.workbenches, projectId, laneId, workspaceId)
          })
        },
        resetWorkbench: (projectId, laneId, workspaceId) => {
          if (!projectId) return
          set((state) => {
            const {
              scopeKey,
              normalizedLaneId,
              normalizedWorkspace,
            } = resolveMutableWorkbenchState(state.workbenches, projectId, laneId, workspaceId)
            state.workbenches[scopeKey] = createDefaultWorkbenchState(
              projectId,
              normalizedLaneId,
              normalizedWorkspace,
            )
          })
        },
        removeProject: (projectId) => {
          const normalizedProjectId = projectId.trim()
          if (!normalizedProjectId) return

          set((state) => {
            for (const [scopeKey, workbench] of Object.entries(state.workbenches)) {
              if (workbench.projectId === normalizedProjectId) {
                delete state.workbenches[scopeKey]
              }
            }
          })
          flushWorkbenchStorage()
        },
        cloneWorkspaceState: (projectId, fromWorkspace, toWorkspace) => {
          const normalizedTargetWorkspace = normalizeWorkspaceId(toWorkspace)
          if (!projectId || !normalizedTargetWorkspace) {
            return
          }

          set((state) => {
            const normalizedSourceWorkspace = normalizeWorkspaceId(fromWorkspace)
            const matchingWorkbenches = Object.values(state.workbenches).filter((workbench) => {
              if (workbench.projectId !== projectId) {
                return false
              }

              if (!normalizedSourceWorkspace) {
                return true
              }

              return normalizeWorkspaceId(workbench.workspaceId) === normalizedSourceWorkspace
            })

            for (const workbench of matchingWorkbenches) {
              const targetScopeKey = buildWorkbenchScopeKey(
                projectId,
                workbench.laneId,
                normalizedTargetWorkspace,
              )

              if (
                state.workbenches[targetScopeKey] &&
                !isEmptySelectionWorkbench(state.workbenches[targetScopeKey])
              ) {
                continue
              }

              state.workbenches[targetScopeKey] = cloneWorkbenchState(
                workbench,
                normalizedTargetWorkspace,
              )
            }
          })
        },
        addTile: (projectId, laneId, type, options = {}, workspaceId) => {
          let createdTileId = ""
          const startMark = markCozeaInteractionStart("workbench-add-tile", {
            laneId,
            projectId,
            tileType: type,
          })

          set((state) => {
            const { scopeKey, workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              workspaceId,
            )
            if (!workbench) {
              return
            }
            const tile = createTile(type, {
              ...options,
              title:
                type === "assistantChat"
                  ? buildAssistantTileTitle(workbench, options.title)
                  : options.title,
            })
            createdTileId = tile.id
            if (options.activate !== false) {
              workbench.activeTileId = tile.id
            }
            workbench.order.push(tile.id)
            workbench.tiles[tile.id] = tile
            state.workbenches[scopeKey] = workbench
          })

          markCozeaInteractionEnd("workbench-add-tile", startMark, {
            laneId,
            projectId,
            tileId: createdTileId || null,
            tileType: type,
          })
          return createdTileId
        },
        openSingletonTile: (projectId, laneId, type, options = {}, workspaceId) => {
          let resolvedTileId = ""
          let reusedExistingTile = false
          const startMark = markCozeaInteractionStart("workbench-open-singleton-tile", {
            laneId,
            projectId,
            tileType: type,
          })

          set((state) => {
            const { scopeKey, workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              workspaceId,
            )
            if (!workbench) {
              return
            }
            const existingTile = workbench.order
              .map((tileId) => workbench.tiles[tileId])
              .find((tile) => tile?.type === type)

            if (existingTile) {
              resolvedTileId = existingTile.id
              reusedExistingTile = true
              if (existingTile.type === "devServer") {
                applyDevAppMetadata(existingTile, options)
              }
              workbench.activeTileId = existingTile.id
              state.workbenches[scopeKey] = workbench
              return
            }

            const tile = createTile(type, options)
            resolvedTileId = tile.id
            workbench.activeTileId = tile.id
            workbench.order.push(tile.id)
            workbench.tiles[tile.id] = tile
            state.workbenches[scopeKey] = workbench
          })

          markCozeaInteractionEnd("workbench-open-singleton-tile", startMark, {
            laneId,
            projectId,
            reusedExistingTile,
            tileId: resolvedTileId || null,
            tileType: type,
          })
          return resolvedTileId
        },
        removeTile: (projectId, laneId, tileId, workspaceId) => {
          set((state) => {
            const { scopeKey, normalizedLaneId, workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              workspaceId,
              { createIfMissing: false },
            )
            if (!workbench || !workbench.tiles[tileId]) return

            delete workbench.tiles[tileId]
            const orderIndex = workbench.order.indexOf(tileId)
            if (orderIndex !== -1) workbench.order.splice(orderIndex, 1)

            if (workbench.order.length === 0) {
              state.workbenches[scopeKey] = createDefaultWorkbenchState(
                projectId,
                normalizedLaneId,
                workbench.workspaceId,
              )
              return
            }

            if (workbench.activeTileId === tileId) {
              const fallbackIndex = Math.min(
                orderIndex === -1 ? workbench.order.length - 1 : orderIndex,
                workbench.order.length - 1,
              )
              workbench.activeTileId = fallbackIndex >= 0 ? (workbench.order[fallbackIndex] ?? null) : null
            }
          })
        },
        setActiveTile: (projectId, laneId, tileId, workspaceId) => {
          const startMark = markCozeaInteractionStart("workbench-focus-tile", {
            laneId,
            projectId,
            tileId,
          })
          set((state) => {
            const { workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              workspaceId,
              { createIfMissing: false },
            )
            if (!workbench || workbench.activeTileId === tileId) return
            if (tileId !== null && !workbench.tiles[tileId]) return
            workbench.activeTileId = tileId
          })
          markCozeaInteractionEnd("workbench-focus-tile", startMark, {
            laneId,
            projectId,
            tileId,
          })
        },
        setLayoutSnapshot: (projectId, laneId, layout, workspaceId) => {
          set((state) => {
            const { workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              workspaceId,
              { createIfMissing: false },
            )
            if (!workbench) return
            workbench.layout = layout
          })
        },
        updateAssistantTile: (projectId, laneId, tileId, patch, workspaceId) => {
          set((state) => {
            const { workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              workspaceId,
              { createIfMissing: false },
            )
            const tile = workbench?.tiles[tileId]
            if (!workbench || !tile || tile.type !== "assistantChat") return

            let changed = false
            for (const key of [
              "title", "viewMode", "assistantProjectId", "threadId", "provider",
              "providerInstanceId", "model", "runtimeMode", "interactionMode", "agentLabel", "laneBinding",
            ] as const) {
              if (patch[key] !== undefined && patch[key] !== tile[key]) {
                ;(tile as unknown as Record<string, unknown>)[key] = patch[key]
                changed = true
              }
            }
            if (!changed) return
          })
        },
        updateBrowserTile: (projectId, laneId, tileId, patch, workspaceId) => {
          set((state) => {
            const { workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              workspaceId,
              { createIfMissing: false },
            )
            const tile = workbench?.tiles[tileId]
            if (!workbench || !tile || tile.type !== "browser") return

            if (patch.title !== undefined && patch.title !== tile.title) {
              tile.title = patch.title
            }

            if (patch.url !== undefined && patch.url !== tile.url) {
              tile.url = patch.url
            }

            if (patch.favicon !== undefined && patch.favicon !== tile.favicon) {
              tile.favicon = patch.favicon
            }

            if (patch.storageScope !== undefined && patch.storageScope !== tile.storageScope) {
              tile.storageScope = patch.storageScope
            }
          })
        },
        updateRuntimePreviewTile: (projectId, laneId, tileId, patch, workspaceId) => {
          set((state) => {
            const { workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              workspaceId,
              { createIfMissing: false },
            )
            const tile = workbench?.tiles[tileId]
            if (!workbench || !tile) return
            if (tile.type !== "devServer" && tile.type !== "mobileSimulator") return

            if (patch.viewMode !== undefined && patch.viewMode !== tile.viewMode) {
              tile.viewMode = patch.viewMode
            }

            if (
              patch.previewOverrideUrl !== undefined &&
              tile.type === "devServer" &&
              patch.previewOverrideUrl !== tile.previewOverrideUrl
            ) {
              tile.previewOverrideUrl = patch.previewOverrideUrl
            }

            if (
              patch.autoStart !== undefined &&
              tile.type === "devServer" &&
              patch.autoStart !== (tile.autoStart ?? false)
            ) {
              if (patch.autoStart) {
                tile.autoStart = true
              } else {
                delete tile.autoStart
              }
            }
          })
        },
        updateTileTitle: (projectId, laneId, tileId, title, workspaceId) => {
          set((state) => {
            const { workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              workspaceId,
              { createIfMissing: false },
            )
            const tile = workbench?.tiles[tileId]
            if (!workbench || !tile || tile.title === title) return
            tile.title = title
          })
        },
      },
    })),
    {
      name: "cozea:project-workbench",
      version: 5,
      storage: createJSONStorage(() => workbenchStorage),
      migrate: (persistedState) => migratePersistedWorkbenchState(persistedState),
      partialize: (state) => ({
        workbenches: sanitizePersistedWorkbenches(state.workbenches),
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...migratePersistedWorkbenchState(persistedState),
      }),
    },
  ),
)

if (import.meta.env.DEV && typeof window !== "undefined") {
  // Exposed for render-performance diagnostics (store emission counting).
  ;(window as unknown as Record<string, unknown>).__workbenchStore = useProjectWorkbenchStore
}
