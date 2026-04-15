import { mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { v } from "convex/values"
import * as Y from "yjs"
import { applyProjectStorageDeltas } from "./lib/workspaceLimits"

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

type YjsSyncCtx = QueryCtx | MutationCtx
const SNAPSHOT_BYTE_THRESHOLD = 5 * 1024 * 1024
const SNAPSHOT_INTERVAL_MS = 3 * 60 * 1000
const SNAPSHOT_RETAIN_COUNT = 5
const YJS_UPDATE_PAGE_SIZE = 8
const YJS_TAIL_READ_LIMIT = 128
const YJS_CLEANUP_PAGE_SIZE = 64
const YJS_SNAPSHOT_CLEANUP_PAGE_SIZE = 2

interface PaginatedResult<T> {
  page: T[]
  isDone: boolean
  continueCursor: string
}

interface StoredYjsUpdate {
  _id?: Id<"yjsUpdates">
  update: ArrayBuffer
  clientId: string
  timestamp: number
  seq?: number
  roomId?: string
}

interface ActiveRoomKeyRecord {
  _id: Id<"projectCollabRoomKeys">
  projectId: Id<"projects">
  roomId: string
  keyVersion: number
  status: "active" | "rotating" | "revoked"
  createdByUserId: Id<"users">
  createdByDeviceId: string
  createdAt: number
  rotatedAt?: number
}

interface WrappedRoomKeyRecord {
  _id: Id<"projectCollabWrappedKeys">
  projectId: Id<"projects">
  roomId: string
  keyVersion: number
  recipientUserId: Id<"users">
  recipientDeviceId: string
  senderDeviceId: string
  senderPublicKeyJwk: string
  wrapAlgorithm: string
  wrappedKey: string
  createdAt: number
  revokedAt?: number
}

type EncryptionBootstrapStatus =
  | "plaintext_legacy"
  | "room_not_initialized"
  | "ready"
  | "missing_for_device"

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

async function hasAnyStoredCollabData(
  ctx: YjsSyncCtx,
  projectId: Id<"projects">,
): Promise<boolean> {
  const [latestUpdate, latestSnapshot] = await Promise.all([
    ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_time", (q) => q.eq("projectId", projectId))
      .first(),
    ctx.db
      .query("yjsDocuments")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first(),
  ])

  return Boolean(latestUpdate || latestSnapshot)
}

async function getActiveRoomKey(
  ctx: YjsSyncCtx,
  projectId: Id<"projects">,
  roomId: string,
): Promise<ActiveRoomKeyRecord | null> {
  const roomKeys = await ctx.db
    .query("projectCollabRoomKeys")
    .withIndex("by_project_and_room", (q) => q.eq("projectId", projectId).eq("roomId", roomId))
    .collect()

  const active = roomKeys
    .filter((entry) => entry.status === "active")
    .sort((a, b) => b.keyVersion - a.keyVersion)[0]

  return (active ?? null) as ActiveRoomKeyRecord | null
}

async function getWrappedRoomKeyForDevice(
  ctx: YjsSyncCtx,
  args: {
    projectId: Id<"projects">
    roomId: string
    deviceId: string
    keyVersion: number
  },
): Promise<WrappedRoomKeyRecord | null> {
  const candidates = await ctx.db
    .query("projectCollabWrappedKeys")
    .withIndex("by_project_room_and_recipient", (q) =>
      q.eq("projectId", args.projectId).eq("roomId", args.roomId).eq("recipientDeviceId", args.deviceId),
    )
    .collect()

  const match = candidates
    .filter((entry) => entry.keyVersion === args.keyVersion && typeof entry.revokedAt !== "number")
    .sort((a, b) => b.createdAt - a.createdAt)[0]

  return (match ?? null) as WrappedRoomKeyRecord | null
}

async function forEachPaginated<T>(
  fetchPage: (cursor: string | null) => Promise<PaginatedResult<T>>,
  handler: (item: T) => Promise<void> | void
): Promise<void> {
  let cursor: string | null = null

  while (true) {
    const result = await fetchPage(cursor)
    for (const item of result.page) {
      await handler(item)
    }
    if (result.isDone) {
      break
    }
    cursor = result.continueCursor
  }
}

async function collectUpdatesAfterSeq(
  ctx: YjsSyncCtx,
  projectId: Id<"projects">,
  seqCutoff: number
): Promise<StoredYjsUpdate[]> {
  return await ctx.db
    .query("yjsUpdates")
    .withIndex("by_project_and_seq", (q) =>
      q.eq("projectId", projectId).gt("seq", seqCutoff)
    )
    .collect() as StoredYjsUpdate[]
}

async function collectUpdatesAfterTimestamp(
  ctx: YjsSyncCtx,
  projectId: Id<"projects">,
  timestampCutoff: number
): Promise<StoredYjsUpdate[]> {
  return await ctx.db
    .query("yjsUpdates")
    .withIndex("by_project_and_time", (q) =>
      q.eq("projectId", projectId).gt("timestamp", timestampCutoff)
    )
    .collect() as StoredYjsUpdate[]
}

async function collectAllProjectUpdates(
  ctx: YjsSyncCtx,
  projectId: Id<"projects">
): Promise<StoredYjsUpdate[]> {
  return await ctx.db
    .query("yjsUpdates")
    .withIndex("by_project_and_time", (q) => q.eq("projectId", projectId))
    .collect() as StoredYjsUpdate[]
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

  await applyProjectStorageDeltas(ctx, project.organizationId, args.projectId, {
    collaborationData: args.update.byteLength,
  })

  return { seq: nextSeq, created: true }
}

async function loadServerState(
  ctx: YjsSyncCtx,
  projectId: Id<"projects">,
  options?: { includeUpdatesSinceSnapshot?: boolean }
) {
  const serverDoc = new Y.Doc()
  const latestSnapshot = await ctx.db
    .query("yjsDocuments")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first()

  let serverTimestamp = 0
  let latestSeq = 0
  const includeUpdatesSinceSnapshot = options?.includeUpdatesSinceSnapshot !== false
  const updatesSinceSnapshot: Array<{
    update: ArrayBuffer
    clientId: string
    timestamp: number
    seq?: number
    roomId?: string
  }> = []
  if (latestSnapshot?.snapshot) {
    Y.applyUpdate(serverDoc, new Uint8Array(latestSnapshot.snapshot), "snapshot")
    serverTimestamp = Math.max(serverTimestamp, latestSnapshot.createdAt)
    latestSeq = Math.max(latestSeq, latestSnapshot.snapshotBaseSeq ?? 0)
  }

  const seqCutoff = latestSnapshot?.snapshotBaseSeq

  if (typeof seqCutoff === "number") {
    const updates = await collectUpdatesAfterSeq(ctx, projectId, seqCutoff)
    for (const update of updates) {
      Y.applyUpdate(serverDoc, new Uint8Array(update.update), "server")
      serverTimestamp = Math.max(serverTimestamp, update.timestamp)
      latestSeq = Math.max(latestSeq, update.seq ?? latestSeq)
      if (includeUpdatesSinceSnapshot) {
        updatesSinceSnapshot.push(update)
      }
    }
  } else if (latestSnapshot) {
    const updates = await collectUpdatesAfterTimestamp(ctx, projectId, latestSnapshot.createdAt)
    for (const update of updates) {
      Y.applyUpdate(serverDoc, new Uint8Array(update.update), "server")
      serverTimestamp = Math.max(serverTimestamp, update.timestamp)
      latestSeq = Math.max(latestSeq, update.seq ?? latestSeq)
      if (includeUpdatesSinceSnapshot) {
        updatesSinceSnapshot.push(update)
      }
    }
  } else {
    const updates = await collectAllProjectUpdates(ctx, projectId)
    for (const update of updates) {
      Y.applyUpdate(serverDoc, new Uint8Array(update.update), "server")
      serverTimestamp = Math.max(serverTimestamp, update.timestamp)
      latestSeq = Math.max(latestSeq, update.seq ?? latestSeq)
      if (includeUpdatesSinceSnapshot) {
        updatesSinceSnapshot.push(update)
      }
    }
  }

  return {
    serverDoc,
    latestSnapshot,
    updatesSinceSnapshot,
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
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertCollaborationAccess(ctx, args.projectId)
    const maxItems = Math.min(
      YJS_TAIL_READ_LIMIT,
      Math.max(1, Math.floor(args.limit ?? YJS_TAIL_READ_LIMIT))
    )
    return await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_time", (q) =>
        q.eq("projectId", args.projectId).gt("timestamp", args.since)
      )
      .take(maxItems)
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
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertCollaborationAccess(ctx, args.projectId)
    const maxItems = Math.min(
      YJS_TAIL_READ_LIMIT,
      Math.max(1, Math.floor(args.limit ?? YJS_TAIL_READ_LIMIT))
    )
    return await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_seq", (q) =>
        q.eq("projectId", args.projectId).gt("seq", Math.max(0, Math.floor(args.sinceSeq)))
      )
      .take(maxItems)
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

    await applyProjectStorageDeltas(ctx, project.organizationId, args.projectId, {
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
    let deletedCount = 0
    let deletedBytes = 0

    const batch = await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_time", (q) =>
        q.eq("projectId", args.projectId).lt("timestamp", args.olderThan)
      )
      .paginate({
        cursor: null,
        numItems: YJS_CLEANUP_PAGE_SIZE,
      }) as PaginatedResult<{ _id: Id<"yjsUpdates">; update?: ArrayBuffer }>

    for (const update of batch.page) {
      deletedBytes += update.update?.byteLength ?? 0
      deletedCount += 1
      await ctx.db.delete(update._id)
    }

    if (deletedBytes > 0) {
      await applyProjectStorageDeltas(ctx, project.organizationId, args.projectId, {
        collaborationData: -deletedBytes,
      })
    }

    return {
      deleted: deletedCount,
      hasMore: !batch.isDone,
    }
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
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, defaultRoomId(args.projectId))
    if (activeRoomKey) {
      return {
        compacted: false,
        reason: "encrypted-room",
        bytesSinceSnapshot: 0,
      }
    }

    const [latestSnapshot, latestSeqUpdate] = await Promise.all([
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
    ])

    let bytesSinceSnapshot = 0
    const snapshotSeqCutoff = latestSnapshot?.snapshotBaseSeq
    if (typeof snapshotSeqCutoff === "number") {
      await forEachPaginated(
        (cursor) =>
          ctx.db
            .query("yjsUpdates")
            .withIndex("by_project_and_seq", (q) =>
              q.eq("projectId", args.projectId).gt("seq", snapshotSeqCutoff)
            )
            .paginate({
              cursor,
              numItems: YJS_UPDATE_PAGE_SIZE,
            }) as Promise<PaginatedResult<{ update?: ArrayBuffer }>>,
        (entry) => {
          bytesSinceSnapshot += entry.update?.byteLength ?? 0
        }
      )
    } else if (latestSnapshot) {
      await forEachPaginated(
        (cursor) =>
          ctx.db
            .query("yjsUpdates")
            .withIndex("by_project_and_time", (q) =>
              q.eq("projectId", args.projectId).gt("timestamp", latestSnapshot.createdAt)
            )
            .paginate({
              cursor,
              numItems: YJS_UPDATE_PAGE_SIZE,
            }) as Promise<PaginatedResult<{ update?: ArrayBuffer }>>,
        (entry) => {
          bytesSinceSnapshot += entry.update?.byteLength ?? 0
        }
      )
    } else {
      await forEachPaginated(
        (cursor) =>
          ctx.db
            .query("yjsUpdates")
            .withIndex("by_project_and_time", (q) => q.eq("projectId", args.projectId))
            .paginate({
              cursor,
              numItems: YJS_UPDATE_PAGE_SIZE,
            }) as Promise<PaginatedResult<{ update?: ArrayBuffer }>>,
        (entry) => {
          bytesSinceSnapshot += entry.update?.byteLength ?? 0
        }
      )
    }

    const force = args.force === true
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

    const { serverDoc, latestSeq } = await loadServerState(ctx, args.projectId, {
      includeUpdatesSinceSnapshot: false,
    })
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

    let prunedUpdates = 0
    let removedUpdateBytes = 0
    while (true) {
      const batch = await ctx.db
        .query("yjsUpdates")
        .withIndex("by_project_and_seq", (q) =>
          q.eq("projectId", args.projectId).lte("seq", latestSeq)
        )
        .paginate({
          cursor: null,
          numItems: YJS_CLEANUP_PAGE_SIZE,
        }) as PaginatedResult<{ _id: Id<"yjsUpdates">; update?: ArrayBuffer }>

      if (batch.page.length === 0) {
        break
      }

      for (const update of batch.page) {
        removedUpdateBytes += update.update?.byteLength ?? 0
        prunedUpdates += 1
        await ctx.db.delete(update._id)
      }
    }

    const retainedSnapshots = await ctx.db
      .query("yjsDocuments")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(SNAPSHOT_RETAIN_COUNT)
    const retainedSnapshotIds = new Set(retainedSnapshots.map((entry) => entry._id))

    const retainedSnapshotCount = retainedSnapshots.length
    let removedSnapshotBytes = 0
    while (true) {
      const batch = await ctx.db
        .query("yjsDocuments")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .paginate({
          cursor: null,
          numItems: YJS_SNAPSHOT_CLEANUP_PAGE_SIZE,
        }) as PaginatedResult<{
          _id: Id<"yjsDocuments">
          byteSize?: number
          snapshot?: ArrayBuffer
        }>

      if (batch.page.length === 0) {
        break
      }

      let deletedInBatch = 0
      for (const snapshotDoc of batch.page) {
        if (retainedSnapshotIds.has(snapshotDoc._id)) {
          continue
        }
        removedSnapshotBytes += Math.max(
          0,
          snapshotDoc.byteSize ?? snapshotDoc.snapshot?.byteLength ?? 0
        )
        deletedInBatch += 1
        await ctx.db.delete(snapshotDoc._id)
      }

      if (deletedInBatch === 0) {
        break
      }
    }

    await applyProjectStorageDeltas(ctx, project.organizationId, args.projectId, {
      collaborationData: -removedUpdateBytes,
      snapshots: snapshot.byteLength - removedSnapshotBytes,
    })

    return {
      compacted: true,
      prunedUpdates,
      retainedSnapshots: retainedSnapshotCount,
      snapshotSeq: latestSeq,
      snapshotBytes: snapshot.byteLength,
    }
  },
})

