import { useCallback, useEffect, useRef } from "react"

import { activateProjectBranchLane } from "@/features/source-control/model/projectBranchSessionStore"
import { type WorkbenchTileType } from "@/lib/workbenchTileContract"
import {
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/lib/workbenchStore"
import { useChangesSidebarStore } from "@/features/source-control/model/changesSidebarStore"

function normalizeOpenTargetParam(
  value: string | null,
):
  | "changes"
  | Extract<WorkbenchTileType, "terminal" | "assistantChat">
  | null {
  if (
    value === "changes" ||
    value === "terminal" ||
    value === "assistantChat"
  ) {
    return value
  }

  return null
}

export interface WorkbenchSearchParamIntent {
  requestedLaneId: string | null
  requestedOpenTarget:
    | "changes"
    | Extract<WorkbenchTileType, "terminal" | "assistantChat">
    | null
  requestedFocusTileId: string | null
  shouldWaitForLaneNavigation: boolean
  shouldClearResolvedLane: boolean
}

export function deriveWorkbenchSearchParamIntent(
  searchParams: URLSearchParams,
  activeLaneId: string,
): WorkbenchSearchParamIntent {
  const requestedLaneId = searchParams.get("lane")
  const requestedOpenTarget = normalizeOpenTargetParam(searchParams.get("openTile"))
  const requestedFocusTileId = searchParams.get("focusTile")
  const shouldWaitForLaneNavigation =
    Boolean(requestedLaneId) && requestedLaneId !== activeLaneId

  return {
    requestedLaneId,
    requestedOpenTarget: shouldWaitForLaneNavigation ? null : requestedOpenTarget,
    requestedFocusTileId: shouldWaitForLaneNavigation ? null : requestedFocusTileId,
    shouldWaitForLaneNavigation,
    shouldClearResolvedLane:
      requestedLaneId === activeLaneId && !requestedOpenTarget && !requestedFocusTileId,
  }
}

export function buildClosedChangesSearchParams(
  searchParams: URLSearchParams,
): URLSearchParams {
  const nextParams = new URLSearchParams(searchParams)
  nextParams.delete("changes")
  nextParams.delete("openTile")
  nextParams.delete("userId")
  return nextParams
}

interface UseProjectWorkbenchSearchParamSyncProps {
  projectId: string | null
  activeLaneId: string
  collabBranch: string
  workspaceId: string | null
  searchParams: URLSearchParams
  replaceSearchParams: (nextParams: URLSearchParams) => void
  refreshLaneState: () => Promise<unknown>
  openWorkbenchTarget: (
    target: Extract<WorkbenchTileType, "terminal" | "assistantChat">,
  ) => void
  focusWorkbenchTile: (tileId: string) => void
}

export function useProjectWorkbenchSearchParamSync(
  props: UseProjectWorkbenchSearchParamSyncProps,
) {
  const {
    projectId,
    activeLaneId,
    collabBranch,
    workspaceId,
    searchParams,
    replaceSearchParams,
    refreshLaneState,
    openWorkbenchTarget,
    focusWorkbenchTile,
  } = props
  const appliedOpenIntentRef = useRef<string | null>(null)

  const closeChangesOverlay = useCallback(() => {
    replaceSearchParams(buildClosedChangesSearchParams(searchParams))
    useChangesSidebarStore.getState().actions.close()
  }, [replaceSearchParams, searchParams])

  useEffect(() => {
    if (!projectId) return

    const intent = deriveWorkbenchSearchParamIntent(searchParams, activeLaneId)
    if (!intent.requestedLaneId || !intent.shouldWaitForLaneNavigation) {
      return
    }
    const laneIdToActivate = intent.requestedLaneId

    let isCancelled = false

    void (async () => {
      try {
        activateProjectBranchLane({
          projectId,
          laneId: laneIdToActivate,
          collabBranch,
          workspaceId,
        })

        if (!isCancelled) {
          await refreshLaneState()
        }
      } catch (error) {
        console.warn("[ProjectWorkbenchPage] Failed to activate requested lane", error)
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [activeLaneId, collabBranch, projectId, workspaceId, refreshLaneState, searchParams])

  useEffect(() => {
    if (!projectId) return
    const intent = deriveWorkbenchSearchParamIntent(searchParams, activeLaneId)
    if (!intent.requestedOpenTarget) {
      appliedOpenIntentRef.current = null
      return
    }

    const intentKey = [
      projectId,
      workspaceId ?? "",
      activeLaneId,
      intent.requestedOpenTarget,
      searchParams.toString(),
    ].join("\u0000")
    if (appliedOpenIntentRef.current === intentKey) return
    // Claim before mutating the workbench. StrictMode may replay this effect
    // before the replace-navigation removes the query parameters.
    appliedOpenIntentRef.current = intentKey

    if (intent.requestedOpenTarget === "changes") {
      useChangesSidebarStore.getState().actions.open()
    } else {
      openWorkbenchTarget(intent.requestedOpenTarget)
    }

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete("lane")
    nextParams.delete("openTile")
    replaceSearchParams(nextParams)
  }, [activeLaneId, openWorkbenchTarget, projectId, replaceSearchParams, searchParams, workspaceId])

  useEffect(() => {
    if (!projectId) return
    if (searchParams.get("changes") === "1") {
      useChangesSidebarStore.getState().actions.open()
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete("changes")
      replaceSearchParams(nextParams)
    }
  }, [projectId, replaceSearchParams, searchParams])

  useEffect(() => {
    if (!projectId) return
    const intent = deriveWorkbenchSearchParamIntent(searchParams, activeLaneId)
    if (!intent.requestedFocusTileId) return

    const liveWorkbench =
      selectProjectWorkbench(
        projectId,
        activeLaneId,
        workspaceId,
      )(useProjectWorkbenchStore.getState())

    if (!liveWorkbench) {
      return
    }

    if (liveWorkbench.tiles[intent.requestedFocusTileId]) {
      focusWorkbenchTile(intent.requestedFocusTileId)
    }

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete("lane")
    nextParams.delete("focusTile")
    replaceSearchParams(nextParams)
  }, [activeLaneId, focusWorkbenchTile, projectId, workspaceId, replaceSearchParams, searchParams])

  useEffect(() => {
    if (!projectId) return

    const intent = deriveWorkbenchSearchParamIntent(searchParams, activeLaneId)
    if (!intent.shouldClearResolvedLane) return

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete("lane")
    replaceSearchParams(nextParams)
  }, [activeLaneId, projectId, replaceSearchParams, searchParams])

  return {
    closeChangesOverlay,
  }
}
