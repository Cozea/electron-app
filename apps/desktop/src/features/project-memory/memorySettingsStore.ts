import { create } from "zustand"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"

/**
 * Per-workspace Memory settings: which skill powers the map, and which agent
 * refreshes it by default.
 *
 * memory-skill ships with Cozea and needs nothing installed, so it is the
 * default. The choice is the user's: any skill in their library can drive the
 * map — graphify once they install it, or one they wrote. The selection is per
 * workspace, since one machine can hold projects with different setups.
 */

export const DEFAULT_MEMORY_SKILL_LABEL = "memory-skill"

/** Where the legend and filter chips sit around the map. */
export type MemoryLegendPosition = "top" | "bottom" | "left" | "right"

export const MEMORY_LEGEND_POSITIONS: MemoryLegendPosition[] = ["top", "bottom", "left", "right"]

export const DEFAULT_MEMORY_LEGEND_POSITION: MemoryLegendPosition = "top"

interface MemorySettingsState {
  /** Workspace id -> chosen skill id. Absent means the built-in default. */
  byWorkspace: Record<string, string>
  /**
   * Workspace id -> preferred agent key (provider, else label). Tile ids are
   * not durable — they change whenever a tile is recreated — so the preference
   * is stored against something that survives a restart.
   */
  agentByWorkspace: Record<string, string>
  /** A wide legend crowds the top strip; a tall one suits a side rail. */
  legendByWorkspace: Record<string, MemoryLegendPosition>
  setForWorkspace: (workspaceId: string, skillId: string | null) => void
  setDefaultAgent: (workspaceId: string, agentKey: string | null) => void
  setLegendPosition: (workspaceId: string, position: MemoryLegendPosition) => void
}

function createMemoryStorage(): StateStorage {
  const values = new Map<string, string>()
  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value)
    },
    removeItem: (name) => {
      values.delete(name)
    },
  }
}

const storage =
  typeof window !== "undefined" && typeof window.localStorage?.getItem === "function"
    ? window.localStorage
    : createMemoryStorage()

export const useMemorySettingsStore = create<MemorySettingsState>()(
  persist(
    (set) => ({
      byWorkspace: {},
      agentByWorkspace: {},
      legendByWorkspace: {},
      setForWorkspace: (workspaceId, skillId) => {
        const normalized = workspaceId.trim()
        if (!normalized) return
        set((state) => {
          const next = { ...state.byWorkspace }
          if (skillId) next[normalized] = skillId
          else delete next[normalized]
          return { byWorkspace: next }
        })
      },
      setLegendPosition: (workspaceId, position) => {
        const normalized = workspaceId.trim()
        if (!normalized) return
        set((state) => ({
          legendByWorkspace: { ...state.legendByWorkspace, [normalized]: position },
        }))
      },
      setDefaultAgent: (workspaceId, agentKey) => {
        const normalized = workspaceId.trim()
        if (!normalized) return
        set((state) => {
          const next = { ...state.agentByWorkspace }
          if (agentKey) next[normalized] = agentKey
          else delete next[normalized]
          return { agentByWorkspace: next }
        })
      },
    }),
    {
      name: "cozea:memory-settings",
      version: 1,
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({
        byWorkspace: state.byWorkspace,
        agentByWorkspace: state.agentByWorkspace,
        legendByWorkspace: state.legendByWorkspace,
      }),
    },
  ),
)

export function getMemorySkillId(workspaceId: string | null): string | null {
  if (!workspaceId) return null
  return useMemorySettingsStore.getState().byWorkspace[workspaceId] ?? null
}
