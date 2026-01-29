import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

// Keep awareness reasonably fresh to avoid "ghost cursors".
// Clients republish periodically to stay active.
const AWARENESS_TIMEOUT_MS = 45 * 1000

/**
 * Upsert the latest awareness update for a client in a project.
 * Stores only the most recent update per (projectId, clientId).
 */
export const upsertAwareness = mutation({
  args: {
    projectId: v.id("projects"),
    clientId: v.string(),
    update: v.bytes(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("yjsAwareness")
      .withIndex("by_project_and_client", (q) =>
        q.eq("projectId", args.projectId).eq("clientId", args.clientId)
      )
      .first()

    const now = Date.now()

    if (existing) {
      await ctx.db.patch(existing._id, {
        update: args.update,
        updatedAt: now,
      })
      return { id: existing._id, updated: true }
    }

    const id = await ctx.db.insert("yjsAwareness", {
      projectId: args.projectId,
      clientId: args.clientId,
      update: args.update,
      updatedAt: now,
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
    const cutoff = Date.now() - AWARENESS_TIMEOUT_MS

    const entries = await ctx.db
      .query("yjsAwareness")
      .withIndex("by_project_and_updated", (q) =>
        q.eq("projectId", args.projectId).gt("updatedAt", cutoff)
      )
      .collect()

    return entries.map((e) => ({
      clientId: e.clientId,
      update: e.update,
      updatedAt: e.updatedAt,
    }))
  },
})

