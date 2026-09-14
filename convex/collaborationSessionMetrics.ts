/**
 * Collaboration Session Metrics and Lifetime Work Telemetry.
 *
 * Persists session activity, time spent per contributor, code changes,
 * active AutoGit committer, PR tracking, and time-bucketed activity heatmap data.
 */

import { ConvexError, v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import {
  mutation as publicMutation,
  query as publicQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import { canAccessProject } from "./lib/projectAccess"

async function getCallerOrNull(ctx: QueryCtx | MutationCtx) {
  try {
    return await requireAuthenticatedDevice(ctx)
  } catch {
    return null
  }
}


const pullRequestValidator = v.object({
  number: v.number(),
  title: v.optional(v.string()),
  url: v.string(),
  state: v.union(v.literal("open"), v.literal("closed"), v.literal("merged")),
  isDraft: v.optional(v.boolean()),
  ahead: v.optional(v.number()),
  behind: v.optional(v.number()),
  checkedAt: v.number(),
})

const gitLeaderValidator = v.object({
  principalId: v.id("devicePrincipals"),
  identityKey: v.string(),
  displayName: v.string(),
})

async function requireSessionAccess(
  ctx: MutationCtx,
  sessionId: Id<"collaborationSessions">,
) {
  const caller = await requireAuthenticatedDevice(ctx)
  const session = await ctx.db.get(sessionId)
  if (!session) {
    throw new ConvexError("Collaboration session not found")
  }
  const hasAccess = await canAccessProject(ctx, session.projectId, caller._id)
  if (!hasAccess) {
    throw new ConvexError("Access denied to collaboration session")
  }
  return { caller, session }
}

async function getCallerWithSessionAccess(
  ctx: QueryCtx,
  sessionId: Id<"collaborationSessions">,
) {
  const caller = await getCallerOrNull(ctx)
  if (!caller) return null
  const session = await ctx.db.get(sessionId)
  if (!session) return null
  const hasAccess = await canAccessProject(ctx, session.projectId, caller._id)
  if (!hasAccess) return null
  return { caller, session }
}

export const getMetrics = publicQuery({
  args: {
    sessionId: v.id("collaborationSessions"),
  },
  handler: async (ctx, args) => {
    const auth = await getCallerWithSessionAccess(ctx, args.sessionId)
    if (!auth) return null
    const { session } = auth

    const existing = await ctx.db
      .query("collaborationSessionMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .first()

    if (existing) {
      return existing
    }

    // Baseline fallback if no record has been written yet
    const members = await ctx.db
      .query("collaborationSessionMembers")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect()

    const autoGit = await ctx.db
      .query("collaborationAutoGit")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .first()

    const memberContributions = []
    for (const m of members) {
      if (m.status === "revoked") continue
      const principal = await ctx.db.get(m.principalId)
      const isLeader = Boolean(
        autoGit?.leaderIdentityKey &&
          principal?.identityKey &&
          autoGit.leaderIdentityKey === principal.identityKey,
      )
      const duration = m.leftAt
        ? m.leftAt - m.joinedAt
        : Math.max(0, Date.now() - m.joinedAt)

      memberContributions.push({
        principalId: m.principalId,
        displayName: principal?.displayName ?? "Cozea member",
        role: m.role,
        sessionTimeMs: duration,
        operationsCount: session.lastDurableSeq ?? 0,
        linesAdded: undefined,
        linesDeleted: undefined,
        isCurrentGitCommitter: isLeader,
        lastActiveAt: m.leftAt ?? Date.now(),
      })
    }

    const now = Date.now()
    const bucketInterval = 15 * 60 * 1000
    const currentBucketStart = Math.floor(now / bucketInterval) * bucketInterval
    const initialBuckets = [
      {
        bucketStart: currentBucketStart,
        operations: session.lastDurableSeq ?? 0,
        checkpoints: session.lastAutoGitCheckpointSeq ? 1 : 0,
      },
    ]

    return {
      _id: "preview" as Id<"collaborationSessionMetrics">,
      _creationTime: session.createdAt,
      sessionId: session._id,
      publicSessionId: session.publicSessionId,
      projectId: session.projectId,
      totalOperations: session.lastDurableSeq ?? 0,
      totalCheckpoints: session.lastAutoGitCheckpointSeq ? 1 : 0,
      totalSessionDurationMs: Math.max(0, now - session.createdAt),
      activeGitLeader: autoGit?.leaderIdentityKey
        ? {
            principalId: session.createdByPrincipalId,
            identityKey: autoGit.leaderIdentityKey,
            displayName: "Git Committer",
          }
        : undefined,
      pullRequest: undefined,
      memberContributions,
      activityBuckets: initialBuckets,
      updatedAt: session.updatedAt,
    }
  },
})

export const recordActivity = publicMutation({
  args: {
    sessionId: v.id("collaborationSessions"),
    operationsDelta: v.optional(v.number()),
    checkpointsDelta: v.optional(v.number()),
    linesAddedDelta: v.optional(v.number()),
    linesDeletedDelta: v.optional(v.number()),
    activeTimeDeltaMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { caller, session } = await requireSessionAccess(ctx, args.sessionId)
    const now = Date.now()
    const bucketInterval = 15 * 60 * 1000 // 15-minute bucket granularity
    const currentBucketStart = Math.floor(now / bucketInterval) * bucketInterval

    const existing = await ctx.db
      .query("collaborationSessionMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .first()

    const opsDelta = Math.max(0, args.operationsDelta ?? 0)
    const checkDelta = Math.max(0, args.checkpointsDelta ?? 0)
    const linesAddDelta = args.linesAddedDelta ?? 0
    const linesDelDelta = args.linesDeletedDelta ?? 0
    const timeDelta = Math.max(0, args.activeTimeDeltaMs ?? 0)

    if (existing) {
      // Update activity buckets
      const buckets = [...existing.activityBuckets]
      const lastBucket = buckets[buckets.length - 1]
      if (lastBucket && lastBucket.bucketStart === currentBucketStart) {
        lastBucket.operations += opsDelta
        lastBucket.checkpoints += checkDelta
      } else {
        buckets.push({
          bucketStart: currentBucketStart,
          operations: opsDelta,
          checkpoints: checkDelta,
        })
        // Keep up to 100 recent buckets to prevent unbounded growth
        if (buckets.length > 100) {
          buckets.shift()
        }
      }

      // Update member contributions
      const members = [...existing.memberContributions]
      const memberIndex = members.findIndex(
        (m) => String(m.principalId) === String(caller._id),
      )
      if (memberIndex >= 0) {
        const current = members[memberIndex]
        members[memberIndex] = {
          ...current,
          operationsCount: current.operationsCount + opsDelta,
          sessionTimeMs: current.sessionTimeMs + timeDelta,
          linesAdded: (current.linesAdded ?? 0) + linesAddDelta,
          linesDeleted: (current.linesDeleted ?? 0) + linesDelDelta,
          lastActiveAt: now,
        }
      } else {
        members.push({
          principalId: caller._id,
          displayName: caller.displayName || "Cozea member",
          role: "developer",
          sessionTimeMs: timeDelta,
          operationsCount: opsDelta,
          linesAdded: linesAddDelta,
          linesDeleted: linesDelDelta,
          isCurrentGitCommitter: false,
          lastActiveAt: now,
        })
      }

      const totalOps = existing.totalOperations + opsDelta
      const totalChecks = existing.totalCheckpoints + checkDelta
      const totalDuration = existing.totalSessionDurationMs + timeDelta

      await ctx.db.patch(existing._id, {
        totalOperations: totalOps,
        totalCheckpoints: totalChecks,
        totalSessionDurationMs: totalDuration,
        memberContributions: members,
        activityBuckets: buckets,
        updatedAt: now,
      })

      return { success: true }
    }

    // Insert new metrics row
    const initialBuckets = [
      {
        bucketStart: currentBucketStart,
        operations: opsDelta || (session.lastDurableSeq ?? 0),
        checkpoints: checkDelta,
      },
    ]

    const initialMembers = [
      {
        principalId: caller._id,
        displayName: caller.displayName || "Cozea member",
        role: "developer" as const,
        sessionTimeMs: timeDelta || Math.max(0, now - session.createdAt),
        operationsCount: opsDelta || (session.lastDurableSeq ?? 0),
        linesAdded: linesAddDelta,
        linesDeleted: linesDelDelta,
        isCurrentGitCommitter: false,
        lastActiveAt: now,
      },
    ]

    await ctx.db.insert("collaborationSessionMetrics", {
      sessionId: session._id,
      publicSessionId: session.publicSessionId,
      projectId: session.projectId,
      totalOperations: opsDelta || (session.lastDurableSeq ?? 0),
      totalCheckpoints: checkDelta,
      totalSessionDurationMs: Math.max(0, now - session.createdAt),
      activeGitLeader: undefined,
      pullRequest: undefined,
      memberContributions: initialMembers,
      activityBuckets: initialBuckets,
      updatedAt: now,
    })

    return { success: true }
  },
})

export const syncGitLeaderAndPR = publicMutation({
  args: {
    sessionId: v.id("collaborationSessions"),
    activeGitLeader: v.optional(gitLeaderValidator),
    pullRequest: v.optional(pullRequestValidator),
  },
  handler: async (ctx, args) => {
    const { session } = await requireSessionAccess(ctx, args.sessionId)
    const now = Date.now()

    const existing = await ctx.db
      .query("collaborationSessionMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .first()

    if (existing) {
      const patchData: Record<string, unknown> = { updatedAt: now }
      if (args.activeGitLeader !== undefined) {
        patchData.activeGitLeader = args.activeGitLeader
        // Update isCurrentGitCommitter on memberContributions
        const updatedMembers = existing.memberContributions.map((m) => ({
          ...m,
          isCurrentGitCommitter:
            args.activeGitLeader !== undefined &&
            String(m.principalId) === String(args.activeGitLeader.principalId),
        }))
        patchData.memberContributions = updatedMembers
      }
      if (args.pullRequest !== undefined) {
        patchData.pullRequest = args.pullRequest
      }
      await ctx.db.patch(existing._id, patchData)
      return { success: true }
    }

    // Insert new row if missing
    await ctx.db.insert("collaborationSessionMetrics", {
      sessionId: session._id,
      publicSessionId: session.publicSessionId,
      projectId: session.projectId,
      totalOperations: session.lastDurableSeq ?? 0,
      totalCheckpoints: session.lastAutoGitCheckpointSeq ? 1 : 0,
      totalSessionDurationMs: Math.max(0, now - session.createdAt),
      activeGitLeader: args.activeGitLeader,
      pullRequest: args.pullRequest,
      memberContributions: [],
      activityBuckets: [],
      updatedAt: now,
    })

    return { success: true }
  },
})
