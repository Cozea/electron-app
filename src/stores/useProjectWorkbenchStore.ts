import type {
  ProviderInteractionMode,
  ProviderKind,
  RuntimeMode,
} from "@cozea/assistant-contracts"
import type { SerializedDockview } from "dockview"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

export type WorkbenchTileType =
  | "browser"
  | "terminal"
  | "devServer"
  | "selection"
  | "tasks"
  | "changes"
  | "assistantChat"

export type WorkbenchSelectionTileMode = "emptyState" | "edgePreview"
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
  tiles: Record<string, WorkbenchTile>
  order: string[]
  activeTileId: string | null
  layout: SerializedDockview | null
  layoutResetKey: number
}

interface CreateTileOptions {
  title?: string
  url?: string
  linkedBrowserTileId?: string | null
  linkedDevServerTileId?: string | null
  selectionMode?: WorkbenchSelectionTileMode
  selectionEdge?: WorkbenchSelectionTileEdge | null
  assistantProjectId?: string | null
  threadId?: string | null
  provider?: ProviderKind
  model?: string | null
  runtimeMode?: RuntimeMode
  interactionMode?: ProviderInteractionMode
  agentLabel?: string | null
  laneBinding?: "activeProjectPath" | "threadWorktree"
}

interface ProjectWorkbenchState {
  projects: Record<string, WorkbenchProjectState>
  actions: {
    ensureProject: (projectId: string) => void
    resetProject: (projectId: string) => void
    addTile: (projectId: string, type: WorkbenchTileType, options?: CreateTileOptions) => string
    openSingletonTile: (
      projectId: string,
      type: Extract<WorkbenchTileType, "devServer" | "assistantChat">,
      options?: CreateTileOptions,
    ) => string
    removeTile: (projectId: string, tileId: string) => void
    setActiveTile: (projectId: string, tileId: string | null) => void
    setLayoutSnapshot: (projectId: string, layout: SerializedDockview | null) => void
    updateBrowserTile: (
      projectId: string,
      tileId: string,
      patch: Partial<Pick<WorkbenchBrowserTile, "url" | "title" | "linkedDevServerTileId">>,
    ) => void
    updateDevServerTile: (
      projectId: string,
      tileId: string,
      patch: Partial<Pick<WorkbenchDevServerTile, "title" | "linkedBrowserTileId">>,
    ) => void
    updateAssistantTile: (
      projectId: string,
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
    updateTileTitle: (projectId: string, tileId: string, title: string) => void
  }
}

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
  project: WorkbenchProjectState,
  requestedTitle?: string,
): string {
  const normalized = requestedTitle?.trim()
  if (normalized) {
    return normalized
  }

  const assistantCount = project.order.reduce((count, tileId) => {
    return project.tiles[tileId]?.type === "assistantChat" ? count + 1 : count
  }, 0)

  return assistantCount <= 0 ? TILE_TITLES.assistantChat : `${TILE_TITLES.assistantChat} ${assistantCount + 1}`
}

function createDefaultProjectState(projectId: string): WorkbenchProjectState {
  const selectionTile = createTile("selection", {
    selectionMode: "emptyState",
  }) as WorkbenchSelectionTile

  return {
    projectId,
    activeTileId: selectionTile.id,
    layout: null,
    layoutResetKey: nextLayoutResetKey(),
    order: [selectionTile.id],
    tiles: {
      [selectionTile.id]: selectionTile,
    },
  }
}

