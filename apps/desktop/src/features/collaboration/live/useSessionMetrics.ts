/**
 * Session metrics hook: collects, persists, and formats work telemetry.
 *
 * Tracks time spent in session, code/operations changed, active AutoGit committer,
 * PR status, and activity buckets for the lifetime heatmap.
 */

import { useCallback, useEffect, useMemo, useRef } from "react"
import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import type { LiveSessionAutoGitView, LiveSessionMember } from "./liveSessionModel"
import type { LiveSessionRecord } from "./useLiveSession"

export interface SessionMemberContributionView {
  principalId: string
  displayName: string
  role: "viewer" | "developer" | "project_manager"
  sessionTimeMs: number
  sessionTimeFormatted: string
  operationsCount: number
  sharePercentage: number
  linesAdded?: number
  linesDeleted?: number
  isCurrentGitCommitter: boolean
  isSelf: boolean
  avatarUrl?: string | null
  microphoneState?: string
}

export interface SessionPullRequestView {
  number: number
  title?: string
  url: string
  state: "open" | "closed" | "merged"
  isDraft?: boolean
  ahead?: number
  behind?: number
}

export interface SessionActivityBucketView {
  bucketStart: number
  operations: number
  checkpoints: number
}

export interface UseSessionMetricsResult {
  totalOperations: number
  totalCheckpoints: number
  sessionDurationFormatted: string
  gitLeader: {
    displayName: string
    isSelf: boolean
  } | null
  pullRequest: SessionPullRequestView | null
  members: SessionMemberContributionView[]
  activityBuckets: SessionActivityBucketView[]
  updateMemberRole: (
    principalId: string,
    role: "viewer" | "developer" | "project_manager",
  ) => Promise<void>
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 1) return "< 1m"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  if (hours < 24) {
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
}

