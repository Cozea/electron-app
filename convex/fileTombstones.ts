import { internalMutation } from "./_generated/server"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import { v } from "convex/values"

const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function deviceDisplayName(device: { deviceLabel?: string; identityKey?: string }): string {
  return device.deviceLabel?.trim() || device.identityKey?.trim() || "Unknown device"
}

/** Create a tombstone when a file is deleted. */
export const createTombstone = mutation({
  args: {
    projectId: v.id("projects"),
    filePath: v.string(),
    // Transitional caller field. Human/device attribution is derived from auth.
    deletedBy: v.optional(v.id("devicePrincipals")),
    deletedByAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const now = Date.now()
    const deletedBy = args.deletedByAgent ? undefined : principal._id

    const existing = await ctx.db
      .query("fileTombstones")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", args.projectId).eq("filePath", args.filePath)
      )
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        deletedAt: now,
        deletedBy,
        deletedByAgent: args.deletedByAgent,
        expiresAt: now + TOMBSTONE_TTL_MS,
      })
      return existing._id
    }

    return await ctx.db.insert("fileTombstones", {
      projectId: args.projectId,
      filePath: args.filePath,
      deletedAt: now,
      deletedBy,
      deletedByAgent: args.deletedByAgent,
      expiresAt: now + TOMBSTONE_TTL_MS,
    })
  },
})

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

    if (!tombstone || tombstone.expiresAt < Date.now()) return null

    let deletedByName: string | null = null
    if (tombstone.deletedBy) {
      const device = await ctx.db.get(tombstone.deletedBy)
      if (device) deletedByName = deviceDisplayName(device)
    } else if (tombstone.deletedByAgent) {
      deletedByName = tombstone.deletedByAgent
    }

    return {
      ...tombstone,
      deletedByName,
    }
  },
})

export const getProjectTombstones = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const now = Date.now()
    const tombstones = await ctx.db
      .query("fileTombstones")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()
    return tombstones.filter((t) => t.expiresAt > now)
  },
})

export const cleanupExpiredTombstones = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const now = Date.now()
    const expired = await ctx.db
      .query("fileTombstones")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect()

    for (const tombstone of expired) await ctx.db.delete(tombstone._id)
    return { deleted: expired.length }
  },
})

export const cleanupAllExpiredTombstones = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()

    const expired = await ctx.db
      .query("fileTombstones")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .collect()

    for (const tombstone of expired) await ctx.db.delete(tombstone._id)

    const dayMs = 24 * 60 * 60_000
    const oldChallenges = await ctx.db.query("deviceAuthChallenges")
      .withIndex("by_expiration", (q) => q.lt("expiresAt", now - dayMs)).take(1_000)
    for (const challenge of oldChallenges) await ctx.db.delete(challenge._id)
    const events = await ctx.db.query("identitySecurityEvents").collect()
    const oldEvents = events.filter((event) => event.createdAt < now - 180 * dayMs).slice(0, 1_000)
    for (const event of oldEvents) await ctx.db.delete(event._id)
    const grants = await ctx.db.query("organizationRecoveryGrants").collect()
    const oldGrants = grants.filter((grant) =>
      grant.expiresAt < now - 30 * dayMs && (grant.consumedAt !== undefined || grant.revokedAt !== undefined),
    ).slice(0, 1_000)
    for (const grant of oldGrants) await ctx.db.delete(grant._id)
    const expiredDevAppUploads = await ctx.db.query("devAppArtifactUploads")
      .withIndex("by_expiration", (q) => q.lt("expiresAt", now)).take(250)
    for (const upload of expiredDevAppUploads) {
      if (upload.storageId) await ctx.storage.delete(upload.storageId)
      await ctx.db.delete(upload._id)
    }

    console.log(`[Maintenance] Cleaned ${expired.length} tombstones, ${oldChallenges.length + oldEvents.length + oldGrants.length} identity rows, and ${expiredDevAppUploads.length} DevApp uploads`)
    return { deleted: expired.length }
  },
})
