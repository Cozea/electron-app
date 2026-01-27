import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

// Color palette for users (consistent with Yjs awareness)
const COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#0ea5e9", // sky
  "#6366f1", // indigo
  "#a855f7", // purple
  "#ec4899", // pink
]

function generateColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  }
  return COLORS[Math.abs(hash) % COLORS.length]
}

/**
 * Log a file change to the activity feed.
 * Called by ProjectFilesPersistence when files are modified.
 */
export const logFileChange = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    filePath: v.string(),
    changeType: v.union(
      v.literal("create"),
      v.literal("modify"),
      v.literal("delete")
    ),
    oldContent: v.optional(v.string()),
    newContent: v.optional(v.string()),
    additions: v.optional(v.number()),
    deletions: v.optional(v.number()),
    totalLines: v.optional(v.number()),
    origin: v.union(
      v.literal("user"),
      v.literal("agent"),
      v.literal("remote"),
      v.literal("init")
    ),
    userName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { projectId, userId, filePath, changeType, oldContent, newContent, additions, deletions, totalLines, origin, userName } = args

    // Generate color for user
    const userColor = userId ? generateColor(userId) : "#6b7280"

    await ctx.db.insert("fileChanges", {
      projectId,
      userId,
      filePath,
      changeType,
      oldContent,
      newContent,
      additions,
      deletions,
      totalLines,
      origin,
      userName,
      userColor,
      timestamp: Date.now(),
    })
  },
})

/**
 * Get recent file changes for a project's activity feed.
 * Returns the last 50 changes, sorted by most recent first.
 * Does not include content to keep payload small.
 */
export const getRecentActivity = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { projectId, limit = 50 } = args

    const changes = await ctx.db
      .query("fileChanges")
      .withIndex("by_project_and_time", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(limit)

    return changes.map((change) => ({
      id: change._id,
      filePath: change.filePath,
      changeType: change.changeType,
      additions: change.additions,
      deletions: change.deletions,
      totalLines: change.totalLines,
      origin: change.origin,
      userName: change.userName || "Unknown",
      userColor: change.userColor || "#6b7280",
      isAgent: change.origin === "agent",
      timestamp: change.timestamp,
    }))
  },
})

/**
 * Get a single file change with content for diff viewing.
 */
export const getChangeWithContent = query({
  args: {
    changeId: v.id("fileChanges"),
  },
  handler: async (ctx, args) => {
    const change = await ctx.db.get(args.changeId)
    if (!change) return null

    return {
      id: change._id,
      filePath: change.filePath,
      changeType: change.changeType,
      oldContent: change.oldContent || "",
      newContent: change.newContent || "",
      additions: change.additions,
      deletions: change.deletions,
      totalLines: change.totalLines,
      origin: change.origin,
      userName: change.userName || "Unknown",
      userColor: change.userColor || "#6b7280",
      isAgent: change.origin === "agent",
      timestamp: change.timestamp,
    }
  },
})

/**
 * Delete old activity entries to prevent unbounded growth.
 * Called periodically or when activity exceeds threshold.
 */
export const cleanupOldActivity = mutation({
  args: {
    projectId: v.id("projects"),
    keepCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { projectId, keepCount = 100 } = args

    // Get all changes for this project
    const allChanges = await ctx.db
      .query("fileChanges")
      .withIndex("by_project_and_time", (q) => q.eq("projectId", projectId))
      .order("desc")
      .collect()

    // Delete entries beyond the keep count
    if (allChanges.length > keepCount) {
      const toDelete = allChanges.slice(keepCount)
      for (const change of toDelete) {
        await ctx.db.delete(change._id)
      }
      return { deleted: toDelete.length }
    }

    return { deleted: 0 }
  },
})
