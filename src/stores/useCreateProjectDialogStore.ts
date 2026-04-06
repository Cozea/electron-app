import { create } from "zustand"

export type CreateProjectDialogMode = "empty" | "local" | "repo"

interface OpenCreateProjectDialogOptions {
  mode?: CreateProjectDialogMode
}

interface CreateProjectDialogState {
  isOpen: boolean
  mode: CreateProjectDialogMode
  open: (options?: OpenCreateProjectDialogOptions) => void
  close: () => void
}

export const useCreateProjectDialogStore = create<CreateProjectDialogState>((set) => ({
  isOpen: false,
  mode: "empty",
  open: (options) =>
    set({
      isOpen: true,
      mode: options?.mode ?? "empty",
    }),
  close: () =>
    set({
      isOpen: false,
      mode: "empty",
    }),
}))
