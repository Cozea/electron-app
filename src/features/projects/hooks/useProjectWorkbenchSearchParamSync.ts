import { useCallback, useEffect } from "react"

import {
  type WorkbenchTileType,
  buildWorkbenchScopeKey,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"

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
    searchParams,
    replaceSearchParams,
    refreshLaneState,
    openWorkbenchTarget,
    focusWorkbenchTile,
  } = props

  const closeChangesOverlay = useCallback(() => {
    replaceSearchParams(buildClosedChangesSearchParams(searchParams))
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
        await window.electronAPI.project.setActiveLane({
          projectId,
          laneId: laneIdToActivate,
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
  }, [activeLaneId, projectId, refreshLaneState, searchParams])

  useEffect(() => {
    if (!projectId) return
    const intent = deriveWorkbenchSearchParamIntent(searchParams, activeLaneId)
    if (!intent.requestedOpenTarget) return

    if (intent.requestedOpenTarget === "changes") {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete("lane")
      nextParams.delete("openTile")
      nextParams.set("changes", "1")
      replaceSearchParams(nextParams)
      return
    }

    openWorkbenchTarget(intent.requestedOpenTarget)

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete("lane")
    nextParams.delete("openTile")
    replaceSearchParams(nextParams)
  }, [activeLaneId, openWorkbenchTarget, projectId, replaceSearchParams, searchParams])

  useEffect(() => {
    if (!projectId) return
    const intent = deriveWorkbenchSearchParamIntent(searchParams, activeLaneId)
    if (!intent.requestedFocusTileId) return

    const liveWorkbench =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey(projectId, activeLaneId)
      ]

    if (liveWorkbench?.tiles[intent.requestedFocusTileId]) {
      focusWorkbenchTile(intent.requestedFocusTileId)
    }

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete("lane")
    nextParams.delete("focusTile")
    replaceSearchParams(nextParams)
  }, [activeLaneId, focusWorkbenchTile, projectId, replaceSearchParams, searchParams])

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
