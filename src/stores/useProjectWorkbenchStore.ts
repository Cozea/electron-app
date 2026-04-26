import type {
  ProviderInteractionMode,
  ProviderKind,
  RuntimeMode,
} from "@cozea/assistant-contracts"
import type { BrowserStorageScope } from "@shared/browserHostTypes"
import type { SerializedDockview } from "dockview"
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"

import {
  buildLegacyWorkspaceIdentityKey,
  buildWorkspaceIdentityKey,
  normalizeWorkspaceProjectPath,
} from "@/features/projects/workspaces/workspaceIdentity"
import { markCozeaInteractionEnd, markCozeaInteractionStart } from "@/lib/performance/marks"

const PERSIST_DEBOUNCE_MS = 500

function createDebouncedStorage(backing: Storage): StateStorage {
  let pending: string | null = null
  let pendingKey: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    getItem(name) {
      return backing.getItem(name)
    },
    setItem(name, value) {
      pendingKey = name
      pending = value
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (pending !== null && pendingKey !== null) {
          backing.setItem(pendingKey, pending)
          pending = null
          pendingKey = null
        }
      }, PERSIST_DEBOUNCE_MS)
    },
    removeItem(name) {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
        pending = null
        pendingKey = null
      }
      backing.removeItem(name)
    },
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
  | "selection"
  | "tasks"
  | "changes"
  | "assistantChat"

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

export interface WorkbenchTerminalTile extends WorkbenchBaseTile {
  type: "terminal"
}

export interface WorkbenchDevServerTile extends WorkbenchBaseTile {
  type: "devServer"
}

