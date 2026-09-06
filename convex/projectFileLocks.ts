import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"

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

function displayName(device: {
  displayName?: string | undefined
  identityKey?: string | undefined
}): string {
  return device.displayName?.trim() || device.identityKey?.trim() || "Unknown device"
}

export const acquireLock = mutation({
  args: {
    projectId: v.id("projects"),
    filePath: v.string(),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const now = Date.now()
    const ttlMs = clampTtlMs(args.ttlMs ?? DEFAULT_LOCK_TTL_MS)
    const filePath = normalizeFilePath(args.filePath)

    const existing = await ctx.db
      .query("projectFileLocks")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", args.projectId).eq("filePath", filePath)
      )
      .first()

    if (!existing) {
      const lockId = await ctx.db.insert("projectFileLocks", {
        projectId: args.projectId,
        filePath,
        status: "locked",
        lockedBy: principal._id,
        lockedAt: now,
      })

      return {
        acquired: true as const,
        lockId,
        filePath,
        lockedBy: principal._id,
        lockedAt: now,
        expiresAt: now + ttlMs,
      }
    }

    if (existing.status === "free") {
      await ctx.db.patch(existing._id, {
        status: "locked",
        lockedBy: principal._id,
        lockedAt: now,
      })

      return {
        acquired: true as const,
        lockId: existing._id,
        filePath,
        lockedBy: principal._id,
        lockedAt: now,
        expiresAt: now + ttlMs,
      }
    }

    if (existing.status === "locked" && existing.lockedBy === principal._id) {
      await ctx.db.patch(existing._id, { lockedAt: now })

      return {
        acquired: true as const,
        lockId: existing._id,
        filePath,
        lockedBy: principal._id,
        lockedAt: now,
        expiresAt: now + ttlMs,
      }
    }

    if (
      existing.status === "locked" &&
      existing.lockedBy &&
      isExpired(existing.lockedAt, ttlMs, now)
    ) {
      await ctx.db.patch(existing._id, {
        status: "locked",
        lockedBy: principal._id,
        lockedAt: now,
        pendingMerges: undefined,
      })

      return {
        acquired: true as const,
        lockId: existing._id,
        filePath,
        lockedBy: principal._id,
        lockedAt: now,
        expiresAt: now + ttlMs,
        stolen: true as const,
      }
    }

    const lockedBy = existing.lockedBy ?? null
    const lockedAt = existing.lockedAt ?? null
    const expiresAt =
      existing.status === "locked" && existing.lockedAt
        ? existing.lockedAt + ttlMs
        : null

    let lockedByName: string | null = null
    if (lockedBy) {
      const device = await ctx.db.get(lockedBy)
      if (device) lockedByName = displayName(device)
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
  },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const filePath = normalizeFilePath(args.filePath)

    const existing = await ctx.db
      .query("projectFileLocks")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", args.projectId).eq("filePath", filePath)
      )
      .first()

    if (!existing) return { released: true as const }
    if (existing.status !== "locked" || existing.lockedBy !== principal._id) {
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

    const lockedByDevice = lock.lockedBy ? await ctx.db.get(lock.lockedBy) : null

    let trafficLight: 'green' | 'yellow' | 'red' = 'green'
    if (lock.status === 'locked') {
      trafficLight = lock.agentId ? 'red' : 'yellow'
    }

    return {
      ...lock,
      trafficLight,
      lockedByPrincipal: lockedByDevice
        ? {
            id: lockedByDevice._id as Id<"devicePrincipals">,
            displayName: displayName(lockedByDevice),
            avatarUrl: lockedByDevice.avatarStorageId ? await ctx.storage.getUrl(lockedByDevice.avatarStorageId) : null,
          }
        : null,
    }
  },
})

/** Acquire a lock for an AI agent. */
export const acquireAgentLock = mutation({
  args: {
    projectId: v.id("projects"),
    filePath: v.string(),
    agentId: v.string(),
    agentName: v.optional(v.string()),
    taskDescription: v.optional(v.string()),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const ttlMs = clampTtlMs(args.ttlMs ?? 60_000)
    const filePath = normalizeFilePath(args.filePath)

    const existing = await ctx.db
      .query("projectFileLocks")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", args.projectId).eq("filePath", filePath)
      )
      .first()

    if (!existing) {
      const lockId = await ctx.db.insert("projectFileLocks", {
        projectId: args.projectId,
        filePath,
        status: "locked",
        agentId: args.agentId,
        agentName: args.agentName ?? "AI Agent",
        taskDescription: args.taskDescription,
        lockedAt: now,
        expiresAt: now + ttlMs,
      })

      return { acquired: true as const, lockId, filePath, expiresAt: now + ttlMs }
    }

    if (existing.status === "free") {
      await ctx.db.patch(existing._id, {
        status: "locked",
        agentId: args.agentId,
        agentName: args.agentName ?? "AI Agent",
        taskDescription: args.taskDescription,
        lockedBy: undefined,
        lockedAt: now,
        expiresAt: now + ttlMs,
      })

      return { acquired: true as const, lockId: existing._id, filePath, expiresAt: now + ttlMs }
    }

    if (existing.status === "locked" && existing.agentId === args.agentId) {
      await ctx.db.patch(existing._id, {
        lockedAt: now,
        expiresAt: now + ttlMs,
        taskDescription: args.taskDescription,
      })

      return { acquired: true as const, lockId: existing._id, filePath, expiresAt: now + ttlMs }
    }

    if (
      existing.status === "locked" &&
      existing.agentId &&
      existing.expiresAt &&
      existing.expiresAt < now
    ) {
      await ctx.db.patch(existing._id, {
        status: "locked",
        agentId: args.agentId,
        agentName: args.agentName ?? "AI Agent",
        taskDescription: args.taskDescription,
        lockedBy: undefined,
        lockedAt: now,
        expiresAt: now + ttlMs,
      })

      return {
        acquired: true as const,
        lockId: existing._id,
        filePath,
        expiresAt: now + ttlMs,
        stolen: true as const,
      }
    }

    if (existing.status === "locked" && existing.lockedBy) {
      const lockedByDevice = await ctx.db.get(existing.lockedBy)
      return {
        acquired: false as const,
        reason: "human-editing",
        lockedBy: lockedByDevice ? displayName(lockedByDevice) : "another device",
      }
    }

    return {
      acquired: false as const,
      reason: "agent-working",
      lockedBy: existing.agentName ?? "another agent",
      taskDescription: existing.taskDescription,
      expiresAt: existing.expiresAt,
    }
  },
})

export const releaseAgentLock = mutation({
  args: {
    projectId: v.id("projects"),
    filePath: v.string(),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    const filePath = normalizeFilePath(args.filePath)

    const existing = await ctx.db
      .query("projectFileLocks")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", args.projectId).eq("filePath", filePath)
      )
      .first()

    if (!existing) return { released: true as const }
    if (existing.agentId !== args.agentId) return { released: false as const }

    await ctx.db.patch(existing._id, {
      status: "free",
      agentId: undefined,
      agentName: undefined,
      taskDescription: undefined,
      lockedBy: undefined,
      lockedAt: undefined,
      expiresAt: undefined,
    })

    return { released: true as const }
  },
})

export const getProjectLocks = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectFileLocks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()
  },
})
