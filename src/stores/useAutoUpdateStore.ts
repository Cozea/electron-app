// @ts-nocheck
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { UpdateState } from '@/types/electron'

type InstallMode = 'now' | 'later' | null

interface AutoUpdateStore extends UpdateState {
  installMode: InstallMode
  setInstallMode: (mode: InstallMode) => void
  applyUpdateState: (state: UpdateState) => void
}

const initialState: UpdateState = {
  status: 'idle',
}

export const useAutoUpdateStore = create<AutoUpdateStore>()(
  immer((set) => ({
    ...initialState,
    installMode: null,

    setInstallMode: (mode) => set({ installMode: mode }),

    applyUpdateState: (state) => set((draft) => {
      const shouldResetInstallMode =
        state.status === 'available' ||
        state.status === 'not-available' ||
        state.status === 'error'

      if (shouldResetInstallMode) {
        draft.installMode = null
      }

      draft.status = state.status
      draft.version = state.version
      draft.releaseName = state.releaseName
      draft.releaseNotes = state.releaseNotes
      draft.progress = state.progress
      draft.error = state.error
    }),
  }))
)
