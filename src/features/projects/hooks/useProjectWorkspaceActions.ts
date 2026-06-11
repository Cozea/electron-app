import { useCallback } from "react"

import type { Id } from "../../../../convex/_generated/dataModel"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { browseForDirectory } from "@/features/projects/lib/localProjectImport"
import { buildProjectRouteNavigationState } from "@/features/projects/lib/projectNavigationState"
import {
  clearProjectBranchSession,
} from "@/features/projects/lib/projectBranchSessionStore"
import { clearCachedProjectLaneState } from "@/features/projects/hooks/useProjectLaneState"
import { clonePersistedWorkbenchLayoutsForWorkspace } from "@/features/projects/lib/workbenchLayoutPersistence"
import { useProjectWorkbenchStore } from "@/stores/useProjectWorkbenchStore"
import { useWorkspaceRuntimeStore } from "@/features/projects/workspaces/useWorkspaceRuntimeStore"
import { invalidateProjectWorkspaceResolution } from "@/features/projects/workspaces/useProjectWorkspaceResolution"
import { evictTerminalViewsForWorkspace } from "@/features/projects/terminals/terminalViewKeepAlive"

interface ProjectWorkspaceActionProject {
  _id: Id<"projects">
  id: string
  name: string
  slug: string
}

interface NavigateOptions {
  replace?: boolean
}

function normalizeWorkspaceId(workspaceId: string | null | undefined): string | null {
  const trimmed = workspaceId?.trim()
  return trimmed || null
}

export function useProjectWorkspaceActions() {
  const navigate = useViewTransitionNavigate()
  const cloneWorkspaceState = useProjectWorkbenchStore((state) => state.actions.cloneWorkspaceState)
  const closeRuntime = useWorkspaceRuntimeStore((state) => state.actions.closeRuntime)

  const relinkProjectWorkspace = useCallback(
    async (
      project: ProjectWorkspaceActionProject,
      currentWorkspaceId: string | null,
      options?: NavigateOptions,
    ): Promise<string | null> => {
      const folderPath = await browseForDirectory(`Choose local folder for ${project.name}`)
      if (!folderPath) {
        return null
      }

      const bindResult = await window.electronAPI.workspace!.bindExistingFolder({
        projectId: project.id,
        folderPath,
        writeMarker: true,
        setActive: true,
        source: "locate",
      })
      if (!bindResult.success || !bindResult.workspace) {
        console.warn("Failed to relink workspace folder", bindResult.error)
        return null
      }

      const nextWorkspaceId = bindResult.workspace.workspaceId
      invalidateProjectWorkspaceResolution(project.id)
      cloneWorkspaceState(project.id, currentWorkspaceId, nextWorkspaceId)
      clonePersistedWorkbenchLayoutsForWorkspace({
        projectId: project.id,
        fromWorkspace: currentWorkspaceId,
        toWorkspace: nextWorkspaceId,
      })

      navigate(buildProjectPath(project.id, "workbench"), {
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
    [cloneWorkspaceState, navigate],
  )

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
          "This explicitly stops retained terminals, dev servers, and browser bindings for the current local folder. You can relink it again later.",
      })

      if (confirmation.response !== 1) {
        return false
      }

      const sessions = await window.electronAPI.workbenchSession.listSessions()
      const matchingSessions = sessions.filter((session) => {
        return (
          session.projectId === project.id &&
          normalizeWorkspaceId(session.workspaceId) === normalizedWorkspaceId
        )
      })

      await Promise.all(
        matchingSessions.map((session) =>
          window.electronAPI.workbenchSession.closeSession({
            sessionKey: session.sessionKey,
            projectId: session.projectId,
            laneId: session.laneId,
          }),
        ),
      )

      const runtimeRecords = Object.values(useWorkspaceRuntimeStore.getState().runtimes)
      for (const runtimeRecord of runtimeRecords) {
        if (
          String(runtimeRecord.config.projectId ?? "") === project.id &&
          normalizeWorkspaceId(runtimeRecord.config.workspaceId) === normalizedWorkspaceId
        ) {
          closeRuntime(runtimeRecord.runtimeId)
        }
      }

      await window.electronAPI.workspace!.forget(normalizedWorkspaceId)
      invalidateProjectWorkspaceResolution(project.id)
      evictTerminalViewsForWorkspace(normalizedWorkspaceId)

      clearProjectBranchSession(project.id, normalizedWorkspaceId)
      clearCachedProjectLaneState(project.id, normalizedWorkspaceId)

      navigate(buildProjectPath(project.id, "workbench"), {
        replace: options?.replace ?? true,
        state: buildProjectRouteNavigationState({
          projectId: project.id,
          projectSlug: project.slug,
          projectName: project.name,
        }),
      })

      return true
    },
    [closeRuntime, navigate],
  )

  return {
    relinkProjectWorkspace,
    closeProjectWorkspace,
  }
}
