import { create } from 'zustand'
import type { GitChangesSnapshot, GitChangesScope } from '@shared/electronApiTypes'

interface StoreGitChangesScopeState {
  snapshot: GitChangesSnapshot | null
  refCount: number
}

interface GitChangesState {
  projects: Record<string, Partial<Record<GitChangesScope, StoreGitChangesScopeState>>>
  actions: {
    handleSnapshotUpdate: (snapshot: GitChangesSnapshot) => void
    watchGitStatus: (workspaceId: string, scope: GitChangesScope) => () => void
  }
}

export const useGitChangesStore = create<GitChangesState>()((set) => ({
  projects: {},
  actions: {
    handleSnapshotUpdate: (snapshot) => {
      set((state) => {
        const projectState = state.projects[snapshot.workspaceId] ?? {}
        const scopeState = projectState[snapshot.scope] ?? { snapshot: null, refCount: 0 }

        if (
          scopeState.snapshot?.patch === snapshot.patch &&
          scopeState.snapshot?.error === snapshot.error &&
          scopeState.snapshot?.cacheKey === snapshot.cacheKey
        ) {
          return state // no change
        }

        return {
          ...state,
          projects: {
            ...state.projects,
            [snapshot.workspaceId]: {
              ...projectState,
              [snapshot.scope]: {
                ...scopeState,
                snapshot,
              },
            },
          },
        }
      })
    },
    watchGitStatus: (workspaceId: string, scope: GitChangesScope) => {
      let isFirstSubscription = false

      set((state) => {
        const projectState = state.projects[workspaceId] ?? {}
        const scopeState = projectState[scope] ?? { snapshot: null, refCount: 0 }

        isFirstSubscription = scopeState.refCount === 0

        return {
          ...state,
          projects: {
            ...state.projects,
            [workspaceId]: {
              ...projectState,
              [scope]: {
                ...scopeState,
                refCount: scopeState.refCount + 1,
              },
            },
          },
        }
      })

      if (isFirstSubscription) {
        window.electronAPI.workspaceSync.subscribeGitChanges({ workspaceId, scope }).catch(() => {
          // ignore
        })
      }

      return () => {
        let isLastUnsubscribe = false

        set((state) => {
          const projectState = state.projects[workspaceId] ?? {}
          const scopeState = projectState[scope] ?? { snapshot: null, refCount: 0 }

          const nextRefCount = Math.max(0, scopeState.refCount - 1)
          isLastUnsubscribe = nextRefCount === 0

          return {
            ...state,
            projects: {
              ...state.projects,
              [workspaceId]: {
                ...projectState,
                [scope]: {
                  ...scopeState,
                  refCount: nextRefCount,
                },
              },
            },
          }
        })

        if (isLastUnsubscribe) {
          window.electronAPI.workspaceSync.unsubscribeGitChanges({ workspaceId, scope }).catch(() => {
            // ignore
          })
        }
      }
    },
  },
}))

if (typeof window !== 'undefined' && window.electronAPI) {
  window.electronAPI.workspaceSync.onGitChangesUpdated((snapshot) => {
    useGitChangesStore.getState().actions.handleSnapshotUpdate(snapshot)
  })
}
