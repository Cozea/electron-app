import { useCallback, type MouseEvent } from "react"
import { useTranslation } from "@/lib/i18n"

import {
  canShowDesktopContextMenu,
  showDesktopContextMenu,
} from "@/lib/desktopBridgeClient"
import { useCreateProjectDialogStore, type CreateProjectDialogMode } from "@/stores/useCreateProjectDialogStore"
import { useLocalProjectImport } from "@/features/projects/hooks/useLocalProjectImport"
import { browseForDirectory } from "@/features/projects/lib/localProjectImport"

type ProjectCreationMenuAction = "empty" | "local"

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
  const { t } = useTranslation()
  const openCreateProjectDialog = useCreateProjectDialogStore((state) => state.open)
  const { importLocalFolder, importPickedLocalFolder } = useLocalProjectImport()

  const openDirect = useCallback(
    (mode: CreateProjectDialogMode = "empty") => {
      if (mode === "local") {
        void importLocalFolder()
        return
      }
      openCreateProjectDialog({ mode })
    },
    [importLocalFolder, openCreateProjectDialog],
  )

  const openMenu = useCallback(
    async (event?: MouseEvent<HTMLElement>) => {
      if (!canShowDesktopContextMenu()) {
        openCreateProjectDialog({ mode: "empty" })
        return
      }

      const selection = await showDesktopContextMenu<ProjectCreationMenuAction>(
        [
          { id: "empty", label: t("menu.emptyProject") },
          { id: "local", label: t("menu.importLocalFolder") },
        ],
        resolveMenuPosition(event),
      )

      if (!selection) {
        return
      }

      if (selection === "local") {
        const selectedPath = await browseForDirectory("Select local project folder")
        if (!selectedPath?.trim()) {
          return
        }
        void importPickedLocalFolder(selectedPath)
        return
      }

      openCreateProjectDialog({ mode: selection })
    },
    [importLocalFolder, importPickedLocalFolder, openCreateProjectDialog, t],
  )

  return {
    openCreateProjectDialog: openDirect,
    openProjectCreationMenu: openMenu,
  }
}
