// @ts-nocheck
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { TerminalProfile } from '@/types/electron'

const MIN_PANEL_HEIGHT = 150
const MAX_PANEL_HEIGHT = 600
const DEFAULT_PANEL_HEIGHT = 250
const MAX_TERMINAL_OUTPUT_CHUNKS = 4000

export type TerminalKind = 'dev-server' | 'shell' | 'task' | 'agent'
export type TerminalNameSource = 'auto' | 'manual'
export type TerminalSurface = 'panel' | 'assistant'

export interface TerminalInstance {
  id: string
  profileId: string
  profileName: string
  title: string
  runId?: string
  phase?: 'starting' | 'active' | 'stopping' | 'exited'
  lastHeartbeatAt?: number
  projectPath?: string
  label?: string
  kind?: TerminalKind
  surface?: TerminalSurface
  agentProfileId?: string
  agentProfileName?: string
  port?: number
  command?: string
  nameSource?: TerminalNameSource
  status: 'starting' | 'running' | 'exited' | 'error'
  exitCode?: number | null
  hasOutput: boolean
}

export interface TerminalGroup {
  id: string
  terminalIds: string[]
  splitDirection: 'horizontal' | 'vertical' | null
  activeTerminalId: string | null
}

interface TerminalState {
  terminals: Record<string, TerminalInstance>
  outputBuffers: Record<string, string[]>
  groups: Record<string, TerminalGroup>
  activeGroupId: string | null
  isMaximized: boolean
  isPanelOpen: boolean
  panelHeight: number
  profiles: TerminalProfile[]
  actions: {
    addTerminal: (terminal: TerminalInstance, groupId?: string) => string
    registerTerminal: (terminal: TerminalInstance) => void
    removeTerminal: (terminalId: string) => void
    updateTerminalStatus: (terminalId: string, status: TerminalInstance['status'], exitCode?: number | null) => void
    updateTerminalTitle: (terminalId: string, title: string) => void
    updateTerminalDisplay: (
      terminalId: string,
      display: Partial<
        Pick<
          TerminalInstance,
          | 'title'
          | 'label'
          | 'port'
          | 'nameSource'
          | 'command'
          | 'kind'
          | 'surface'
          | 'projectPath'
          | 'runId'
          | 'phase'
          | 'lastHeartbeatAt'
          | 'agentProfileId'
          | 'agentProfileName'
        >
      >,
    ) => void
    setTerminalHasOutput: (terminalId: string, hasOutput: boolean) => void
    appendTerminalOutput: (terminalId: string, chunk: string) => void
    clearTerminalOutput: (terminalId: string) => void
    createGroup: () => string
    setActiveGroup: (groupId: string) => void
    setActiveTerminal: (terminalId: string) => void
    splitTerminal: (terminalId: string, direction: 'horizontal' | 'vertical') => void
    setMaximized: (isMaximized: boolean) => void
    toggleMaximized: () => void
    setPanelOpen: (isOpen: boolean) => void
    togglePanel: () => void
    setPanelHeight: (height: number) => void
    resetPanelHeight: () => void
    setProfiles: (profiles: TerminalProfile[]) => void
    resetProject: (projectPath: string) => void
    reset: () => void
  }
}

const initialState = {
  terminals: {},
  outputBuffers: {},
  groups: {},
  activeGroupId: null,
  isMaximized: false,
  isPanelOpen: false,
  panelHeight: DEFAULT_PANEL_HEIGHT,
  profiles: [],
}

export function isAssistantTerminal(terminal?: Pick<TerminalInstance, 'surface'> | null): boolean {
  return terminal?.surface === 'assistant'
}

export function isPanelTerminal(terminal?: Pick<TerminalInstance, 'surface'> | null): boolean {
  return !terminal || terminal.surface !== 'assistant'
}

export function selectPanelTerminals(state: Pick<TerminalState, 'terminals'>): TerminalInstance[] {
  return Object.values(state.terminals).filter(isPanelTerminal)
}

