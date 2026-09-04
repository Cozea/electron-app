import { v } from "convex/values"

import type { Id } from "./_generated/dataModel"
import { authenticatedMutation as mutation } from "./lib/authenticatedFunctions"
import { applyProjectStorageDeltas } from "./lib/workspaceLimits"

const DEFAULT_CLEANUP_BATCH_SIZE = 64
const MAX_CLEANUP_BATCH_SIZE = 256

/**
 * Delete encrypted Yjs updates only when an acknowledged snapshot explicitly
 * claims to contain their sequence.
 *
 * Timestamp-based cleanup is unsafe: a snapshot can be encoded while another
 * client is publishing a newer update, and wall-clock ordering cannot prove
 * that the snapshot contains that update. `throughSeq` is a causal boundary
 * supplied by the client transport after updates have been decoded/applied.
 */
export const cleanupUpdatesThroughSeq = mutation({
  args: {
    projectId: v.id("projects"),
    throughSeq: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const throughSeq = Number.isFinite(args.throughSeq)
      ? Math.max(0, Math.floor(args.throughSeq))
      : 0
    const limit = Number.isFinite(args.limit)
      ? Math.max(1, Math.min(MAX_CLEANUP_BATCH_SIZE, Math.floor(args.limit!)))
      : DEFAULT_CLEANUP_BATCH_SIZE

    const updates = await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_seq", (query) =>
        query.eq("projectId", args.projectId).lte("seq", throughSeq),
      )
      .order("asc")
      .take(limit)

    let deletedBytes = 0
    let highestDeletedSeq = 0

    for (const update of updates) {
      deletedBytes += update.update?.byteLength ?? 0
      highestDeletedSeq = Math.max(highestDeletedSeq, update.seq ?? 0)
      await ctx.db.delete(update._id)
    }

    if (deletedBytes > 0) {
      await applyProjectStorageDeltas(ctx, args.projectId, {
        collaborationData: -deletedBytes,
      })
    }

    const remaining = await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_seq", (query) =>
        query.eq("projectId", args.projectId).lte("seq", throughSeq),
      )
      .order("asc")
      .first()

    return {
      projectId: args.projectId as Id<"projects">,
      throughSeq,
      deleted: updates.length,
      deletedBytes,
      highestDeletedSeq,
      hasMore: remaining !== null,
    }
  },
})
