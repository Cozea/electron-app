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
  formatWorkspaceBindFailure,
  inspectLocalGitState,
} from "@/features/projects/lib/localProjectImport"

export type LocalProjectImportOutcome =
  | "cancelled"
  | "imported"
  | "error"

export interface LocalProjectImportResult {
  outcome: LocalProjectImportOutcome
  errorMessage: string | null
}

interface ImportLocalFolderOptions {
  /**
   * "dialog" (default) reports failures via a native message box; "return"
   * leaves presentation to the caller (used by CreateProjectDialog, which
   * renders the message inline).
   */
  reportError?: "dialog" | "return"
}

export function useLocalProjectImport() {
  const navigate = useViewTransitionNavigate()
  const { convexUserId } = useAuth()
  const createProject = useMutation(api.projects.create)
  const deleteProject = useMutation(api.projects.deleteProject)
  const updateProjectStatus = useMutation(api.projects.updateStatus)

  const navigateToProjectWorkbench = useCallback(
    (projectId: string, projectSlug: string, workspaceId: string, projectName: string) => {
      navigate(buildProjectPath(projectId, "workbench"), {
        state: buildProjectRouteNavigationState({
          projectId,
          projectSlug,
          projectName,
          preferredWorkspaceId: workspaceId,
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
    options?: ImportLocalFolderOptions,
  ): Promise<LocalProjectImportResult> => {
    const reportError = options?.reportError ?? "dialog"
    const fail = async (errorMessage: string): Promise<LocalProjectImportResult> => {
      if (reportError === "dialog") {
        await showImportError(errorMessage)
      }
      return { outcome: "error", errorMessage }
    }

    const localFolderPath = selectedPath.trim()
    if (!localFolderPath) {
      return { outcome: "cancelled", errorMessage: null }
    }

    if (!convexUserId) {
      return fail("No project profile is ready right now.")
    }

    const projectName = deriveNameFromPath(localFolderPath) || "Project"
    // One inspection pass: it already resolves the current branch with the
    // same fallbacks the old detectCurrentBranch round-trip re-derived.
    const localGitState = await inspectLocalGitState(localFolderPath)
    const branch = localGitState.branch || "main"
    const existingRemoteUrl = localGitState.remoteUrl?.trim() || ""
    const provider = existingRemoteUrl ? deriveProviderFromRepoUrl(existingRemoteUrl) : null

    // Compensation only ever undoes effects THIS run created. A resumed doc
    // (deterministic token matched a pre-existing project) and any binding it
    // already had are the user's real data — never roll those back.
    let createdProjectId: Id<"projects"> | null = null
    let boundWorkspaceId: string | null = null
    try {
      const result = await createProject({
        userId: convexUserId,
        name: projectName,
        template: "blank",
        creationPath: "repo",
        status: "provisioning",
        // Deterministic per folder: re-importing the same path resumes the
        // same doc even across app restarts.
        creationToken: `local-import:${localFolderPath}`,
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
      // Only a freshly-created doc is ours to delete on failure.
      const createdThisRun = !result.resumed
      if (createdThisRun) {
        createdProjectId = result.projectId
      }

      const bindResult = await window.electronAPI.workspace!.bindExistingFolder({
        projectId: String(result.projectId),
        folderPath: localFolderPath,
        writeMarker: true,
        setActive: true,
      })

      if (!bindResult.success || !bindResult.workspace) {
        throw new Error(formatWorkspaceBindFailure(bindResult))
      }
      // Track the binding for rollback only when we own the project doc; a
      // resumed project's binding pre-existed and must survive a later failure.
      if (createdThisRun) {
        boundWorkspaceId = bindResult.workspace.workspaceId
      }

      // Local effects done: finalize the saga.
      await updateProjectStatus({
        projectId: result.projectId,
        userId: convexUserId,
        status: "active",
      })

      navigateToProjectWorkbench(
        String(result.projectId),
        result.slug,
        bindResult.workspace.workspaceId,
        projectName,
      )
      return { outcome: "imported", errorMessage: null }
    } catch (error) {
      // Compensate in reverse: undo the local bind (catalog row + on-disk
      // marker) before deleting the cloud doc, so a later-step failure can't
      // leave the folder bound to a deleted project — which made every retry
      // a duplicate_path conflict that only "forget" could escape.
      if (boundWorkspaceId) {
        try {
          await window.electronAPI.workspace!.forget(boundWorkspaceId)
        } catch (cleanupError) {
          console.warn("[LocalProjectImport] Failed to release workspace binding after import error:", cleanupError)
        }
      }
      if (createdProjectId) {
        try {
          await deleteProject({
            projectId: createdProjectId,
            userId: convexUserId,
            confirmName: projectName,
          })
        } catch (cleanupError) {
          console.warn("[LocalProjectImport] Failed to clean up project after import error:", cleanupError)
        }
      }
      return fail(error instanceof Error ? error.message : "Unknown import error.")
    }
  }, [
    convexUserId,
    createProject,
    deleteProject,
    navigateToProjectWorkbench,
    showImportError,
    updateProjectStatus,
  ])

  const importLocalFolder = useCallback(async (): Promise<LocalProjectImportResult> => {
    const selectedPath = await browseForDirectory("Select local project folder")
    if (!selectedPath?.trim()) {
      return { outcome: "cancelled", errorMessage: null }
    }

    return importPickedLocalFolder(selectedPath)
  }, [importPickedLocalFolder])

  return {
    importPickedLocalFolder,
    importLocalFolder,
  }
}
