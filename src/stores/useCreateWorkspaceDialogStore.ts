import { create } from 'zustand'

interface CreateWorkspaceDialogState {
  isOpen: boolean
  open: () => void
  close: () => void
}

export const useCreateWorkspaceDialogStore = create<CreateWorkspaceDialogState>(
  (set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
  })
)
