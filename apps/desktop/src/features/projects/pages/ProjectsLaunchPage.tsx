import { useCallback, useEffect, useState, type DragEvent } from "react"
import { appToast } from "@/lib/appToast"

import { useAuth } from "@/contexts/AuthContext"
import { EmptyFolder } from "@/components/ui/empty-folder"
import {
  clearLastWorkbenchRoute,
  readLastWorkbenchRoute,
} from "@/features/workbench/model/lastWorkbenchRoute"
import { browseForDirectory } from "@/lib/browseForDirectory"
import { resolveDroppedLocalFolderPath } from "@/lib/resolveDroppedLocalFolderPath"
import { useTranslation } from "@/lib/i18n"
import { useCreateProjectDialogStore } from "@/lib/createProjectDialogStore"

export function ProjectsLaunchPage() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const openCreateProjectDialog = useCreateProjectDialogStore((state) => state.open)
  const workspaceSelectionId = user?.identityKey ?? "local-device"
  const [ignoredWorkspaceSelectionId, setIgnoredWorkspaceSelectionId] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [isSelectingFolder, setIsSelectingFolder] = useState(false)
  const legacyLastWorkbenchRoute =
    ignoredWorkspaceSelectionId === workspaceSelectionId
      ? null
      : readLastWorkbenchRoute(workspaceSelectionId)

  // Desktop-bootstrap builds restore the previous workbench before React mounts,
  // so /projects must be a real stable destination if authoritative validation
  // redirects here. Mounting here also clears any stale restore target so next
  // launch does not bounce back.
  useEffect(() => {
    if (!legacyLastWorkbenchRoute) return

    // If /projects actually mounted, it is now the user's authoritative local
    // navigation intent (including the deleted/revoked-project correction
    // path). Clear the old restore target so next launch does not bounce back.
    clearLastWorkbenchRoute(workspaceSelectionId)
    setIgnoredWorkspaceSelectionId(workspaceSelectionId)
  }, [legacyLastWorkbenchRoute, workspaceSelectionId])

  const showDropError = useCallback(async (detail: string) => {
    appToast.error({
      title: "Cozea couldn't import that local folder.",
      description: detail,
    })
  }, [])

  const handleBrowse = useCallback(async () => {
    if (isSelectingFolder) return

    setIsSelectingFolder(true)
    try {
      const selectedPath = await browseForDirectory("Select local project folder")
      if (!selectedPath?.trim()) return

      openCreateProjectDialog({
        mode: "local",
        localFolderPath: selectedPath,
      })
    } finally {
      setIsSelectingFolder(false)
    }
  }, [isSelectingFolder, openCreateProjectDialog])

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer.types.includes("Files")) {
      setIsDragActive(true)
    }
  }, [])

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer.types.includes("Files")) {
      event.dataTransfer.dropEffect = "copy"
      setIsDragActive(true)
    }
  }, [])

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return
    }
    setIsDragActive(false)
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setIsDragActive(false)

      if (isSelectingFolder) {
        return
      }

      const resolved = resolveDroppedLocalFolderPath(
        event.dataTransfer,
        window.electronAPI.getPathForFile,
      )

      if (!resolved.ok) {
        const detail =
          resolved.reason === "multiple"
            ? "Drop a single repository folder at a time."
            : resolved.reason === "not_folder"
              ? "Drop a folder (repository), not a file."
              : "Cozea couldn't read a local path from that drop."
        void showDropError(detail)
        return
      }

      openCreateProjectDialog({
        mode: "local",
        localFolderPath: resolved.path,
      })
    },
    [isSelectingFolder, openCreateProjectDialog, showDropError],
  )

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6 md:p-12">
      <EmptyFolder
        title={
          isSelectingFolder
            ? t("projects.dropRepoImporting")
            : isDragActive
              ? t("projects.dropRepoActive")
              : t("projects.dropRepoTitle")
        }
        description={t("projects.dropRepoHint")}
        browseLabel={t("projects.dropRepoBrowse")}
        isDragActive={isDragActive}
        isSelectingFolder={isSelectingFolder}
        onBrowse={() => {
          if (!isSelectingFolder) {
            void handleBrowse()
          }
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
    </div>
  )
}
