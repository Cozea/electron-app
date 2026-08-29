import { api } from "./_generated/api"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { ConvexError, v } from "convex/values"
import * as Y from "yjs"
import { applyProjectStorageDeltas } from "./lib/workspaceLimits"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import { canManageProject } from "./lib/projectAccess"

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

interface ParsedCipherEnvelopeMetadata {
  kind: "yjs_update" | "yjs_snapshot" | "yjs_awareness"
  keyVersion: number
}

function parseCipherEnvelopeMetadata(bytes: ArrayBuffer): ParsedCipherEnvelopeMetadata | null {
  try {
    const text = new TextDecoder().decode(new Uint8Array(bytes))
    const parsed = JSON.parse(text) as {
      v?: unknown
      alg?: unknown
      kind?: unknown
      keyVersion?: unknown
    }

    if (
      parsed?.v !== 1 ||
      parsed.alg !== "A256GCM" ||
      (parsed.kind !== "yjs_update" &&
        parsed.kind !== "yjs_snapshot" &&
        parsed.kind !== "yjs_awareness") ||
      typeof parsed.keyVersion !== "number" ||
      !Number.isFinite(parsed.keyVersion)
    ) {
      return null
    }

    return {
      kind: parsed.kind,
      keyVersion: Math.max(1, Math.floor(parsed.keyVersion)),
    }
  } catch {
    return null
  }
}

function assertEncryptedPayloadMatchesActiveKey(args: {
  payload: ArrayBuffer
  expectedKind: ParsedCipherEnvelopeMetadata["kind"]
  activeKeyVersion: number
}): void {
  const parsed = parseCipherEnvelopeMetadata(args.payload)
  if (!parsed || parsed.kind !== args.expectedKind) {
    throw new ConvexError({
      code: "invalid_encrypted_payload",
      message: `Invalid encrypted ${args.expectedKind} payload.`,
    })
  }

  if (parsed.keyVersion !== args.activeKeyVersion) {
    throw new ConvexError({
      code: "encryption_key_stale",
      message: "Encrypted collaboration key is stale. Refresh room access.",
    })
  }
}

type YjsSyncCtx = QueryCtx | MutationCtx
const SNAPSHOT_BYTE_THRESHOLD = 5 * 1024 * 1024
const SNAPSHOT_INTERVAL_MS = 3 * 60 * 1000
const SNAPSHOT_RETAIN_COUNT = 5
const YJS_UPDATE_PAGE_SIZE = 8
// Nudge compaction every N appended updates. maybeCompactProject is internally
// threshold-gated (interval/byte), so off-threshold nudges are cheap and this
// bounds the yjsUpdates table instead of letting it grow forever.
const YJS_COMPACT_EVERY_N_UPDATES = 128
// OFF by default and must stay off until maybeCompactProject is made
// encryption-aware. Stored updates are A256GCM cipher envelopes, but
// maybeCompactProject feeds them straight to Y.applyUpdate, writes the
// resulting plaintext Y.encodeStateAsUpdate blob into yjsDocuments (bypassing
// the yjs_snapshot envelope check saveSnapshot enforces), and then deletes
// every yjsUpdates row at or below the snapshot seq. Clients already snapshot
// and prune correctly via saveSnapshot + cleanupOldUpdates, so this path buys
// nothing and risks unrecoverable collaboration history loss.
const YJS_SERVER_SIDE_COMPACTION_ENABLED: boolean = false
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

interface RecoveryKitRecord {
  _id: Id<"projectCollabRecoveryKits">
  projectId: Id<"projects">
  roomId: string
  keyVersion: number
  wrapAlgorithm: string
  wrappedKey: string
  salt: string
  iterations: number
  createdByUserId: Id<"users">
  createdByDeviceId: string
  createdAt: number
  revokedAt?: number
}

type EncryptionBootstrapStatus =
  | "room_not_initialized"
  | "ready"
  | "missing_for_device"
  | "device_revoked"

function assertGatewaySecret(secret: string): void {
  const expected = process.env.AI_GATEWAY_SECRET
  if (!expected || secret !== expected) {
    throw new ConvexError("Unauthorized")
  }
}

function defaultRoomId(projectId: Id<"projects">): string {
  return `project:${projectId}`
}

