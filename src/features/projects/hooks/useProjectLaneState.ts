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

function normalizeBranch(value: string | null | undefined, fallback = "main"): string {
  const trimmed = value?.trim()
  return trimmed || fallback
}

function buildLaneIdentityKey(
  projectId: string | null,
  collabBranch: string | null,
  projectPath: string | null,
): string | null {
  if (!projectId) return null
  return `${projectId}::${normalizeBranch(collabBranch)}::${normalizeWorkspaceProjectPath(projectPath) ?? "unbound"}`
}

const laneStateCache = new Map<string, ProjectLaneState>()

export function clearCachedProjectLaneState(
  projectId: string | null | undefined,
  projectPath?: string | null,
): void {
  const trimmedProjectId = projectId?.trim()
  if (!trimmedProjectId) {
    return
  }

  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  for (const cacheKey of Array.from(laneStateCache.keys())) {
    if (
      cacheKey.startsWith(`${trimmedProjectId}::`) &&
      (!normalizedProjectPath || cacheKey.endsWith(`::${normalizedProjectPath}`))
    ) {
      laneStateCache.delete(cacheKey)
    }
  }
}

export function useProjectLaneState({
  projectId,
  projectPath,
  collabBranch,
}: UseProjectLaneStateArgs): UseProjectLaneStateResult {
  const normalizedCollabBranch = useMemo(
    () => normalizeBranch(collabBranch),
    [collabBranch],
  )
  const normalizedProjectPath = useMemo(
    () => normalizeWorkspaceProjectPath(projectPath),
    [projectPath],
  )
  const identityKey = useMemo(
    () => buildLaneIdentityKey(projectId, normalizedCollabBranch, normalizedProjectPath),
    [normalizedCollabBranch, normalizedProjectPath, projectId],
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

    setScoped((current) => ({
      identityKey,
      laneState:
        current.identityKey === identityKey
          ? current.laneState
          : laneStateCache.get(identityKey) ?? null,
      isLoading: true,
    }))

    try {
      const storedSession = readScopedProjectBranchSession(projectId, normalizedProjectPath)
      let activeBranch = storedSession?.activeBranch ?? normalizedCollabBranch

      if (normalizedProjectPath) {
        const statusResult = await window.electronAPI.sync.gitStatus({
          projectPath: normalizedProjectPath,
        }).catch(() => null)

        if (statusResult?.success !== false && statusResult?.currentBranch) {
          activeBranch = statusResult.currentBranch
        }

        rememberProjectBranchSession({
          projectId,
          branch: activeBranch,
          collabBranch: normalizedCollabBranch,
          projectPath: normalizedProjectPath,
        })
      }

      const nextLaneState = buildProjectBranchLaneState({
        projectId,
        projectPath: normalizedProjectPath ?? storedSession?.projectPath ?? null,
        collabBranch: normalizedCollabBranch,
        activeBranch,
      })

      if (refreshRequestIdRef.current !== requestId) return

      if (nextLaneState) {
        laneStateCache.set(identityKey, nextLaneState)
      } else {
        laneStateCache.delete(identityKey)
      }

      setScoped({
        identityKey,
        laneState: nextLaneState,
        isLoading: false,
      })
    } catch (error) {
      if (refreshRequestIdRef.current !== requestId) return
      console.error("[ProjectBranchSession] Failed to load branch session state", error)
      setScoped((current) => ({
        identityKey,
        laneState:
          current.identityKey === identityKey
            ? current.laneState
            : laneStateCache.get(identityKey) ?? null,
        isLoading: false,
      }))
    }
  }, [identityKey, normalizedCollabBranch, normalizedProjectPath, projectId])

  useEffect(() => {
    void refreshLaneState()
  }, [refreshLaneState])

  useEffect(() => {
    if (!projectId || !normalizedProjectPath) {
      return
    }

    const interval = window.setInterval(() => {
      void refreshLaneState()
    }, 5000)

    return () => {
      window.clearInterval(interval)
    }
  }, [normalizedProjectPath, projectId, refreshLaneState])

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
