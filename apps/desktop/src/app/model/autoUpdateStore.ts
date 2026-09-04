import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { UpdateState } from '@/types/electron'

type InstallMode = 'now' | 'later' | null

interface AutoUpdateStore extends UpdateState {
  continueActiveChats: boolean
  setContinueActiveChats: (enabled: boolean) => void
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
    continueActiveChats: typeof localStorage !== 'undefined' && localStorage.getItem('cozea:continue-chats-after-updates') === 'true',
    setContinueActiveChats: (enabled) => {
      localStorage.setItem('cozea:continue-chats-after-updates', String(enabled))
      set({ continueActiveChats: enabled })
    },

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

/** Failed preparation leaves the downloaded update available for an explicit retry. */
export async function installDownloadedUpdate(): Promise<void> {
  try {
    const result = await window.electronAPI?.updates.install({ continueActiveChats: useAutoUpdateStore.getState().continueActiveChats })
    if (!result?.success) useAutoUpdateStore.setState({ error: result?.error ?? 'The updater is unavailable.', installMode: null })
  } catch (error) {
    useAutoUpdateStore.setState({ error: error instanceof Error ? error.message : String(error), installMode: null })
  }
}
