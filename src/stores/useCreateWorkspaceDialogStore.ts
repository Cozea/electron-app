import { create } from 'zustand'

interface OpenCreateWorkspaceDialogOptions {
  redirectTo?: string | null
}

interface CreateWorkspaceDialogState {
  isOpen: boolean
  redirectTo: string | null
  open: (options?: OpenCreateWorkspaceDialogOptions) => void
  close: () => void
}

export const useCreateWorkspaceDialogStore = create<CreateWorkspaceDialogState>(
  (set) => ({
    isOpen: false,
    redirectTo: null,
    open: (options) =>
      set({
        isOpen: true,
        redirectTo: options?.redirectTo ?? null,
      }),
    close: () => set({ isOpen: false, redirectTo: null }),
  })
)