export interface WorkbenchMobileSimulatorTile extends WorkbenchBaseTile {
  type: "mobileSimulator"
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

export interface WorkbenchChangesTile extends WorkbenchBaseTile {
  type: "changes"
}

export interface WorkbenchAssistantChatTile extends WorkbenchBaseTile {
  type: "assistantChat"
  assistantProjectId?: string | null
  threadId?: string | null
  provider?: ProviderKind
  model?: string | null
  runtimeMode?: RuntimeMode
  interactionMode?: ProviderInteractionMode
  agentLabel?: string | null
  laneBinding?: "sessionProjectPath" | "threadWorktree"
}

export type WorkbenchTile =
  | WorkbenchBrowserTile
  | WorkbenchTerminalTile
  | WorkbenchDevServerTile
  | WorkbenchMobileSimulatorTile
  | WorkbenchSelectionTile
  | WorkbenchTasksTile
  | WorkbenchChangesTile
  | WorkbenchAssistantChatTile

export interface WorkbenchProjectState {
  projectId: string
  laneId: string
  projectPath: string | null
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
  type: Exclude<WorkbenchTileType, "assistantChat" | "selection" | "tasks" | "changes">
  title: string
  favicon?: string | null
}

export interface WorkbenchLaneSidebarSummary {
  laneId: string
  activeTileId: string | null
  agents: WorkbenchSidebarAssistantTileSummary[]
  surfaces: WorkbenchSidebarSurfaceTileSummary[]
}

interface CreateTileOptions {
  title?: string
  url?: string
  storageScope?: BrowserStorageScope
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
  model?: string | null
  runtimeMode?: RuntimeMode
  interactionMode?: ProviderInteractionMode
  agentLabel?: string | null
  laneBinding?: "sessionProjectPath" | "threadWorktree"
}

interface PersistedWorkbenchState {
  workbenches: Record<string, WorkbenchProjectState>
}

interface LegacyPersistedWorkbenchState {
  projects?: Record<string, WorkbenchProjectState>
}

interface ProjectWorkbenchState extends PersistedWorkbenchState {
  actions: {
    ensureWorkbench: (projectId: string, laneId: string, projectPath?: string | null) => void
    resetWorkbench: (projectId: string, laneId: string, projectPath?: string | null) => void
    cloneProjectPathState: (
      projectId: string,
      fromProjectPath?: string | null,
      toProjectPath?: string | null,
    ) => void
    addTile: (
      projectId: string,
      laneId: string,
      type: WorkbenchTileType,
      options?: CreateTileOptions,
      projectPath?: string | null,
    ) => string
    openSingletonTile: (
      projectId: string,
      laneId: string,
      type: Extract<WorkbenchTileType, "devServer" | "mobileSimulator">,
      options?: CreateTileOptions,
      projectPath?: string | null,
    ) => string
    removeTile: (projectId: string, laneId: string, tileId: string, projectPath?: string | null) => void
    setActiveTile: (projectId: string, laneId: string, tileId: string | null, projectPath?: string | null) => void
    setLayoutSnapshot: (
      projectId: string,
      laneId: string,
      layout: SerializedDockview | null,
      projectPath?: string | null,
    ) => void
    updateAssistantTile: (
      projectId: string,
      laneId: string,
      tileId: string,
        patch: Partial<
        Pick<
          WorkbenchAssistantChatTile,
          | "title"
          | "assistantProjectId"
          | "threadId"
          | "provider"
          | "model"
          | "runtimeMode"
          | "interactionMode"
          | "agentLabel"
          | "laneBinding"
        >
      >,
      projectPath?: string | null,
    ) => void
    updateBrowserTile: (
      projectId: string,
      laneId: string,
      tileId: string,
      patch: Partial<Pick<WorkbenchBrowserTile, "url" | "title" | "favicon" | "storageScope">>,
      projectPath?: string | null,
    ) => void
    updateTileTitle: (
      projectId: string,
      laneId: string,
      tileId: string,
      title: string,
      projectPath?: string | null,
    ) => void
  }
}

export const DEFAULT_WORKBENCH_LANE_ID = "collab"

const TILE_TITLES: Record<WorkbenchTileType, string> = {
  browser: "Browser",
  terminal: "Terminal",
  devServer: "Dev Server",
  mobileSimulator: "Mobile Simulator",
  selection: "Add DevApp",
  tasks: "Tasks",
  changes: "Changes",
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
  projectPath?: string | null,
): string {
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  if (!normalizedProjectPath) {
    return buildLegacyWorkbenchScopeKey(projectId, laneId)
  }

  return buildWorkspaceIdentityKey(projectId, normalizeLaneId(laneId), normalizedProjectPath)!
}

function resolveWorkbenchScopeKey(
  workbenches: Record<string, WorkbenchProjectState>,
  projectId: string,
  laneId?: string | null,
  projectPath?: string | null,
): string {
  const normalizedLaneId = normalizeLaneId(laneId)
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  const pathAwareScopeKey = buildWorkbenchScopeKey(projectId, normalizedLaneId, normalizedProjectPath)
  if (normalizedProjectPath && workbenches[pathAwareScopeKey]) {
    return pathAwareScopeKey
  }

  const legacyScopeKey = buildLegacyWorkbenchScopeKey(projectId, normalizedLaneId)
  if (workbenches[legacyScopeKey]) {
    return legacyScopeKey
  }

  if (!normalizedProjectPath) {
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
  projectPath?: string | null,
): string {
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  if (!normalizedProjectPath) {
    return buildLegacyWorkbenchScopeKey(projectId, laneId)
  }

  const pathAwareScopeKey = buildWorkbenchScopeKey(projectId, laneId, normalizedProjectPath)
  if (workbenches[pathAwareScopeKey]) {
    const existing = workbenches[pathAwareScopeKey]
    if (existing.projectPath !== normalizedProjectPath) {
      workbenches[pathAwareScopeKey] = {
        ...existing,
        projectPath: normalizedProjectPath,
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
    projectPath: normalizedProjectPath,
  })
  delete workbenches[legacyScopeKey]
  return pathAwareScopeKey
}

function resolveMutableWorkbenchState(
  workbenches: Record<string, WorkbenchProjectState>,
  projectId: string,
  laneId?: string | null,
  projectPath?: string | null,
  options?: {
    createIfMissing?: boolean
  },
): {
  scopeKey: string
  normalizedLaneId: string
  normalizedProjectPath: string | null
  workbench: WorkbenchProjectState | null
} {
  const normalizedLaneId = normalizeLaneId(laneId)
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  const scopeKey = normalizedProjectPath
    ? promoteLegacyWorkbenchIfNeeded(workbenches, projectId, normalizedLaneId, normalizedProjectPath)
    : resolveWorkbenchScopeKey(workbenches, projectId, normalizedLaneId, null)

  let workbench = workbenches[scopeKey] ?? null

  if (!workbench && options?.createIfMissing !== false) {
    workbench = createDefaultWorkbenchState(projectId, normalizedLaneId, normalizedProjectPath)
    workbenches[scopeKey] = workbench
    return {
      scopeKey,
      normalizedLaneId,
      normalizedProjectPath,
      workbench,
    }
  }

  if (workbench) {
    workbench.projectId = projectId
    workbench.laneId = normalizedLaneId
    if (normalizedProjectPath && workbench.projectPath !== normalizedProjectPath) {
      workbench.projectPath = normalizedProjectPath
    }
  }

  return {
    scopeKey,
    normalizedLaneId,
    normalizedProjectPath,
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
    case "devServer":
      return { id, type, title, createdAt }
    case "mobileSimulator":
      return { id, type, title, createdAt }
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
    case "changes":
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
        model: options.model ?? null,
        runtimeMode: options.runtimeMode ?? "full-access",
        interactionMode: options.interactionMode ?? "default",
        agentLabel: options.agentLabel ?? null,
        laneBinding: options.laneBinding ?? "sessionProjectPath",
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
  projectPath?: string | null,
): WorkbenchProjectState {
  const normalizedLaneId = normalizeLaneId(laneId)
  const selectionTile = createTile("selection", {
    selectionMode: "emptyState",
  }) as WorkbenchSelectionTile

  return {
    projectId,
    laneId: normalizedLaneId,
    projectPath: normalizeWorkspaceProjectPath(projectPath),
    activeTileId: selectionTile.id,
    layout: null,
    layoutResetKey: nextLayoutResetKey(),
    order: [selectionTile.id],
    tiles: {
      [selectionTile.id]: selectionTile,
    },
  }
}

function isEmptySelectionWorkbench(workbench: WorkbenchProjectState | null | undefined): boolean {
  if (!workbench || workbench.order.length !== 1) {
    return false
  }

  const onlyTile = workbench.tiles[workbench.order[0]!]
  return onlyTile?.type === "selection"
}

function sanitizeWorkbenchState(workbench: WorkbenchProjectState): WorkbenchProjectState {
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
          : "sessionProjectPath"
      sanitizedTiles[tileId] = {
        ...tile,
        assistantProjectId: tile.assistantProjectId ?? null,
        threadId: tile.threadId ?? null,
        model: tile.model ?? null,
        runtimeMode: tile.runtimeMode ?? "full-access",
        interactionMode: tile.interactionMode ?? "default",
        agentLabel: tile.agentLabel ?? null,
        laneBinding: normalizedLaneBinding,
      }
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

  const nonSelectionTileIds = sanitizedOrder.filter((tileId) => sanitizedTiles[tileId]?.type !== "selection")
  const selectionTileIds = sanitizedOrder.filter((tileId) => sanitizedTiles[tileId]?.type === "selection")

  if (nonSelectionTileIds.length > 0 && selectionTileIds.length > 0) {
    for (const tileId of selectionTileIds) {
      delete sanitizedTiles[tileId]
    }
    sanitizedOrder = nonSelectionTileIds
  } else if (nonSelectionTileIds.length === 0) {
    const primarySelectionTileId = selectionTileIds[0]
    if (!primarySelectionTileId) {
      return createDefaultWorkbenchState(workbench.projectId, workbench.laneId, workbench.projectPath)
    }

    for (const tileId of selectionTileIds.slice(1)) {
      delete sanitizedTiles[tileId]
    }

    const primaryTile = sanitizedTiles[primarySelectionTileId]
    if (primaryTile?.type === "selection" && primaryTile.mode !== "emptyState") {
      sanitizedTiles[primarySelectionTileId] = {
        ...primaryTile,
        mode: "emptyState",
        edge: null,
        referenceTileId: null,
        adjacentTileId: null,
        previewScope: null,
        previewTargetKind: null,
        previewTargetId: null,
      }
    }

    sanitizedOrder = [primarySelectionTileId]
  }

  if (sanitizedOrder.length === 0) {
    return createDefaultWorkbenchState(workbench.projectId, workbench.laneId, workbench.projectPath)
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
    projectPath: normalizeWorkspaceProjectPath(workbench.projectPath),
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

function sanitizePersistedWorkbenches(
  workbenches: Record<string, WorkbenchProjectState> | undefined,
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
        sanitizedWorkbench.projectPath,
      ),
      sanitizedWorkbench,
    ])
  }

  return Object.fromEntries(sanitizedEntries)
}

function cloneWorkbenchState(workbench: WorkbenchProjectState, projectPath: string): WorkbenchProjectState {
  return sanitizeWorkbenchState({
    ...workbench,
    projectPath,
    order: [...workbench.order],
    tiles: Object.fromEntries(
      Object.entries(workbench.tiles).map(([tileId, tile]) => [tileId, { ...tile }] as const),
    ),
  })
}

function migratePersistedWorkbenchState(
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
          sanitizedWorkbench.projectPath,
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
  projectPath?: string | null,
) {
  return (state: ProjectWorkbenchState): WorkbenchProjectState | null => {
    if (!projectId) return null
    const scopeKey = resolveWorkbenchScopeKey(state.workbenches, projectId, laneId, projectPath)
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
    if (!tile || tile.type === "selection" || tile.type === "tasks" || tile.type === "changes") {
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
  projectPath?: string | null,
) {
  return (state: ProjectWorkbenchState): string | null => {
    if (!projectId) return null

    const scopeKey = resolveWorkbenchScopeKey(state.workbenches, projectId, laneId, projectPath)
    const workbench = state.workbenches[scopeKey] ?? null
    if (!workbench?.activeTileId) return null

    const activeTile = workbench.tiles[workbench.activeTileId]
    if (!activeTile || activeTile.type === "selection" || activeTile.type === "tasks" || activeTile.type === "changes") {
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
        ensureWorkbench: (projectId, laneId, projectPath) => {
          if (!projectId) return

          set((state) => {
            const {
              scopeKey,
              normalizedLaneId,
              normalizedProjectPath,
              workbench,
            } = resolveMutableWorkbenchState(state.workbenches, projectId, laneId, projectPath)
            state.workbenches[scopeKey] = workbench
              ? sanitizeWorkbenchState(workbench)
              : createDefaultWorkbenchState(projectId, normalizedLaneId, normalizedProjectPath)
          })
        },
        resetWorkbench: (projectId, laneId, projectPath) => {
          if (!projectId) return
          set((state) => {
            const {
              scopeKey,
              normalizedLaneId,
              normalizedProjectPath,
            } = resolveMutableWorkbenchState(state.workbenches, projectId, laneId, projectPath)
            state.workbenches[scopeKey] = createDefaultWorkbenchState(
              projectId,
              normalizedLaneId,
              normalizedProjectPath,
            )
          })
        },
        cloneProjectPathState: (projectId, fromProjectPath, toProjectPath) => {
          const normalizedTargetProjectPath = normalizeWorkspaceProjectPath(toProjectPath)
          if (!projectId || !normalizedTargetProjectPath) {
            return
          }

          set((state) => {
            const normalizedSourceProjectPath = normalizeWorkspaceProjectPath(fromProjectPath)
            const matchingWorkbenches = Object.values(state.workbenches).filter((workbench) => {
              if (workbench.projectId !== projectId) {
                return false
              }

              if (!normalizedSourceProjectPath) {
                return true
              }

              return normalizeWorkspaceProjectPath(workbench.projectPath) === normalizedSourceProjectPath
            })

            for (const workbench of matchingWorkbenches) {
              const targetScopeKey = buildWorkbenchScopeKey(
                projectId,
                workbench.laneId,
                normalizedTargetProjectPath,
              )

              if (
                state.workbenches[targetScopeKey] &&
                !isEmptySelectionWorkbench(state.workbenches[targetScopeKey])
              ) {
                continue
              }

              state.workbenches[targetScopeKey] = cloneWorkbenchState(
                workbench,
                normalizedTargetProjectPath,
              )
            }
          })
        },
        addTile: (projectId, laneId, type, options = {}, projectPath) => {
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
              projectPath,
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
            workbench.activeTileId = tile.id
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
        openSingletonTile: (projectId, laneId, type, options = {}, projectPath) => {
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
              projectPath,
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
        removeTile: (projectId, laneId, tileId, projectPath) => {
          set((state) => {
            const { scopeKey, normalizedLaneId, workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              projectPath,
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
                workbench.projectPath,
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
        setActiveTile: (projectId, laneId, tileId, projectPath) => {
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
              projectPath,
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
        setLayoutSnapshot: (projectId, laneId, layout, projectPath) => {
          set((state) => {
            const { workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              projectPath,
              { createIfMissing: false },
            )
            if (!workbench) return
            workbench.layout = layout
          })
        },
        updateAssistantTile: (projectId, laneId, tileId, patch, projectPath) => {
          set((state) => {
            const { workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              projectPath,
              { createIfMissing: false },
            )
            const tile = workbench?.tiles[tileId]
            if (!workbench || !tile || tile.type !== "assistantChat") return

            let changed = false
            for (const key of [
              "title", "assistantProjectId", "threadId", "provider",
              "model", "runtimeMode", "interactionMode", "agentLabel", "laneBinding",
            ] as const) {
              if (patch[key] !== undefined && patch[key] !== tile[key]) {
                ;(tile as unknown as Record<string, unknown>)[key] = patch[key]
                changed = true
              }
            }
            if (!changed) return
          })
        },
        updateBrowserTile: (projectId, laneId, tileId, patch, projectPath) => {
          set((state) => {
            const { workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              projectPath,
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
        updateTileTitle: (projectId, laneId, tileId, title, projectPath) => {
          set((state) => {
            const { workbench } = resolveMutableWorkbenchState(
              state.workbenches,
              projectId,
              laneId,
              projectPath,
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
      version: 2,
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
