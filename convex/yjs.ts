import { mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { v } from "convex/values"
import * as Y from "yjs"

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

type YjsSyncCtx = QueryCtx | MutationCtx

async function loadServerState(ctx: YjsSyncCtx, projectId: Id<"projects">) {
  const serverDoc = new Y.Doc()
  const latestSnapshot = await ctx.db
    .query("yjsDocuments")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first()

  let serverTimestamp = 0
  if (latestSnapshot?.snapshot) {
    Y.applyUpdate(serverDoc, new Uint8Array(latestSnapshot.snapshot), "snapshot")
    serverTimestamp = Math.max(serverTimestamp, latestSnapshot.createdAt)
  }

  const updates = latestSnapshot
    ? await ctx.db
        .query("yjsUpdates")
        .withIndex("by_project_and_time", (q) =>
          q.eq("projectId", projectId).gt("timestamp", latestSnapshot.createdAt)
        )
        .collect()
    : await ctx.db
        .query("yjsUpdates")
        .withIndex("by_project_and_time", (q) => q.eq("projectId", projectId))
        .collect()

  updates.sort((a, b) => a.timestamp - b.timestamp)
  for (const update of updates) {
    Y.applyUpdate(serverDoc, new Uint8Array(update.update), "server")
    serverTimestamp = Math.max(serverTimestamp, update.timestamp)
  }

  return {
    serverDoc,
    latestSnapshot,
    updatesSinceSnapshot: updates,
    serverTimestamp,
  }
}

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
 * Used by clients to tail real-time updates.
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
 * Kept for compatibility with legacy clients.
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
 * Sync with server using a state-vector-first merge response.
 *
 * Compatibility notes:
 * - Keeps legacy fields (`serverSnapshot`, `recentUpdates`) for older clients.
 * - Adds `deltaUpdate` + `serverStateVector` for efficient sync.
 */
export const syncWithServer = mutation({
  args: {
    projectId: v.id("projects"),
    clientUpdate: v.optional(v.bytes()),
    clientId: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.clientUpdate) {
      await ctx.db.insert("yjsUpdates", {
        projectId: args.projectId,
        update: args.clientUpdate,
        clientId: args.clientId,
        origin: "reconnect",
        timestamp: Date.now(),
      })
    }

    const {
      serverDoc,
      latestSnapshot,
      updatesSinceSnapshot,
      serverTimestamp,
    } = await loadServerState(ctx, args.projectId)

    let clientStateVector: Uint8Array | undefined
    if (args.clientUpdate) {
      try {
        const clientDoc = new Y.Doc()
        Y.applyUpdate(clientDoc, new Uint8Array(args.clientUpdate), "client")
        clientStateVector = Y.encodeStateVector(clientDoc)
      } catch {
        clientStateVector = undefined
      }
    }

    const deltaUpdate = clientStateVector
      ? Y.encodeStateAsUpdate(serverDoc, clientStateVector)
      : Y.encodeStateAsUpdate(serverDoc)

    const serverStateVector = Y.encodeStateVector(serverDoc)

    return {
      // Legacy fields for compatibility.
      serverSnapshot: latestSnapshot?.snapshot ?? null,
      snapshotVersion: latestSnapshot?.version ?? 0,
      snapshotCreatedAt: latestSnapshot?.createdAt ?? 0,
      recentUpdates: updatesSinceSnapshot.map((update) => ({
        update: update.update,
        clientId: update.clientId,
        timestamp: update.timestamp,
      })),
      // State-vector-first payload.
      deltaUpdate: toArrayBuffer(deltaUpdate),
      deltaByteLength: deltaUpdate.byteLength,
      serverStateVector: toArrayBuffer(serverStateVector),
      serverTimestamp,
    }
  },
})
