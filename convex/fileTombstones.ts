import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Create a tombstone when a file is deleted.
 * Used to detect delete-vs-edit conflicts on reconnection.
 */
export const createTombstone = mutation({
  args: {
    projectId: v.id("projects"),
    filePath: v.string(),
    deletedBy: v.optional(v.id("users")),
    deletedByAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    // Check if tombstone already exists
    const existing = await ctx.db
      .query("fileTombstones")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", args.projectId).eq("filePath", args.filePath)
      )
      .first()

    if (existing) {
      // Update existing tombstone
      await ctx.db.patch(existing._id, {
        deletedAt: now,
        deletedBy: args.deletedBy,
        deletedByAgent: args.deletedByAgent,
        expiresAt: now + TOMBSTONE_TTL_MS,
      })
      return existing._id
    }

    // Create new tombstone
    return await ctx.db.insert("fileTombstones", {
      projectId: args.projectId,
      filePath: args.filePath,
      deletedAt: now,
      deletedBy: args.deletedBy,
      deletedByAgent: args.deletedByAgent,
      expiresAt: now + TOMBSTONE_TTL_MS,
    })
  },
})

/**
 * Remove a tombstone when a file is recreated.
 */
export const removeTombstone = mutation({
  args: {
    projectId: v.id("projects"),
    filePath: v.string(),
  },
  handler: async (ctx, args) => {
    const tombstone = await ctx.db
      .query("fileTombstones")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", args.projectId).eq("filePath", args.filePath)
      )
      .first()

    if (tombstone) {
      await ctx.db.delete(tombstone._id)
      return { removed: true }
    }

    return { removed: false }
  },
})

/**
 * Check if a file has a tombstone (was deleted).
 */
export const getTombstone = query({
  args: {
    projectId: v.id("projects"),
    filePath: v.string(),
  },
  handler: async (ctx, args) => {
    const tombstone = await ctx.db
      .query("fileTombstones")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", args.projectId).eq("filePath", args.filePath)
      )
      .first()

    if (!tombstone) return null

    // Check if expired
    if (tombstone.expiresAt < Date.now()) {
      return null
    }

    // Get who deleted it
    let deletedByName: string | null = null
    if (tombstone.deletedBy) {
      const user = await ctx.db.get(tombstone.deletedBy)
      if (user) {
        deletedByName =
          `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email
      }
    } else if (tombstone.deletedByAgent) {
      deletedByName = tombstone.deletedByAgent
    }

    return {
      ...tombstone,
      deletedByName,
    }
  },
})

/**
 * Get all tombstones for a project.
 * Useful for checking conflicts on reconnection.
 */
export const getProjectTombstones = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const now = Date.now()
    const tombstones = await ctx.db
      .query("fileTombstones")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()

    // Filter out expired tombstones
    return tombstones.filter((t) => t.expiresAt > now)
  },
})

/**
 * Cleanup expired tombstones.
 * Should be called periodically by a cron job.
 */
export const cleanupExpiredTombstones = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const now = Date.now()
    const expired = await ctx.db
      .query("fileTombstones")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect()

    for (const tombstone of expired) {
      await ctx.db.delete(tombstone._id)
    }

    return { deleted: expired.length }
  },
})
