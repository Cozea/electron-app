import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

/**
 * Broadcast a Yjs update to all clients subscribed to the project.
 * Called when a local client makes changes to the Y.Doc.
 */
export const broadcastUpdate = mutation({
  args: {
    projectId: v.id("projects"),
    update: v.bytes(),
    clientId: v.string(),
    origin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("yjsUpdates", {
      projectId: args.projectId,
      update: args.update,
      clientId: args.clientId,
      origin: args.origin,
      timestamp: Date.now(),
    })
  },
})

/**
 * Get all Yjs updates since a given timestamp.
 * Used by clients to catch up with changes they missed.
 */
export const getUpdatesSince = query({
  args: {
    projectId: v.id("projects"),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_time", (q) =>
        q.eq("projectId", args.projectId).gt("timestamp", args.since)
      )
      .collect()
  },
})

/**
 * Get the latest document snapshot for initialization.
 * Used when a new client joins to get the full document state.
 */
export const getLatestSnapshot = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("yjsDocuments")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first()
  },
})

/**
 * Save a document snapshot for recovery/initialization.
 * Called periodically to create checkpoints.
 */
export const saveSnapshot = mutation({
  args: {
    projectId: v.id("projects"),
    snapshot: v.bytes(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("yjsDocuments", {
      projectId: args.projectId,
      snapshot: args.snapshot,
      version: args.version,
      createdAt: Date.now(),
    })
  },
})

/**
 * Clean up old Yjs updates to prevent table from growing unbounded.
 * Call this after saving a snapshot.
 */
export const cleanupOldUpdates = mutation({
  args: {
    projectId: v.id("projects"),
    olderThan: v.number(),
  },
  handler: async (ctx, args) => {
    const oldUpdates = await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_time", (q) =>
        q.eq("projectId", args.projectId).lt("timestamp", args.olderThan)
      )
      .collect()

    for (const update of oldUpdates) {
      await ctx.db.delete(update._id)
    }

    return { deleted: oldUpdates.length }
  },
})
