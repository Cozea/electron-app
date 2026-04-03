import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes"

interface UseProjectLaneStateArgs {
  projectId: string | null
  projectPath: string | null
  collabBranch: string | null
}

interface UseProjectLaneStateResult {
  laneState: ProjectLaneState | null
  activeLane: ProjectLaneDescriptor | null
  collabLane: ProjectLaneDescriptor | null
  isLoading: boolean
  refreshLaneState: () => Promise<void>
}

interface ScopedLaneState {
  scopeKey: string | null
  laneState: ProjectLaneState | null
  isLoading: boolean
}

function buildLaneScopeKey(
  projectId: string | null,
  projectPath: string | null,
  collabBranch: string | null,
): string | null {
  if (!projectId) return null
  return [projectId, projectPath ?? "", collabBranch ?? ""].join("::")
}

export function useProjectLaneState({
  projectId,
  projectPath,
  collabBranch,
}: UseProjectLaneStateArgs): UseProjectLaneStateResult {
  const scopeKey = useMemo(
    () => buildLaneScopeKey(projectId, projectPath, collabBranch),
    [collabBranch, projectId, projectPath],
  )
  const [scopedLaneState, setScopedLaneState] = useState<ScopedLaneState>({
    scopeKey,
    laneState: null,
    isLoading: false,
  })
  const refreshRequestIdRef = useRef(0)

  const refreshLaneState = useCallback(async () => {
    const requestId = refreshRequestIdRef.current + 1
    refreshRequestIdRef.current = requestId

    if (!projectId || !scopeKey) {
      setScopedLaneState({
        scopeKey,
        laneState: null,
        isLoading: false,
      })
      return
    }

    setScopedLaneState((current) => ({
      scopeKey,
      laneState: current.scopeKey === scopeKey ? current.laneState : null,
      isLoading: true,
    }))

    try {
      if (projectPath && collabBranch) {
        const ensuredLaneState = await window.electronAPI.project.ensureCollabLane({
          projectId,
          projectPath,
          branch: collabBranch,
        })
        if (refreshRequestIdRef.current !== requestId) return
        setScopedLaneState({
          scopeKey,
          laneState: ensuredLaneState,
          isLoading: false,
        })
        return
      }

      const existingLaneState = await window.electronAPI.project.getLaneState({ projectId })
      if (refreshRequestIdRef.current !== requestId) return
      setScopedLaneState({
        scopeKey,
        laneState: existingLaneState,
        isLoading: false,
      })
    } catch (error) {
      if (refreshRequestIdRef.current !== requestId) return
      console.error("[ProjectLane] Failed to load lane state", error)
      setScopedLaneState({
        scopeKey,
        laneState: null,
        isLoading: false,
      })
    }
  }, [collabBranch, projectId, projectPath, scopeKey])

  useEffect(() => {
    void refreshLaneState()
  }, [refreshLaneState])

  const laneState = scopedLaneState.scopeKey === scopeKey ? scopedLaneState.laneState : null
  const isLoading = scopedLaneState.scopeKey === scopeKey ? scopedLaneState.isLoading : Boolean(scopeKey)

  const activeLane = useMemo(() => {
    if (!laneState) return null

    return (
      laneState.lanes.find((lane) => lane.id === laneState.activeLaneId) ??
      laneState.lanes.find((lane) => lane.id === laneState.collabLaneId) ??
      laneState.lanes[0] ??
      null
    )
  }, [laneState])

  const collabLane = useMemo(() => {
    if (!laneState) return null
    return laneState.lanes.find((lane) => lane.id === laneState.collabLaneId) ?? null
  }, [laneState])

  return {
    laneState,
    activeLane,
    collabLane,
    isLoading,
    refreshLaneState,
  }
}
