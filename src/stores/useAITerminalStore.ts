// @ts-nocheck
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type AITerminalSidebarMode = 'closed' | 'panel' | 'fullscreen'

export interface AIAgentSessionRecord {
  terminalId: string
  profileId: string
  profileName: string
  label: string
  command: string
  createdAt: number
}

export const MIN_PANEL_WIDTH = 250
export const DEFAULT_PANEL_WIDTH = 400
export const MAX_DRAG_PANEL_WIDTH = 800

interface AITerminalSidebarState {
  mode: AITerminalSidebarMode
  panelWidth: number
  activeSessionIdsByProject: Record<string, string | null>
  sessionsByProject: Record<string, AIAgentSessionRecord[]>
  openPanel: () => void
  closePanel: () => void
  expandToFullscreen: () => void
  collapseToPanel: () => void
  setPanelWidth: (width: number) => void
  resetPanelWidth: () => void
  upsertSession: (projectPath: string, session: AIAgentSessionRecord) => void
  removeSession: (projectPath: string, terminalId: string) => void
  setActiveSession: (projectPath: string, terminalId: string | null) => void
  resetProject: (projectPath: string) => void
}

export const useAITerminalStore = create<AITerminalSidebarState>()(
  persist(
    (set) => ({
      mode: 'closed',
      panelWidth: DEFAULT_PANEL_WIDTH,
      activeSessionIdsByProject: {},
      sessionsByProject: {},

      openPanel: () => set({ mode: 'panel' }),
      closePanel: () => set({ mode: 'closed' }),
      expandToFullscreen: () => set({ mode: 'fullscreen' }),
      collapseToPanel: () => set({ mode: 'panel' }),

      setPanelWidth: (width) =>
        set({
          panelWidth: Math.max(MIN_PANEL_WIDTH, Math.min(MAX_DRAG_PANEL_WIDTH, width)),
        }),
      resetPanelWidth: () => set({ panelWidth: DEFAULT_PANEL_WIDTH }),

      upsertSession: (projectPath, session) => {
        set((state) => {
          const currentSessions = state.sessionsByProject[projectPath] ?? []
          const nextSessions = [session, ...currentSessions.filter((item) => item.terminalId !== session.terminalId)]

          return {
            sessionsByProject: {
              ...state.sessionsByProject,
              [projectPath]: nextSessions,
            },
          }
        })
      },

      removeSession: (projectPath, terminalId) => {
        set((state) => {
          const currentSessions = state.sessionsByProject[projectPath] ?? []
          const nextSessions = currentSessions.filter((session) => session.terminalId !== terminalId)
          const nextActiveId = state.activeSessionIdsByProject[projectPath] === terminalId
            ? null
            : state.activeSessionIdsByProject[projectPath] ?? null

          return {
            sessionsByProject: {
              ...state.sessionsByProject,
              [projectPath]: nextSessions,
            },
            activeSessionIdsByProject: {
              ...state.activeSessionIdsByProject,
              [projectPath]: nextActiveId,
            },
          }
        })
      },

      setActiveSession: (projectPath, terminalId) => {
        set((state) => ({
          activeSessionIdsByProject: {
            ...state.activeSessionIdsByProject,
            [projectPath]: terminalId,
          },
        }))
      },

      resetProject: (projectPath) => {
        set((state) => {
          const sessionsByProject = { ...state.sessionsByProject }
          delete sessionsByProject[projectPath]

          const activeSessionIdsByProject = { ...state.activeSessionIdsByProject }
          delete activeSessionIdsByProject[projectPath]

          return {
            sessionsByProject,
            activeSessionIdsByProject,
          }
        })
      },
    }),
    {
      name: 'cozea-ai-terminal-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mode: state.mode,
        panelWidth: state.panelWidth,
      }),
    },
  ),
)
