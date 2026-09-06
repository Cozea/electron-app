import { useCallback } from "react"
import { useConvex, useMutation } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildWorkbenchHref } from "@/features/workbench/model/lastWorkbenchRoute"
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState"
import { buildWorkbenchIntentState } from "@/features/workbench/model/workbenchIntent"
import {
  deriveProviderFromRepoUrl,
  resolveImportedProjectName,
} from "@/features/projects/lib/localProjectImport"
import { cleanupDeletedProjectLocally } from "@/features/projects/lib/projectLocalCleanup"
import { DEFAULT_WORKBENCH_LANE_ID } from "@/lib/workbenchScopeKey"
import {
  useProjectWorkbenchStore,
} from "@/lib/workbenchStore"

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
  const convex = useConvex()
  const { principalId } = useAuth()
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
    (
      projectId: string,
      projectSlug: string,
      workspaceId: string,
      projectName: string,
      devAppRelativePath?: string | null,
    ) => {
      // Ensure a workbench shell exists, then open the assistant tile so the
      // attachment lands in an active workbench instead of only the sidebar.
      useProjectWorkbenchStore
        .getState()
        .actions.ensureWorkbench(projectId, DEFAULT_WORKBENCH_LANE_ID, workspaceId)

      navigate(
        buildWorkbenchHref(projectId, DEFAULT_WORKBENCH_LANE_ID),
        {
          state: buildProjectRouteNavigationState(
            {
              projectId,
              projectSlug,
              projectName,
              preferredWorkspaceId: workspaceId,
            },
            buildWorkbenchIntentState({
              laneId: DEFAULT_WORKBENCH_LANE_ID,
              ...(devAppRelativePath
                ? {
                    openDevAppPreview: {
                      relativePath: devAppRelativePath,
                      sourceProjectId: projectId,
                      sourceWorkspaceId: workspaceId,
                    },
                  }
                : { openTile: "assistantChat" as const }),
            }),
          ),
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
    requestedName = "",
    options: { requireDevApp?: boolean } = {},
  ): Promise<LocalProjectImportOutcome> => {
    const localFolderPath = selectedPath.trim()
    if (!localFolderPath) {
      return "cancelled"
    }

    if (!principalId) {
      await showImportError("No device identity is ready right now.")
      return "error"
    }

    try {
      const authoringInspection = await window.electronAPI.devAppAuthoring.inspectFolder({
        folderPath: localFolderPath,
      })
      if (!authoringInspection.success) throw new Error(authoringInspection.error)
      if (authoringInspection.inspection.status === "invalid") {
        throw new Error(
          authoringInspection.inspection.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
        )
      }
      if (options.requireDevApp && authoringInspection.inspection.status !== "valid") {
        throw new Error("This folder does not contain a valid cozea-devapp.json manifest.")
      }
      const devAppRelativePath =
        authoringInspection.inspection.status === "valid"
          ? authoringInspection.inspection.source.relativePath
          : null
      const projectName = resolveImportedProjectName(requestedName, localFolderPath)
      let preflight = await window.electronAPI.workspace!.preflightExistingFolder({
        folderPath: localFolderPath,
      })
      if (!preflight.success) {
        throw new Error(preflight.error || "The selected folder could not be opened.")
      }

      if (preflight.existingWorkspace) {
        const existingProjectId = preflight.existingWorkspace.projectId as Id<"projects">
        const accessibleProject = await convex.query(api.projects.getAccessibleById, {
          projectId: existingProjectId,
        })

        if (accessibleProject) {
          navigateToProjectWorkbench(
            String(accessibleProject._id),
            accessibleProject.slug,
            preflight.existingWorkspace.workspaceId,
            accessibleProject.name,
            devAppRelativePath,
          )
          return "imported"
        }

        // The folder still exists, but its device-local catalog entry points at
        // a project the authenticated device cannot see (for example after an
        // identity cutover). Remove every app-owned projection for that binding
        // while preserving the attached source folder, then attach it to a new
        // project owned by the current device below.
        await cleanupDeletedProjectLocally(String(existingProjectId), {
          keepLocalFiles: true,
        })

        preflight = await window.electronAPI.workspace!.preflightExistingFolder({
          folderPath: localFolderPath,
        })
        if (!preflight.success || preflight.existingWorkspace) {
          throw new Error(
            preflight.error ||
              "Cozea could not safely detach the folder from its inaccessible project.",
          )
        }
      }

      const branch = preflight.branch || "main"
      const existingRemoteUrl = preflight.repoIdentity?.url?.trim() || ""
      const provider = existingRemoteUrl ? deriveProviderFromRepoUrl(existingRemoteUrl) : null
      const creationToken = globalThis.crypto.randomUUID()
      const result = await createProject({
        principalId: principalId,
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
            principalId: principalId,
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
        principalId: principalId,
        status: "active",
      })
      navigateToProjectWorkbench(
        String(result.projectId),
        result.slug,
        importResult.workspaceId,
        projectName,
        devAppRelativePath,
      )
      return "imported"
    } catch (error) {
      await showImportError(
        error instanceof Error ? error.message : "Unknown folder attachment error.",
      )
      return "error"
    }
  }, [
    principalId,
    convex,
    createProject,
    deleteProject,
    navigateToProjectWorkbench,
    attachWorkspacePath,
    showImportError,
    updateProjectStatus,
  ])

  return {
    importPickedLocalFolder,
  }
}
