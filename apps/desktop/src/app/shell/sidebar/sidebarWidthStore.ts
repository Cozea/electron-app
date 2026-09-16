import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

export const SIDEBAR_MIN_WIDTH_PX = 192 // 12rem — tree labels stay legible
export const SIDEBAR_MAX_WIDTH_PX = 384 // 24rem — protects the workbench
export const SIDEBAR_DEFAULT_WIDTH_PX = 224 // 14rem — historical default

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH_PX, Math.max(SIDEBAR_MIN_WIDTH_PX, width)))
}

interface SidebarWidthState {
  /** One width for the app sidebar across all surfaces; null = default. */
  width: number | null
  setWidth: (width: number) => void
}

export const useSidebarWidthStore = create<SidebarWidthState>()(
  persist(
    (set) => ({
      width: null,
      setWidth: (width) => set({ width: clampSidebarWidth(width) }),
    }),
    {
      name: "cozea-sidebar-widths",
      version: 1,
      storage: createJSONStorage(() => window.localStorage),
    },
  ),
)
