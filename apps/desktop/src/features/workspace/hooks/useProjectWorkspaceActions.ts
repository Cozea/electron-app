import { useCallback } from "react"
import { useMutation } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildProjectPath } from "@/contexts/project/projectRoutes"
import { browseForDirectory } from "@/lib/browseForDirectory"
import { formatWorkspaceBindFailure } from "@/features/workspace/formatWorkspaceBindFailure"
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState"
import {
  clearProjectBranchSession,
} from "@/features/source-control/model/projectBranchSessionStore"
import { clearCachedProjectLaneState } from "@/features/workbench/hooks/useProjectLaneState"
import { clonePersistedWorkbenchLayoutsForWorkspace } from "@/features/workbench/model/workbenchLayoutPersistence"
import { useProjectWorkbenchStore } from "@/lib/workbenchStore"
import { useWorkspaceRuntimeStore } from "@/lib/workspaceRuntimeStore"
import { invalidateProjectWorkspaceResolution } from "@/features/workspace/useProjectWorkspaceResolution"
import { evictTerminalViewsForWorkspace } from "@/features/terminal/terminalViewKeepAlive"

interface ProjectWorkspaceActionProject {
  _id: Id<"projects">
  id: string
  name: string
  slug: string
  /** When "provisioning", a successful relink finalizes the saga to active. */
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
  const navigate = useViewTransitionNavigate()
  const { principalId } = useAuth()
  const updateProjectStatus = useMutation(api.projects.updateStatus)
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

      const bindResult = await window.electronAPI.workspace!.attachExistingFolder({
        projectId: project.id,
        folderPath,
        setActive: true,
      })
      if (!bindResult.success || !bindResult.workspace) {
        // Conflicts used to die in a console.warn: the user picked a folder
        // and nothing visibly happened.
        await window.electronAPI.dialog.showMessageBox({
          type: "error",
          buttons: ["OK"],
          defaultId: 0,
          title: "Relink Failed",
          message: `Could not relink ${project.name}`,
          detail: formatWorkspaceBindFailure(bindResult),
          noLink: true,
        })
        return null
      }

      const nextWorkspaceId = bindResult.workspace.workspaceId

      // Finalize the create saga if this relink is the repair for a project
      // left stuck "provisioning" by an earlier crash. Other create flows
      // finalize on their own happy path; relink is the one that didn't.
      if (project.status === "provisioning" && principalId) {
        try {
          await updateProjectStatus({
            projectId: project._id,
            userId: principalId,
            status: "active",
          })
        } catch (finalizeError) {
          console.warn("[ProjectWorkspaceActions] Failed to finalize provisioning project on relink:", finalizeError)
        }
      }

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
    [cloneWorkspaceState, principalId, navigate, updateProjectStatus],
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
