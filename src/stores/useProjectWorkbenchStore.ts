import type { SerializedDockview } from "dockview"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

export type WorkbenchTileType =
  | "browser"
  | "terminal"
  | "devServer"
  | "tasks"
  | "changes"
  | "assistantChat"

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

export interface WorkbenchTasksTile extends WorkbenchBaseTile {
  type: "tasks"
}

export interface WorkbenchChangesTile extends WorkbenchBaseTile {
  type: "changes"
}

export interface WorkbenchAssistantChatTile extends WorkbenchBaseTile {
  type: "assistantChat"
}

export type WorkbenchTile =
  | WorkbenchBrowserTile
  | WorkbenchTerminalTile
  | WorkbenchDevServerTile
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
    updateTileTitle: (projectId: string, tileId: string, title: string) => void
  }
}

const TILE_TITLES: Record<WorkbenchTileType, string> = {
  browser: "Browser",
  terminal: "Terminal",
  devServer: "Dev Server",
  tasks: "Tasks",
  changes: "Changes",
  assistantChat: "AI Chat",
}

const SINGLETON_TILE_TYPES = new Set<WorkbenchTileType>(["devServer", "assistantChat"])

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
    case "tasks":
    case "changes":
    case "assistantChat":
      return { id, type, title, createdAt }
    default:
      return { id, type, title, createdAt }
  }
}

function createDefaultProjectState(projectId: string): WorkbenchProjectState {
  const createdAt = Date.now()
  const browserId = createTileId("browser")
  const terminalId = createTileId("terminal")
  const devServerId = createTileId("devServer")

  const browserTile: WorkbenchBrowserTile = {
    id: browserId,
    type: "browser",
    title: "Browser",
    createdAt,
    url: "",
    linkedDevServerTileId: devServerId,
  }

  const terminalTile: WorkbenchTerminalTile = {
    id: terminalId,
    type: "terminal",
    title: "Terminal",
    createdAt,
  }

  const devServerTile: WorkbenchDevServerTile = {
    id: devServerId,
    type: "devServer",
    title: "Dev Server",
    createdAt,
    linkedBrowserTileId: browserId,
  }

  return {
    projectId,
    activeTileId: browserId,
    layout: null,
    layoutResetKey: nextLayoutResetKey(),
    order: [browserId, terminalId, devServerId],
    tiles: {
      [browserId]: browserTile,
      [terminalId]: terminalTile,
      [devServerId]: devServerTile,
    },
  }
}

function sanitizeProjectState(project: WorkbenchProjectState): WorkbenchProjectState {
  const sanitizedTiles: Record<string, WorkbenchTile> = {}
  let removedObsoleteTile = false

  for (const [tileId, tile] of Object.entries(project.tiles ?? {})) {
    if (!tile || tile.type === "tasks" || tile.type === "changes") {
      removedObsoleteTile = true
      continue
    }
    sanitizedTiles[tileId] = tile
  }

  const sanitizedOrder = (project.order ?? []).filter((tileId) => Boolean(sanitizedTiles[tileId]))
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
    layout: removedObsoleteTile ? null : isSerializedDockview(project.layout) ? project.layout : null,
    layoutResetKey: removedObsoleteTile
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
          const tile = createTile(type, options)

          set((state) => {
            const project = withProject(state, projectId)
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

          return tile.id
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

export function isWorkbenchSingletonTile(type: WorkbenchTileType): boolean {
  return SINGLETON_TILE_TYPES.has(type)
}