function sanitizeProjectState(project: WorkbenchProjectState): WorkbenchProjectState {
  const sanitizedTiles: Record<string, WorkbenchTile> = {}
  let removedObsoleteTile = false
  let removedSelectionTiles = false

  for (const [tileId, tile] of Object.entries(project.tiles ?? {})) {
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

  let sanitizedOrder = (project.order ?? []).filter((tileId) => Boolean(sanitizedTiles[tileId]))

  const nonSelectionTileIds = sanitizedOrder.filter((tileId) => sanitizedTiles[tileId]?.type !== "selection")
  const selectionTileIds = sanitizedOrder.filter((tileId) => sanitizedTiles[tileId]?.type === "selection")

  if (nonSelectionTileIds.length > 0 && selectionTileIds.length > 0) {
    removedSelectionTiles = true
    for (const tileId of selectionTileIds) {
      delete sanitizedTiles[tileId]
    }
    sanitizedOrder = nonSelectionTileIds
  } else if (nonSelectionTileIds.length === 0) {
    const primarySelectionTileId = selectionTileIds[0]
    if (!primarySelectionTileId) {
      return createDefaultProjectState(project.projectId)
    }

    for (const tileId of selectionTileIds.slice(1)) {
      removedSelectionTiles = true
      delete sanitizedTiles[tileId]
    }

    const primaryTile = sanitizedTiles[primarySelectionTileId]
    if (primaryTile?.type === "selection" && primaryTile.mode !== "emptyState") {
      sanitizedTiles[primarySelectionTileId] = {
        ...primaryTile,
        mode: "emptyState",
        edge: null,
      }
      removedSelectionTiles = true
    }

    sanitizedOrder = [primarySelectionTileId]
  }

  if (sanitizedOrder.length === 0) {
    return createDefaultProjectState(project.projectId)
  }

  const sanitizedActiveTileId =
    project.activeTileId && sanitizedTiles[project.activeTileId]
      ? project.activeTileId
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

  return {
    projectId: project.projectId,
    activeTileId: sanitizedActiveTileId,
    layout:
      removedObsoleteTile || removedSelectionTiles
        ? null
        : isSerializedDockview(project.layout)
          ? project.layout
          : null,
    layoutResetKey: removedObsoleteTile || removedSelectionTiles
      ? nextLayoutResetKey()
      : typeof project.layoutResetKey === "number"
        ? project.layoutResetKey
        : 0,
    order: sanitizedOrder,
    tiles: sanitizedTiles,
  }
}

function withProject(state: ProjectWorkbenchState, projectId: string): WorkbenchProjectState {
  return state.projects[projectId] ?? createDefaultProjectState(projectId)
}

export function selectProjectWorkbench(projectId: string | null | undefined) {
  return (state: ProjectWorkbenchState): WorkbenchProjectState | null =>
    projectId ? state.projects[projectId] ?? null : null
}

export const useProjectWorkbenchStore = create<ProjectWorkbenchState>()(
  persist(
    (set, get) => ({
      projects: {},
      actions: {
        ensureProject: (projectId) => {
          if (!projectId) return
          set((state) => {
            const existing = state.projects[projectId]
            if (existing) {
              const sanitized = sanitizeProjectState(existing)
              if (sanitized === existing) return state
              return {
                projects: {
                  ...state.projects,
                  [projectId]: sanitized,
                },
              }
            }

            return {
              projects: {
                ...state.projects,
                [projectId]: createDefaultProjectState(projectId),
              },
            }
          })
        },
        resetProject: (projectId) => {
          if (!projectId) return
          set((state) => ({
            projects: {
              ...state.projects,
              [projectId]: createDefaultProjectState(projectId),
            },
          }))
        },
        addTile: (projectId, type, options = {}) => {
          let createdTileId = ""

          set((state) => {
            const project = withProject(state, projectId)
            const tile = createTile(type, {
              ...options,
              title:
                type === "assistantChat"
                  ? buildAssistantTileTitle(project, options.title)
                  : options.title,
            })
            createdTileId = tile.id
            return {
              projects: {
                ...state.projects,
                [projectId]: {
                  ...project,
                  activeTileId: tile.id,
                  order: [...project.order, tile.id],
                  tiles: {
                    ...project.tiles,
                    [tile.id]: tile,
                  },
                },
              },
            }
          })

          return createdTileId
        },
        openSingletonTile: (projectId, type, options = {}) => {
          const project = withProject(get(), projectId)
          const existing = project.order.find((tileId) => project.tiles[tileId]?.type === type)
          if (existing) {
            get().actions.setActiveTile(projectId, existing)
            return existing
          }
          return get().actions.addTile(projectId, type, options)
        },
        removeTile: (projectId, tileId) => {
          set((state) => {
            const project = state.projects[projectId]
            if (!project || !project.tiles[tileId]) return state
            const { [tileId]: _removed, ...remainingTiles } = project.tiles
            const order = project.order.filter((id) => id !== tileId)

            if (order.length === 0) {
              return {
                projects: {
                  ...state.projects,
                  [projectId]: createDefaultProjectState(projectId),
                },
              }
            }

            const nextActiveTileId =
              project.activeTileId === tileId ? (order[order.length - 1] ?? null) : project.activeTileId

            return {
              projects: {
                ...state.projects,
                [projectId]: {
                  ...project,
                  tiles: remainingTiles,
                  order,
                  activeTileId: nextActiveTileId,
                },
              },
            }
          })
        },
        setActiveTile: (projectId, tileId) => {
          set((state) => {
            const project = state.projects[projectId]
            if (!project || project.activeTileId === tileId) return state
            return {
              projects: {
                ...state.projects,
                [projectId]: {
                  ...project,
                  activeTileId: tileId,
                },
              },
            }
          })
        },
        setLayoutSnapshot: (projectId, layout) => {
          set((state) => {
            const project = state.projects[projectId]
            if (!project) return state
            return {
              projects: {
                ...state.projects,
                [projectId]: {
                  ...project,
                  layout,
                },
              },
            }
          })
        },
        updateBrowserTile: (projectId, tileId, patch) => {
          set((state) => {
            const project = state.projects[projectId]
            const tile = project?.tiles[tileId]
            if (!project || !tile || tile.type !== "browser") return state

            const nextTile: WorkbenchBrowserTile = {
              ...tile,
              ...patch,
            }

            if (
              nextTile.title === tile.title &&
              nextTile.url === tile.url &&
              nextTile.linkedDevServerTileId === tile.linkedDevServerTileId
            ) {
              return state
            }

            return {
              projects: {
                ...state.projects,
                [projectId]: {
                  ...project,
                  tiles: {
                    ...project.tiles,
                    [tileId]: nextTile,
                  },
                },
              },
            }
          })
        },
        updateDevServerTile: (projectId, tileId, patch) => {
          set((state) => {
            const project = state.projects[projectId]
            const tile = project?.tiles[tileId]
            if (!project || !tile || tile.type !== "devServer") return state

            const nextTile: WorkbenchDevServerTile = {
              ...tile,
              ...patch,
            }

            if (
              nextTile.title === tile.title &&
              nextTile.linkedBrowserTileId === tile.linkedBrowserTileId
            ) {
              return state
            }

            return {
              projects: {
                ...state.projects,
                [projectId]: {
                  ...project,
                  tiles: {
                    ...project.tiles,
                    [tileId]: nextTile,
                  },
                },
              },
            }
          })
        },
        updateAssistantTile: (projectId, tileId, patch) => {
          set((state) => {
            const project = state.projects[projectId]
            const tile = project?.tiles[tileId]
            if (!project || !tile || tile.type !== "assistantChat") return state

            const nextTile: WorkbenchAssistantChatTile = {
              ...tile,
              ...patch,
            }

            if (
              nextTile.title === tile.title &&
              nextTile.assistantProjectId === tile.assistantProjectId &&
              nextTile.threadId === tile.threadId &&
              nextTile.provider === tile.provider &&
              nextTile.model === tile.model &&
              nextTile.runtimeMode === tile.runtimeMode &&
              nextTile.interactionMode === tile.interactionMode &&
              nextTile.agentLabel === tile.agentLabel &&
              nextTile.laneBinding === tile.laneBinding
            ) {
              return state
            }

            return {
              projects: {
                ...state.projects,
                [projectId]: {
                  ...project,
                  tiles: {
                    ...project.tiles,
                    [tileId]: nextTile,
                  },
                },
              },
            }
          })
        },
        updateTileTitle: (projectId, tileId, title) => {
          set((state) => {
            const project = state.projects[projectId]
            const tile = project?.tiles[tileId]
            if (!project || !tile || tile.title === title) return state

            return {
              projects: {
                ...state.projects,
                [projectId]: {
                  ...project,
                  tiles: {
                    ...project.tiles,
                    [tileId]: {
                      ...tile,
                      title,
                    },
                  },
                },
              },
            }
          })
        },
      },
    }),
    {
      name: "cozea:project-workbench",
      storage: createJSONStorage(() => window.localStorage),
      partialize: (state) => ({
        projects: Object.fromEntries(
          Object.entries(state.projects).map(([projectId, project]) => [projectId, sanitizeProjectState(project)]),
        ),
      }),
    },
  ),
)

export function isWorkbenchSingletonTile(
  type: WorkbenchTileType,
): type is Extract<WorkbenchTileType, "devServer" | "assistantChat"> {
  return SINGLETON_TILE_TYPES.has(type)
}
