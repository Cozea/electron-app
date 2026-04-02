import { useCallback, useEffect, useMemo, useState } from "react"

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
  refreshLaneState: () => Promise<void>
}

export function useProjectLaneState({
  projectId,
  projectPath,
  collabBranch,
}: UseProjectLaneStateArgs): UseProjectLaneStateResult {
  const [laneState, setLaneState] = useState<ProjectLaneState | null>(null)

  const refreshLaneState = useCallback(async () => {
    if (!projectId) {
      setLaneState(null)
      return
    }

    try {
      if (projectPath && collabBranch) {
        const ensuredLaneState = await window.electronAPI.project.ensureCollabLane({
          projectId,
          projectPath,
          branch: collabBranch,
        })
        setLaneState(ensuredLaneState)
        return
      }

      const existingLaneState = await window.electronAPI.project.getLaneState({ projectId })
      setLaneState(existingLaneState)
    } catch (error) {
      console.error("[ProjectLane] Failed to load lane state", error)
      setLaneState(null)
    }
  }, [collabBranch, projectId, projectPath])

  useEffect(() => {
    void refreshLaneState()
  }, [refreshLaneState])

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
    refreshLaneState,
  }
}
