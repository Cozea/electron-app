import { useCallback, type MouseEvent } from "react"

import { useCreateProjectDialogStore, type CreateProjectDialogMode } from "@/stores/useCreateProjectDialogStore"

type ProjectCreationMenuAction = "empty" | "local" | "repo"

function resolveMenuPosition(event?: MouseEvent<HTMLElement>): { x: number; y: number } | undefined {
  if (event) {
    return {
      x: event.clientX,
      y: event.clientY,
    }
  }

  if (typeof document === "undefined") {
    return undefined
  }

  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) {
    return undefined
  }

  const rect = activeElement.getBoundingClientRect()
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.bottom),
  }
}

export function useProjectCreationMenu() {
  const openCreateProjectDialog = useCreateProjectDialogStore((state) => state.open)

  const openDirect = useCallback(
    (mode: CreateProjectDialogMode = "empty") => {
      openCreateProjectDialog({ mode })
    },
    [openCreateProjectDialog],
  )

  const openMenu = useCallback(
    async (event?: MouseEvent<HTMLElement>) => {
      const desktopBridge = window.desktopBridge

      if (!desktopBridge?.showContextMenu) {
        openCreateProjectDialog({ mode: "empty" })
        return
      }

      const selection = await desktopBridge.showContextMenu<ProjectCreationMenuAction>(
        [
          { id: "empty", label: "Empty project" },
          { id: "local", label: "Import local folder" },
          { id: "repo", label: "Import repository" },
        ],
        resolveMenuPosition(event),
      )

      if (!selection) {
        return
      }

      openCreateProjectDialog({ mode: selection })
    },
    [openCreateProjectDialog],
  )

  return {
    openCreateProjectDialog: openDirect,
    openProjectCreationMenu: openMenu,
  }
}