export const registerCollabDevice = mutation({
  args: {
    userId: v.id("users"),
    deviceId: v.string(),
    deviceLabel: v.string(),
    platform: v.string(),
    publicKeyJwk: v.string(),
    publicKeyAlgorithm: v.string(),
    fingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("collabDevices")
      .withIndex("by_user_and_device", (q) =>
        q.eq("userId", args.userId).eq("deviceId", args.deviceId),
      )
      .first()

    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, {
        deviceLabel: args.deviceLabel,
        platform: args.platform,
        publicKeyJwk: args.publicKeyJwk,
        publicKeyAlgorithm: args.publicKeyAlgorithm,
        fingerprint: args.fingerprint,
        lastSeenAt: now,
        revokedAt: undefined,
      })
      return { deviceId: args.deviceId, created: false }
    }

    await ctx.db.insert("collabDevices", {
      userId: args.userId,
      deviceId: args.deviceId,
      deviceLabel: args.deviceLabel,
      platform: args.platform,
      publicKeyJwk: args.publicKeyJwk,
      publicKeyAlgorithm: args.publicKeyAlgorithm,
      fingerprint: args.fingerprint,
      createdAt: now,
      lastSeenAt: now,
    })

    return { deviceId: args.deviceId, created: true }
  },
})

export const getEncryptionBootstrap = query({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
    userId: v.id("users"),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertCollaborationAccess(ctx, args.projectId)
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)

    if (!activeRoomKey) {
      const hasCollabData = await hasAnyStoredCollabData(ctx, args.projectId)
      if (hasCollabData) {
        return {
          roomId,
          encryptionRequired: false,
          status: "plaintext_legacy" as EncryptionBootstrapStatus,
          activeKeyVersion: null,
          wrappedRoomKey: null,
          wrapAlgorithm: null,
          senderPublicKeyJwk: null,
        }
      }

      return {
        roomId,
        encryptionRequired: true,
        status: "room_not_initialized" as EncryptionBootstrapStatus,
        activeKeyVersion: 1,
        wrappedRoomKey: null,
        wrapAlgorithm: null,
        senderPublicKeyJwk: null,
      }
    }

    const wrappedKey = await getWrappedRoomKeyForDevice(ctx, {
      projectId: args.projectId,
      roomId,
      deviceId: args.deviceId,
      keyVersion: activeRoomKey.keyVersion,
    })

    if (!wrappedKey) {
      return {
        roomId,
        encryptionRequired: true,
        status: "missing_for_device" as EncryptionBootstrapStatus,
        activeKeyVersion: activeRoomKey.keyVersion,
        wrappedRoomKey: null,
        wrapAlgorithm: null,
        senderPublicKeyJwk: null,
      }
    }

    return {
      roomId,
      encryptionRequired: true,
      status: "ready" as EncryptionBootstrapStatus,
      activeKeyVersion: activeRoomKey.keyVersion,
      wrappedRoomKey: wrappedKey.wrappedKey,
      wrapAlgorithm: wrappedKey.wrapAlgorithm,
      senderPublicKeyJwk: wrappedKey.senderPublicKeyJwk,
    }
  },
})

