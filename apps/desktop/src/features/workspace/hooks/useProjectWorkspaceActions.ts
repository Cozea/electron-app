import { useCallback } from "react"
import { appToast } from "@/lib/appToast"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useNavigateTo } from "@/lib/navigation"
import { browseForDirectory } from "@/lib/browseForDirectory"
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState"
import {
  clearProjectBranchSession,
} from "@/features/source-control/model/projectBranchSessionStore"
import { clearCachedProjectLaneState } from "@/features/workbench/hooks/useProjectLaneState"
import { useWorkspaceRuntimeStore } from "@/lib/workspaceRuntimeStore"
import { invalidateProjectWorkspaceResolution } from "@/features/workspace/useProjectWorkspaceResolution"
import { evictTerminalViewsForWorkspace } from "@/features/terminal/terminalViewKeepAlive"
import { requireLocalProjectsApi } from "@/features/projects/lib/localProjectsApi"

interface ProjectWorkspaceActionProject {
  _id: Id<"projects"> | null
  id: string
  name: string
  slug: string
  /** Last-known local presentation. Repair never mutates shared status. */
  status?: string
}

interface NavigateOptions {
  replace?: boolean
}

function normalizeWorkspaceId(workspaceId: string | null | undefined): string | null {
  const trimmed = workspaceId?.trim()
  return trimmed || null
}

export function useProjectWorkspaceActions() {
  const navigateTo = useNavigateTo()
  const closeRuntime = useWorkspaceRuntimeStore((state) => state.actions.closeRuntime)

  const repairProjectWorkspace = useCallback(
    async (
      project: ProjectWorkspaceActionProject,
      currentWorkspaceId: string | null,
      folderPath: string,
      options?: NavigateOptions,
    ): Promise<string | null> => {
      const localProject = await requireLocalProjectsApi().get(project.id)
      if (!localProject || !currentWorkspaceId) {
        appToast.error({ title: `Could not repair ${project.name}`, description: "The original folder binding is unavailable. Open the folder as a local project to continue." })
        return null
      }
      const bindResult = await requireLocalProjectsApi().repair({
        operationId: crypto.randomUUID(), projectId: localProject.projectId,
        workspaceId: currentWorkspaceId, folderPath,
      })
      if (!bindResult.success) {
        // Conflicts used to die in a console.warn: the user picked a folder
        // and nothing visibly happened.
        appToast.error({
          title: `Could not relink ${project.name}`,
          description: bindResult.error,
        })
        return null
      }

      const nextWorkspaceId = bindResult.value.workspace.workspaceId

      for (const record of Object.values(useWorkspaceRuntimeStore.getState().runtimes)) {
        if (record.config.projectId === project.id && record.config.workspaceId === currentWorkspaceId) closeRuntime(record.runtimeId)
      }
      evictTerminalViewsForWorkspace(currentWorkspaceId)
      clearProjectBranchSession(project.id, currentWorkspaceId)
      clearCachedProjectLaneState(project.id, currentWorkspaceId)

      invalidateProjectWorkspaceResolution(project.id)

      navigateTo({ to: "workbench", projectId: project.id }, {
        replace: options?.replace,
        state: buildProjectRouteNavigationState({
          projectId: project.id,
          projectSlug: project.slug,
          projectName: project.name,
          preferredWorkspaceId: nextWorkspaceId,
        }),
      })

      return nextWorkspaceId
    },
    [closeRuntime, navigateTo],
  )

  const relinkProjectWorkspace = useCallback(async (
    project: ProjectWorkspaceActionProject,
    currentWorkspaceId: string | null,
    options?: NavigateOptions,
  ): Promise<string | null> => {
    const folderPath = await browseForDirectory(`Choose local folder for ${project.name}`)
    return folderPath ? repairProjectWorkspace(project, currentWorkspaceId, folderPath, options) : null
  }, [repairProjectWorkspace])

  const closeProjectWorkspace = useCallback(
    async (
      project: ProjectWorkspaceActionProject,
      workspaceId: string | null,
      options?: NavigateOptions,
    ): Promise<boolean> => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId)
      if (!normalizedWorkspaceId) {
        return false
      }

      const confirmation = await window.electronAPI.dialog.showMessageBox({
        type: "warning",
        buttons: ["Cancel", "Close Workspace"],
        defaultId: 0,
        cancelId: 0,
        title: "Close Workspace",
        message: `Close ${project.name} on this local root?`,
        detail:
          "Stops this workspace's idle chat sessions, terminals, Dev Server and browser surfaces. Files, conversations, drafts and layouts are kept. Running chats must be stopped first. You can reopen the same workspace later.",
      })

      if (confirmation.response !== 1) {
        return false
      }

      const api = requireLocalProjectsApi()
      const localProject = await api.get(project.id)
      if (!localProject) return false
      const result = await api.close({ operationId: crypto.randomUUID(), projectId: localProject.projectId, workspaceId: normalizedWorkspaceId })
      if (!result.success) {
        appToast.error({ title: `Could not close ${project.name}`, description: result.error })
        return false
      }

      const runtimeRecords = Object.values(useWorkspaceRuntimeStore.getState().runtimes)
      for (const runtimeRecord of runtimeRecords) {
        if (
          String(runtimeRecord.config.projectId ?? "") === project.id &&
          normalizeWorkspaceId(runtimeRecord.config.workspaceId) === normalizedWorkspaceId
        ) {
          closeRuntime(runtimeRecord.runtimeId)
        }
      }

      invalidateProjectWorkspaceResolution(project.id)
      evictTerminalViewsForWorkspace(normalizedWorkspaceId)

      clearProjectBranchSession(project.id, normalizedWorkspaceId)
      clearCachedProjectLaneState(project.id, normalizedWorkspaceId)

      navigateTo({ to: "projects" }, {
        replace: options?.replace ?? true,
      })

      return true
    },
    [closeRuntime, navigateTo],
  )

  return {
    repairProjectWorkspace,
    relinkProjectWorkspace,
    closeProjectWorkspace,
  }
}
