import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { TerminalProfile } from '@/types/electron'

// Panel height constraints
const MIN_PANEL_HEIGHT = 150
const MAX_PANEL_HEIGHT = 600
const DEFAULT_PANEL_HEIGHT = 250

export interface TerminalInstance {
  id: string
  profileId: string
  profileName: string
  title: string
  status: 'starting' | 'running' | 'exited' | 'error'
  exitCode?: number | null
  hasOutput: boolean
}

export interface TerminalGroup {
  id: string
  terminalIds: string[]  // Terminal IDs in this split group
  splitDirection: 'horizontal' | 'vertical' | null
  activeTerminalId: string | null
}

interface TerminalState {
  // All terminal instances
  terminals: Record<string, TerminalInstance>

  // Groups (for split view)
  groups: Record<string, TerminalGroup>

  // Active group
  activeGroupId: string | null

  // Panel state
  isMaximized: boolean
  isPanelOpen: boolean
  panelHeight: number

  // Available profiles (loaded from main process)
  profiles: TerminalProfile[]

  // Actions
  actions: {
    // Terminal management
    addTerminal: (terminal: TerminalInstance, groupId?: string) => string
    removeTerminal: (terminalId: string) => void
    updateTerminalStatus: (terminalId: string, status: TerminalInstance['status'], exitCode?: number | null) => void
    updateTerminalTitle: (terminalId: string, title: string) => void
    setTerminalHasOutput: (terminalId: string, hasOutput: boolean) => void

    // Group management
    createGroup: () => string
    setActiveGroup: (groupId: string) => void
    setActiveTerminal: (terminalId: string) => void
    splitTerminal: (terminalId: string, direction: 'horizontal' | 'vertical') => void

    // Panel state
    setMaximized: (isMaximized: boolean) => void
    toggleMaximized: () => void
    setPanelOpen: (isOpen: boolean) => void
    togglePanel: () => void
    setPanelHeight: (height: number) => void
    resetPanelHeight: () => void

    // Profiles
    setProfiles: (profiles: TerminalProfile[]) => void

    // Reset
    reset: () => void
  }
}