export const initializeEncryptedRoom = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
    userId: v.id("users"),
    deviceId: v.string(),
    keyVersion: v.number(),
    wrapAlgorithm: v.string(),
    wrappedKey: v.string(),
    senderPublicKeyJwk: v.string(),
  },
  handler: async (ctx, args) => {
    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)
    const roomId = args.roomId || defaultRoomId(args.projectId)

    const existingRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)
    if (existingRoomKey) {
      return { roomId, created: false, keyVersion: existingRoomKey.keyVersion }
    }

    const hasCollabData = await hasAnyStoredCollabData(ctx, args.projectId)
    if (hasCollabData) {
      throw new Error("Cannot initialize encrypted room for an existing plaintext collaboration history")
    }

    const now = Date.now()
    await ctx.db.insert("projectCollabRoomKeys", {
      projectId: args.projectId,
      roomId,
      keyVersion: Math.max(1, Math.floor(args.keyVersion)),
      status: "active",
      createdByUserId: args.userId,
      createdByDeviceId: args.deviceId,
      createdAt: now,
    })

    await ctx.db.insert("projectCollabWrappedKeys", {
      projectId: args.projectId,
      roomId,
      keyVersion: Math.max(1, Math.floor(args.keyVersion)),
      recipientUserId: args.userId,
      recipientDeviceId: args.deviceId,
      senderDeviceId: args.deviceId,
      senderPublicKeyJwk: args.senderPublicKeyJwk,
      wrapAlgorithm: args.wrapAlgorithm,
      wrappedKey: args.wrappedKey,
      createdAt: now,
    })

    return { roomId, created: true, keyVersion: Math.max(1, Math.floor(args.keyVersion)) }
  },
})

