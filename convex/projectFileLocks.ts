import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"

const DEFAULT_LOCK_TTL_MS = 30_000
const MIN_LOCK_TTL_MS = 3_000
const MAX_LOCK_TTL_MS = 10 * 60_000

function clampTtlMs(ttlMs: number): number {
  return Math.max(MIN_LOCK_TTL_MS, Math.min(MAX_LOCK_TTL_MS, ttlMs))
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "")
}

function isExpired(lockedAt: number | undefined, ttlMs: number, now: number): boolean {
  if (!lockedAt) return true
  return now - lockedAt > ttlMs
}

function displayName(user: {
  firstName?: string | undefined
  lastName?: string | undefined
  email: string
}): string {
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
  return name || user.email
}

export const acquireLock = mutation({
  args: {
    projectId: v.id("projects"),
    filePath: v.string(),
    userId: v.id("users"),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const ttlMs = clampTtlMs(args.ttlMs ?? DEFAULT_LOCK_TTL_MS)
    const filePath = normalizeFilePath(args.filePath)

    const existing = await ctx.db
      .query("projectFileLocks")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", args.projectId).eq("filePath", filePath)
      )
      .first()

    // No lock record yet: create and lock.
    if (!existing) {
      const lockId = await ctx.db.insert("projectFileLocks", {
        projectId: args.projectId,
        filePath,
        status: "locked",
        lockedBy: args.userId,
        lockedAt: now,
      })

      return {
        acquired: true as const,
        lockId,
        filePath,
        lockedBy: args.userId,
        lockedAt: now,
        expiresAt: now + ttlMs,
      }
    }

    // Free: take it.
    if (existing.status === "free") {
      await ctx.db.patch(existing._id, {
        status: "locked",
        lockedBy: args.userId,
        lockedAt: now,
      })

      return {
        acquired: true as const,
        lockId: existing._id,
        filePath,
        lockedBy: args.userId,
        lockedAt: now,
        expiresAt: now + ttlMs,
      }
    }

    // Locked by us: renew the lease.
    if (existing.status === "locked" && existing.lockedBy === args.userId) {
      await ctx.db.patch(existing._id, {
        lockedAt: now,
      })

      return {
        acquired: true as const,
        lockId: existing._id,
        filePath,
        lockedBy: args.userId,
        lockedAt: now,
        expiresAt: now + ttlMs,
      }
    }

    // Locked by someone else, but expired: steal it.
    if (
      existing.status === "locked" &&
      existing.lockedBy &&
      isExpired(existing.lockedAt, ttlMs, now)
    ) {
      await ctx.db.patch(existing._id, {
        status: "locked",
        lockedBy: args.userId,
        lockedAt: now,
        pendingMerges: undefined,
      })

      return {
        acquired: true as const,
        lockId: existing._id,
        filePath,
        lockedBy: args.userId,
        lockedAt: now,
        expiresAt: now + ttlMs,
        stolen: true as const,
      }
    }

    // Otherwise: busy (locked or merging).
    const lockedBy = existing.lockedBy ?? null
    const lockedAt = existing.lockedAt ?? null
    const expiresAt =
      existing.status === "locked" && existing.lockedAt
        ? existing.lockedAt + ttlMs
        : null

    let lockedByName: string | null = null
    if (lockedBy) {
      const user = await ctx.db.get(lockedBy)
      if (user) lockedByName = displayName(user)
    }

    return {
      acquired: false as const,
      filePath,
      status: existing.status,
      lockedBy,
      lockedByName,
      lockedAt,
      expiresAt,
    }
  },
})

export const releaseLock = mutation({
  args: {
    projectId: v.id("projects"),
    filePath: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const filePath = normalizeFilePath(args.filePath)

    const existing = await ctx.db
      .query("projectFileLocks")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", args.projectId).eq("filePath", filePath)
      )
      .first()

    if (!existing) {
      return { released: true as const }
    }

    // Only the lock owner can release.
    if (existing.status !== "locked" || existing.lockedBy !== args.userId) {
      return { released: false as const }
    }

    await ctx.db.patch(existing._id, {
      status: "free",
      lockedBy: undefined,
      lockedAt: undefined,
      pendingMerges: undefined,
    })

    return { released: true as const }
  },
})

export const getLock = query({
  args: {
    projectId: v.id("projects"),
    filePath: v.string(),
  },
  handler: async (ctx, args) => {
    const filePath = normalizeFilePath(args.filePath)

    const lock = await ctx.db
      .query("projectFileLocks")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", args.projectId).eq("filePath", filePath)
      )
      .first()

    if (!lock) return null

    const lockedByUser =
      lock.lockedBy ? await ctx.db.get(lock.lockedBy) : null

    return {
      ...lock,
      lockedByUser: lockedByUser
        ? {
            id: lockedByUser._id as Id<"users">,
            name: displayName(lockedByUser),
            profileImageUrl: lockedByUser.profileImageUrl ?? null,
          }
        : null,
    }
  },
})

