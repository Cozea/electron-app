import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes"
import {
  buildProjectBranchLaneState,
  readScopedProjectBranchSession,
  rememberProjectBranchSession,
} from "@/features/projects/lib/projectBranchSessionStore"
import { normalizeWorkspaceProjectPath } from "@/features/projects/workspaces/workspaceIdentity"

interface UseProjectLaneStateArgs {
  projectId: string | null
  workspaceId: string | null
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

function normalizeBranch(value: string | null | undefined, fallback = "main"): string {
  const trimmed = value?.trim()
  return trimmed || fallback
}

function buildLaneIdentityKey(
  projectId: string | null,
  collabBranch: string | null,
  workspaceId: string | null,
): string | null {
  if (!projectId) return null
  return `${projectId}::${normalizeBranch(collabBranch)}::${normalizeWorkspaceProjectPath(workspaceId) ?? "unbound"}`
}

const laneStateCache = new Map<string, ProjectLaneState>()

// The hook polls every 5s; consumers (ProjectLayout among them) re-render on
// every state identity change. Lane state must therefore keep its object
// identity for unchanged content or the poll becomes a layout-wide re-render
// metronome.
function laneStatesEqual(a: ProjectLaneState | null, b: ProjectLaneState | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

export function clearCachedProjectLaneState(
  projectId: string | null | undefined,
  workspaceId?: string | null,
): void {
  const trimmedProjectId = projectId?.trim()
  if (!trimmedProjectId) {
    return
  }

  const normalizedWorkspaceId = normalizeWorkspaceProjectPath(workspaceId)
  for (const cacheKey of Array.from(laneStateCache.keys())) {
    if (
      cacheKey.startsWith(`${trimmedProjectId}::`) &&
      (!normalizedWorkspaceId || cacheKey.endsWith(`::${normalizedWorkspaceId}`))
    ) {
      laneStateCache.delete(cacheKey)
    }
  }
}

export function useProjectLaneState({
  projectId,
  workspaceId,
  collabBranch,
}: UseProjectLaneStateArgs): UseProjectLaneStateResult {
  const normalizedCollabBranch = useMemo(
    () => normalizeBranch(collabBranch),
    [collabBranch],
  )
  const normalizedWorkspaceId = useMemo(
    () => normalizeWorkspaceProjectPath(workspaceId),
    [workspaceId],
  )
  const identityKey = useMemo(
    () => buildLaneIdentityKey(projectId, normalizedCollabBranch, normalizedWorkspaceId),
    [normalizedCollabBranch, normalizedWorkspaceId, projectId],
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
      setScoped((current) =>
        current.identityKey === identityKey && current.laneState === null && !current.isLoading
          ? current
          : { identityKey, laneState: null, isLoading: false },
      )
      return
    }

    setScoped((current) => {
      const carried =
        current.identityKey === identityKey
          ? current.laneState
          : laneStateCache.get(identityKey) ?? null
      // Background refreshes with data in hand are not "loading": flipping the
      // flag re-rendered every consumer twice per 5s poll.
      const nextLoading = carried === null
      if (
        current.identityKey === identityKey &&
        current.laneState === carried &&
        current.isLoading === nextLoading
      ) {
        return current
      }
      return { identityKey, laneState: carried, isLoading: nextLoading }
    })

    try {
      const storedSession = readScopedProjectBranchSession(projectId, normalizedWorkspaceId)
      let activeBranch = storedSession?.activeBranch ?? normalizedCollabBranch

      if (normalizedWorkspaceId) {
        const statusResult = await window.electronAPI.workspaceSync.gitStatus({
          workspaceId: normalizedWorkspaceId,
        }).catch(() => null)

        if (statusResult?.success !== false && statusResult?.currentBranch) {
          activeBranch = statusResult.currentBranch
        }

        rememberProjectBranchSession({
          projectId,
          branch: activeBranch,
          collabBranch: normalizedCollabBranch,
          workspaceId: normalizedWorkspaceId,
        })
      }

      const nextLaneState = buildProjectBranchLaneState({
        projectId,
        workspaceId: normalizedWorkspaceId ?? storedSession?.workspaceId ?? null,
        collabBranch: normalizedCollabBranch,
        activeBranch,
      })

      if (refreshRequestIdRef.current !== requestId) return

      // Re-use the cached object when content is unchanged so downstream
      // identity checks (and React bail-outs) hold across polls.
      const cached = laneStateCache.get(identityKey) ?? null
      const stableNext =
        nextLaneState && laneStatesEqual(cached, nextLaneState) ? cached : nextLaneState
      if (stableNext) {
        laneStateCache.set(identityKey, stableNext)
      } else {
        laneStateCache.delete(identityKey)
      }

      setScoped((current) =>
        current.identityKey === identityKey &&
        current.laneState === stableNext &&
        !current.isLoading
          ? current
          : { identityKey, laneState: stableNext, isLoading: false },
      )
    } catch (error) {
      if (refreshRequestIdRef.current !== requestId) return
      console.error("[ProjectBranchSession] Failed to load branch session state", error)
      setScoped((current) => {
        const carried =
          current.identityKey === identityKey
            ? current.laneState
            : laneStateCache.get(identityKey) ?? null
        if (
          current.identityKey === identityKey &&
          current.laneState === carried &&
          !current.isLoading
        ) {
          return current
        }
        return { identityKey, laneState: carried, isLoading: false }
      })
    }
  }, [identityKey, normalizedCollabBranch, normalizedWorkspaceId, projectId])

  useEffect(() => {
    void refreshLaneState()
  }, [refreshLaneState])

  useEffect(() => {
    if (!projectId || !normalizedWorkspaceId) {
      return
    }

    const interval = window.setInterval(() => {
      void refreshLaneState()
    }, 5000)

    return () => {
      window.clearInterval(interval)
    }
  }, [normalizedWorkspaceId, projectId, refreshLaneState])

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
