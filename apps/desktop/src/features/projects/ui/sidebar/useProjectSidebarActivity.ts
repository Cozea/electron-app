import * as React from "react"
import { useShallow } from "zustand/react/shallow"

import {
  mergeSidebarActivity,
  resolveDevServerActivity,
  type SidebarActivity,
} from "@/lib/sidebarActivity"
import {
  createAgentsActivitySelector,
  createProjectAgentsActivitySelector,
} from "@/features/projects/ui/sidebar/sidebarActivitySelectors"
import {
  buildDevServerRunKey,
  useDevServerRunStore,
  type DevServerStatus,
} from "@/features/dev-server/devServerRunStore"
import { useStore } from "@/features/assistant/model/assistantStore"
import {
  selectProjectLaneWorkbenches,
  useProjectWorkbenchStore,
  type WorkbenchLaneSidebarSummary,
} from "@/features/workbench/model/workbenchStore"
import { useTileActivityStore } from "@/features/workbench/model/tileActivityStore"

export interface ProjectSidebarActivity {
  /** Everything executing under the project, across every lane. */
  projectActivity: SidebarActivity
  /** The subset the expanded tile rows already show for themselves. */
  visibleActivity: SidebarActivity
}

/**
 * Resolves what a project row should say about running work.
 *
 * Deliberately keyed off `projectId` rather than the active lane: lane state is
 * only fetched for the focused or expanded row, so anything lane-scoped goes
 * quiet the moment you look at a different project. Threads, workbenches and
 * dev-server runs are all held globally, so a background project keeps
 * reporting.
 */
export function useProjectSidebarActivity(input: {
  projectId: string
  workspaceId: string | null
  activeLaneSummary: WorkbenchLaneSidebarSummary | null
  activeDevServerStatus: DevServerStatus
}): ProjectSidebarActivity {
  const { projectId, workspaceId, activeLaneSummary, activeDevServerStatus } = input

  // --- everything under the project ---------------------------------------

  const projectAgentsActivity = useStore(
    React.useMemo(
      () => createProjectAgentsActivitySelector({ projectId, workspaceId }),
      [projectId, workspaceId],
    ),
  )

  const laneScopes = useProjectWorkbenchLaneScopes(projectId, workspaceId)

  const projectDevServerActivity = useDevServerRunStore(
    React.useCallback(
      (state) =>
        mergeSidebarActivity(
          laneScopes.runKeys.map((key) =>
            resolveDevServerActivity(state.runs[key]?.status ?? "idle"),
          ),
        ),
      [laneScopes.runKeys],
    ),
  )

  const projectTilesActivity = useTileActivityStore(
    React.useCallback(
      (state) =>
        mergeSidebarActivity(
          laneScopes.tileIds.map((tileId) => state.activityByTileId[tileId] ?? "idle"),
        ),
      [laneScopes.tileIds],
    ),
  )

  // --- the active lane, which the expanded tile rows render ----------------

  const activeAgentThreadIds = React.useMemo(
    () =>
      (activeLaneSummary?.agents ?? [])
        .map((agent) => agent.threadId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    [activeLaneSummary],
  )

  const visibleAgentsActivity = useStore(
    React.useMemo(() => createAgentsActivitySelector(activeAgentThreadIds), [activeAgentThreadIds]),
  )

  const visibleSurfaceTileIds = React.useMemo(
    () => (activeLaneSummary?.surfaces ?? []).map((surface) => surface.id),
    [activeLaneSummary],
  )

  const visibleTilesActivity = useTileActivityStore(
    React.useCallback(
      (state) =>
        mergeSidebarActivity(
          visibleSurfaceTileIds.map((tileId) => state.activityByTileId[tileId] ?? "idle"),
        ),
      [visibleSurfaceTileIds],
    ),
  )

  return {
    projectActivity: mergeSidebarActivity([
      projectAgentsActivity,
      projectDevServerActivity,
      projectTilesActivity,
    ]),
    visibleActivity: mergeSidebarActivity([
      visibleAgentsActivity,
      resolveDevServerActivity(activeDevServerStatus),
      visibleTilesActivity,
    ]),
  }
}

/**
 * Dev-server run keys and tile ids for every lane of a project that has a
 * workbench. Lanes can sit on their own worktree, so a lane's workspace need
 * not be the project's — take each run key from the workbench that owns it.
 *
 * The ids come back joined so the subscription compares by value instead of
 * handing back a fresh array on every store tick.
 */
function useProjectWorkbenchLaneScopes(
  projectId: string,
  workspaceId: string | null,
): { runKeys: string[]; tileIds: string[] } {
  const scopes = useProjectWorkbenchStore(
    useShallow((state) => {
      const byLane = selectProjectLaneWorkbenches(projectId)(state)
      const runKeys: string[] = []
      const tileIds: string[] = []
      for (const workbench of Object.values(byLane)) {
        const laneWorkspaceId = workbench.workspaceId ?? workspaceId
        if (laneWorkspaceId) {
          runKeys.push(buildDevServerRunKey(laneWorkspaceId, workbench.laneId))
        }
        tileIds.push(...Object.keys(workbench.tiles))
      }
      return { runKeys: runKeys.join(" "), tileIds: tileIds.join(" ") }
    }),
  )

  return React.useMemo(
    () => ({
      runKeys: scopes.runKeys ? scopes.runKeys.split(" ") : [],
      tileIds: scopes.tileIds ? scopes.tileIds.split(" ") : [],
    }),
    [scopes.runKeys, scopes.tileIds],
  )
}
