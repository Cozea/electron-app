import { useEffect } from "react"
import { create } from "zustand"

import type { SidebarActivity } from "@/features/projects/ui/sidebar/sidebarActivity"

/**
 * Runtime execution state published by workbench tiles, keyed by tile id.
 *
 * Tiles that own a process (DevApp preview, org DevApp, terminal) keep their
 * status in local component state, which the sidebar cannot read. They mirror it
 * here so the sidebar can animate rows for processes it does not itself manage.
 * Deliberately not persisted: a process is not running just because the app
 * restarted. Entries are cleared on tile unmount.
 */
interface TileActivityState {
  activityByTileId: Record<string, SidebarActivity>
  actions: {
    setTileActivity: (tileId: string, activity: SidebarActivity) => void
    clearTileActivity: (tileId: string) => void
  }
}

export const useTileActivityStore = create<TileActivityState>()((set) => ({
  activityByTileId: {},
  actions: {
    setTileActivity: (tileId, activity) =>
      set((state) => {
        if (state.activityByTileId[tileId] === activity) return state
        return {
          activityByTileId: { ...state.activityByTileId, [tileId]: activity },
        }
      }),
    clearTileActivity: (tileId) =>
      set((state) => {
        if (!(tileId in state.activityByTileId)) return state
        const next = { ...state.activityByTileId }
        delete next[tileId]
        return { activityByTileId: next }
      }),
  },
}))

export const useTileActivityActions = () => useTileActivityStore((state) => state.actions)

export function selectTileActivity(tileId: string) {
  return (state: TileActivityState): SidebarActivity =>
    state.activityByTileId[tileId] ?? "idle"
}

/**
 * Mirrors a tile's own execution state into the store for as long as the tile is
 * mounted, and withdraws it on unmount so a torn-down tile stops animating rows.
 */
export function usePublishTileActivity(tileId: string, activity: SidebarActivity): void {
  const actions = useTileActivityStore((state) => state.actions)

  useEffect(() => {
    actions.setTileActivity(tileId, activity)
  }, [actions, activity, tileId])

  useEffect(() => {
    return () => actions.clearTileActivity(tileId)
  }, [actions, tileId])
}
