import { useCallback } from "react"
import { requireLocalProjectsApi } from "@/features/projects/lib/localProjectsApi"
import { appToast } from "@/lib/appToast"

import { useNavigateTo } from "@/lib/navigation"
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState"
import { buildWorkbenchIntentState } from "@/features/workbench/model/workbenchIntent"
import {
  buildFilesystemSlug,
  resolveImportedProjectName,
} from "@/features/projects/lib/localProjectImport"
import { DEFAULT_WORKBENCH_LANE_ID } from "@/lib/workbenchScopeKey"
import {
  useProjectWorkbenchStore,
} from "@/lib/workbenchStore"

export type LocalProjectImportOutcome =
  | "cancelled"
  | "imported"
  | "error"

export function useLocalProjectImport() {
  const navigateTo = useNavigateTo()

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

      navigateTo(
        // The lane is already in the state intent. A duplicate URL lane causes
        // legacy query cleanup to discard the intent before scope hydration.
        { to: "workbench", projectId },
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
                : { ensureTile: "assistantChat" as const }),
            }),
          ),
        },
      )
    },
    [navigateTo],
  )

  const showImportError = useCallback(async (detail: string) => {
    appToast.error({
      title: "Cozea couldn't attach that local folder.",
      description: detail,
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
      const result = await requireLocalProjectsApi().open({
        operationId: globalThis.crypto.randomUUID(),
        name: projectName,
        slug: buildFilesystemSlug(projectName),
        folderPath: localFolderPath,
      })
      if (!result.success) throw new Error(result.error)
      navigateToProjectWorkbench(
        result.value.project.projectId,
        result.value.project.slug,
        result.value.workspace.workspaceId,
        result.value.project.name,
        devAppRelativePath,
      )
      return "imported"
    } catch (error) {
      await showImportError(
        error instanceof Error ? error.message : "Unknown folder attachment error.",
      )
      return "error"
    }
  }, [navigateToProjectWorkbench, showImportError])

  return {
    importPickedLocalFolder,
  }
}
