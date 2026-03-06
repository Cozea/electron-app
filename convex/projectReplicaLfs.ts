import { internalMutation, mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { v } from "convex/values"
import {
  applyProjectStorageDeltas,
  getLegacyFileStorageTotals,
} from "./lib/workspaceLimits"

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

type SyncCtx = QueryCtx | MutationCtx

async function assertSyncProjectAccess(ctx: SyncCtx, projectId: Id<"projects">) {
  const project = await ctx.db.get(projectId)
  if (!project) {
    throw new Error("Project not found")
  }

  return { project }
}

export const generateUploadUrlForServer = mutation({
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
    const { project } = await assertSyncProjectAccess(ctx, args.projectId)

    const existing = await ctx.db
      .query("projectReplicaLfsObjects")
      .withIndex("by_project_and_oid", (q) =>
        q.eq("projectId", args.projectId).eq("oid", args.oid)
      )
      .first()
    const firstLfsObject = await ctx.db
      .query("projectReplicaLfsObjects")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()
    const replica = await ctx.db
      .query("projectReplicaGit")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()

    const bundleBytes = Math.max(0, replica?.bundleSizeBytes ?? 0)
    const hadLfsObjectsBefore = Boolean(firstLfsObject)
    const usedReplicaAccountingBefore = bundleBytes > 0 || hadLfsObjectsBefore
    const previousObjectBytes = Math.max(0, existing?.size ?? 0)
    const nextObjectBytes = Math.max(0, args.size)

    let sourceAndConfigDelta = 0
    let gitHistoryDelta = 0
    if (usedReplicaAccountingBefore) {
      sourceAndConfigDelta = nextObjectBytes - previousObjectBytes
    } else {
      const legacyTotals = await getLegacyFileStorageTotals(ctx, args.projectId)
      sourceAndConfigDelta = nextObjectBytes - legacyTotals.activeBytes
      gitHistoryDelta = -legacyTotals.supersededBytes
    }

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
      await applyProjectStorageDeltas(ctx, project.organizationId, args.projectId, {
        sourceAndConfig: sourceAndConfigDelta,
        gitHistory: gitHistoryDelta,
      })
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

    await applyProjectStorageDeltas(ctx, project.organizationId, args.projectId, {
      sourceAndConfig: sourceAndConfigDelta,
      gitHistory: gitHistoryDelta,
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
    await assertSyncProjectAccess(ctx, args.projectId)
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
    const totalEntriesByProject = new Map<string, number>()
    const affectedProjects = new Map<string, {
      projectId: Id<"projects">
      deletedBytes: number
      deletedEntries: number
    }>()

    for (const entry of candidates) {
      const key = String(entry.projectId)
      totalEntriesByProject.set(key, (totalEntriesByProject.get(key) ?? 0) + 1)
    }

    for (const entry of candidates) {
      if (deleted >= maxDeletes) break
      if (entry.createdAt > cutoff) continue

      const url = await ctx.storage.getUrl(entry.storageId)
      if (url) continue

      const key = String(entry.projectId)
      const current =
        affectedProjects.get(key) ??
        {
          projectId: entry.projectId,
          deletedBytes: 0,
          deletedEntries: 0,
        }
      current.deletedBytes += Math.max(0, entry.size)
      current.deletedEntries += 1
      affectedProjects.set(key, current)
      await ctx.db.delete(entry._id)
      deleted += 1
    }

    for (const state of affectedProjects.values()) {
      const project = await ctx.db.get(state.projectId)
      if (!project) continue

      const replica = await ctx.db
        .query("projectReplicaGit")
        .withIndex("by_project", (q) => q.eq("projectId", state.projectId))
        .first()
      const bundleBytes = Math.max(0, replica?.bundleSizeBytes ?? 0)
      const totalEntriesBefore = totalEntriesByProject.get(String(state.projectId)) ?? 0
      const remainingEntries = Math.max(0, totalEntriesBefore - state.deletedEntries)

      let sourceAndConfigDelta = -state.deletedBytes
      let gitHistoryDelta = 0
      if (bundleBytes <= 0 && remainingEntries === 0) {
        const legacyTotals = await getLegacyFileStorageTotals(ctx, state.projectId)
        sourceAndConfigDelta = legacyTotals.activeBytes - state.deletedBytes
        gitHistoryDelta = legacyTotals.supersededBytes
      }

      await applyProjectStorageDeltas(ctx, project.organizationId, state.projectId, {
        sourceAndConfig: sourceAndConfigDelta,
        gitHistory: gitHistoryDelta,
      })
    }

    return {
      deleted,
      cutoff,
    }
  },
})
