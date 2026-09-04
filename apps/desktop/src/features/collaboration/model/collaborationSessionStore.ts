import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface ActiveCollaborationBinding {
  projectId: string
  sessionId: string
  workspaceId: string
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
          set((state) => {
            const next = Object.fromEntries(
              Object.entries(state.activeByProject).filter(([, binding]) => binding.sessionId !== sessionId),
            )
            return { activeByProject: next }
          })
        },
      },
    }),
    {
      name: "cozea-collaboration-v2-active-sessions",
      partialize: (state) => ({ activeByProject: state.activeByProject }),
      version: 1,
    },
  ),
)

export function getActiveCollaborationBinding(projectId: string | null | undefined): ActiveCollaborationBinding | null {
  if (!projectId) return null
  return useCollaborationSessionStore.getState().activeByProject[projectId] ?? null
}
