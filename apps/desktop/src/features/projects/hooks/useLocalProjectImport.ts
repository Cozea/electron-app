import { useCallback } from "react"
import { useMutation } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildWorkbenchHref } from "@/features/projects/lib/lastWorkbenchRoute"
import { buildProjectRouteNavigationState } from "@/features/projects/lib/projectNavigationState"
import {
  browseForDirectory,
  buildFilesystemSlug,
  deriveNameFromPath,
  deriveProviderFromRepoUrl,
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
}

export function useLocalProjectImport() {
  const navigate = useViewTransitionNavigate()
  const { convexUserId } = useAuth()
  const createProject = useMutation(api.projects.create)
  const deleteProject = useMutation(api.projects.deleteProject)
  const updateProjectStatus = useMutation(api.projects.updateStatus)

  const attachWorkspacePath = useCallback(
    async (projectId: Id<"projects">, folderPath: string): Promise<ImportWorkspacePathResult> => {
      try {
        const result = await window.electronAPI.workspace!.attachExistingFolder({
          projectId: String(projectId),
          folderPath,
          setActive: true,
        })
        if (!result.success || !result.workspace) {
          const error = result.error || "Workspace attachment did not return a local folder."
          console.warn("[LocalProjectImport] Failed to attach local project folder.", error)
          return { workspaceId: null, error }
        } else {
          return { workspaceId: result.workspace.workspaceId, error: null }
        }
      } catch (bindError) {
        const error = bindError instanceof Error ? bindError.message : "Unknown workspace attachment error."
        console.warn("[LocalProjectImport] Failed to attach local project folder.", bindError)
        return { workspaceId: null, error }
      }
    },
    [],
  )

  const navigateToProjectWorkbench = useCallback(
    (projectId: string, projectSlug: string, workspaceId: string, projectName: string) => {
      // Ensure a workbench shell exists, then open the assistant tile so the
      // attachment lands in an active workbench instead of only the sidebar.
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
      title: "Could not open folder",
      message: "Cozea couldn't attach that local folder.",
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

    if (!convexUserId) {
      await showImportError("No project profile is ready right now.")
      return "error"
    }

    try {
      const projectName = deriveNameFromPath(localFolderPath) || "Project"
      const preflight = await window.electronAPI.workspace!.preflightExistingFolder({
        folderPath: localFolderPath,
      })
      if (!preflight.success) {
        throw new Error(preflight.error || "The selected folder could not be opened.")
      }

      if (preflight.existingWorkspace) {
        navigateToProjectWorkbench(
          preflight.existingWorkspace.projectId,
          buildFilesystemSlug(projectName),
          preflight.existingWorkspace.workspaceId,
          projectName,
        )
        return "imported"
      }

      const branch = preflight.branch || "main"
      const existingRemoteUrl = preflight.repoIdentity?.url?.trim() || ""
      const provider = existingRemoteUrl ? deriveProviderFromRepoUrl(existingRemoteUrl) : null
      const creationToken = globalThis.crypto.randomUUID()
      const result = await createProject({
        userId: convexUserId,
        name: projectName,
        template: "blank",
        creationPath: "repo",
        status: "provisioning",
        creationToken,
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

      const importResult = await attachWorkspacePath(result.projectId, localFolderPath)
      if (!importResult.workspaceId) {
        if (!result.resumed) {
          await deleteProject({
            projectId: result.projectId,
            userId: convexUserId,
            confirmName: projectName,
          }).catch((compensationError) => {
            console.warn(
              "[LocalProjectImport] Failed to compensate a provisioning project.",
              compensationError,
            )
          })
        }
        throw new Error(
          [
            "Failed to attach the selected local folder.",
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
        error instanceof Error ? error.message : "Unknown folder attachment error.",
      )
      return "error"
    }
  }, [
    convexUserId,
    createProject,
    deleteProject,
    navigateToProjectWorkbench,
    attachWorkspacePath,
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
