import { mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { v } from "convex/values"
import * as Y from "yjs"
import { applyStorageDeltas } from "./lib/workspaceLimits"

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

type YjsSyncCtx = QueryCtx | MutationCtx
const SNAPSHOT_BYTE_THRESHOLD = 5 * 1024 * 1024
const SNAPSHOT_INTERVAL_MS = 3 * 60 * 1000
const SNAPSHOT_RETAIN_COUNT = 5

function defaultRoomId(projectId: Id<"projects">): string {
  return `project:${projectId}`
}

async function getProject(
  ctx: YjsSyncCtx,
  projectId: Id<"projects">
) {
  const project = await ctx.db.get(projectId)
  if (!project) {
    throw new Error("Project not found")
  }

  return project
}

async function assertCollaborationAccess(ctx: YjsSyncCtx, projectId: Id<"projects">) {
  await getProject(ctx, projectId)
}

async function assertCollaborationWriteAllowed(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  _additionalBytes: number
) {
  return await getProject(ctx, projectId)
}

async function getLatestSeq(ctx: YjsSyncCtx, projectId: Id<"projects">): Promise<number> {
  const latest = await ctx.db
    .query("yjsUpdates")
    .withIndex("by_project_and_seq", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first()
  return latest?.seq ?? 0
}

async function insertSequencedUpdate(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">
    roomId?: string
    update: ArrayBuffer
    clientId: string
    origin?: string
    seq?: number
    idempotencyKey?: string
    timestamp?: number
  }
): Promise<{
  seq: number
  created: boolean
}> {
  const project = await assertCollaborationWriteAllowed(ctx, args.projectId, args.update.byteLength)

  if (args.idempotencyKey?.trim()) {
    const existing = await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_idempotency", (q) =>
        q.eq("projectId", args.projectId).eq("idempotencyKey", args.idempotencyKey!.trim())
      )
      .first()
    if (existing) {
      return { seq: existing.seq ?? 0, created: false }
    }
  }

  let nextSeq = typeof args.seq === "number" && Number.isFinite(args.seq) && args.seq > 0
    ? Math.floor(args.seq)
    : (await getLatestSeq(ctx, args.projectId)) + 1

  const conflictingSeq = await ctx.db
    .query("yjsUpdates")
    .withIndex("by_project_and_seq", (q) => q.eq("projectId", args.projectId).eq("seq", nextSeq))
    .first()

  if (conflictingSeq) {
    nextSeq = Math.max(nextSeq, (await getLatestSeq(ctx, args.projectId)) + 1)
  }

  await ctx.db.insert("yjsUpdates", {
    projectId: args.projectId,
    roomId: args.roomId || defaultRoomId(args.projectId),
    seq: nextSeq,
    update: args.update,
    clientId: args.clientId,
    origin: args.origin,
    idempotencyKey: args.idempotencyKey?.trim() || undefined,
    timestamp: args.timestamp ?? Date.now(),
  })

  await applyStorageDeltas(ctx, project.organizationId, {
    collaborationData: args.update.byteLength,
  })

  return { seq: nextSeq, created: true }
}

async function loadServerState(ctx: YjsSyncCtx, projectId: Id<"projects">) {
  const serverDoc = new Y.Doc()
  const latestSnapshot = await ctx.db
    .query("yjsDocuments")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first()

  let serverTimestamp = 0
  let latestSeq = 0
  if (latestSnapshot?.snapshot) {
    Y.applyUpdate(serverDoc, new Uint8Array(latestSnapshot.snapshot), "snapshot")
    serverTimestamp = Math.max(serverTimestamp, latestSnapshot.createdAt)
    latestSeq = Math.max(latestSeq, latestSnapshot.snapshotBaseSeq ?? 0)
  }

  const seqCutoff = latestSnapshot?.snapshotBaseSeq
  const updates = typeof seqCutoff === "number"
    ? await ctx.db
        .query("yjsUpdates")
        .withIndex("by_project_and_seq", (q) =>
          q.eq("projectId", projectId).gt("seq", seqCutoff)
        )
        .collect()
    : latestSnapshot
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

  updates.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  for (const update of updates) {
    Y.applyUpdate(serverDoc, new Uint8Array(update.update), "server")
    serverTimestamp = Math.max(serverTimestamp, update.timestamp)
    latestSeq = Math.max(latestSeq, update.seq ?? latestSeq)
  }

  return {
    serverDoc,
    latestSnapshot,
    updatesSinceSnapshot: updates,
    serverTimestamp,
    latestSeq,
  }
}

