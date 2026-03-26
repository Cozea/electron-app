import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type AITerminalSidebarMode = 'closed' | 'panel' | 'fullscreen'

export const MIN_PANEL_WIDTH = 250
export const DEFAULT_PANEL_WIDTH = 400
export const MAX_DRAG_PANEL_WIDTH = 800

interface AITerminalSidebarState {
  mode: AITerminalSidebarMode
  panelWidth: number
  
  openPanel: () => void
  closePanel: () => void
  expandToFullscreen: () => void
  collapseToPanel: () => void
  setPanelWidth: (width: number) => void
  resetPanelWidth: () => void
}

export const useAITerminalStore = create<AITerminalSidebarState>()(
  persist(
    (set) => ({
      mode: 'closed',
      panelWidth: DEFAULT_PANEL_WIDTH,

      openPanel: () => set({ mode: 'panel' }),
      closePanel: () => set({ mode: 'closed' }),
      expandToFullscreen: () => set({ mode: 'fullscreen' }),
      collapseToPanel: () => set({ mode: 'panel' }),

      setPanelWidth: (width) =>
        set({
          panelWidth: Math.max(MIN_PANEL_WIDTH, Math.min(MAX_DRAG_PANEL_WIDTH, width)),
        }),
      resetPanelWidth: () => set({ panelWidth: DEFAULT_PANEL_WIDTH }),
    }),
    {
      name: 'cozea-ai-terminal-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mode: state.mode,
        panelWidth: state.panelWidth,
      }),
    }
  )
)