export const createKeyRequest = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.string(),
    recipientUserId: v.id("users"),
    recipientDeviceId: v.string(),
    recipientPublicKeyJwk: v.string(),
    recipientFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)
    const existing = await ctx.db
      .query("projectCollabKeyRequests")
      .withIndex("by_project_room_and_device", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", args.roomId).eq("recipientDeviceId", args.recipientDeviceId),
      )
      .first()

    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, {
        recipientPublicKeyJwk: args.recipientPublicKeyJwk,
        recipientFingerprint: args.recipientFingerprint,
        requestedAt: now,
        fulfilledAt: undefined,
      })
      return { requestId: existing._id, created: false }
    }

    const requestId = await ctx.db.insert("projectCollabKeyRequests", {
      projectId: args.projectId,
      roomId: args.roomId,
      recipientUserId: args.recipientUserId,
      recipientDeviceId: args.recipientDeviceId,
      recipientPublicKeyJwk: args.recipientPublicKeyJwk,
      recipientFingerprint: args.recipientFingerprint,
      requestedAt: now,
    })

    return { requestId, created: true }
  },
})

export const listPendingKeyRequests = query({
  args: {
    projectId: v.id("projects"),
    roomId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertCollaborationAccess(ctx, args.projectId)
    const requests = await ctx.db
      .query("projectCollabKeyRequests")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", args.roomId),
      )
      .collect()

    return requests
      .filter((request) => typeof request.fulfilledAt !== "number")
      .sort((a, b) => a.requestedAt - b.requestedAt)
  },
})