async function getProject(
  ctx: YjsSyncCtx,
  projectId: Id<"projects">
) {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
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
    .filter((entry) => entry.status === "active" || entry.status === "rotating")
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

async function getActiveRecoveryKitRecord(
  ctx: YjsSyncCtx,
  args: {
    projectId: Id<"projects">
    roomId: string
    keyVersion?: number | null
  },
): Promise<RecoveryKitRecord | null> {
  const candidates = await ctx.db
    .query("projectCollabRecoveryKits")
    .withIndex("by_project_and_room", (q) =>
      q.eq("projectId", args.projectId).eq("roomId", args.roomId),
    )
    .collect()

  const match = candidates
    .filter((entry) =>
      typeof entry.revokedAt !== "number" &&
      (args.keyVersion == null || entry.keyVersion === args.keyVersion),
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0]

  return (match ?? null) as RecoveryKitRecord | null
}

async function deleteAllProjectCollabPayloads(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<{ removedUpdateBytes: number; removedSnapshotBytes: number }> {
  let removedUpdateBytes = 0
  while (true) {
    const batch = await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_time", (q) => q.eq("projectId", projectId))
      .paginate({
        cursor: null,
        numItems: YJS_CLEANUP_PAGE_SIZE,
      }) as PaginatedResult<{ _id: Id<"yjsUpdates">; update?: ArrayBuffer }>

    if (batch.page.length === 0) {
      break
    }

    for (const update of batch.page) {
      removedUpdateBytes += update.update?.byteLength ?? 0
      await ctx.db.delete(update._id)
    }
  }

  let removedSnapshotBytes = 0
  while (true) {
    const batch = await ctx.db
      .query("yjsDocuments")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .paginate({
        cursor: null,
        numItems: YJS_SNAPSHOT_CLEANUP_PAGE_SIZE,
      }) as PaginatedResult<{ _id: Id<"yjsDocuments">; byteSize?: number; snapshot?: ArrayBuffer }>

    if (batch.page.length === 0) {
      break
    }

    for (const snapshotDoc of batch.page) {
      removedSnapshotBytes += snapshotDoc.byteSize ?? snapshotDoc.snapshot?.byteLength ?? 0
      await ctx.db.delete(snapshotDoc._id)
    }
  }

  return {
    removedUpdateBytes,
    removedSnapshotBytes,
  }
}

async function deleteAllProjectAwarenessEntries(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<number> {
  let removedCount = 0

  while (true) {
    const batch = await ctx.db
      .query("yjsAwareness")
      .withIndex("by_project_and_updated", (q) => q.eq("projectId", projectId))
      .paginate({
        cursor: null,
        numItems: YJS_CLEANUP_PAGE_SIZE,
      }) as PaginatedResult<{ _id: Id<"yjsAwareness"> }>

    if (batch.page.length === 0) {
      break
    }

    for (const entry of batch.page) {
      await ctx.db.delete(entry._id)
      removedCount += 1
    }
  }

  return removedCount
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
  await assertCollaborationWriteAllowed(ctx, args.projectId, args.update.byteLength)
  const roomId = args.roomId || defaultRoomId(args.projectId)
  const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)

  if (!activeRoomKey) {
    throw new ConvexError({
      code: "room_not_initialized",
      message: "Encrypted collaboration room is not initialized.",
    })
  }
  assertEncryptedPayloadMatchesActiveKey({
    payload: args.update,
    expectedKind: "yjs_update",
    activeKeyVersion: activeRoomKey.keyVersion,
  })

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
    roomId,
    seq: nextSeq,
    update: args.update,
    clientId: args.clientId,
    origin: args.origin,
    idempotencyKey: args.idempotencyKey?.trim() || undefined,
    timestamp: args.timestamp ?? Date.now(),
  })

  await applyProjectStorageDeltas(ctx, args.projectId, {
    collaborationData: args.update.byteLength,
  })

  // Periodically attempt compaction (snapshot + prune). Scheduled async so the
  // write returns immediately; the compaction itself no-ops under threshold.
  if (
    YJS_SERVER_SIDE_COMPACTION_ENABLED &&
    nextSeq % YJS_COMPACT_EVERY_N_UPDATES === 0
  ) {
    await ctx.scheduler.runAfter(0, api.yjs.maybeCompactProject, {
      projectId: args.projectId,
    })
  }

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
    serverSecret: v.optional(v.string()),
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
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertCollaborationAccess(ctx, args.projectId)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, defaultRoomId(args.projectId))
    if (!activeRoomKey) {
      return []
    }
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
    serverSecret: v.optional(v.string()),
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
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, defaultRoomId(args.projectId))
    if (!activeRoomKey) {
      return null
    }
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
    await assertCollaborationWriteAllowed(ctx, args.projectId, args.snapshot.byteLength)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, defaultRoomId(args.projectId))
    if (!activeRoomKey) {
      throw new ConvexError({
        code: "room_not_initialized",
        message: "Encrypted collaboration room is not initialized.",
      })
    }
    assertEncryptedPayloadMatchesActiveKey({
      payload: args.snapshot,
      expectedKind: "yjs_snapshot",
      activeKeyVersion: activeRoomKey.keyVersion,
    })
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

    await applyProjectStorageDeltas(ctx, args.projectId, {
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
    await getProject(ctx, args.projectId)
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
      await applyProjectStorageDeltas(ctx, args.projectId, {
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
    await getProject(ctx, args.projectId)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, defaultRoomId(args.projectId))
    if (!activeRoomKey) {
      return {
        compacted: false,
        reason: "room-not-initialized",
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

    await applyProjectStorageDeltas(ctx, args.projectId, {
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
    serverSecret: v.string(),
    userId: v.id("users"),
    deviceId: v.string(),
    deviceLabel: v.string(),
    platform: v.string(),
    publicKeyJwk: v.string(),
    publicKeyAlgorithm: v.string(),
    fingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const existing = await ctx.db
      .query("collabDevices")
      .withIndex("by_user_and_device", (q) =>
        q.eq("userId", args.userId).eq("deviceId", args.deviceId),
      )
      .first()

    const now = Date.now()
    if (existing) {
      if (typeof existing.revokedAt === "number") {
        await ctx.db.patch(existing._id, {
          deviceLabel: args.deviceLabel,
          platform: args.platform,
          lastSeenAt: now,
        })
        return { deviceId: args.deviceId, created: false, revoked: true }
      }

      await ctx.db.patch(existing._id, {
        deviceLabel: args.deviceLabel,
        platform: args.platform,
        publicKeyJwk: args.publicKeyJwk,
        publicKeyAlgorithm: args.publicKeyAlgorithm,
        fingerprint: args.fingerprint,
        lastSeenAt: now,
      })
      return { deviceId: args.deviceId, created: false, revoked: false }
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

    return { deviceId: args.deviceId, created: true, revoked: false }
  },
})

export const getEncryptionBootstrap = query({
  args: {
    serverSecret: v.string(),
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
    userId: v.id("users"),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    await assertCollaborationAccess(ctx, args.projectId)
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const registeredDevice = await ctx.db
      .query("collabDevices")
      .withIndex("by_user_and_device", (q) =>
        q.eq("userId", args.userId).eq("deviceId", args.deviceId),
      )
      .first()

    if (registeredDevice && typeof registeredDevice.revokedAt === "number") {
      return {
        roomId,
        encryptionRequired: true,
        status: "device_revoked" as EncryptionBootstrapStatus,
        activeKeyVersion: null,
        wrappedRoomKey: null,
        wrapAlgorithm: null,
        senderPublicKeyJwk: null,
      }
    }

    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)

    if (!activeRoomKey) {
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
    let removedUpdateBytes = 0
    let removedSnapshotBytes = 0
    let removedAwarenessEntries = 0

    if (hasCollabData) {
      const payloadCleanup = await deleteAllProjectCollabPayloads(ctx, args.projectId)
      removedUpdateBytes = payloadCleanup.removedUpdateBytes
      removedSnapshotBytes = payloadCleanup.removedSnapshotBytes
      removedAwarenessEntries = await deleteAllProjectAwarenessEntries(ctx, args.projectId)
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

    if (removedUpdateBytes > 0 || removedSnapshotBytes > 0) {
      await applyProjectStorageDeltas(ctx, args.projectId, {
        collaborationData: -removedUpdateBytes,
        snapshots: -removedSnapshotBytes,
      })
    }

    return {
      roomId,
      created: true,
      keyVersion: Math.max(1, Math.floor(args.keyVersion)),
      removedUpdateBytes,
      removedSnapshotBytes,
      removedAwarenessEntries,
    }
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
    const user = await requireAuthenticatedDevice(ctx)
    if (user._id !== args.recipientUserId || user.identityKey !== args.recipientDeviceId) {
      throw new ConvexError("A device can request an encryption key only for itself")
    }
    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)
    const device = await ctx.db
      .query("collabDevices")
      .withIndex("by_user_and_device", (q) =>
        q.eq("userId", args.recipientUserId).eq("deviceId", args.recipientDeviceId),
      )
      .first()
    if (device && typeof device.revokedAt === "number") {
      throw new Error("This device has been revoked from encrypted collaboration")
    }

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
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only project managers can review encryption key requests")
    }
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

export const getActiveRecoveryKit = query({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertCollaborationAccess(ctx, args.projectId)
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)
    if (!activeRoomKey) {
      return null
    }

    const recoveryKit = await getActiveRecoveryKitRecord(ctx, {
      projectId: args.projectId,
      roomId,
      keyVersion: activeRoomKey.keyVersion,
    })

    if (!recoveryKit) {
      return null
    }

    return {
      roomId,
      keyVersion: recoveryKit.keyVersion,
      wrapAlgorithm: recoveryKit.wrapAlgorithm,
      wrappedKey: recoveryKit.wrappedKey,
      salt: recoveryKit.salt,
      iterations: recoveryKit.iterations,
      createdAt: recoveryKit.createdAt,
      createdByDeviceId: recoveryKit.createdByDeviceId,
    }
  },
})

export const listCollabRoomDevices = query({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only project managers can review collaboration devices")
    }
    await assertCollaborationAccess(ctx, args.projectId)
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)
    const [wrappedKeys, pendingRequests] = await Promise.all([
      ctx.db
        .query("projectCollabWrappedKeys")
        .withIndex("by_project_room_and_key_version", (q) =>
          q.eq("projectId", args.projectId).eq("roomId", roomId).eq("keyVersion", activeRoomKey?.keyVersion ?? 1),
        )
        .collect(),
      ctx.db
        .query("projectCollabKeyRequests")
        .withIndex("by_project_and_room", (q) => q.eq("projectId", args.projectId).eq("roomId", roomId))
        .collect(),
    ])

    const deviceIds = new Set<string>()
    for (const entry of wrappedKeys) {
      deviceIds.add(entry.recipientDeviceId)
    }
    for (const request of pendingRequests) {
      deviceIds.add(request.recipientDeviceId)
    }

    const devices = await Promise.all(
      [...deviceIds].map(async (deviceId) => {
        const device = await ctx.db
          .query("collabDevices")
          .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
          .first()
        if (!device) {
          return null
        }

        const deviceWrappedKeys = wrappedKeys
          .filter((entry) => entry.recipientDeviceId === deviceId)
          .sort((a, b) => b.createdAt - a.createdAt)
        const pendingRequest = pendingRequests
          .filter((entry) => entry.recipientDeviceId === deviceId && typeof entry.fulfilledAt !== "number")
          .sort((a, b) => b.requestedAt - a.requestedAt)[0]

        return {
          userId: device.userId,
          deviceId: device.deviceId,
          deviceLabel: device.deviceLabel,
          platform: device.platform,
          fingerprint: device.fingerprint,
          publicKeyJwk: device.publicKeyJwk,
          publicKeyAlgorithm: device.publicKeyAlgorithm,
          createdAt: device.createdAt,
          lastSeenAt: device.lastSeenAt,
          revokedAt: device.revokedAt ?? null,
          hasWrappedKey: deviceWrappedKeys.some((entry) => typeof entry.revokedAt !== "number"),
          wrappedKeyVersion: deviceWrappedKeys[0]?.keyVersion ?? null,
          hasPendingRequest: Boolean(pendingRequest),
          pendingRequestedAt: pendingRequest?.requestedAt ?? null,
          activeKeyVersion: activeRoomKey?.keyVersion ?? null,
          rotationRequired: activeRoomKey?.status === "rotating",
        }
      }),
    )

    return devices
      .filter((device) => device !== null)
      .sort((a, b) => (b?.lastSeenAt ?? 0) - (a?.lastSeenAt ?? 0))
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
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only project managers can approve encryption key requests")
    }
    if (user.identityKey !== args.senderDeviceId) {
      throw new ConvexError("The wrapping device does not match the authenticated device")
    }
    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)
    const pendingRequest = await ctx.db
      .query("projectCollabKeyRequests")
      .withIndex("by_project_room_and_device", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", args.roomId).eq("recipientDeviceId", args.recipientDeviceId),
      )
      .first()
    if (
      !pendingRequest ||
      typeof pendingRequest.fulfilledAt === "number" ||
      pendingRequest.recipientUserId !== args.recipientUserId
    ) {
      throw new ConvexError("A matching pending key request is required before sharing access")
    }
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

    await ctx.db.patch(pendingRequest._id, { fulfilledAt: now })

    return { stored: true }
  },
})