export function useSessionMetrics(input: {
  session: LiveSessionRecord | null
  members: readonly LiveSessionMember[]
  autoGit: LiveSessionAutoGitView | null
  workspaceId?: string | null
}): UseSessionMetricsResult {
  const { session, members, autoGit, workspaceId } = input
  const sessionId = session?._id

  const rawMetrics = useQuery(
    api.collaborationSessionMetrics.getMetrics,
    sessionId ? { sessionId } : "skip",
  )

  const recordActivityMutation = useMutation(api.collaborationSessionMetrics.recordActivity)
  const syncGitLeaderAndPRMutation = useMutation(api.collaborationSessionMetrics.syncGitLeaderAndPR)
  const updateMemberRoleMutation = useMutation(api.collaborationSessions.updateMemberRole)

  // Track session uptime periodically while active
  const lastSyncRef = useRef<number>(Date.now())
  useEffect(() => {
    if (!sessionId || session?.lifecycle !== "ACTIVE") return

    const interval = setInterval(() => {
      const now = Date.now()
      const deltaMs = now - lastSyncRef.current
      lastSyncRef.current = now

      // Sync active time delta
      void recordActivityMutation({
        sessionId,
        activeTimeDeltaMs: deltaMs,
      }).catch((err) => {
        console.debug("[useSessionMetrics] heartbeat sync error:", err)
      })
    }, 60000) // sync every 60s

    return () => clearInterval(interval)
  }, [sessionId, session?.lifecycle, recordActivityMutation])

  // Resolve git status & PR info from workspaceSync
  useEffect(() => {
    if (!sessionId || !workspaceId) return
    let isCancelled = false

    void (async () => {
      try {
        if (!window.electronAPI?.workspaceSync?.gitStatus) return
        const status = await window.electronAPI.workspaceSync.gitStatus({ workspaceId })
        if (isCancelled || !status) return

        const prRaw = (status as unknown as Record<string, unknown>).pr as
          | { number: number; title?: string; url?: string; state: "open" | "closed" | "merged"; isDraft?: boolean }
          | undefined

        const ahead = typeof status.ahead === "number" ? status.ahead : undefined
        const behind = typeof status.behind === "number" ? status.behind : undefined

        if (prRaw && typeof prRaw.number === "number" && prRaw.url) {
          await syncGitLeaderAndPRMutation({
            sessionId,
            pullRequest: {
              number: prRaw.number,
              title: prRaw.title,
              url: prRaw.url,
              state: prRaw.state,
              isDraft: prRaw.isDraft,
              ahead,
              behind,
              checkedAt: Date.now(),
            },
          })
        }
      } catch (err) {
        console.debug("[useSessionMetrics] PR lookup warning:", err)
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [sessionId, workspaceId, syncGitLeaderAndPRMutation])

  // Current Git committer resolution
  const selfMember = useMemo(() => members.find((m) => m.isSelf), [members])
  const gitLeader = useMemo(() => {
    if (rawMetrics?.activeGitLeader) {
      return {
        displayName: rawMetrics.activeGitLeader.displayName,
        isSelf: Boolean(selfMember && String(rawMetrics.activeGitLeader.principalId) === String(selfMember.principalId)),
      }
    }
    if (autoGit?.title?.includes("This Mac saves")) {
      return {
        displayName: selfMember?.displayName ?? "You",
        isSelf: true,
      }
    }
    const otherLeader = members.find((m) => !m.isSelf && autoGit?.title?.includes(m.displayName))
    if (otherLeader) {
      return {
        displayName: otherLeader.displayName,
        isSelf: false,
      }
    }
    return null
  }, [rawMetrics?.activeGitLeader, autoGit?.title, members, selfMember])

  const totalOperations = useMemo(() => {
    return rawMetrics?.totalOperations ?? 0
  }, [rawMetrics?.totalOperations])

  const totalCheckpoints = useMemo(() => {
    return rawMetrics?.totalCheckpoints ?? 0
  }, [rawMetrics?.totalCheckpoints])

  const sessionDurationFormatted = useMemo(() => {
    const durationMs = rawMetrics?.totalSessionDurationMs ?? (session?.createdAt ? Date.now() - session.createdAt : 0)
    return formatDuration(durationMs)
  }, [rawMetrics?.totalSessionDurationMs, session?.createdAt])

  // Merge live members with persisted metrics contributions
  const memberContributions: SessionMemberContributionView[] = useMemo(() => {
    interface PersistedMemberContribution {
      principalId: string
      displayName?: string
      role?: string
      sessionTimeMs?: number
      operationsCount?: number
      linesAdded?: number
      linesDeleted?: number
    }
    const rawContributions = (rawMetrics?.memberContributions ?? []) as PersistedMemberContribution[]
    const contributionMap = new Map(rawContributions.map((c) => [String(c.principalId), c]))

    const allPrincipalIds = new Set([
      ...members.map((m) => String(m.principalId)),
      ...rawContributions.map((c) => String(c.principalId)),
    ])

    const totalOps = totalOperations > 0 ? totalOperations : 1

    return Array.from(allPrincipalIds).map((principalId) => {
      const live = members.find((m) => String(m.principalId) === principalId)
      const persisted = contributionMap.get(principalId)

      const displayName = live?.displayName ?? persisted?.displayName ?? "Collaborator"
      const role = (live?.role ?? persisted?.role ?? "developer") as "viewer" | "developer" | "project_manager"
      const opsCount = persisted?.operationsCount ?? 0
      const sessionTimeMs = persisted?.sessionTimeMs ?? (session?.createdAt ? Date.now() - session.createdAt : 0)
      const sharePercentage = Math.round((opsCount / totalOps) * 100)

      const isCurrentGitCommitter = Boolean(
        (gitLeader?.isSelf && live?.isSelf) ||
        (gitLeader && !gitLeader.isSelf && gitLeader.displayName === displayName),
      )

      return {
        principalId,
        displayName,
        role,
        sessionTimeMs,
        sessionTimeFormatted: formatDuration(sessionTimeMs),
        operationsCount: opsCount,
        sharePercentage,
        linesAdded: persisted?.linesAdded,
        linesDeleted: persisted?.linesDeleted,
        isCurrentGitCommitter,
        isSelf: Boolean(live?.isSelf),
        avatarUrl: live?.avatarUrl,
        microphoneState: live?.microphoneState,
      }
    })
  }, [members, rawMetrics?.memberContributions, totalOperations, session?.createdAt, gitLeader])

  const pullRequest: SessionPullRequestView | null = useMemo(() => {
    if (!rawMetrics?.pullRequest) return null
    return {
      number: rawMetrics.pullRequest.number,
      title: rawMetrics.pullRequest.title,
      url: rawMetrics.pullRequest.url,
      state: rawMetrics.pullRequest.state,
      isDraft: rawMetrics.pullRequest.isDraft,
      ahead: rawMetrics.pullRequest.ahead,
      behind: rawMetrics.pullRequest.behind,
    }
  }, [rawMetrics?.pullRequest])

  const activityBuckets: SessionActivityBucketView[] = useMemo(() => {
    if (rawMetrics?.activityBuckets && rawMetrics.activityBuckets.length > 0) {
      return rawMetrics.activityBuckets
    }
    // Generate a baseline bucket from session creation
    const now = Date.now()
    const bucketInterval = 15 * 60 * 1000
    const start = Math.floor(now / bucketInterval) * bucketInterval
    return [
      {
        bucketStart: start,
        operations: totalOperations,
        checkpoints: totalCheckpoints,
      },
    ]
  }, [rawMetrics?.activityBuckets, totalOperations, totalCheckpoints])

  const handleUpdateMemberRole = useCallback(
    async (principalId: string, role: "viewer" | "developer" | "project_manager") => {
      if (!sessionId) return
      await updateMemberRoleMutation({
        sessionId,
        principalId: principalId as Id<"devicePrincipals">,
        role,
      })
    },
    [sessionId, updateMemberRoleMutation],
  )

  return {
    totalOperations,
    totalCheckpoints,
    sessionDurationFormatted,
    gitLeader,
    pullRequest,
    members: memberContributions,
    activityBuckets,
    updateMemberRole: handleUpdateMemberRole,
  }
}
