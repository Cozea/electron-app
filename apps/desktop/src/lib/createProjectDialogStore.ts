/**
 * Open state for the app-wide create-project dialog.
 *
 * Anything may ask for the dialog — the projects hub, the new-project page, the
 * DevApps store, DevApp settings — so the request cannot live inside the
 * feature that happens to render it.
 */

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
