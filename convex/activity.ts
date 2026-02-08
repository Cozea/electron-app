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

const ALLOWED_COMMENT_REACTIONS = new Set(["👍", "❤️", "🎉", "😄", "🚀"])

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
      v.literal("delete"),
      v.literal("rename")
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
    /** For renames: the old path before rename */
    oldPath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { projectId, userId, filePath, changeType, oldContent, newContent, additions, deletions, totalLines, origin, userName, oldPath } = args

    // Generate color for user
    const userColor = userId ? generateColor(userId) : "#6b7280"

    await ctx.db.insert("fileChanges", {
      projectId,
      userId,
      filePath,
      changeType,
      oldContent: changeType === "rename" ? oldPath : oldContent,
      newContent: changeType === "rename" ? filePath : newContent,
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

    // Fetch user images for each change
    const results = await Promise.all(
      changes.map(async (change) => {
        let userImage: string | undefined = undefined
        if (change.userId) {
          const user = await ctx.db.get(change.userId)
          userImage = user?.profileImageUrl ?? undefined
        }

        return {
          id: change._id,
          userId: change.userId,
          filePath: change.filePath,
          changeType: change.changeType,
          additions: change.additions,
          deletions: change.deletions,
          totalLines: change.totalLines,
          origin: change.origin,
          userName: change.userName || "Unknown",
          userColor: change.userColor || "#6b7280",
          userImage,
          isAgent: change.origin === "agent",
          timestamp: change.timestamp,
        }
      })
    )

    return results
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

    // Fetch user image if userId exists
    let userImage: string | undefined = undefined
    if (change.userId) {
      const user = await ctx.db.get(change.userId)
      userImage = user?.profileImageUrl ?? undefined
    }

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
      userImage,
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

// ============================================
// CHANGE COMMENTS
// ============================================

/**
 * Add a comment to a file change.
 */
export const addComment = mutation({
  args: {
    changeId: v.id("fileChanges"),
    userId: v.id("users"),
    content: v.string(),
    parentCommentId: v.optional(v.id("changeComments")),
  },
  handler: async (ctx, args) => {
    const { changeId, userId, content, parentCommentId } = args

    // Get the change to get the projectId
    const change = await ctx.db.get(changeId)
    if (!change) {
      throw new Error("Change not found")
    }

    // Get user info
    const user = await ctx.db.get(userId)
    if (!user) {
      throw new Error("User not found")
    }

    if (parentCommentId) {
      const parentComment = await ctx.db.get(parentCommentId)
      if (!parentComment || parentComment.status !== "active") {
        throw new Error("Parent comment not found")
      }
      if (parentComment.changeId !== changeId) {
        throw new Error("Parent comment must belong to the same change")
      }
      if (parentComment.parentCommentId) {
        throw new Error("Only one nested reply level is supported")
      }
    }

    const userName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
    const userColor = generateColor(userId)

    const commentId = await ctx.db.insert("changeComments", {
      changeId,
      projectId: change.projectId,
      userId,
      content,
      userName,
      userColor,
      userImage: user.profileImageUrl,
      parentCommentId,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    return commentId
  },
})

/**
 * Get comments for a specific file change.
 */
export const getCommentsForChange = query({
  args: {
    changeId: v.id("fileChanges"),
    viewerUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("changeComments")
      .withIndex("by_change", (q) => q.eq("changeId", args.changeId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("asc")
      .collect()

    const reactions = await ctx.db
      .query("changeCommentReactions")
      .withIndex("by_change", (q) => q.eq("changeId", args.changeId))
      .collect()

    const activeCommentIds = new Set(comments.map((comment) => comment._id.toString()))
    const reactionsByComment = new Map<
      string,
      Map<string, { count: number; reactedByViewer: boolean }>
    >()

    for (const reaction of reactions) {
      const commentId = reaction.commentId.toString()
      if (!activeCommentIds.has(commentId)) continue

      const byEmoji =
        reactionsByComment.get(commentId) ??
        new Map<string, { count: number; reactedByViewer: boolean }>()

      const reactionSummary = byEmoji.get(reaction.emoji) ?? {
        count: 0,
        reactedByViewer: false,
      }

      reactionSummary.count += 1
      if (args.viewerUserId && reaction.userId === args.viewerUserId) {
        reactionSummary.reactedByViewer = true
      }

      byEmoji.set(reaction.emoji, reactionSummary)
      reactionsByComment.set(commentId, byEmoji)
    }

    return comments.map((comment) => ({
      id: comment._id,
      changeId: comment.changeId,
      userId: comment.userId,
      parentCommentId: comment.parentCommentId,
      content: comment.content,
      userName: comment.userName,
      userColor: comment.userColor,
      userImage: comment.userImage,
      createdAt: comment.createdAt,
      reactions: Array.from(
        reactionsByComment.get(comment._id.toString())?.entries() ?? []
      )
        .map(([emoji, summary]) => ({
          emoji,
          count: summary.count,
          reactedByViewer: summary.reactedByViewer,
        }))
        .sort((a, b) => b.count - a.count),
    }))
  },
})

/**
 * Toggle an emoji reaction on a change comment.
 */
export const toggleCommentReaction = mutation({
  args: {
    commentId: v.id("changeComments"),
    userId: v.id("users"),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const { commentId, userId, emoji } = args

    if (!ALLOWED_COMMENT_REACTIONS.has(emoji)) {
      throw new Error("Unsupported reaction emoji")
    }

    const comment = await ctx.db.get(commentId)
    if (!comment || comment.status !== "active") {
      throw new Error("Comment not found")
    }

    const existingReactions = await ctx.db
      .query("changeCommentReactions")
      .withIndex("by_comment_and_user", (q) =>
        q.eq("commentId", commentId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("emoji"), emoji))
      .collect()

    if (existingReactions.length > 0) {
      await Promise.all(existingReactions.map((reaction) => ctx.db.delete(reaction._id)))
      return { reacted: false }
    }

    await ctx.db.insert("changeCommentReactions", {
      commentId,
      changeId: comment.changeId,
      projectId: comment.projectId,
      userId,
      emoji,
      createdAt: Date.now(),
    })

    return { reacted: true }
  },
})

/**
 * Get comment counts for multiple changes (for timeline display).
 */
export const getCommentCountsForChanges = query({
  args: {
    changeIds: v.array(v.id("fileChanges")),
  },
  handler: async (ctx, args) => {
    const counts: Record<string, number> = {}

    for (const changeId of args.changeIds) {
      const comments = await ctx.db
        .query("changeComments")
        .withIndex("by_change", (q) => q.eq("changeId", changeId))
        .filter((q) => q.eq(q.field("status"), "active"))
        .collect()
      counts[changeId] = comments.length
    }

    return counts
  },
})

/**
 * Count unread changes from other users since a given timestamp.
 * Used for sidebar badge notification.
 */
export const getUnreadChangesCount = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    lastSeenTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const { projectId, userId, lastSeenTimestamp } = args

    // Get all changes since the last seen timestamp
    const changes = await ctx.db
      .query("fileChanges")
      .withIndex("by_project_and_time", (q) => q.eq("projectId", projectId))
      .filter((q) => q.gt(q.field("timestamp"), lastSeenTimestamp))
      .collect()

    // Count only changes from other users (not the current user)
    const unreadCount = changes.filter(
      (change) => change.userId !== userId
    ).length

    return unreadCount
  },
})

/**
 * Delete a comment (soft delete).
 */
export const deleteComment = mutation({
  args: {
    commentId: v.id("changeComments"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId)
    if (!comment) {
      throw new Error("Comment not found")
    }

    // Only allow the author to delete their comment
    if (comment.userId !== args.userId) {
      throw new Error("Not authorized to delete this comment")
    }

    const reactions = await ctx.db
      .query("changeCommentReactions")
      .withIndex("by_comment", (q) => q.eq("commentId", args.commentId))
      .collect()
    await Promise.all(reactions.map((reaction) => ctx.db.delete(reaction._id)))

    await ctx.db.patch(args.commentId, {
      status: "deleted",
      updatedAt: Date.now(),
    })
  },
})
