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

/**
 * Sync with server using state vectors.
 *
 * This mutation is used during reconnection to efficiently sync:
 * 1. Receives the client's update (changes made while offline)
 * 2. Returns the server's snapshot (for client to compute diff)
 *
 * The client will:
 * 1. Apply the server snapshot to get any remote changes
 * 2. The CRDT will automatically merge local and remote changes
 */
export const syncWithServer = mutation({
  args: {
    projectId: v.id("projects"),
    clientUpdate: v.optional(v.bytes()),
    clientId: v.string(),
  },
  handler: async (ctx, args) => {
    // If client sent an update, store it
    if (args.clientUpdate) {
      await ctx.db.insert("yjsUpdates", {
        projectId: args.projectId,
        update: args.clientUpdate,
        clientId: args.clientId,
        origin: "reconnect",
        timestamp: Date.now(),
      })
    }

    // Return the latest server snapshot
    const serverSnapshot = await ctx.db
      .query("yjsDocuments")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first()

    // Also get any updates since the snapshot
    const recentUpdates = serverSnapshot
      ? await ctx.db
          .query("yjsUpdates")
          .withIndex("by_project_and_time", (q) =>
            q.eq("projectId", args.projectId).gt("timestamp", serverSnapshot.createdAt)
          )
          .collect()
      : []

    return {
      serverSnapshot: serverSnapshot?.snapshot ?? null,
      snapshotVersion: serverSnapshot?.version ?? 0,
      snapshotCreatedAt: serverSnapshot?.createdAt ?? 0,
      recentUpdates: recentUpdates.map((u) => ({
        update: u.update,
        clientId: u.clientId,
        timestamp: u.timestamp,
      })),
    }
  },
})
