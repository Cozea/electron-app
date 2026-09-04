import { useCallback, useEffect, useState, type DragEvent } from "react"
import { Navigate } from "@/lib/router"
import { useQuery } from "convex/react"
import { FolderLibraryIcon as __FolderLibraryHugeIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  buildWorkbenchHref,
  clearLastWorkbenchRoute,
  readLastWorkbenchRoute,
} from "@/features/workbench/model/lastWorkbenchRoute"
import { browseForDirectory } from "@/features/projects/lib/localProjectImport"
import { resolveDroppedLocalFolderPath } from "@/features/projects/lib/resolveDroppedLocalFolderPath"
import { useTranslation } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useCreateProjectDialogStore } from "@/features/projects/model/createProjectDialogStore"

export function ProjectsLaunchPage() {
  const { convexUserId, user } = useAuth()
  const { t } = useTranslation()
  const openCreateProjectDialog = useCreateProjectDialogStore((state) => state.open)
  const workspaceSelectionId = user?.id ?? "local-device"
  const [ignoredWorkspaceSelectionId, setIgnoredWorkspaceSelectionId] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [isSelectingFolder, setIsSelectingFolder] = useState(false)
  const lastWorkbenchRoute =
    ignoredWorkspaceSelectionId === workspaceSelectionId
      ? null
      : readLastWorkbenchRoute(workspaceSelectionId)

  const restoredProject = useQuery(
    api.projects.getAccessibleById,
    lastWorkbenchRoute?.projectId && convexUserId
      ? {
          projectId: lastWorkbenchRoute.projectId as Id<"projects">,
        }
      : "skip",
  )

  const projectsPage = useQuery(
    api.projects.listPageForCurrentUser,
    !lastWorkbenchRoute && convexUserId
      ? {
          userId: convexUserId,
          statusFilter: "all",
          sortBy: "last_modified",
          page: 1,
          pageSize: 1,
        }
      : "skip",
  )

  useEffect(() => {
    if (!workspaceSelectionId || !lastWorkbenchRoute) {
      return
    }
    if (restoredProject !== null) {
      return
    }

    clearLastWorkbenchRoute(workspaceSelectionId)
    setIgnoredWorkspaceSelectionId(workspaceSelectionId)
  }, [lastWorkbenchRoute, restoredProject, workspaceSelectionId])

  const showDropError = useCallback(async (detail: string) => {
    await window.electronAPI.dialog.showMessageBox({
      type: "error",
      buttons: ["OK"],
      defaultId: 0,
      title: "Could not import folder",
      message: "Cozea couldn't import that local folder.",
      detail,
      noLink: true,
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

  if (lastWorkbenchRoute) {
    if (restoredProject) {
      return (
        <Navigate
          to={buildWorkbenchHref(lastWorkbenchRoute.projectId, lastWorkbenchRoute.laneId, {
            focusTileId: lastWorkbenchRoute.focusTileId,
          })}
          replace
        />
      )
    }
  }

  const fallbackProject = projectsPage?.items?.[0] ?? null

  const hasProjects = Boolean(fallbackProject?._id)

  return (
    <div className="flex min-h-full flex-1 items-center justify-center">
      <div className="w-full max-w-xl p-6 md:p-10">
        <Empty className="py-6">
          {hasProjects ? (
            <EmptyHeader>
              <EmptyTitle>{t("projects.selectProject")}</EmptyTitle>
              <EmptyDescription>
                {t("projects.selectProjectDesc")}
              </EmptyDescription>
            </EmptyHeader>
          ) : null}
          <EmptyContent className="w-full max-w-md">
            <div
              role="button"
              tabIndex={0}
              aria-disabled={isSelectingFolder}
              aria-label={t("projects.dropRepoAriaLabel")}
              onClick={() => {
                if (!isSelectingFolder) {
                  void handleBrowse()
                }
              }}
              onKeyDown={(event) => {
                if (isSelectingFolder) {
                  return
                }
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  void handleBrowse()
                }
              }}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl px-6 py-10 text-center transition-colors",
                isDragActive
                  ? "bg-primary/5"
                  : "bg-secondary/20 hover:bg-secondary/30",
                isSelectingFolder && "pointer-events-none opacity-70",
              )}
            >
              {isSelectingFolder ? (
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              ) : (
                <HugeiconsIcon
                  icon={__FolderLibraryHugeIcon}
                  className={cn(
                    "size-8",
                    isDragActive ? "text-primary" : "text-muted-foreground",
                  )}
                />
              )}
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {isSelectingFolder
                    ? t("projects.dropRepoImporting")
                    : isDragActive
                      ? t("projects.dropRepoActive")
                      : t("projects.dropRepoTitle")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("projects.dropRepoHint")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSelectingFolder}
                onClick={(event) => {
                  event.stopPropagation()
                  void handleBrowse()
                }}
              >
                {t("projects.dropRepoBrowse")}
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      </div>
    </div>
  )
}
