import { internalMutation, mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { v } from "convex/values"
import {
  applyProjectStorageDeltas,
  getLegacyFileStorageTotals,
} from "./lib/workspaceLimits"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET
const DEFAULT_SESSION_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_DELETE_BATCH = 1000

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

type SyncCtx = QueryCtx | MutationCtx

async function assertSyncProjectAccess(
  ctx: SyncCtx,
  projectId: Id<"projects">
) {
  const project = await ctx.db.get(projectId)
  if (!project) {
    throw new Error("Project not found")
  }

  return { project }
}

export const getReplicaForServer = query({
  args: {
    projectId: v.id("projects"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    await assertSyncProjectAccess(ctx, args.projectId)
    return await ctx.db
      .query("projectReplicaGit")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()
  },
})

export const upsertReplicaForServer = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    canonicalRef: v.string(),
    headCommit: v.optional(v.string()),
    bundleStorageId: v.optional(v.id("_storage")),
    bundleChecksum: v.optional(v.string()),
    bundleSizeBytes: v.optional(v.number()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const { project } = await assertSyncProjectAccess(ctx, args.projectId)
    const now = Date.now()

    const existing = await ctx.db
      .query("projectReplicaGit")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()
    const firstLfsObject = await ctx.db
      .query("projectReplicaLfsObjects")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()

    const previousBundleBytes = Math.max(0, existing?.bundleSizeBytes ?? 0)
    const nextBundleBytes = Math.max(
      0,
      args.bundleSizeBytes !== undefined ? args.bundleSizeBytes : existing?.bundleSizeBytes ?? 0
    )
    const hasLfsObjects = Boolean(firstLfsObject)
    const usedReplicaAccountingBefore = previousBundleBytes > 0 || hasLfsObjects
    const usedReplicaAccountingAfter = nextBundleBytes > 0 || hasLfsObjects

    let sourceAndConfigDelta = 0
    let gitHistoryDelta = 0
    if (usedReplicaAccountingBefore && usedReplicaAccountingAfter) {
      sourceAndConfigDelta = nextBundleBytes - previousBundleBytes
    } else if (usedReplicaAccountingBefore !== usedReplicaAccountingAfter) {
      const legacyTotals = await getLegacyFileStorageTotals(ctx, args.projectId)
      if (usedReplicaAccountingAfter) {
        sourceAndConfigDelta = nextBundleBytes - legacyTotals.activeBytes
        gitHistoryDelta = -legacyTotals.supersededBytes
      } else {
        sourceAndConfigDelta = legacyTotals.activeBytes - previousBundleBytes
        gitHistoryDelta = legacyTotals.supersededBytes
      }
    }

    if (existing) {
      const previousBundleStorageId = existing.bundleStorageId
      const nextBundleStorageId = args.bundleStorageId ?? existing.bundleStorageId

      await ctx.db.patch(existing._id, {
        canonicalRef: args.canonicalRef,
        headCommit: args.headCommit ?? existing.headCommit,
        bundleStorageId: nextBundleStorageId,
        bundleChecksum: args.bundleChecksum ?? existing.bundleChecksum,
        bundleSizeBytes: args.bundleSizeBytes ?? existing.bundleSizeBytes,
        version: existing.version + 1,
        updatedAt: now,
        updatedBy: args.userId,
      })

      if (
        previousBundleStorageId &&
        nextBundleStorageId &&
        previousBundleStorageId !== nextBundleStorageId
      ) {
        try {
          await ctx.storage.delete(previousBundleStorageId)
        } catch {
          // Best effort: stale bundle cleanup can retry via maintenance cron.
        }
      }
      await applyProjectStorageDeltas(ctx, project.organizationId, args.projectId, {
        sourceAndConfig: sourceAndConfigDelta,
        gitHistory: gitHistoryDelta,
      })
      return await ctx.db.get(existing._id)
    }

    const replicaId = await ctx.db.insert("projectReplicaGit", {
      projectId: args.projectId,
      canonicalRef: args.canonicalRef,
      headCommit: args.headCommit,
      bundleStorageId: args.bundleStorageId,
      bundleChecksum: args.bundleChecksum,
      bundleSizeBytes: args.bundleSizeBytes,
      version: 1,
      updatedAt: now,
      updatedBy: args.userId,
    })

    await applyProjectStorageDeltas(ctx, project.organizationId, args.projectId, {
      sourceAndConfig: sourceAndConfigDelta,
      gitHistory: gitHistoryDelta,
    })

    return await ctx.db.get(replicaId)
  },
})

