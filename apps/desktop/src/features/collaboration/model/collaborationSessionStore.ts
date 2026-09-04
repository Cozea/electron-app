import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface ActiveCollaborationBinding {
  projectId: string
  sessionId: string
  workspaceId: string
  sourceWorkspaceId: string
  sessionBranch: string
  joinedAt: number
}

interface CollaborationSessionState {
  activeByProject: Record<string, ActiveCollaborationBinding>
  actions: {
    activate(binding: ActiveCollaborationBinding): void
    clear(projectId: string): void
    clearSession(sessionId: string): void
  }
}

export const useCollaborationSessionStore = create<CollaborationSessionState>()(
  persist(
    (set) => ({
      activeByProject: {},
      actions: {
        activate(binding) {
          set((state) => ({
            activeByProject: {
              ...state.activeByProject,
              [binding.projectId]: { ...binding },
            },
          }))
        },
        clear(projectId) {
          set((state) => {
            if (!state.activeByProject[projectId]) return state
            const next = { ...state.activeByProject }
            delete next[projectId]
            return { activeByProject: next }
          })
        },
        clearSession(sessionId) {
          set((state) => ({
            activeByProject: Object.fromEntries(
              Object.entries(state.activeByProject).filter(([, binding]) => binding.sessionId !== sessionId),
            ),
          }))
        },
      },
    }),
    {
      name: "cozea-collaboration-v2-active-sessions",
      partialize: (state) => ({ activeByProject: state.activeByProject }),
      version: 2,
      migrate: (persisted) => {
        const candidate = persisted as Partial<CollaborationSessionState> | undefined
        const activeByProject = Object.fromEntries(
          Object.entries(candidate?.activeByProject ?? {}).flatMap(([projectId, binding]) => {
            if (!binding?.workspaceId || !binding.sessionId || !binding.sessionBranch) return []
            return [[projectId, {
              ...binding,
              sourceWorkspaceId: binding.sourceWorkspaceId ?? binding.workspaceId,
            }]]
          }),
        )
        return { activeByProject }
      },
    },
  ),
)

export function getActiveCollaborationBinding(projectId: string | null | undefined): ActiveCollaborationBinding | null {
  if (!projectId) return null
  return useCollaborationSessionStore.getState().activeByProject[projectId] ?? null
}