export const storeRecoveryKit = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.string(),
    keyVersion: v.number(),
    wrapAlgorithm: v.string(),
    wrappedKey: v.string(),
    salt: v.string(),
    iterations: v.number(),
    createdByUserId: v.id("users"),
    createdByDeviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only project managers can create collaboration recovery kits")
    }
    if (args.createdByUserId !== user._id || args.createdByDeviceId !== user.identityKey) {
      throw new ConvexError("Recovery-kit creator does not match the authenticated device")
    }
    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, args.roomId)
    if (!activeRoomKey) {
      throw new ConvexError({
        code: "room_not_initialized",
        message: "Encrypted collaboration room is not initialized.",
      })
    }

    const normalizedKeyVersion = Math.max(1, Math.floor(args.keyVersion))
    if (activeRoomKey.keyVersion !== normalizedKeyVersion) {
      throw new ConvexError({
        code: "encryption_key_stale",
        message: "Recovery kit does not match the active encrypted room key.",
      })
    }

    const now = Date.now()
    const existing = await ctx.db
      .query("projectCollabRecoveryKits")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", args.roomId),
      )
      .collect()

    for (const entry of existing) {
      if (typeof entry.revokedAt === "number") continue
      await ctx.db.patch(entry._id, {
        revokedAt: now,
      })
    }

    await ctx.db.insert("projectCollabRecoveryKits", {
      projectId: args.projectId,
      roomId: args.roomId,
      keyVersion: normalizedKeyVersion,
      wrapAlgorithm: args.wrapAlgorithm,
      wrappedKey: args.wrappedKey,
      salt: args.salt,
      iterations: Math.max(1, Math.floor(args.iterations)),
      createdByUserId: args.createdByUserId,
      createdByDeviceId: args.createdByDeviceId,
      createdAt: now,
    })

    return { stored: true, keyVersion: normalizedKeyVersion }
  },
})

