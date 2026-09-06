import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

export const enqueueForServer = mutation({
  args: {
    projectId: v.id("projects"),
    requestedBy: v.id("devicePrincipals"),
    target: v.union(v.literal("preview"), v.literal("production")),
    provider: v.union(v.literal("railway")),
    commitSha: v.optional(v.string()),
    statusUrl: v.optional(v.string()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const now = Date.now()

    const deploymentJobId = await ctx.db.insert("deploymentJobs", {
      projectId: args.projectId,
      requestedBy: args.requestedBy,
      target: args.target,
      provider: args.provider,
      commitSha: args.commitSha,
      status: "queued",
      statusUrl: args.statusUrl,
      logs: [`[${new Date(now).toISOString()}] job queued`],
      createdAt: now,
      updatedAt: now,
    })

    return deploymentJobId
  },
})

export const getForServer = query({
  args: {
    deploymentJobId: v.id("deploymentJobs"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    return await ctx.db.get(args.deploymentJobId)
  },
})

export const updateStatusForServer = mutation({
  args: {
    deploymentJobId: v.id("deploymentJobs"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("canceled")
    ),
    providerDeploymentId: v.optional(v.string()),
    statusUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    appendLogs: v.optional(v.array(v.string())),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const current = await ctx.db.get(args.deploymentJobId)
    if (!current) {
      throw new Error("Deployment job not found")
    }

    const now = Date.now()
    const nextLogs = [
      ...(current.logs ?? []),
      ...(args.appendLogs ?? []).map((line) => `[${new Date(now).toISOString()}] ${line}`),
    ]

    await ctx.db.patch(args.deploymentJobId, {
      status: args.status,
      providerDeploymentId: args.providerDeploymentId ?? current.providerDeploymentId,
      statusUrl: args.statusUrl ?? current.statusUrl,
      error: args.error,
      logs: nextLogs.slice(-500),
      updatedAt: now,
      startedAt: args.status === "running"
        ? (current.startedAt ?? now)
        : current.startedAt,
      completedAt: args.status === "succeeded" || args.status === "failed" || args.status === "canceled"
        ? now
        : current.completedAt,
    })

    return { updated: true }
  },
})

export const listRecentForProjectForServer = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const max = typeof args.limit === "number" && Number.isFinite(args.limit)
      ? Math.max(1, Math.min(100, Math.floor(args.limit)))
      : 20

    const rows = await ctx.db
      .query("deploymentJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(max)

    return rows
  },
})

export const listActiveForServer = query({
  args: {
    limit: v.optional(v.number()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const max = typeof args.limit === "number" && Number.isFinite(args.limit)
      ? Math.max(1, Math.min(250, Math.floor(args.limit)))
      : 100

    const rows = await ctx.db
      .query("deploymentJobs")
      .withIndex("by_updated_at")
      .order("desc")
      .take(Math.max(max * 2, 150))

    return rows
      .filter((row) => row.status === "queued" || row.status === "running")
      .slice(0, max)
  },
})
