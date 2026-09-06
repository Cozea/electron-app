import { v } from "convex/values"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { internalMutation } from "./_generated/server"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"

// Presence is considered stale after 60 seconds (2 missed heartbeats)
const PRESENCE_TIMEOUT_MS = 60 * 1000

/** Update presence heartbeat for the authenticated device principal. */
export const heartbeat = mutation({
  args: {
    projectId: v.id("projects"),
    activeTab: v.optional(v.string()),
    activeFile: v.optional(v.string()),
    activeRoute: v.optional(v.string()),
    lastActivityAt: v.optional(v.number()),
    isAiTyping: v.optional(v.boolean()),
    isAgentWorking: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const now = Date.now()
    const displayName = principal.displayName.trim() || "This device"
    const avatarUrl = principal.avatarStorageId ? (await ctx.storage.getUrl(principal.avatarStorageId)) ?? undefined : undefined

    const existing = await ctx.db
      .query("projectPresence")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", principal._id)
      )
      .first()

    const presentation = {
      userName: displayName,
      userAvatarUrl: avatarUrl,
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...presentation,
        lastHeartbeat: now,
        lastActivityAt: args.lastActivityAt ?? now,
        activeTab: args.activeTab,
        activeFile: args.activeFile,
        activeRoute: args.activeRoute,
        isAiTyping: args.isAiTyping ?? false,
        isAgentWorking: args.isAgentWorking ?? false,
      })
    } else {
      await ctx.db.insert("projectPresence", {
        projectId: args.projectId,
        userId: principal._id,
        ...presentation,
        lastHeartbeat: now,
        lastActivityAt: args.lastActivityAt ?? now,
        activeTab: args.activeTab,
        activeFile: args.activeFile,
        activeRoute: args.activeRoute,
        isAiTyping: args.isAiTyping ?? false,
        isAgentWorking: args.isAgentWorking ?? false,
      })
    }
  },
})

/** Remove presence for the authenticated device when it leaves a project. */
export const leave = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const presence = await ctx.db
      .query("projectPresence")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", principal._id)
      )
      .first()

    if (presence) await ctx.db.delete(presence._id)
  },
})

/** Get all active device principals in a project. */
export const getActiveUsers = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - PRESENCE_TIMEOUT_MS
    const presences = await ctx.db
      .query("projectPresence")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()

    return presences
      .filter((p) => p.lastHeartbeat > cutoff)
      .sort(
        (a, b) =>
          (b.lastActivityAt ?? b.lastHeartbeat) -
          (a.lastActivityAt ?? a.lastHeartbeat)
      )
      .map((p) => ({
        id: p._id,
        userId: p.userId,
        userName: p.userName,
        userAvatarUrl: p.userAvatarUrl,
        activeTab: p.activeTab,
        activeFile: p.activeFile,
        activeRoute: p.activeRoute,
        isAiTyping: p.isAiTyping ?? false,
        isAgentWorking: p.isAgentWorking ?? false,
        lastActivityAt: p.lastActivityAt ?? p.lastHeartbeat,
        lastHeartbeat: p.lastHeartbeat,
      }))
  },
})

/** Cleanup stale presence records. */
export const cleanupStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - PRESENCE_TIMEOUT_MS * 2
    const stalePresences = await ctx.db
      .query("projectPresence")
      .withIndex("by_heartbeat", (q) => q.lt("lastHeartbeat", cutoff))
      .collect()

    for (const presence of stalePresences) {
      await ctx.db.delete(presence._id)
    }

    return { deleted: stalePresences.length }
  },
})