/**
 * Broadcast a Yjs update to all clients subscribed to the project.
 * Called when a local client makes changes to the Y.Doc.
 */
export const broadcastUpdate = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
    seq: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
    update: v.bytes(),
    clientId: v.string(),
    origin: v.optional(v.string()),
    timestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const inserted = await insertSequencedUpdate(ctx, {
      projectId: args.projectId,
      roomId: args.roomId,
      seq: args.seq,
      idempotencyKey: args.idempotencyKey,
      update: args.update,
      clientId: args.clientId,
      origin: args.origin,
      timestamp: args.timestamp,
    })

    return {
      seq: inserted.seq,
      created: inserted.created,
    }
  },
})

/**
 * Get all Yjs updates since a given timestamp.
 * Used by legacy clients to tail real-time updates.
 */
export const getUpdatesSince = query({
  args: {
    projectId: v.id("projects"),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    await assertCollaborationAccess(ctx, args.projectId)
    return await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_time", (q) =>
        q.eq("projectId", args.projectId).gt("timestamp", args.since)
      )
      .collect()
  },
})

/**
 * Get all Yjs updates after a given sequence number.
 * Preferred by WS-based clients for exact replay.
 */
export const getUpdatesAfterSeq = query({
  args: {
    projectId: v.id("projects"),
    sinceSeq: v.number(),
  },
  handler: async (ctx, args) => {
    await assertCollaborationAccess(ctx, args.projectId)
    return await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_seq", (q) =>
        q.eq("projectId", args.projectId).gt("seq", Math.max(0, Math.floor(args.sinceSeq)))
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
    await assertCollaborationAccess(ctx, args.projectId)
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
    snapshotBaseSeq: v.optional(v.number()),
    createdByClientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await assertCollaborationWriteAllowed(ctx, args.projectId, args.snapshot.byteLength)
    const fallbackBaseSeq =
      typeof args.snapshotBaseSeq === "number" && Number.isFinite(args.snapshotBaseSeq)
        ? Math.max(0, Math.floor(args.snapshotBaseSeq))
        : await getLatestSeq(ctx, args.projectId)

    await ctx.db.insert("yjsDocuments", {
      projectId: args.projectId,
      snapshot: args.snapshot,
      version: args.version,
      snapshotBaseSeq: fallbackBaseSeq,
      byteSize: args.snapshot.byteLength,
      createdByClientId: args.createdByClientId,
      createdAt: Date.now(),
    })

    await applyStorageDeltas(ctx, project.organizationId, {
      snapshots: args.snapshot.byteLength,
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
    const project = await getProject(ctx, args.projectId)
    const oldUpdates = await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_time", (q) =>
        q.eq("projectId", args.projectId).lt("timestamp", args.olderThan)
      )
      .collect()
    const deletedBytes = oldUpdates.reduce(
      (sum, update) => sum + (update.update?.byteLength ?? 0),
      0
    )

    for (const update of oldUpdates) {
      await ctx.db.delete(update._id)
    }

    if (deletedBytes > 0) {
      await applyStorageDeltas(ctx, project.organizationId, {
        collaborationData: -deletedBytes,
      })
    }

    return { deleted: oldUpdates.length }
  },
})

/**
 * Build snapshot/compact update history when thresholds are met.
 */
export const maybeCompactProject = mutation({
  args: {
    projectId: v.id("projects"),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const project = await getProject(ctx, args.projectId)

    const [latestSnapshot, latestSeqUpdate, recentUpdates] = await Promise.all([
      ctx.db
        .query("yjsDocuments")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .order("desc")
        .first(),
      ctx.db
        .query("yjsUpdates")
        .withIndex("by_project_and_seq", (q) => q.eq("projectId", args.projectId))
        .order("desc")
        .first(),
      ctx.db
        .query("yjsUpdates")
        .withIndex("by_project_and_time", (q) => q.eq("projectId", args.projectId))
        .collect(),
    ])

    const force = args.force === true
    const bytesSinceSnapshot = recentUpdates.reduce((total, entry) => total + entry.update.byteLength, 0)
    const lastSnapshotAt = latestSnapshot?.createdAt ?? 0
    const intervalExceeded = Date.now() - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS
    const byteExceeded = bytesSinceSnapshot >= SNAPSHOT_BYTE_THRESHOLD

    if (!force && !intervalExceeded && !byteExceeded) {
      return {
        compacted: false,
        reason: "threshold-not-reached",
        bytesSinceSnapshot,
      }
    }

    const { serverDoc, latestSeq } = await loadServerState(ctx, args.projectId)
    const snapshot = Y.encodeStateAsUpdate(serverDoc)
    const snapshotBuffer = toArrayBuffer(snapshot)

    await ctx.db.insert("yjsDocuments", {
      projectId: args.projectId,
      snapshot: snapshotBuffer,
      version: Date.now(),
      snapshotBaseSeq: latestSeq,
      byteSize: snapshot.byteLength,
      createdByClientId: latestSeqUpdate?.clientId,
      createdAt: Date.now(),
    })

    const oldUpdates = await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_seq", (q) =>
        q.eq("projectId", args.projectId).lte("seq", latestSeq)
      )
      .collect()

    for (const update of oldUpdates) {
      await ctx.db.delete(update._id)
    }

    const allSnapshots = await ctx.db
      .query("yjsDocuments")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect()

    for (let index = SNAPSHOT_RETAIN_COUNT; index < allSnapshots.length; index += 1) {
      await ctx.db.delete(allSnapshots[index]._id)
    }

    const removedUpdateBytes = oldUpdates.reduce(
      (sum, update) => sum + (update.update?.byteLength ?? 0),
      0
    )
    const removedSnapshotBytes = allSnapshots
      .slice(SNAPSHOT_RETAIN_COUNT)
      .reduce(
        (sum, snapshotDoc) =>
          sum + Math.max(0, snapshotDoc.byteSize ?? snapshotDoc.snapshot?.byteLength ?? 0),
        0
      )

    await applyStorageDeltas(ctx, project.organizationId, {
      collaborationData: -removedUpdateBytes,
      snapshots: snapshot.byteLength - removedSnapshotBytes,
    })

    return {
      compacted: true,
      prunedUpdates: oldUpdates.length,
      retainedSnapshots: Math.min(allSnapshots.length, SNAPSHOT_RETAIN_COUNT),
      snapshotSeq: latestSeq,
      snapshotBytes: snapshot.byteLength,
    }
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
    roomId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.clientUpdate) {
      await insertSequencedUpdate(ctx, {
        projectId: args.projectId,
        roomId: args.roomId,
        idempotencyKey: args.idempotencyKey,
        update: args.clientUpdate,
        clientId: args.clientId,
        origin: "reconnect",
      })
    } else {
      await assertCollaborationAccess(ctx, args.projectId)
    }

    const {
      serverDoc,
      latestSnapshot,
      updatesSinceSnapshot,
      serverTimestamp,
      latestSeq,
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
        seq: update.seq ?? 0,
        roomId: update.roomId,
      })),
      // State-vector-first payload.
      deltaUpdate: toArrayBuffer(deltaUpdate),
      deltaByteLength: deltaUpdate.byteLength,
      serverStateVector: toArrayBuffer(serverStateVector),
      serverTimestamp,
      serverSeq: latestSeq,
    }
  },
})
