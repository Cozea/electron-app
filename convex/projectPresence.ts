import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

// Presence is considered stale after 60 seconds (2 missed heartbeats)
const PRESENCE_TIMEOUT_MS = 60 * 1000

/**
 * Update presence heartbeat for a user in a project.
 * Call this every 30 seconds while the user is viewing the project.
 */
export const heartbeat = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    userName: v.string(),
    userEmail: v.string(),
    userAvatarUrl: v.optional(v.string()),
    activeTab: v.optional(v.string()),
    activeFile: v.optional(v.string()),
    activeRoute: v.optional(v.string()),
    lastActivityAt: v.optional(v.number()),
    isAiTyping: v.optional(v.boolean()),
    isAgentWorking: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const {
      projectId,
      userId,
      userName,
      userEmail,
      userAvatarUrl,
      activeTab,
      activeFile,
      activeRoute,
      lastActivityAt,
      isAiTyping,
      isAgentWorking,
    } = args

    // Check if presence record already exists
    const existing = await ctx.db
      .query("projectPresence")
      .withIndex("by_project_and_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
      .first()

    const now = Date.now()

    if (existing) {
      // Update existing presence
      await ctx.db.patch(existing._id, {
        userName,
        userEmail,
        userAvatarUrl,
        lastHeartbeat: now,
        lastActivityAt: lastActivityAt ?? now,
        activeTab,
        activeFile,
        activeRoute,
        isAiTyping: isAiTyping ?? false,
        isAgentWorking: isAgentWorking ?? false,
      })
    } else {
      // Create new presence record
      await ctx.db.insert("projectPresence", {
        projectId,
        userId,
        userName,
        userEmail,
        userAvatarUrl,
        lastHeartbeat: now,
        lastActivityAt: lastActivityAt ?? now,
        activeTab,
        activeFile,
        activeRoute,
        isAiTyping: isAiTyping ?? false,
        isAgentWorking: isAgentWorking ?? false,
      })
    }
  },
})

/**
 * Remove presence when user leaves the project page.
 */
export const leave = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { projectId, userId } = args

    const presence = await ctx.db
      .query("projectPresence")
      .withIndex("by_project_and_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
      .first()

    if (presence) {
      await ctx.db.delete(presence._id)
    }
  },
})

/**
 * Get all active users in a project (heartbeat within last 60 seconds).
 */
export const getActiveUsers = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const { projectId } = args
    const cutoff = Date.now() - PRESENCE_TIMEOUT_MS

    const presences = await ctx.db
      .query("projectPresence")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()

    // Filter to only active presences and return user info
    const activePresences = presences
      .filter((p) => p.lastHeartbeat > cutoff)
      .sort(
        (a, b) =>
          (b.lastActivityAt ?? b.lastHeartbeat) -
          (a.lastActivityAt ?? a.lastHeartbeat)
      )

    return activePresences
      .map((p) => ({
        id: p._id,
        userId: p.userId,
        userName: p.userName,
        userEmail: p.userEmail,
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

/**
 * Cleanup stale presence records (run periodically via cron or on heartbeat).
 * This is optional - records will naturally be filtered out by getActiveUsers.
 */
export const cleanupStale = mutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - PRESENCE_TIMEOUT_MS * 2 // Delete after 2 minutes of inactivity

    const stalePresences = await ctx.db
      .query("projectPresence")
      .withIndex("by_heartbeat")
      .filter((q) => q.lt(q.field("lastHeartbeat"), cutoff))
      .collect()

    for (const presence of stalePresences) {
      await ctx.db.delete(presence._id)
    }

    return { deleted: stalePresences.length }
  },
})
