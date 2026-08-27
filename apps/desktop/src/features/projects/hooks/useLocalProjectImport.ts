import { useCallback } from "react"
import { useMutation } from "convex/react"

import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildWorkbenchHref } from "@/features/projects/lib/lastWorkbenchRoute"
import { buildProjectRouteNavigationState } from "@/features/projects/lib/projectNavigationState"
import {
  browseForDirectory,
  buildFilesystemSlug,
  deriveNameFromPath,
  deriveProviderFromRepoUrl,
  inspectLocalGitState,
} from "@/features/projects/lib/localProjectImport"
import {
  DEFAULT_WORKBENCH_LANE_ID,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"

export type LocalProjectImportOutcome =
  | "cancelled"
  | "imported"
  | "error"

interface ImportWorkspacePathResult {
  workspaceId: string | null
  error: string | null
  destinationRoot: string | null
}

export function useLocalProjectImport() {
  const navigate = useViewTransitionNavigate()
  const { convexUserId } = useAuth()
  const createProject = useMutation(api.projects.create)
  const updateProjectStatus = useMutation(api.projects.updateStatus)

  const importWorkspacePath = useCallback(
    async (projectId: Id<"projects">, folderPath: string, projectName: string): Promise<ImportWorkspacePathResult> => {
      let destinationRoot: string | null = null
      try {
        const settings = await window.electronAPI.settings.get()
        destinationRoot = settings.projectsDirectory?.trim() || null
        const result = await window.electronAPI.workspace!.importExistingFolder({
          projectId: String(projectId),
          sourceFolderPath: folderPath,
          slug: buildFilesystemSlug(projectName),
          rootPathOverride: destinationRoot ?? undefined,
          setActive: true,
        })
        if (!result.success || !result.workspace) {
          const error = result.error || "Workspace import did not return a managed local folder."
          console.warn("[LocalProjectImport] Failed to import local project into managed workspace.", error)
          return { workspaceId: null, error, destinationRoot }
        } else {
          return { workspaceId: result.workspace.workspaceId, error: null, destinationRoot }
        }
      } catch (bindError) {
        const error = bindError instanceof Error ? bindError.message : "Unknown workspace import error."
        console.warn(
          "[LocalProjectImport] Failed to import local project into managed workspace.",
          bindError,
        )
        return { workspaceId: null, error, destinationRoot }
      }
    },
    [],
  )

  const navigateToProjectWorkbench = useCallback(
    (projectId: string, projectSlug: string, workspaceId: string, projectName: string) => {
      // Ensure a workbench shell exists, then open the assistant tile so import
      // lands in an active workbench instead of only adding the project to the sidebar.
      useProjectWorkbenchStore
        .getState()
        .actions.ensureWorkbench(projectId, DEFAULT_WORKBENCH_LANE_ID, workspaceId)

      navigate(
        buildWorkbenchHref(projectId, DEFAULT_WORKBENCH_LANE_ID, {
          openTile: "assistantChat",
        }),
        {
          state: buildProjectRouteNavigationState({
            projectId,
            projectSlug,
            projectName,
            preferredWorkspaceId: workspaceId,
          }),
        },
      )
    },
    [navigate],
  )

  const showImportError = useCallback(async (detail: string) => {
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

  const importPickedLocalFolder = useCallback(async (
    selectedPath: string,
  ): Promise<LocalProjectImportOutcome> => {
    const localFolderPath = selectedPath.trim()
    if (!localFolderPath) {
      return "cancelled"
    }

    const localGitState = await inspectLocalGitState(localFolderPath)

    if (!convexUserId) {
      await showImportError("No project profile is ready right now.")
      return "error"
    }

    try {
      const projectName = deriveNameFromPath(localFolderPath) || "Project"
      // The folder is not bound into the workspace catalog yet, so the
      // catalog-backed git IPC cannot answer here; inspectLocalGitState has
      // already read the branch straight off `.git/HEAD`.
      const branch = localGitState.branch || "main"
      const existingRemoteUrl = localGitState.remoteUrl?.trim() || ""
      const provider = existingRemoteUrl ? deriveProviderFromRepoUrl(existingRemoteUrl) : null
      const result = await createProject({
        userId: convexUserId,
        name: projectName,
        template: "blank",
        creationPath: "repo",
        sourceControl: existingRemoteUrl && provider
          ? {
              provider,
              repoUrl: existingRemoteUrl,
              defaultBranch: branch,
              workingCopyMode: "attached",
              setupMode: "personal",
            }
          : undefined,
        repoSource: existingRemoteUrl && provider
          ? {
              provider,
              repoUrl: existingRemoteUrl,
              branch,
            }
          : undefined,
      })

      const importResult = await importWorkspacePath(result.projectId, localFolderPath, projectName)
      if (!importResult.workspaceId) {
        throw new Error(
          [
            "Failed to import the local folder workspace.",
            importResult.destinationRoot ? `Destination: ${importResult.destinationRoot}` : null,
            importResult.error,
          ].filter(Boolean).join("\n"),
        )
      }
      await updateProjectStatus({
        projectId: result.projectId,
        userId: convexUserId,
        status: "active",
      })
      navigateToProjectWorkbench(
        String(result.projectId),
        result.slug,
        importResult.workspaceId,
        projectName,
      )
      return "imported"
    } catch (error) {
      await showImportError(
        error instanceof Error ? error.message : "Unknown import error.",
      )
      return "error"
    }
  }, [
    convexUserId,
    createProject,
    navigateToProjectWorkbench,
    importWorkspacePath,
    showImportError,
    updateProjectStatus,
  ])

  const importLocalFolder = useCallback(async (): Promise<LocalProjectImportOutcome> => {
    const selectedPath = await browseForDirectory("Select local project folder")
    if (!selectedPath?.trim()) {
      return "cancelled"
    }

    return importPickedLocalFolder(selectedPath)
  }, [importPickedLocalFolder])

  return {
    importPickedLocalFolder,
    importLocalFolder,
  }
}
