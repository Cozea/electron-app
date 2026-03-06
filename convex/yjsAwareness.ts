import type { MutationCtx } from "./_generated/server"
import { internalMutation, mutation, query } from "./_generated/server"
import { v } from "convex/values"

// Keep awareness reasonably fresh to avoid "ghost cursors".
// Clients republish periodically to stay active.
const AWARENESS_TIMEOUT_MS = 45 * 1000
const AWARENESS_CLEANUP_BATCH_SIZE = 1000

async function deleteExpiredAwarenessBatch(ctx: MutationCtx) {
  const now = Date.now()
  const stale = await ctx.db
    .query("yjsAwareness")
    .withIndex("by_updated_at", (q) => q.lt("updatedAt", now - 2 * AWARENESS_TIMEOUT_MS))
    .order("asc")
    .take(AWARENESS_CLEANUP_BATCH_SIZE)

  let deleted = 0
  for (const entry of stale) {
    const expiresAt = entry.expiresAt ?? entry.updatedAt + AWARENESS_TIMEOUT_MS
    if (expiresAt <= now) {
      await ctx.db.delete(entry._id)
      deleted += 1
    }
  }

  return { deleted }
}

/**
 * Upsert the latest awareness update for a client in a project.
 * Stores only the most recent update per (projectId, clientId).
 */
export const upsertAwareness = mutation({
  args: {
    projectId: v.id("projects"),
    clientId: v.string(),
    update: v.bytes(),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("yjsAwareness")
      .withIndex("by_project_and_client", (q) =>
        q.eq("projectId", args.projectId).eq("clientId", args.clientId)
      )
      .first()

    const now = Date.now()
    const ttlMs = typeof args.ttlMs === "number" && Number.isFinite(args.ttlMs)
      ? Math.max(1_000, Math.min(60_000, Math.floor(args.ttlMs)))
      : AWARENESS_TIMEOUT_MS
    const expiresAt = now + ttlMs

    if (existing) {
      await ctx.db.patch(existing._id, {
        update: args.update,
        updatedAt: now,
        expiresAt,
      })
      return { id: existing._id, updated: true }
    }

    const id = await ctx.db.insert("yjsAwareness", {
      projectId: args.projectId,
      clientId: args.clientId,
      update: args.update,
      updatedAt: now,
      expiresAt,
    })

    return { id, updated: false }
  },
})

/**
 * Get active awareness updates for a project.
 * Clients use this to render live cursors/selections for other users.
 */
export const getActiveAwareness = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const cutoff = now - AWARENESS_TIMEOUT_MS

    const entries = await ctx.db
      .query("yjsAwareness")
      .withIndex("by_project_and_updated", (q) =>
        q.eq("projectId", args.projectId).gt("updatedAt", cutoff)
      )
      .collect()

    return entries
      .filter((entry) => {
        if (typeof entry.expiresAt === "number") {
          return entry.expiresAt > now
        }
        return entry.updatedAt > cutoff
      })
      .map((e) => ({
      clientId: e.clientId,
      update: e.update,
      updatedAt: e.updatedAt,
      expiresAt: e.expiresAt ?? e.updatedAt + AWARENESS_TIMEOUT_MS,
    }))
  },
})

export const cleanupExpiredAwareness = mutation({
  args: {},
  handler: async (ctx) => await deleteExpiredAwarenessBatch(ctx),
})

export const cleanupExpiredAwarenessInternal = internalMutation({
  args: {},
  handler: async (ctx) => await deleteExpiredAwarenessBatch(ctx),
})
