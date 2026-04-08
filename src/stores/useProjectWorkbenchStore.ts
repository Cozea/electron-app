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

const debouncedLocalStorage = createDebouncedStorage(window.localStorage)

export type WorkbenchTileType =
  | "browser"
  | "terminal"
  | "devServer"
  | "selection"
  | "tasks"
  | "changes"
  | "assistantChat"

export type WorkbenchSelectionTileMode = "emptyState" | "edgePreview" | "seamPreview"
export type WorkbenchSelectionTileEdge = "left" | "right" | "top" | "bottom"

interface WorkbenchBaseTile {
  id: string
  type: WorkbenchTileType
  title: string
  createdAt: number
}

export interface WorkbenchBrowserTile extends WorkbenchBaseTile {
  type: "browser"
  url: string
  storageScope?: BrowserStorageScope
  linkedDevServerTileId?: string | null
}

export interface WorkbenchTerminalTile extends WorkbenchBaseTile {
  type: "terminal"
}

export interface WorkbenchDevServerTile extends WorkbenchBaseTile {
  type: "devServer"
  linkedBrowserTileId?: string | null
}

export interface WorkbenchSelectionTile extends WorkbenchBaseTile {
  type: "selection"
  mode: WorkbenchSelectionTileMode
  edge?: WorkbenchSelectionTileEdge | null
  referenceTileId?: string | null
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
  laneBinding?: "activeProjectPath" | "threadWorktree"
}

export type WorkbenchTile =
  | WorkbenchBrowserTile
  | WorkbenchTerminalTile
  | WorkbenchDevServerTile
  | WorkbenchSelectionTile
  | WorkbenchTasksTile
  | WorkbenchChangesTile
  | WorkbenchAssistantChatTile

export interface WorkbenchProjectState {
  projectId: string
  laneId: string
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
  linkedBrowserTileId?: string | null
  linkedDevServerTileId?: string | null
  selectionMode?: WorkbenchSelectionTileMode
  selectionEdge?: WorkbenchSelectionTileEdge | null
  selectionReferenceTileId?: string | null
  assistantProjectId?: string | null
  threadId?: string | null
  provider?: ProviderKind
  model?: string | null
  runtimeMode?: RuntimeMode
  interactionMode?: ProviderInteractionMode
  agentLabel?: string | null
  laneBinding?: "activeProjectPath" | "threadWorktree"
}

interface PersistedWorkbenchState {
  workbenches: Record<string, WorkbenchProjectState>
}

interface LegacyPersistedWorkbenchState {
  projects?: Record<string, WorkbenchProjectState>
}

interface ProjectWorkbenchState extends PersistedWorkbenchState {
  actions: {
    ensureWorkbench: (projectId: string, laneId: string) => void
    resetWorkbench: (projectId: string, laneId: string) => void
    addTile: (
      projectId: string,
      laneId: string,
      type: WorkbenchTileType,
      options?: CreateTileOptions,
    ) => string
    openSingletonTile: (
      projectId: string,
      laneId: string,
      type: Extract<WorkbenchTileType, "devServer">,
      options?: CreateTileOptions,
    ) => string
    removeTile: (projectId: string, laneId: string, tileId: string) => void
    setActiveTile: (projectId: string, laneId: string, tileId: string | null) => void
    setLayoutSnapshot: (
      projectId: string,
      laneId: string,
      layout: SerializedDockview | null,
    ) => void
    updateBrowserTile: (
      projectId: string,
      laneId: string,
      tileId: string,
      patch: Partial<Pick<WorkbenchBrowserTile, "url" | "title" | "storageScope" | "linkedDevServerTileId">>,
    ) => void
    updateDevServerTile: (
      projectId: string,
      laneId: string,
      tileId: string,
      patch: Partial<Pick<WorkbenchDevServerTile, "title" | "linkedBrowserTileId">>,
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
    ) => void
    updateTileTitle: (projectId: string, laneId: string, tileId: string, title: string) => void
  }
}

export const DEFAULT_WORKBENCH_LANE_ID = "collab"

