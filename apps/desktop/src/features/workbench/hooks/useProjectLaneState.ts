import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useDemandGatedInterval } from "@/hooks/useDemandGatedInterval"
import { publishGitRemoteStatus } from "@/features/source-control/model/gitRemoteStatusCache"

import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes"
import {
  buildProjectBranchLaneState,
  readScopedProjectBranchSession,
  rememberProjectBranchSession,
  resolveLaneBranchKnowledge,
} from "@/features/source-control/model/projectBranchSessionStore"
import { normalizeWorkspaceProjectPath } from "@/lib/workspaceIdentity"

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
const laneLoadInflight = new Map<string, Promise<ProjectLaneState | null>>()

// The hook polls every 5s; consumers (ProjectLayout among them) re-render on
// every state identity change. Lane state must therefore keep its object
// identity for unchanged content or the poll becomes a layout-wide re-render
// metronome.
function laneStatesEqual(a: ProjectLaneState | null, b: ProjectLaneState | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

async function loadProjectLaneStateUncached(input: {
  projectId: string
  identityKey: string
  normalizedCollabBranch: string
  normalizedWorkspaceId: string | null
}): Promise<ProjectLaneState | null> {
  const storedSession = readScopedProjectBranchSession(input.projectId, input.normalizedWorkspaceId)
  let activeBranch: string

  if (input.normalizedWorkspaceId) {
    const statusResult = await window.electronAPI.workspaceSync.gitStatus({
      workspaceId: input.normalizedWorkspaceId,
    }).catch(() => null)

    if (statusResult?.success) {
      publishGitRemoteStatus(input.normalizedWorkspaceId, {
        ahead: statusResult.ahead ?? 0,
        behind: statusResult.behind ?? 0,
        error: statusResult.error ?? null,
      })
    } else if (statusResult && statusResult.success === false) {
      publishGitRemoteStatus(input.normalizedWorkspaceId, {
        ahead: 0,
        behind: 0,
        error: statusResult.error ?? "Failed to read git remote status",
      })
    }

    const resolution = resolveLaneBranchKnowledge({
      statusResult,
      storedBranch: storedSession?.activeBranch ?? null,
      collabBranch: input.normalizedCollabBranch,
    })

    if (resolution.kind === "unresolved") {
      // No fresh status, no stored knowledge: building lane state anyway
      // would fabricate the collab lane, flip the workbench scope key, and
      // strand open tiles. Hold (the 5s poll retries) and keep whatever
      // state is already showing.
      return laneStateCache.get(input.identityKey) ?? null
    }

    activeBranch = resolution.branch
    if (resolution.remember) {
      rememberProjectBranchSession({
        projectId: input.projectId,
        branch: activeBranch,
        collabBranch: input.normalizedCollabBranch,
        workspaceId: input.normalizedWorkspaceId,
      })
    }
  } else {
    activeBranch = storedSession?.activeBranch ?? input.normalizedCollabBranch
  }

  const nextLaneState = buildProjectBranchLaneState({
    projectId: input.projectId,
    workspaceId: input.normalizedWorkspaceId ?? storedSession?.workspaceId ?? null,
    collabBranch: input.normalizedCollabBranch,
    activeBranch,
  })

  const cached = laneStateCache.get(input.identityKey) ?? null
  const stableNext =
    nextLaneState && laneStatesEqual(cached, nextLaneState) ? cached : nextLaneState
  if (stableNext) {
    laneStateCache.set(input.identityKey, stableNext)
  } else {
    laneStateCache.delete(input.identityKey)
  }
  return stableNext
}

export async function prefetchProjectLaneState(input: {
  projectId: string
  workspaceId: string | null
  collabBranch: string | null
}): Promise<ProjectLaneState | null> {
  const normalizedCollabBranch = normalizeBranch(input.collabBranch)
  const normalizedWorkspaceId = normalizeWorkspaceProjectPath(input.workspaceId)
  const identityKey = buildLaneIdentityKey(
    input.projectId,
    normalizedCollabBranch,
    normalizedWorkspaceId,
  )
  if (!identityKey) {
    return null
  }

  const cached = laneStateCache.get(identityKey)
  if (cached) {
    return cached
  }

  const pending = laneLoadInflight.get(identityKey)
  if (pending) {
    return pending
  }

  const promise = loadProjectLaneStateUncached({
    projectId: input.projectId,
    identityKey,
    normalizedCollabBranch,
    normalizedWorkspaceId,
  }).finally(() => {
    laneLoadInflight.delete(identityKey)
  })
  laneLoadInflight.set(identityKey, promise)
  return promise
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
      const nextLaneState = await loadProjectLaneStateUncached({
        projectId,
        identityKey,
        normalizedCollabBranch,
        normalizedWorkspaceId,
      })

      if (refreshRequestIdRef.current !== requestId) return

      setScoped((current) =>
        current.identityKey === identityKey &&
        current.laneState === nextLaneState &&
        current.isLoading === (nextLaneState === null)
          ? current
          : { identityKey, laneState: nextLaneState, isLoading: nextLaneState === null },
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

  // Demand-gated (BackgroundPolicy-lite): pause expensive gitStatus polling
  // while the window is hidden; resume (and refresh once) when visible again.
  useDemandGatedInterval(
    () => {
      void refreshLaneState()
    },
    5000,
    {
      enabled: Boolean(projectId && normalizedWorkspaceId),
      pauseWhenDocumentHidden: true,
      runOnResume: true,
    },
  )

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
