/**
 * Collaboration Session WebRTC media signaling and presence control plane.
 *
 * Master Specification: Section 23 (Presence & Media), P25.
 * Strictly decoupled from projectd's file-correctness plane.
 */

import { ConvexError, v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import {
  authenticatedMutation as mutation,
  authenticatedQuery as query,
} from "./lib/authenticatedFunctions"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import { canAccessProject } from "./lib/projectAccess"

const microphoneStateValidator = v.union(
  v.literal("muted"),
  v.literal("active"),
  v.literal("speaking"),
  v.literal("off"),
  v.literal("unpermitted"),
)

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
  let caller = null
  try {
    caller = await requireAuthenticatedDevice(ctx)
  } catch {
    return null
  }
  if (!caller) return null
  const session = await ctx.db.get(sessionId)
  if (!session) return null
  const hasAccess = await canAccessProject(ctx, session.projectId, caller._id)
  if (!hasAccess) return null
  return { caller, session }
}

/**
 * Send an SDP offer, answer, or ICE candidate to a remote peer in the session.
 */
export const sendSignal = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
    targetPrincipalId: v.id("devicePrincipals"),
    type: v.union(v.literal("offer"), v.literal("answer"), v.literal("candidate")),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const { caller } = await requireSessionAccess(ctx, args.sessionId)

    if (caller._id === args.targetPrincipalId) {
      throw new ConvexError("Cannot send media signal to self")
    }

    const signalId = await ctx.db.insert("collaborationSessionMediaSignals", {
      sessionId: args.sessionId,
      senderPrincipalId: caller._id,
      targetPrincipalId: args.targetPrincipalId,
      type: args.type,
      payload: args.payload,
      createdAt: Date.now(),
    })

    return { signalId }
  },
})

/**
 * List pending media signals targeted to the authenticated caller.
 */
export const listPendingSignals = query({
  args: {
    sessionId: v.id("collaborationSessions"),
  },
  handler: async (ctx, args) => {
    const access = await getCallerWithSessionAccess(ctx, args.sessionId)
    if (!access) return []

    return await ctx.db
      .query("collaborationSessionMediaSignals")
      .withIndex("by_session_and_target", (q) =>
        q.eq("sessionId", args.sessionId).eq("targetPrincipalId", access.caller._id),
      )
      .collect()
  },
})

/**
 * Consume/ack a signal once processed by the client, preventing table growth.
 */
export const consumeSignal = mutation({
  args: {
    signalId: v.id("collaborationSessionMediaSignals"),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const signal = await ctx.db.get(args.signalId)
    if (!signal) return { success: true }

    if (signal.targetPrincipalId !== caller._id) {
      throw new ConvexError("Not authorized to consume this signal")
    }

    await ctx.db.delete(args.signalId)
    return { success: true }
  },
})

/**
 * Update media and workbench presence for the authenticated caller.
 */
export const updatePresence = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
    microphoneState: microphoneStateValidator,
    isWorkbenchActive: v.boolean(),
    allowBackgroundAudio: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { caller } = await requireSessionAccess(ctx, args.sessionId)

    const existing = await ctx.db
      .query("collaborationSessionPresence")
      .withIndex("by_session_and_principal", (q) =>
        q.eq("sessionId", args.sessionId).eq("principalId", caller._id),
      )
      .first()

    const now = Date.now()

    if (existing) {
      await ctx.db.patch(existing._id, {
        microphoneState: args.microphoneState,
        isWorkbenchActive: args.isWorkbenchActive,
        allowBackgroundAudio: args.allowBackgroundAudio,
        lastHeartbeat: now,
      })
      return { presenceId: existing._id }
    }

    const presenceId = await ctx.db.insert("collaborationSessionPresence", {
      sessionId: args.sessionId,
      principalId: caller._id,
      microphoneState: args.microphoneState,
      isWorkbenchActive: args.isWorkbenchActive,
      allowBackgroundAudio: args.allowBackgroundAudio,
      lastHeartbeat: now,
    })

    return { presenceId }
  },
})

/**
 * Leave media session, cleanly cleaning up presence and pending signals.
 */
export const leaveMediaSession = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
  },
  handler: async (ctx, args) => {
    const { caller } = await requireSessionAccess(ctx, args.sessionId)

    const existing = await ctx.db
      .query("collaborationSessionPresence")
      .withIndex("by_session_and_principal", (q) =>
        q.eq("sessionId", args.sessionId).eq("principalId", caller._id),
      )
      .first()

    if (existing) {
      await ctx.db.delete(existing._id)
    }

    // Clean up any remaining signals targeting caller in this session
    const pendingTargetSignals = await ctx.db
      .query("collaborationSessionMediaSignals")
      .withIndex("by_session_and_target", (q) =>
        q.eq("sessionId", args.sessionId).eq("targetPrincipalId", caller._id),
      )
      .collect()

    for (const signal of pendingTargetSignals) {
      await ctx.db.delete(signal._id)
    }

    return { success: true }
  },
})