export const createSessionForServer = mutation({
  args: {
    projectId: v.id("projects"),
    sessionId: v.string(),
    userId: v.id("users"),
    deviceId: v.optional(v.string()),
    baseCommit: v.optional(v.string()),
    localCommit: v.optional(v.string()),
    remoteCommit: v.optional(v.string()),
    status: v.union(
      v.literal("planned"),
      v.literal("applied"),
      v.literal("conflict"),
      v.literal("failed"),
      v.literal("queued")
    ),
    diagnostics: v.optional(v.any()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    await assertSyncProjectAccess(ctx, args.projectId)
    const now = Date.now()

    const existing = await ctx.db
      .query("projectReplicaGitSessions")
      .withIndex("by_project_and_session", (q) =>
        q.eq("projectId", args.projectId).eq("sessionId", args.sessionId)
      )
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        userId: args.userId,
        deviceId: args.deviceId ?? existing.deviceId,
        baseCommit: args.baseCommit ?? existing.baseCommit,
        localCommit: args.localCommit ?? existing.localCommit,
        remoteCommit: args.remoteCommit ?? existing.remoteCommit,
        status: args.status,
        diagnostics: args.diagnostics ?? existing.diagnostics,
        updatedAt: now,
      })
      return await ctx.db.get(existing._id)
    }

    const sessionDocId = await ctx.db.insert("projectReplicaGitSessions", {
      projectId: args.projectId,
      sessionId: args.sessionId,
      userId: args.userId,
      deviceId: args.deviceId,
      baseCommit: args.baseCommit,
      localCommit: args.localCommit,
      remoteCommit: args.remoteCommit,
      status: args.status,
      diagnostics: args.diagnostics,
      createdAt: now,
      updatedAt: now,
    })

    return await ctx.db.get(sessionDocId)
  },
})

export const updateSessionForServer = mutation({
  args: {
    projectId: v.id("projects"),
    sessionId: v.string(),
    status: v.union(
      v.literal("planned"),
      v.literal("applied"),
      v.literal("conflict"),
      v.literal("failed"),
      v.literal("queued")
    ),
    baseCommit: v.optional(v.string()),
    localCommit: v.optional(v.string()),
    remoteCommit: v.optional(v.string()),
    resultCommit: v.optional(v.string()),
    diagnostics: v.optional(v.any()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    await assertSyncProjectAccess(ctx, args.projectId)
    const now = Date.now()
    const existing = await ctx.db
      .query("projectReplicaGitSessions")
      .withIndex("by_project_and_session", (q) =>
        q.eq("projectId", args.projectId).eq("sessionId", args.sessionId)
      )
      .first()

    if (!existing) {
      throw new Error("Replica session not found")
    }

    await ctx.db.patch(existing._id, {
      status: args.status,
      baseCommit: args.baseCommit ?? existing.baseCommit,
      localCommit: args.localCommit ?? existing.localCommit,
      remoteCommit: args.remoteCommit ?? existing.remoteCommit,
      resultCommit: args.resultCommit ?? existing.resultCommit,
      diagnostics: args.diagnostics ?? existing.diagnostics,
      updatedAt: now,
    })

    return await ctx.db.get(existing._id)
  },
})

export const generateBundleUploadUrlForServer = mutation({
  args: {
    projectId: v.id("projects"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    await assertSyncProjectAccess(ctx, args.projectId)
    return await ctx.storage.generateUploadUrl()
  },
})

export const getStorageUrlForServer = query({
  args: {
    storageId: v.id("_storage"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    return await ctx.storage.getUrl(args.storageId)
  },
})

/**
 * Internal maintenance: prune stale replica sessions and expired lock metadata.
 */
export const cleanupReplicaMetadata = internalMutation({
  args: {
    maxAgeMs: v.optional(v.number()),
    maxDeletes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const maxAgeMs = Math.max(60_000, args.maxAgeMs ?? DEFAULT_SESSION_RETENTION_MS)
    const cutoff = now - maxAgeMs
    const maxDeletes = Math.max(1, Math.min(args.maxDeletes ?? DEFAULT_MAX_DELETE_BATCH, 10_000))

    let deletedSessions = 0
    const staleSessions = await ctx.db
      .query("projectReplicaGitSessions")
      .withIndex("by_updated_at")
      .order("asc")
      .take(maxDeletes)

    for (const session of staleSessions) {
      if (deletedSessions >= maxDeletes) break
      if (session.updatedAt > cutoff) break
      await ctx.db.delete(session._id)
      deletedSessions += 1
    }

    let deletedLocks = 0
    const expiredLocks = await ctx.db
      .query("projectReplicaGitLocks")
      .withIndex("by_expires_at")
      .order("asc")
      .take(maxDeletes)

    for (const lock of expiredLocks) {
      if (deletedLocks >= maxDeletes) break
      if (lock.expiresAt > now) break
      await ctx.db.delete(lock._id)
      deletedLocks += 1
    }

    return {
      deletedSessions,
      deletedLocks,
      cutoff,
    }
  },
})
