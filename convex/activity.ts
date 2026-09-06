import { v } from "convex/values"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"

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
const EXCLUDED_ACTIVITY_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".vercel",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".pnpm-store",
  ".yarn",
  "tmp",
  "temp",
  "logs",
  "vendor",
  "target",
  "__pycache__",
])
const EXCLUDED_ACTIVITY_FILE_SUFFIXES = [
  ".log",
  ".tmp",
  ".temp",
  ".swp",
  ".swo",
  ".pid",
  "prisma/dev.db",
  "prisma/dev.db-wal",
  "prisma/dev.db-shm",
  ".tsbuildinfo",
  ".eslintcache",
]

function generateColor(principalId: string): string {
  let hash = 0
  for (let i = 0; i < principalId.length; i++) {
    hash = principalId.charCodeAt(i) + ((hash << 5) - hash)
  }
  return COLORS[Math.abs(hash) % COLORS.length]
}

function normalizeActivityPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "").trim().toLowerCase()
}

function shouldExcludeActivityPath(filePath: string): boolean {
  const normalizedPath = normalizeActivityPath(filePath)
  if (!normalizedPath) return false

  const parts = normalizedPath.split("/")
  if (parts.some((segment) => EXCLUDED_ACTIVITY_DIRECTORIES.has(segment))) {
    return true
  }

  return EXCLUDED_ACTIVITY_FILE_SUFFIXES.some((suffix) => (
    normalizedPath.endsWith(suffix) || normalizedPath.endsWith(`/${suffix}`)
  ))
}

/**
 * Log a file change to the activity feed.
 * Called by ProjectFilesPersistence when files are modified.
 */
