import { create } from "zustand"

export type CreateProjectDialogMode = "empty" | "local" | "devapp" | "devapp-local"

interface OpenCreateProjectDialogOptions {
  mode?: CreateProjectDialogMode
  localFolderPath?: string
}

interface CreateProjectDialogState {
  isOpen: boolean
  mode: CreateProjectDialogMode
  localFolderPath: string
  open: (options?: OpenCreateProjectDialogOptions) => void
  close: () => void
}

export const useCreateProjectDialogStore = create<CreateProjectDialogState>((set) => ({
  isOpen: false,
  mode: "empty",
  localFolderPath: "",
  open: (options) =>
    set({
      isOpen: true,
      mode: options?.mode ?? "empty",
      localFolderPath: options?.localFolderPath ?? "",
    }),
  close: () =>
    set({
      isOpen: false,
      mode: "empty",
      localFolderPath: "",
    }),
}))