const initialState = {
  terminals: {},
  groups: {},
  activeGroupId: null,
  isMaximized: false,
  isPanelOpen: false,
  panelHeight: DEFAULT_PANEL_HEIGHT,
  profiles: [],
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      ...initialState,

      actions: {
        addTerminal: (terminal, groupId) => {
          const state = get()
          let targetGroupId = groupId

          // If no group specified, use active group or create a new one
          if (!targetGroupId) {
            if (state.activeGroupId && state.groups[state.activeGroupId]) {
              targetGroupId = state.activeGroupId
            } else {
              targetGroupId = crypto.randomUUID()
            }
          }

          set((state) => {
            const existingGroup = state.groups[targetGroupId!]
            const newGroup: TerminalGroup = existingGroup
              ? {
                  ...existingGroup,
                  terminalIds: [...existingGroup.terminalIds, terminal.id],
                  activeTerminalId: terminal.id,
                }
              : {
                  id: targetGroupId!,
                  terminalIds: [terminal.id],
                  splitDirection: null,
                  activeTerminalId: terminal.id,
                }

            return {
              terminals: {
                ...state.terminals,
                [terminal.id]: terminal,
              },
              groups: {
                ...state.groups,
                [targetGroupId!]: newGroup,
              },
              activeGroupId: targetGroupId!,
              isPanelOpen: true,
            }
          })

          return targetGroupId!
        },

        removeTerminal: (terminalId) => {
          set((state) => {
            const newTerminals = { ...state.terminals }
            delete newTerminals[terminalId]

            const newGroups = { ...state.groups }
            let newActiveGroupId = state.activeGroupId

            // Remove terminal from all groups
            for (const [groupId, group] of Object.entries(newGroups)) {
              const idx = group.terminalIds.indexOf(terminalId)
              if (idx !== -1) {
                const newTerminalIds = group.terminalIds.filter((id) => id !== terminalId)

                if (newTerminalIds.length === 0) {
                  // Remove empty group
                  delete newGroups[groupId]
                  if (state.activeGroupId === groupId) {
                    // Set active to first remaining group
                    const remainingGroups = Object.keys(newGroups)
                    newActiveGroupId = remainingGroups[0] || null
                  }
                } else {
                  // Update group
                  newGroups[groupId] = {
                    ...group,
                    terminalIds: newTerminalIds,
                    activeTerminalId:
                      group.activeTerminalId === terminalId
                        ? newTerminalIds[Math.min(idx, newTerminalIds.length - 1)]
                        : group.activeTerminalId,
                    // Reset split if only one terminal left
                    splitDirection: newTerminalIds.length === 1 ? null : group.splitDirection,
                  }
                }
              }
            }

            return {
              terminals: newTerminals,
              groups: newGroups,
              activeGroupId: newActiveGroupId,
              // Close panel if no terminals left
              isPanelOpen: Object.keys(newTerminals).length > 0 ? state.isPanelOpen : false,
            }
          })
        },

        updateTerminalStatus: (terminalId, status, exitCode) => {
          set((state) => {
            const terminal = state.terminals[terminalId]
            if (!terminal) return state

            return {
              terminals: {
                ...state.terminals,
                [terminalId]: {
                  ...terminal,
                  status,
                  exitCode: exitCode !== undefined ? exitCode : terminal.exitCode,
                },
              },
            }
          })
        },

        updateTerminalTitle: (terminalId, title) => {
          set((state) => {
            const terminal = state.terminals[terminalId]
            if (!terminal) return state

            return {
              terminals: {
                ...state.terminals,
                [terminalId]: { ...terminal, title },
              },
            }
          })
        },

        setTerminalHasOutput: (terminalId, hasOutput) => {
          set((state) => {
            const terminal = state.terminals[terminalId]
            if (!terminal) return state

            return {
              terminals: {
                ...state.terminals,
                [terminalId]: { ...terminal, hasOutput },
              },
            }
          })
        },

        createGroup: () => {
          const groupId = crypto.randomUUID()
          set((state) => ({
            groups: {
              ...state.groups,
              [groupId]: {
                id: groupId,
                terminalIds: [],
                splitDirection: null,
                activeTerminalId: null,
              },
            },
            activeGroupId: groupId,
          }))
          return groupId
        },

        setActiveGroup: (groupId) => {
          set({ activeGroupId: groupId })
        },

        setActiveTerminal: (terminalId) => {
          set((state) => {
            // Find which group contains this terminal
            for (const [groupId, group] of Object.entries(state.groups)) {
              if (group.terminalIds.includes(terminalId)) {
                return {
                  activeGroupId: groupId,
                  groups: {
                    ...state.groups,
                    [groupId]: {
                      ...group,
                      activeTerminalId: terminalId,
                    },
                  },
                }
              }
            }
            return state
          })
        },

        splitTerminal: (terminalId, direction) => {
          set((state) => {
            // Find which group contains this terminal
            for (const [groupId, group] of Object.entries(state.groups)) {
              if (group.terminalIds.includes(terminalId)) {
                return {
                  groups: {
                    ...state.groups,
                    [groupId]: {
                      ...group,
                      splitDirection: direction,
                    },
                  },
                }
              }
            }
            return state
          })
        },

        setMaximized: (isMaximized) => {
          set({ isMaximized })
        },

        toggleMaximized: () => {
          set((state) => ({ isMaximized: !state.isMaximized }))
        },

        setPanelOpen: (isOpen) => {
          set({ isPanelOpen: isOpen })
        },

        togglePanel: () => {
          set((state) => ({ isPanelOpen: !state.isPanelOpen }))
        },

        setPanelHeight: (height) => {
          set({
            panelHeight: Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, height)),
          })
        },

        resetPanelHeight: () => {
          set({ panelHeight: DEFAULT_PANEL_HEIGHT })
        },

        setProfiles: (profiles) => {
          set({ profiles })
        },

        reset: () => {
          set(initialState)
        },
      },
    }),
    {
      name: 'terminal-store',
      storage: createJSONStorage(() => localStorage),
      // Only persist panel height and open state
      partialize: (state) => ({
        panelHeight: state.panelHeight,
        isPanelOpen: state.isPanelOpen,
        isMaximized: state.isMaximized,
      }),
    }
  )
)

// Selectors for convenience - use primitive values to avoid infinite loops
export const useTerminalActions = () => useTerminalStore((state) => state.actions)
export const useTerminals = () => useTerminalStore((state) => state.terminals)
export const useTerminalGroups = () => useTerminalStore((state) => state.groups)
export const useActiveGroupId = () => useTerminalStore((state) => state.activeGroupId)
export const useTerminalProfiles = () => useTerminalStore((state) => state.profiles)
export const useIsPanelOpen = () => useTerminalStore((state) => state.isPanelOpen)
export const useIsMaximized = () => useTerminalStore((state) => state.isMaximized)
export const usePanelHeight = () => useTerminalStore((state) => state.panelHeight)

// Derived selectors - these need to be used with useShallow or at component level
export function useActiveGroup(): TerminalGroup | null {
  const activeGroupId = useTerminalStore((state) => state.activeGroupId)
  const groups = useTerminalStore((state) => state.groups)
  return activeGroupId ? groups[activeGroupId] ?? null : null
}

export function useActiveTerminal(): TerminalInstance | null {
  const activeGroupId = useTerminalStore((state) => state.activeGroupId)
  const groups = useTerminalStore((state) => state.groups)
  const terminals = useTerminalStore((state) => state.terminals)
  const activeGroup = activeGroupId ? groups[activeGroupId] : null
  return activeGroup?.activeTerminalId ? terminals[activeGroup.activeTerminalId] ?? null : null
}

// Panel state as individual hooks (avoid object creation)
export function useTerminalPanelState() {
  const isMaximized = useTerminalStore((state) => state.isMaximized)
  const isPanelOpen = useTerminalStore((state) => state.isPanelOpen)
  const panelHeight = useTerminalStore((state) => state.panelHeight)
  return { isMaximized, isPanelOpen, panelHeight }
}