const TILE_TITLES: Record<WorkbenchTileType, string> = {
  browser: "Browser",
  terminal: "Terminal",
  devServer: "Dev Server",
  selection: "Add Tile",
  tasks: "Tasks",
  changes: "Changes",
  assistantChat: "AI Agent",
}

const SINGLETON_TILE_TYPES = new Set<WorkbenchTileType>(["devServer"])

function normalizeLaneId(laneId: string | null | undefined): string {
  const normalized = laneId?.trim()
  return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKBENCH_LANE_ID
}

export function buildWorkbenchScopeKey(projectId: string, laneId?: string | null): string {
  return `${projectId}::${normalizeLaneId(laneId)}`
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
        url: options.url?.trim() ?? "",
        storageScope: options.storageScope ?? "workspace",
        linkedDevServerTileId: options.linkedDevServerTileId ?? null,
      }
    case "terminal":
      return { id, type, title, createdAt }
    case "devServer":
      return {
        id,
        type,
        title,
        createdAt,
        linkedBrowserTileId: options.linkedBrowserTileId ?? null,
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
        laneBinding: options.laneBinding ?? "activeProjectPath",
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

function createDefaultWorkbenchState(projectId: string, laneId: string): WorkbenchProjectState {
  const normalizedLaneId = normalizeLaneId(laneId)
  const selectionTile = createTile("selection", {
    selectionMode: "emptyState",
  }) as WorkbenchSelectionTile

  return {
    projectId,
    laneId: normalizedLaneId,
    activeTileId: selectionTile.id,
    layout: null,
    layoutResetKey: nextLayoutResetKey(),
    order: [selectionTile.id],
    tiles: {
      [selectionTile.id]: selectionTile,
    },
  }
}

function sanitizeWorkbenchState(workbench: WorkbenchProjectState): WorkbenchProjectState {
  const sanitizedTiles: Record<string, WorkbenchTile> = {}
  let removedObsoleteTile = false

  for (const [tileId, tile] of Object.entries(workbench.tiles ?? {})) {
    if (!tile || tile.type === "tasks" || tile.type === "changes") {
      removedObsoleteTile = true
      continue
    }

    if (tile.type === "assistantChat") {
      sanitizedTiles[tileId] = {
        ...tile,
        assistantProjectId: tile.assistantProjectId ?? null,
        threadId: tile.threadId ?? null,
        model: tile.model ?? null,
        runtimeMode: tile.runtimeMode ?? "full-access",
        interactionMode: tile.interactionMode ?? "default",
        agentLabel: tile.agentLabel ?? null,
        laneBinding: tile.laneBinding ?? "activeProjectPath",
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
      return createDefaultWorkbenchState(workbench.projectId, workbench.laneId)
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
      }
    }

    sanitizedOrder = [primarySelectionTileId]
  }

  if (sanitizedOrder.length === 0) {
    return createDefaultWorkbenchState(workbench.projectId, workbench.laneId)
  }

  const sanitizedActiveTileId =
    workbench.activeTileId && sanitizedTiles[workbench.activeTileId]
      ? workbench.activeTileId
      : (sanitizedOrder[0] ?? null)

  for (const tileId of sanitizedOrder) {
    const tile = sanitizedTiles[tileId]
    if (!tile) continue

    if (tile.type === "browser" && tile.linkedDevServerTileId && !sanitizedTiles[tile.linkedDevServerTileId]) {
      sanitizedTiles[tileId] = {
        ...tile,
        linkedDevServerTileId: null,
      }
    }

    if (tile.type === "devServer" && tile.linkedBrowserTileId && !sanitizedTiles[tile.linkedBrowserTileId]) {
      sanitizedTiles[tileId] = {
        ...tile,
        linkedBrowserTileId: null,
      }
    }
  }

  // Transient selection tiles can appear while the user is adding/splitting panels.
  // We strip them from persisted metadata, but they should not invalidate the
  // rest of the Dockview layout because that would cause split orientation and
  // sizing to fall back to the default rebuild on the next load.
  const shouldResetLayout = removedObsoleteTile

  return {
    projectId: workbench.projectId,
    laneId: normalizeLaneId(workbench.laneId),
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
      buildWorkbenchScopeKey(sanitizedWorkbench.projectId, sanitizedWorkbench.laneId),
      sanitizedWorkbench,
    ])
  }

  return Object.fromEntries(sanitizedEntries)
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
      return [[buildWorkbenchScopeKey(sanitizedWorkbench.projectId, sanitizedWorkbench.laneId), sanitizedWorkbench]]
    }),
  )

  return {
    workbenches: migratedWorkbenches,
  }
}

