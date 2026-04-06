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
  identityKey: string | null
  laneState: ProjectLaneState | null
  isLoading: boolean
}

/** Stable across local path resolution — avoids wiping lanes when `projectPath` goes "" → real path. */
function buildLaneIdentityKey(projectId: string | null, collabBranch: string | null): string | null {
  if (!projectId) return null
  return `${projectId}::${collabBranch ?? ""}`
}

const laneStateCache = new Map<string, ProjectLaneState>()

export function useProjectLaneState({
  projectId,
  projectPath,
  collabBranch,
}: UseProjectLaneStateArgs): UseProjectLaneStateResult {
  const identityKey = useMemo(
    () => buildLaneIdentityKey(projectId, collabBranch),
    [collabBranch, projectId],
  )

  const [scoped, setScoped] = useState<ScopedLaneState>(() => ({
    identityKey,
    laneState: identityKey ? laneStateCache.get(identityKey) ?? null : null,
    isLoading: false,
  }))

  const refreshRequestIdRef = useRef(0)

  useEffect(() => {
    setScoped((current) => {
      if (current.identityKey === identityKey) return current
      const cached = identityKey ? laneStateCache.get(identityKey) ?? null : null
      return {
        identityKey,
        laneState: cached,
        isLoading: false,
      }
    })
  }, [identityKey])

  const refreshLaneState = useCallback(async () => {
    const requestId = refreshRequestIdRef.current + 1
    refreshRequestIdRef.current = requestId

    if (!projectId || !identityKey) {
      setScoped({
        identityKey,
        laneState: null,
        isLoading: false,
      })
      return
    }

    setScoped((current) => {
      if (current.identityKey === identityKey) {
        return {
          identityKey,
          laneState: current.laneState,
          isLoading: true,
        }
      }
      return {
        identityKey,
        laneState: laneStateCache.get(identityKey) ?? null,
        isLoading: true,
      }
    })

    try {
      let nextLaneState: ProjectLaneState

      if (projectPath && collabBranch) {
        nextLaneState = await window.electronAPI.project.ensureCollabLane({
          projectId,
          projectPath,
          branch: collabBranch,
        })
      } else {
        const loaded = await window.electronAPI.project.getLaneState({ projectId })
        if (loaded == null) {
          if (refreshRequestIdRef.current !== requestId) return
          setScoped((current) => ({
            identityKey,
            laneState:
              current.identityKey === identityKey && current.laneState
                ? current.laneState
                : laneStateCache.get(identityKey) ?? null,
            isLoading: false,
          }))
          return
        }
        nextLaneState = loaded
      }

      if (refreshRequestIdRef.current !== requestId) return

      laneStateCache.set(identityKey, nextLaneState)
      setScoped({
        identityKey,
        laneState: nextLaneState,
        isLoading: false,
      })
    } catch (error) {
      if (refreshRequestIdRef.current !== requestId) return
      console.error("[ProjectLane] Failed to load lane state", error)
      setScoped((current) => ({
        identityKey,
        laneState:
          current.identityKey === identityKey && current.laneState
            ? current.laneState
            : laneStateCache.get(identityKey) ?? null,
        isLoading: false,
      }))
    }
  }, [collabBranch, identityKey, projectId, projectPath])

  useEffect(() => {
    void refreshLaneState()
  }, [refreshLaneState])

  const laneState = useMemo(() => {
    if (scoped.identityKey === identityKey) {
      return scoped.laneState
    }
    return identityKey ? laneStateCache.get(identityKey) ?? null : null
  }, [identityKey, scoped.identityKey, scoped.laneState])

  const isLoading = useMemo(() => {
    if (scoped.identityKey === identityKey) {
      return scoped.isLoading
    }
    return Boolean(identityKey)
  }, [identityKey, scoped.identityKey, scoped.isLoading])

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
