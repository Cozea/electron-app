import { create } from "zustand"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"

import {
  CHANGES_TILE_MIN_WIDTH_COLLAPSED,
  CHANGES_TILE_MIN_WIDTH_EXPANDED,
} from "@/features/projects/lib/changesTileSizing"

const SIDEBAR_DEFAULT_WIDTH = CHANGES_TILE_MIN_WIDTH_COLLAPSED
const SIDEBAR_MAX_WIDTH = 1200

function createMemoryStorage(): StateStorage {
  const items = new Map<string, string>()
  return {
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => {
      items.set(name, value)
    },
    removeItem: (name) => {
      items.delete(name)
    },
  }
}

const sidebarStorage =
  typeof window === "undefined" ? createMemoryStorage() : window.localStorage

import type { ChangesViewMode } from "@/features/projects/components/changes/ChangesTypes"

interface ChangesSidebarState {
  isOpen: boolean
  width: number
  minWidth: number
  viewMode: ChangesViewMode
  actions: {
    open: () => void
    close: () => void
    toggle: () => void
    setWidth: (width: number) => void
    setMinWidth: (minWidth: number) => void
    setViewMode: (mode: ChangesViewMode) => void
  }
}

function clampWidth(value: number, minWidth: number): number {
  if (!Number.isFinite(value)) return minWidth
  return Math.min(Math.max(value, minWidth), SIDEBAR_MAX_WIDTH)
}

export const useChangesSidebarStore = create<ChangesSidebarState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      width: SIDEBAR_DEFAULT_WIDTH,
      minWidth: CHANGES_TILE_MIN_WIDTH_COLLAPSED,
      viewMode: 'diff',
      actions: {
        open: () => set({ isOpen: true }),
        close: () => set({ isOpen: false }),
        toggle: () => set((state) => ({ isOpen: !state.isOpen })),
        setWidth: (width) =>
          set((state) => ({ width: clampWidth(width, state.minWidth) })),
        setMinWidth: (minWidth) => {
          const normalized = Math.max(
            CHANGES_TILE_MIN_WIDTH_COLLAPSED,
            Math.min(minWidth, CHANGES_TILE_MIN_WIDTH_EXPANDED),
          )
          if (normalized === get().minWidth) return
          set((state) => ({
            minWidth: normalized,
            width: clampWidth(state.width, normalized),
          }))
        },
        setViewMode: (mode) => set({ viewMode: mode }),
      },
    }),
    {
      name: "cozea:changes-sidebar",
      version: 2,
      storage: createJSONStorage(() => sidebarStorage),
      partialize: (state) => ({
        isOpen: state.isOpen,
        width: state.width,
        viewMode: state.viewMode,
      }),
    },
  ),
)