export function selectAssistantTerminalsForProject(projectPath?: string | null) {
  return (state: Pick<TerminalState, 'terminals'>): TerminalInstance[] =>
    Object.values(state.terminals).filter(
      (terminal) =>
        terminal.surface === 'assistant' &&
        terminal.kind === 'agent' &&
        (!projectPath || terminal.projectPath === projectPath),
    )
}

export function selectHasPanelTerminals(state: Pick<TerminalState, 'terminals'>): boolean {
  return Object.values(state.terminals).some(isPanelTerminal)
}

export function selectPanelTerminalCount(state: Pick<TerminalState, 'terminals'>): number {
  return selectPanelTerminals(state).length
}

function normalizeTerminal(terminal: TerminalInstance): TerminalInstance {
  return {
    ...terminal,
    surface: terminal.surface ?? 'panel',
  }
}

function removeTerminalFromGroups(
  groups: Record<string, TerminalGroup>,
  activeGroupId: string | null,
  terminalId: string,
): { groups: Record<string, TerminalGroup>; activeGroupId: string | null } {
  const nextGroups = { ...groups }
  let nextActiveGroupId = activeGroupId

  for (const [groupId, group] of Object.entries(nextGroups)) {
    const index = group.terminalIds.indexOf(terminalId)
    if (index === -1) continue

    const terminalIds = group.terminalIds.filter((id) => id !== terminalId)
    if (terminalIds.length === 0) {
      delete nextGroups[groupId]
      if (nextActiveGroupId === groupId) {
        nextActiveGroupId = Object.keys(nextGroups)[0] ?? null
      }
      continue
    }

    nextGroups[groupId] = {
      ...group,
      terminalIds,
      activeTerminalId:
        group.activeTerminalId === terminalId
          ? terminalIds[Math.min(index, terminalIds.length - 1)] ?? null
          : group.activeTerminalId,
      splitDirection: terminalIds.length === 1 ? null : group.splitDirection,
    }
  }

  return {
    groups: nextGroups,
    activeGroupId: nextActiveGroupId,
  }
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      ...initialState,

      actions: {
        addTerminal: (terminal, groupId) => {
          const state = get()
          const normalizedTerminal = normalizeTerminal(terminal)
          let targetGroupId = groupId

          if (!targetGroupId) {
            if (state.activeGroupId && state.groups[state.activeGroupId]) {
              targetGroupId = state.activeGroupId
            } else {
              targetGroupId = crypto.randomUUID()
            }
          }

          set((currentState) => {
            const existingGroup = currentState.groups[targetGroupId!]
            const groupTerminalIds = existingGroup?.terminalIds ?? []
            const nextTerminalIds = [...groupTerminalIds.filter((id) => id !== normalizedTerminal.id), normalizedTerminal.id]

            const nextGroup: TerminalGroup = existingGroup
              ? {
                  ...existingGroup,
                  terminalIds: nextTerminalIds,
                  activeTerminalId: normalizedTerminal.id,
                }
              : {
                  id: targetGroupId!,
                  terminalIds: [normalizedTerminal.id],
                  splitDirection: null,
                  activeTerminalId: normalizedTerminal.id,
                }

            return {
              terminals: {
                ...currentState.terminals,
                [normalizedTerminal.id]: normalizedTerminal,
              },
              outputBuffers: {
                ...currentState.outputBuffers,
                [normalizedTerminal.id]: currentState.outputBuffers[normalizedTerminal.id] ?? [],
              },
              groups: {
                ...currentState.groups,
                [targetGroupId!]: nextGroup,
              },
              activeGroupId: targetGroupId!,
              isPanelOpen: true,
            }
          })

          return targetGroupId!
        },

        registerTerminal: (terminal) => {
          const normalizedTerminal = normalizeTerminal(terminal)
          set((state) => ({
            terminals: {
              ...state.terminals,
              [normalizedTerminal.id]: normalizedTerminal,
            },
            outputBuffers: {
              ...state.outputBuffers,
              [normalizedTerminal.id]: state.outputBuffers[normalizedTerminal.id] ?? [],
            },
          }))
        },

        removeTerminal: (terminalId) => {
          set((state) => {
            if (!state.terminals[terminalId]) return state

            const terminals = { ...state.terminals }
            delete terminals[terminalId]

            const outputBuffers = { ...state.outputBuffers }
            delete outputBuffers[terminalId]

            const { groups, activeGroupId } = removeTerminalFromGroups(state.groups, state.activeGroupId, terminalId)

            return {
              terminals,
              outputBuffers,
              groups,
              activeGroupId,
              isPanelOpen: selectHasPanelTerminals({ terminals }) ? state.isPanelOpen : false,
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

        updateTerminalDisplay: (terminalId, display) => {
          set((state) => {
            const terminal = state.terminals[terminalId]
            if (!terminal) return state

            return {
              terminals: {
                ...state.terminals,
                [terminalId]: {
                  ...terminal,
                  ...display,
                },
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

        appendTerminalOutput: (terminalId, chunk) => {
          if (!chunk) return

          set((state) => {
            if (!state.terminals[terminalId]) return state

            const existing = state.outputBuffers[terminalId] ?? []
            const next = [...existing, chunk]
            const trimmed =
              next.length > MAX_TERMINAL_OUTPUT_CHUNKS
                ? next.slice(next.length - MAX_TERMINAL_OUTPUT_CHUNKS)
                : next

            return {
              outputBuffers: {
                ...state.outputBuffers,
                [terminalId]: trimmed,
              },
            }
          })
        },

        clearTerminalOutput: (terminalId) => {
          set((state) => {
            if (!state.outputBuffers[terminalId]) return state
            const next = { ...state.outputBuffers }
            delete next[terminalId]
            return { outputBuffers: next }
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
            for (const [groupId, group] of Object.entries(state.groups)) {
              if (!group.terminalIds.includes(terminalId)) continue
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
            return state
          })
        },

        splitTerminal: (terminalId, direction) => {
          set((state) => {
            for (const [groupId, group] of Object.entries(state.groups)) {
              if (!group.terminalIds.includes(terminalId)) continue
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

        resetProject: (projectPath) => {
          set((state) => {
            const terminalIds = Object.values(state.terminals)
              .filter((terminal) => terminal.projectPath === projectPath)
              .map((terminal) => terminal.id)

            if (terminalIds.length === 0) return state

            const terminals = { ...state.terminals }
            const outputBuffers = { ...state.outputBuffers }
            let groups = state.groups
            let activeGroupId = state.activeGroupId

            for (const terminalId of terminalIds) {
              delete terminals[terminalId]
              delete outputBuffers[terminalId]
              const nextGroupState = removeTerminalFromGroups(groups, activeGroupId, terminalId)
              groups = nextGroupState.groups
              activeGroupId = nextGroupState.activeGroupId
            }

            return {
              terminals,
              outputBuffers,
              groups,
              activeGroupId,
              isPanelOpen: selectHasPanelTerminals({ terminals }) ? state.isPanelOpen : false,
            }
          })
        },

        reset: () => {
          set(initialState)
        },
      },
    }),
    {
      name: 'terminal-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        panelHeight: state.panelHeight,
        isPanelOpen: state.isPanelOpen,
        isMaximized: state.isMaximized,
      }),
    },
  ),
)

export const useTerminalActions = () => useTerminalStore((state) => state.actions)
export const useTerminals = () => useTerminalStore((state) => state.terminals)
export const useTerminalGroups = () => useTerminalStore((state) => state.groups)
export const useActiveGroupId = () => useTerminalStore((state) => state.activeGroupId)
export const useTerminalProfiles = () => useTerminalStore((state) => state.profiles)
export const useIsPanelOpen = () => useTerminalStore((state) => state.isPanelOpen)
export const useIsMaximized = () => useTerminalStore((state) => state.isMaximized)
export const usePanelHeight = () => useTerminalStore((state) => state.panelHeight)

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

export function useTerminalPanelState() {
  const isMaximized = useTerminalStore((state) => state.isMaximized)
  const isPanelOpen = useTerminalStore((state) => state.isPanelOpen)
  const panelHeight = useTerminalStore((state) => state.panelHeight)
  return { isMaximized, isPanelOpen, panelHeight }
}