export const logFileChange = mutation({
  args: {
    projectId: v.id("projects"),
    principalId: v.optional(v.id("devicePrincipals")),
    checkpointGroupId: v.optional(v.string()),
    filePath: v.string(),
    changeType: v.union(
      v.literal("create"),
      v.literal("modify"),
      v.literal("delete"),
      v.literal("rename")
    ),
    additions: v.optional(v.number()),
    deletions: v.optional(v.number()),
    totalLines: v.optional(v.number()),
    origin: v.union(
      v.literal("user"),
      v.literal("agent"),
      v.literal("remote"),
      v.literal("init")
    ),
    sourceOrigin: v.optional(v.string()),
    actorType: v.optional(
      v.union(
        v.literal("user"),
        v.literal("agent"),
        v.literal("system"),
      )
    ),
    actorId: v.optional(v.string()),
    displayName: v.optional(v.string()),
    terminalId: v.optional(v.string()),
    terminalTitle: v.optional(v.string()),
    terminalKind: v.optional(v.string()),
    commandId: v.optional(v.string()),
    commandText: v.optional(v.string()),
    runId: v.optional(v.string()),
    sessionKey: v.optional(v.string()),
    laneId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    gitCwd: v.optional(v.string()),
    changeTimestamp: v.optional(v.number()),
    /** For renames: the old path before rename */
    oldPath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const {
      projectId,
      principalId,
      checkpointGroupId,
      filePath,
      changeType,
      additions,
      deletions,
      totalLines,
      origin,
      sourceOrigin,
      actorType,
      actorId,
      displayName,
      terminalId,
      terminalTitle,
      terminalKind,
      commandId,
      commandText,
      runId,
      sessionKey,
      laneId,
      workspaceId,
      gitCwd,
      changeTimestamp,
      oldPath,
    } = args
    if (shouldExcludeActivityPath(filePath)) {
      return null
    }

    // Generate color for user
    const userColor = principalId ? generateColor(principalId) : "#6b7280"

    return await ctx.db.insert("fileChanges", {
      projectId,
      principalId,
      checkpointGroupId,
      filePath,
      changeType,
      oldPath: changeType === "rename" ? oldPath : undefined,
      additions,
      deletions,
      totalLines,
      origin,
      sourceOrigin,
      actorType,
      actorId,
      displayName,
      terminalId,
      terminalTitle,
      terminalKind,
      commandId,
      commandText,
      runId,
      sessionKey,
      laneId,
      workspaceId,
      gitCwd,
      userColor,
      changeTimestamp,
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
      .take(Math.min(limit * 5, 250))
    const visibleChanges = changes
      .filter((change) => !shouldExcludeActivityPath(change.filePath))
      .slice(0, limit)

    const uniqueUserIds = new Map<string, typeof visibleChanges[number]["principalId"]>()
    for (const change of visibleChanges) {
      if (!change.principalId) continue
      uniqueUserIds.set(change.principalId.toString(), change.principalId)
    }

    const userImageEntries = await Promise.all(
      Array.from(uniqueUserIds.entries()).map(async ([userKey, principalId]) => {
        const user = principalId ? await ctx.db.get(principalId) : null
        return [userKey, user?.avatarStorageId ? (await ctx.storage.getUrl(user.avatarStorageId)) ?? undefined : undefined] as const
      })
    )
    const userImages = new Map(userImageEntries)

    const results = visibleChanges.map((change) => ({
      id: change._id,
      principalId: change.principalId,
      checkpointGroupId: change.checkpointGroupId,
      filePath: change.filePath,
      oldPath: change.oldPath,
      changeType: change.changeType,
      additions: change.additions,
      deletions: change.deletions,
      totalLines: change.totalLines,
      origin: change.origin,
      sourceOrigin: change.sourceOrigin,
      actorType: change.actorType,
      actorId: change.actorId,
      displayName: change.displayName || "Unknown",
      terminalId: change.terminalId,
      terminalTitle: change.terminalTitle,
      terminalKind: change.terminalKind,
      commandId: change.commandId,
      commandText: change.commandText,
      runId: change.runId,
      sessionKey: change.sessionKey,
      laneId: change.laneId,
      workspaceId: change.workspaceId,
      gitCwd: change.gitCwd,
      userColor: change.userColor || "#6b7280",
      userImage: change.principalId ? userImages.get(change.principalId.toString()) : undefined,
      isAgent: change.origin === "agent",
      changeTimestamp: change.changeTimestamp,
      timestamp: change.timestamp,
    }))

    return results
  },
})

export const clearEphemeralChanges = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const changes = await ctx.db
      .query("fileChanges")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()

    const comments = await ctx.db
      .query("changeComments")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()

    const reactions = await Promise.all(
      comments.map((comment) =>
        ctx.db
          .query("changeCommentReactions")
          .withIndex("by_comment", (q) => q.eq("commentId", comment._id))
          .collect()
      )
    )

    for (const commentReactions of reactions) {
      for (const reaction of commentReactions) {
        await ctx.db.delete(reaction._id)
      }
    }

    for (const comment of comments) {
      await ctx.db.delete(comment._id)
    }

    for (const change of changes) {
      await ctx.db.delete(change._id)
    }

    return {
      deletedChanges: changes.length,
      deletedComments: comments.length,
      deletedReactions: reactions.reduce((total, commentReactions) => total + commentReactions.length, 0),
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
    principalId: v.id("devicePrincipals"),
    content: v.string(),
    parentCommentId: v.optional(v.id("changeComments")),
  },
  handler: async (ctx, args) => {
    const { changeId, principalId, content, parentCommentId } = args

    // Get the change to get the projectId
    const change = await ctx.db.get(changeId)
    if (!change) {
      throw new Error("Change not found")
    }

    // Get user info
    const user = await ctx.db.get(principalId)
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

    const displayName = user.displayName
    const userColor = generateColor(principalId)

    const commentId = await ctx.db.insert("changeComments", {
      changeId,
      projectId: change.projectId,
      principalId,
      content,
      displayName,
      userColor,
      userImage: user.avatarStorageId ? (await ctx.storage.getUrl(user.avatarStorageId)) ?? undefined : undefined,
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
    viewerPrincipalId: v.optional(v.id("devicePrincipals")),
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
      if (args.viewerPrincipalId && reaction.principalId === args.viewerPrincipalId) {
        reactionSummary.reactedByViewer = true
      }

      byEmoji.set(reaction.emoji, reactionSummary)
      reactionsByComment.set(commentId, byEmoji)
    }

    return comments.map((comment) => ({
      id: comment._id,
      changeId: comment.changeId,
      principalId: comment.principalId,
      parentCommentId: comment.parentCommentId,
      content: comment.content,
      displayName: comment.displayName,
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
    principalId: v.id("devicePrincipals"),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const { commentId, principalId, emoji } = args

    if (!ALLOWED_COMMENT_REACTIONS.has(emoji)) {
      throw new Error("Unsupported reaction emoji")
    }

    const comment = await ctx.db.get(commentId)
    if (!comment || comment.status !== "active") {
      throw new Error("Comment not found")
    }

    const existingReactions = await ctx.db
      .query("changeCommentReactions")
      .withIndex("by_comment_and_principal", (q) =>
        q.eq("commentId", commentId).eq("principalId", principalId)
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
      principalId,
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
    projectId: v.id("projects"),
    changeIds: v.array(v.id("fileChanges")),
  },
  handler: async (ctx, args) => {
    const counts: Record<string, number> = {}
    const targetChangeIds = new Set(args.changeIds.map((changeId) => changeId.toString()))

    for (const changeId of args.changeIds) {
      counts[changeId] = 0
    }

    if (targetChangeIds.size === 0) {
      return counts
    }

    const comments = await ctx.db
      .query("changeComments")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect()

    for (const comment of comments) {
      const changeKey = comment.changeId.toString()
      if (!targetChangeIds.has(changeKey)) continue
      counts[changeKey] = (counts[changeKey] ?? 0) + 1
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
    principalId: v.id("devicePrincipals"),
    lastSeenTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const { projectId, principalId, lastSeenTimestamp } = args

    // Get all changes since the last seen timestamp
    const changes = await ctx.db
      .query("fileChanges")
      .withIndex("by_project_and_time", (q) => q.eq("projectId", projectId))
      .filter((q) => q.gt(q.field("timestamp"), lastSeenTimestamp))
      .collect()

    // Count only changes from other users (not the current user)
    const unreadCount = changes.filter(
      (change) => change.principalId !== principalId && !shouldExcludeActivityPath(change.filePath)
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
    principalId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId)
    if (!comment) {
      throw new Error("Comment not found")
    }

    // Only allow the author to delete their comment
    if (comment.principalId !== args.principalId) {
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