function withWorkbench(
  state: ProjectWorkbenchState,
  projectId: string,
  laneId: string,
): WorkbenchProjectState {
  const normalizedLaneId = normalizeLaneId(laneId)
  const scopeKey = buildWorkbenchScopeKey(projectId, normalizedLaneId)
  return state.workbenches[scopeKey] ?? createDefaultWorkbenchState(projectId, normalizedLaneId)
}

export function selectProjectWorkbench(
  projectId: string | null | undefined,
  laneId?: string | null,
) {
  return (state: ProjectWorkbenchState): WorkbenchProjectState | null => {
    if (!projectId) return null
    const scopeKey = buildWorkbenchScopeKey(projectId, laneId)
    return state.workbenches[scopeKey] ?? null
  }
}

export function selectProjectLaneWorkbenches(projectId: string | null | undefined) {
  return (state: ProjectWorkbenchState): Record<string, WorkbenchProjectState> => {
    if (!projectId) return {}

    return Object.fromEntries(
      Object.values(state.workbenches)
        .filter((workbench) => workbench.projectId === projectId)
        .map((workbench) => [workbench.laneId, workbench] as const),
    )
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
) {
  return (state: ProjectWorkbenchState): string | null => {
    if (!projectId) return null

    const scopeKey = buildWorkbenchScopeKey(projectId, laneId)
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
    immer((set, get) => ({
      workbenches: {},
      actions: {
        ensureWorkbench: (projectId, laneId) => {
          if (!projectId) return
          const normalizedLaneId = normalizeLaneId(laneId)
          const scopeKey = buildWorkbenchScopeKey(projectId, normalizedLaneId)

          set((state) => {
            const existing = state.workbenches[scopeKey]
            state.workbenches[scopeKey] = existing
              ? sanitizeWorkbenchState(existing)
              : createDefaultWorkbenchState(projectId, normalizedLaneId)
          })
        },
        resetWorkbench: (projectId, laneId) => {
          if (!projectId) return
          const normalizedLaneId = normalizeLaneId(laneId)
          const scopeKey = buildWorkbenchScopeKey(projectId, normalizedLaneId)
          set((state) => {
            state.workbenches[scopeKey] = createDefaultWorkbenchState(projectId, normalizedLaneId)
          })
        },
        addTile: (projectId, laneId, type, options = {}) => {
          let createdTileId = ""
          const normalizedLaneId = normalizeLaneId(laneId)
          const scopeKey = buildWorkbenchScopeKey(projectId, normalizedLaneId)

          set((state) => {
            const workbench = state.workbenches[scopeKey] ?? createDefaultWorkbenchState(projectId, normalizedLaneId)
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

          return createdTileId
        },
        openSingletonTile: (projectId, laneId, type, options = {}) => {
          const workbench = withWorkbench(get(), projectId, laneId)
          const existing = workbench.order.find((tileId) => workbench.tiles[tileId]?.type === type)
          if (existing) {
            get().actions.setActiveTile(projectId, laneId, existing)
            return existing
          }
          return get().actions.addTile(projectId, laneId, type, options)
        },
        removeTile: (projectId, laneId, tileId) => {
          const normalizedLaneId = normalizeLaneId(laneId)
          const scopeKey = buildWorkbenchScopeKey(projectId, normalizedLaneId)

          set((state) => {
            const workbench = state.workbenches[scopeKey]
            if (!workbench || !workbench.tiles[tileId]) return

            delete workbench.tiles[tileId]
            const orderIndex = workbench.order.indexOf(tileId)
            if (orderIndex !== -1) workbench.order.splice(orderIndex, 1)

            if (workbench.order.length === 0) {
              state.workbenches[scopeKey] = createDefaultWorkbenchState(projectId, normalizedLaneId)
              return
            }

            if (workbench.activeTileId === tileId) {
              workbench.activeTileId = workbench.order[workbench.order.length - 1] ?? null
            }
          })
        },
        setActiveTile: (projectId, laneId, tileId) => {
          const normalizedLaneId = normalizeLaneId(laneId)
          const scopeKey = buildWorkbenchScopeKey(projectId, normalizedLaneId)

          set((state) => {
            const workbench = state.workbenches[scopeKey]
            if (!workbench || workbench.activeTileId === tileId) return
            workbench.activeTileId = tileId
          })
        },
        setLayoutSnapshot: (projectId, laneId, layout) => {
          const normalizedLaneId = normalizeLaneId(laneId)
          const scopeKey = buildWorkbenchScopeKey(projectId, normalizedLaneId)

          set((state) => {
            const workbench = state.workbenches[scopeKey]
            if (!workbench) return
            workbench.layout = layout
          })
        },
        updateBrowserTile: (projectId, laneId, tileId, patch) => {
          const normalizedLaneId = normalizeLaneId(laneId)
          const scopeKey = buildWorkbenchScopeKey(projectId, normalizedLaneId)

          set((state) => {
            const workbench = state.workbenches[scopeKey]
            const tile = workbench?.tiles[tileId]
            if (!workbench || !tile || tile.type !== "browser") return

            let changed = false
            if (patch.title !== undefined && patch.title !== tile.title) {
              tile.title = patch.title
              changed = true
            }
            if (patch.url !== undefined && patch.url !== tile.url) {
              tile.url = patch.url
              changed = true
            }
            if (patch.storageScope !== undefined && patch.storageScope !== tile.storageScope) {
              tile.storageScope = patch.storageScope
              changed = true
            }
            if (patch.linkedDevServerTileId !== undefined && patch.linkedDevServerTileId !== tile.linkedDevServerTileId) {
              tile.linkedDevServerTileId = patch.linkedDevServerTileId
              changed = true
            }
            if (!changed) return
          })
        },
        updateDevServerTile: (projectId, laneId, tileId, patch) => {
          const normalizedLaneId = normalizeLaneId(laneId)
          const scopeKey = buildWorkbenchScopeKey(projectId, normalizedLaneId)

          set((state) => {
            const workbench = state.workbenches[scopeKey]
            const tile = workbench?.tiles[tileId]
            if (!workbench || !tile || tile.type !== "devServer") return

            let changed = false
            if (patch.title !== undefined && patch.title !== tile.title) {
              tile.title = patch.title
              changed = true
            }
            if (patch.linkedBrowserTileId !== undefined && patch.linkedBrowserTileId !== tile.linkedBrowserTileId) {
              tile.linkedBrowserTileId = patch.linkedBrowserTileId
              changed = true
            }
            if (!changed) return
          })
        },
        updateAssistantTile: (projectId, laneId, tileId, patch) => {
          const normalizedLaneId = normalizeLaneId(laneId)
          const scopeKey = buildWorkbenchScopeKey(projectId, normalizedLaneId)

          set((state) => {
            const workbench = state.workbenches[scopeKey]
            const tile = workbench?.tiles[tileId]
            if (!workbench || !tile || tile.type !== "assistantChat") return

            let changed = false
            for (const key of [
              "title", "assistantProjectId", "threadId", "provider",
              "model", "runtimeMode", "interactionMode", "agentLabel", "laneBinding",
            ] as const) {
              if (patch[key] !== undefined && patch[key] !== tile[key]) {
                (tile as Record<string, unknown>)[key] = patch[key]
                changed = true
              }
            }
            if (!changed) return
          })
        },
        updateTileTitle: (projectId, laneId, tileId, title) => {
          const normalizedLaneId = normalizeLaneId(laneId)
          const scopeKey = buildWorkbenchScopeKey(projectId, normalizedLaneId)

          set((state) => {
            const workbench = state.workbenches[scopeKey]
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
      storage: createJSONStorage(() => debouncedLocalStorage),
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

export function isWorkbenchSingletonTile(
  type: WorkbenchTileType,
): type is Extract<WorkbenchTileType, "devServer"> {
  return SINGLETON_TILE_TYPES.has(type)
}
