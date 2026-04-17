import { useCallback } from "react"
import { useMutation } from "convex/react"

import type { Id } from "../../../../convex/_generated/dataModel"
import { api } from "../../../../convex/_generated/api"
import { useAuth } from "@/contexts/AuthContext"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { browseForDirectory } from "@/features/projects/lib/localProjectImport"
import {
  clearRememberedLocalProjectPath,
  rememberLocalProjectPath,
} from "@/features/projects/lib/projectOpenLocal"
import {
  primeLocalProjectPath,
  suppressLocalProjectPath,
} from "@/features/projects/hooks/useLocalProjectPath"
import {
  clearProjectBranchSession,
} from "@/features/projects/lib/projectBranchSessionStore"
import { clearCachedProjectLaneState } from "@/features/projects/hooks/useProjectLaneState"
import { clonePersistedWorkbenchLayoutsForProjectPath } from "@/features/projects/lib/workbenchLayoutPersistence"
import { useProjectWorkbenchStore } from "@/stores/useProjectWorkbenchStore"
import { useWorkspaceRuntimeStore } from "@/features/projects/workspaces/useWorkspaceRuntimeStore"

interface ProjectWorkspaceActionProject {
  _id: Id<"projects">
  id: string
  name: string
  slug: string
}

interface NavigateOptions {
  replace?: boolean
}

function normalizeProjectPath(projectPath: string | null | undefined): string | null {
  const trimmed = projectPath?.trim()
  return trimmed ? trimmed.replace(/\\/g, "/").replace(/\/+$/, "") : null
}

export function useProjectWorkspaceActions() {
  const navigate = useViewTransitionNavigate()
  const { convexUserId } = useAuth()
  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)
  const cloneProjectPathState = useProjectWorkbenchStore((state) => state.actions.cloneProjectPathState)
  const closeRuntime = useWorkspaceRuntimeStore((state) => state.actions.closeRuntime)

  const relinkProjectWorkspace = useCallback(
    async (
      project: ProjectWorkspaceActionProject,
      currentProjectPath: string | null,
      options?: NavigateOptions,
    ): Promise<string | null> => {
      const nextProjectPath = await browseForDirectory(`Choose local folder for ${project.name}`)
      if (!nextProjectPath) {
        return null
      }

      cloneProjectPathState(project.id, currentProjectPath, nextProjectPath)
      clonePersistedWorkbenchLayoutsForProjectPath({
        projectId: project.id,
        fromProjectPath: currentProjectPath,
        toProjectPath: nextProjectPath,
      })

      await rememberLocalProjectPath({
        projectId: project.id,
        projectPath: nextProjectPath,
        userId: convexUserId,
        updateMemberLocalPath: convexUserId ? updateMemberLocalPath : undefined,
      })

      primeLocalProjectPath(project.id, nextProjectPath, project.slug)

      navigate(buildProjectPath(project.id, "workbench"), {
        replace: options?.replace,
        state: {
          projectId: project.id,
          projectSlug: project.slug,
          projectName: project.name,
          localPath: nextProjectPath,
        },
      })

      return nextProjectPath
    },
    [cloneProjectPathState, convexUserId, navigate, updateMemberLocalPath],
  )

  const closeProjectWorkspace = useCallback(
    async (
      project: ProjectWorkspaceActionProject,
      projectPath: string | null,
      options?: NavigateOptions,
    ): Promise<boolean> => {
      const normalizedProjectPath = normalizeProjectPath(projectPath)
      if (!normalizedProjectPath) {
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
          normalizeProjectPath(session.projectPath) === normalizedProjectPath
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
          normalizeProjectPath(runtimeRecord.config.localPath) === normalizedProjectPath
        ) {
          closeRuntime(runtimeRecord.workspaceId)
        }
      }

      await clearRememberedLocalProjectPath({
        projectId: project.id,
      })

      clearProjectBranchSession(project.id)
      clearCachedProjectLaneState(project.id)
      suppressLocalProjectPath(project.id, normalizedProjectPath, project.slug)

      navigate(buildProjectPath(project.id, "workbench"), {
        replace: options?.replace ?? true,
        state: {
          projectId: project.id,
          projectSlug: project.slug,
          projectName: project.name,
          localPath: null,
        },
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
