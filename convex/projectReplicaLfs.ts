import { internalMutation, mutation, query } from "./_generated/server"
import { v } from "convex/values"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET
const DEFAULT_LFS_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_DELETE_BATCH = 500

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

export const generateUploadUrlForServer = mutation({
  args: {
    projectId: v.id("projects"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const project = await ctx.db.get(args.projectId)
    if (!project) {
      throw new Error("Project not found")
    }
    return await ctx.storage.generateUploadUrl()
  },
})

export const upsertObjectForServer = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    oid: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const existing = await ctx.db
      .query("projectReplicaLfsObjects")
      .withIndex("by_project_and_oid", (q) =>
        q.eq("projectId", args.projectId).eq("oid", args.oid)
      )
      .first()

    if (existing) {
      const previousStorageId = existing.storageId
      await ctx.db.patch(existing._id, {
        size: args.size,
        storageId: args.storageId,
      })
      if (previousStorageId !== args.storageId) {
        try {
          await ctx.storage.delete(previousStorageId)
        } catch {
          // Best effort cleanup; maintenance cron retries stale metadata cleanup.
        }
      }
      return await ctx.db.get(existing._id)
    }

    const now = Date.now()
    const docId = await ctx.db.insert("projectReplicaLfsObjects", {
      projectId: args.projectId,
      oid: args.oid,
      size: args.size,
      storageId: args.storageId,
      createdAt: now,
      createdBy: args.userId,
    })

    return await ctx.db.get(docId)
  },
})

export const getObjectForServer = query({
  args: {
    projectId: v.id("projects"),
    oid: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const record = await ctx.db
      .query("projectReplicaLfsObjects")
      .withIndex("by_project_and_oid", (q) =>
        q.eq("projectId", args.projectId).eq("oid", args.oid)
      )
      .first()

    if (!record) return null
    const url = await ctx.storage.getUrl(record.storageId)
    return {
      ...record,
      url,
    }
  },
})

/**
 * Internal maintenance: remove stale LFS metadata whose storage object is missing.
 */
export const cleanupStaleLfsMetadata = internalMutation({
  args: {
    maxAgeMs: v.optional(v.number()),
    maxDeletes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const maxAgeMs = Math.max(24 * 60 * 60 * 1000, args.maxAgeMs ?? DEFAULT_LFS_RETENTION_MS)
    const maxDeletes = Math.max(1, Math.min(args.maxDeletes ?? DEFAULT_MAX_DELETE_BATCH, 5_000))
    const cutoff = now - maxAgeMs

    const candidates = await ctx.db
      .query("projectReplicaLfsObjects")
      .collect()

    let deleted = 0
    for (const entry of candidates) {
      if (deleted >= maxDeletes) break
      if (entry.createdAt > cutoff) continue

      const url = await ctx.storage.getUrl(entry.storageId)
      if (url) continue

      await ctx.db.delete(entry._id)
      deleted += 1
    }

    return {
      deleted,
      cutoff,
    }
  },
})