export const revokeCollabDevice = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only project managers can revoke collaboration access")
    }
    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const now = Date.now()

    const wrappedKeys = await ctx.db
      .query("projectCollabWrappedKeys")
      .withIndex("by_project_room_and_recipient", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId).eq("recipientDeviceId", args.deviceId),
      )
      .collect()
    for (const entry of wrappedKeys) {
      if (typeof entry.revokedAt === "number") continue
      await ctx.db.patch(entry._id, {
        revokedAt: now,
      })
    }

    const pendingRequests = await ctx.db
      .query("projectCollabKeyRequests")
      .withIndex("by_project_room_and_device", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId).eq("recipientDeviceId", args.deviceId),
      )
      .collect()
    for (const request of pendingRequests) {
      if (typeof request.fulfilledAt === "number") continue
      await ctx.db.patch(request._id, {
        fulfilledAt: now,
      })
    }

    return { revoked: true, revokedAt: now }
  },
})

export const rotateEncryptedRoomKey = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
    userId: v.id("users"),
    initiatedByDeviceId: v.string(),
    encryptedSnapshot: v.bytes(),
    createdByClientId: v.optional(v.string()),
    wrappedKeys: v.array(
      v.object({
        recipientUserId: v.id("users"),
        recipientDeviceId: v.string(),
        senderPublicKeyJwk: v.string(),
        wrapAlgorithm: v.string(),
        wrappedKey: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only project managers can rotate collaboration keys")
    }
    if (args.userId !== user._id || args.initiatedByDeviceId !== user.identityKey) {
      throw new ConvexError("Key rotation initiator does not match the authenticated device")
    }
    await assertCollaborationWriteAllowed(
      ctx,
      args.projectId,
      args.encryptedSnapshot.byteLength,
    )
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)
    if (!activeRoomKey) {
      throw new Error("Encrypted collaboration room is not initialized")
    }

    const nextKeyVersion = activeRoomKey.keyVersion + 1
    assertEncryptedPayloadMatchesActiveKey({
      payload: args.encryptedSnapshot,
      expectedKind: "yjs_snapshot",
      activeKeyVersion: nextKeyVersion,
    })
    const now = Date.now()
    const roomKeys = await ctx.db
      .query("projectCollabRoomKeys")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId),
      )
      .collect()

    for (const roomKey of roomKeys) {
      if (roomKey.status === "revoked") continue
      await ctx.db.patch(roomKey._id, {
        status: "revoked",
        rotatedAt: now,
      })
    }

    for (const roomKey of roomKeys) {
      const wrappedKeys = await ctx.db
        .query("projectCollabWrappedKeys")
        .withIndex("by_project_room_and_key_version", (q) =>
          q.eq("projectId", args.projectId).eq("roomId", roomId).eq("keyVersion", roomKey.keyVersion),
        )
        .collect()

      for (const wrappedKey of wrappedKeys) {
        if (typeof wrappedKey.revokedAt === "number") continue
        await ctx.db.patch(wrappedKey._id, {
          revokedAt: now,
        })
      }
    }

    const recoveryKits = await ctx.db
      .query("projectCollabRecoveryKits")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId),
      )
      .collect()

    for (const recoveryKit of recoveryKits) {
      if (typeof recoveryKit.revokedAt === "number") continue
      await ctx.db.patch(recoveryKit._id, {
        revokedAt: now,
      })
    }

    const { removedUpdateBytes, removedSnapshotBytes } = await deleteAllProjectCollabPayloads(
      ctx,
      args.projectId,
    )
    const removedAwarenessEntries = await deleteAllProjectAwarenessEntries(ctx, args.projectId)

    await ctx.db.insert("projectCollabRoomKeys", {
      projectId: args.projectId,
      roomId,
      keyVersion: nextKeyVersion,
      status: "active",
      createdByUserId: args.userId,
      createdByDeviceId: args.initiatedByDeviceId,
      createdAt: now,
    })

    const inserted = new Set<string>()
    for (const wrappedKey of args.wrappedKeys) {
      const dedupeKey = `${wrappedKey.recipientUserId}:${wrappedKey.recipientDeviceId}`
      if (inserted.has(dedupeKey)) continue
      inserted.add(dedupeKey)

      await ctx.db.insert("projectCollabWrappedKeys", {
        projectId: args.projectId,
        roomId,
        keyVersion: nextKeyVersion,
        recipientUserId: wrappedKey.recipientUserId,
        recipientDeviceId: wrappedKey.recipientDeviceId,
        senderDeviceId: args.initiatedByDeviceId,
        senderPublicKeyJwk: wrappedKey.senderPublicKeyJwk,
        wrapAlgorithm: wrappedKey.wrapAlgorithm,
        wrappedKey: wrappedKey.wrappedKey,
        createdAt: now,
      })
    }

    await ctx.db.insert("yjsDocuments", {
      projectId: args.projectId,
      snapshot: args.encryptedSnapshot,
      version: now,
      snapshotBaseSeq: 0,
      byteSize: args.encryptedSnapshot.byteLength,
      createdByClientId: args.createdByClientId,
      createdAt: now,
    })

    await applyProjectStorageDeltas(ctx, args.projectId, {
      collaborationData: -removedUpdateBytes,
      snapshots: args.encryptedSnapshot.byteLength - removedSnapshotBytes,
    })

    return {
      rotated: true,
      roomId,
      keyVersion: nextKeyVersion,
      previousKeyVersion: activeRoomKey.keyVersion,
      removedUpdateBytes,
      removedSnapshotBytes,
      removedAwarenessEntries,
    }
  },
})