export const storeWrappedRoomKey = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.string(),
    keyVersion: v.number(),
    recipientUserId: v.id("users"),
    recipientDeviceId: v.string(),
    senderDeviceId: v.string(),
    senderPublicKeyJwk: v.string(),
    wrapAlgorithm: v.string(),
    wrappedKey: v.string(),
  },
  handler: async (ctx, args) => {
    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)
    const existing = await ctx.db
      .query("projectCollabWrappedKeys")
      .withIndex("by_project_room_and_recipient", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", args.roomId).eq("recipientDeviceId", args.recipientDeviceId),
      )
      .collect()

    const matching = existing.find(
      (entry) => entry.keyVersion === args.keyVersion && typeof entry.revokedAt !== "number",
    )
    const now = Date.now()

    if (matching) {
      await ctx.db.patch(matching._id, {
        senderDeviceId: args.senderDeviceId,
        senderPublicKeyJwk: args.senderPublicKeyJwk,
        wrapAlgorithm: args.wrapAlgorithm,
        wrappedKey: args.wrappedKey,
        createdAt: now,
      })
    } else {
      await ctx.db.insert("projectCollabWrappedKeys", {
        projectId: args.projectId,
        roomId: args.roomId,
        keyVersion: args.keyVersion,
        recipientUserId: args.recipientUserId,
        recipientDeviceId: args.recipientDeviceId,
        senderDeviceId: args.senderDeviceId,
        senderPublicKeyJwk: args.senderPublicKeyJwk,
        wrapAlgorithm: args.wrapAlgorithm,
        wrappedKey: args.wrappedKey,
        createdAt: now,
      })
    }

    const pendingRequest = await ctx.db
      .query("projectCollabKeyRequests")
      .withIndex("by_project_room_and_device", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", args.roomId).eq("recipientDeviceId", args.recipientDeviceId),
      )
      .first()

    if (pendingRequest && typeof pendingRequest.fulfilledAt !== "number") {
      await ctx.db.patch(pendingRequest._id, {
        fulfilledAt: now,
      })
    }

    return { stored: true }
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

    const roomId = args.roomId || defaultRoomId(args.projectId)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)

    if (activeRoomKey) {
      const latestSnapshot = await ctx.db
        .query("yjsDocuments")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .order("desc")
        .first()

      const updatesAfterSnapshot = typeof latestSnapshot?.snapshotBaseSeq === "number"
        ? await collectUpdatesAfterSeq(ctx, args.projectId, latestSnapshot.snapshotBaseSeq)
        : latestSnapshot
          ? await collectUpdatesAfterTimestamp(ctx, args.projectId, latestSnapshot.createdAt)
          : await collectAllProjectUpdates(ctx, args.projectId)

      const recentUpdates = updatesAfterSnapshot.map((update) => ({
        update: update.update,
        clientId: update.clientId,
        timestamp: update.timestamp,
      }))

      const latestSeq = updatesAfterSnapshot.reduce(
        (max, update) => Math.max(max, update.seq ?? 0),
        latestSnapshot?.snapshotBaseSeq ?? 0,
      )

      const serverTimestamp = updatesAfterSnapshot.reduce(
        (max, update) => Math.max(max, update.timestamp),
        latestSnapshot?.createdAt ?? 0,
      )

      return {
        serverSnapshot: latestSnapshot?.snapshot ?? null,
        snapshotVersion: latestSnapshot?.version ?? 0,
        snapshotCreatedAt: latestSnapshot?.createdAt ?? 0,
        recentUpdates,
        deltaUpdate: undefined,
        deltaByteLength: undefined,
        serverStateVector: undefined,
        serverTimestamp,
        serverSeq: latestSeq,
      }
    }

    const {
      serverDoc,
      latestSnapshot,
      serverTimestamp,
      latestSeq,
    } = await loadServerState(ctx, args.projectId, {
      includeUpdatesSinceSnapshot: false,
    })

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
      recentUpdates: [],
      // State-vector-first payload.
      deltaUpdate: toArrayBuffer(deltaUpdate),
      deltaByteLength: deltaUpdate.byteLength,
      serverStateVector: toArrayBuffer(serverStateVector),
      serverTimestamp,
      serverSeq: latestSeq,
    }
  },
})
