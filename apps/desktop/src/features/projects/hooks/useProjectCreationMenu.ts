import { useCallback, type MouseEvent } from "react"
import { useTranslation } from "@/lib/i18n"

import {
  canShowDesktopContextMenu,
  showDesktopContextMenu,
} from "@/lib/desktopBridgeClient"
import { getNativeMenuIcon } from "@/lib/nativeMenuIcons"
import { useCreateProjectDialogStore, type CreateProjectDialogMode } from "@/lib/createProjectDialogStore"
import { browseForDirectory } from "@/lib/browseForDirectory"
import { useProductTourStore } from "@/features/tour/productTourStore"

type ProjectCreationMenuAction = CreateProjectDialogMode

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
  const isTourActive = useProductTourStore((state) => state.isActive)

  const openDirect = useCallback(
    (mode: CreateProjectDialogMode = "empty") => {
      if (mode === "local" || mode === "devapp-local") {
        void browseForDirectory(
          mode === "devapp-local" ? "Select existing DevApp project" : "Select local project folder",
        ).then((selectedPath) => {
          if (selectedPath?.trim()) openCreateProjectDialog({ mode, localFolderPath: selectedPath })
        })
        return
      }
      openCreateProjectDialog({ mode })
    },
    [openCreateProjectDialog],
  )

  const openMenu = useCallback(
    async (event?: MouseEvent<HTMLElement>) => {
      if (!canShowDesktopContextMenu()) {
        openCreateProjectDialog({ mode: "empty" })
        return
      }

      const selection = await showDesktopContextMenu<ProjectCreationMenuAction>(
        [
          { id: "empty", label: t("menu.emptyProject"), icon: getNativeMenuIcon("new-project") },
          // The tutorial teaches the empty project route. The rest stay visible
          // so the menu still reads honestly, but cannot be chosen and send the
          // tour somewhere it has no step for.
          {
            id: "local",
            label: t("menu.importLocalFolder"),
            icon: getNativeMenuIcon("open-folder"),
            enabled: !isTourActive,
          },
          {
            id: "devapp",
            label: t("menu.createNativeDevApp"),
            icon: getNativeMenuIcon("package"),
            enabled: !isTourActive,
          },
          {
            id: "devapp-local",
            label: t("menu.openExistingDevApp"),
            icon: getNativeMenuIcon("open-project"),
            enabled: !isTourActive,
          },
        ],
        resolveMenuPosition(event),
      )

      if (!selection) {
        return
      }

      if (selection === "local" || selection === "devapp-local") {
        const selectedPath = await browseForDirectory(
          selection === "devapp-local" ? "Select existing DevApp project" : "Select local project folder",
        )
        if (selectedPath?.trim()) {
          openCreateProjectDialog({ mode: selection, localFolderPath: selectedPath })
        }
        return
      }

      openCreateProjectDialog({ mode: selection })
    },
    [isTourActive, openCreateProjectDialog, t],
  )

  return {
    openCreateProjectDialog: openDirect,
    openProjectCreationMenu: openMenu,
  }
}