export const resetEncryptedRoom = mutation({
  args: {
    projectId: v.id("projects"),
    roomId: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    retainDeviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only project managers can reset encrypted collaboration")
    }
    if (
      (args.userId !== undefined && args.userId !== user._id) ||
      (args.retainDeviceId !== undefined && args.retainDeviceId !== user.identityKey)
    ) {
      throw new ConvexError("Retained recovery device does not match the authenticated device")
    }
    await assertCollaborationWriteAllowed(ctx, args.projectId, 0)
    const roomId = args.roomId || defaultRoomId(args.projectId)
    const now = Date.now()

    const roomKeys = await ctx.db
      .query("projectCollabRoomKeys")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId),
      )
      .collect()

    for (const roomKey of roomKeys) {
      if (roomKey.status === "revoked") continue
      await ctx.db.patch(roomKey._id, {
        status: "revoked",
        rotatedAt: now,
      })
    }

    for (const roomKey of roomKeys) {
      const wrappedKeys = await ctx.db
        .query("projectCollabWrappedKeys")
        .withIndex("by_project_room_and_key_version", (q) =>
          q.eq("projectId", args.projectId).eq("roomId", roomId).eq("keyVersion", roomKey.keyVersion),
        )
        .collect()

      for (const wrappedKey of wrappedKeys) {
        if (typeof wrappedKey.revokedAt === "number") continue
        await ctx.db.patch(wrappedKey._id, {
          revokedAt: now,
        })
      }
    }

    const recoveryKits = await ctx.db
      .query("projectCollabRecoveryKits")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId),
      )
      .collect()

    for (const recoveryKit of recoveryKits) {
      if (typeof recoveryKit.revokedAt === "number") continue
      await ctx.db.patch(recoveryKit._id, {
        revokedAt: now,
      })
    }

    const keyRequests = await ctx.db
      .query("projectCollabKeyRequests")
      .withIndex("by_project_and_room", (q) =>
        q.eq("projectId", args.projectId).eq("roomId", roomId),
      )
      .collect()

    for (const request of keyRequests) {
      if (typeof request.fulfilledAt === "number") continue
      await ctx.db.patch(request._id, {
        fulfilledAt: now,
      })
    }

    if (args.userId && args.retainDeviceId) {
      const retainedDevice = await ctx.db
        .query("collabDevices")
        .withIndex("by_user_and_device", (q) =>
          q.eq("userId", args.userId!).eq("deviceId", args.retainDeviceId!),
        )
        .first()

      if (retainedDevice && typeof retainedDevice.revokedAt === "number") {
        await ctx.db.patch(retainedDevice._id, {
          revokedAt: undefined,
          lastSeenAt: now,
        })
      }
    }

    const { removedUpdateBytes, removedSnapshotBytes } = await deleteAllProjectCollabPayloads(
      ctx,
      args.projectId,
    )
    const removedAwarenessEntries = await deleteAllProjectAwarenessEntries(ctx, args.projectId)

    await applyProjectStorageDeltas(ctx, args.projectId, {
      collaborationData: -removedUpdateBytes,
      snapshots: -removedSnapshotBytes,
    })

    return {
      reset: true,
      roomId,
      removedUpdateBytes,
      removedSnapshotBytes,
      removedAwarenessEntries,
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

    const roomId = args.roomId || defaultRoomId(args.projectId)
    const activeRoomKey = await getActiveRoomKey(ctx, args.projectId, roomId)

    if (!activeRoomKey) {
      const emptyDoc = new Y.Doc()
      const emptyStateVector = Y.encodeStateVector(emptyDoc)
      return {
        serverSnapshot: null,
        snapshotVersion: 0,
        snapshotCreatedAt: 0,
        recentUpdates: [],
        deltaUpdate: toArrayBuffer(Y.encodeStateAsUpdate(emptyDoc)),
        deltaByteLength: 0,
        serverStateVector: toArrayBuffer(emptyStateVector),
        serverTimestamp: 0,
        serverSeq: 0,
      }
    }

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
  },
})
