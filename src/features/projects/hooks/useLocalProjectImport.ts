import { useCallback } from "react"
import { useMutation } from "convex/react"

import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { buildProjectRouteNavigationState } from "@/features/projects/lib/projectNavigationState"
import {
  browseForDirectory,
  deriveNameFromPath,
  deriveProviderFromRepoUrl,
  detectCurrentBranch,
  inspectLocalGitState,
} from "@/features/projects/lib/localProjectImport"

export type LocalProjectImportOutcome =
  | "cancelled"
  | "imported"
  | "error"

export function useLocalProjectImport() {
  const navigate = useViewTransitionNavigate()
  const { convexUserId } = useAuth()
  const createProject = useMutation(api.projects.create)
  const updateProjectStatus = useMutation(api.projects.updateStatus)
  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)

  const bindWorkspacePath = useCallback(
    async (projectId: Id<"projects">, folderPath: string): Promise<string | null> => {
      let workspaceId: string | null = null
      try {
        const result = await window.electronAPI.workspace!.bindExistingFolder({
          projectId: String(projectId),
          folderPath,
          writeMarker: true,
          setActive: true,
        })
        if (!result.success || !result.workspace) {
          console.warn(
            "[LocalProjectImport] Failed to bind local project path in desktop registry.",
            result.error,
          )
        } else {
          workspaceId = result.workspace.workspaceId
        }
      } catch (bindError) {
        console.warn(
          "[LocalProjectImport] Failed to bind local project path in desktop registry.",
          bindError,
        )
      }

      if (!convexUserId || !workspaceId) {
        return workspaceId
      }

      try {
        await updateMemberLocalPath({
          projectId,
          userId: convexUserId,
          localPath: workspaceId,
        })
      } catch (persistError) {
        console.warn(
          "[LocalProjectImport] Failed to mirror local project path to project membership.",
          persistError,
        )
      }
      
      return workspaceId
    },
    [convexUserId, updateMemberLocalPath],
  )

  const navigateToProjectWorkbench = useCallback(
    (projectId: string, projectSlug: string, projectPath: string, projectName: string) => {
      navigate(buildProjectPath(projectId, "workbench"), {
        state: buildProjectRouteNavigationState({
          projectId,
          projectSlug,
          projectName,
          preferredWorkspaceId: projectPath,
        }),
      })
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
      const branch = await detectCurrentBranch(
        localFolderPath,
        localGitState.branch || "main",
      )
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

      await updateProjectStatus({
        projectId: result.projectId,
        userId: convexUserId,
        status: "active",
      })
      const workspaceId = await bindWorkspacePath(result.projectId, localFolderPath)
      if (!workspaceId) {
        throw new Error("Failed to bind the local folder workspace.")
      }
      navigateToProjectWorkbench(
        String(result.projectId),
        result.slug,
        workspaceId,
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
    bindWorkspacePath,
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
