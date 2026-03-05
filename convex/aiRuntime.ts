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

const AGENT_RUN_STATUS = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("budget_exceeded")
)

export const upsertAgentRunForServer = mutation({
  args: {
    serverSecret: v.string(),
    runId: v.string(),
    organizationWorkosId: v.string(),
    conversationId: v.optional(v.string()),
    model: v.string(),
    provider: v.string(),
    status: AGENT_RUN_STATUS,
    maxCostUsd: v.optional(v.number()),
    cumulativeCostUsd: v.number(),
    promptTokens: v.number(),
    completionTokens: v.number(),
    totalTokens: v.number(),
    billedUsd: v.optional(v.number()),
    walletHoldId: v.optional(v.string()),
    stepsCount: v.optional(v.number()),
    error: v.optional(v.string()),
    metadata: v.optional(v.any()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const now = Date.now()

    const existing = await ctx.db
      .query("aiAgentRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .first()

    const payload = {
      runId: args.runId,
      organizationWorkosId: args.organizationWorkosId,
      conversationId: args.conversationId,
      model: args.model,
      provider: args.provider,
      status: args.status,
      maxCostUsd: args.maxCostUsd,
      cumulativeCostUsd: args.cumulativeCostUsd,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      totalTokens: args.totalTokens,
      billedUsd: args.billedUsd,
      walletHoldId: args.walletHoldId,
      stepsCount: Math.max(0, Math.floor(args.stepsCount ?? 0)),
      error: args.error,
      metadata: args.metadata,
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      updatedAt: now,
    }

    if (existing) {
      await ctx.db.patch(existing._id, payload)
      return {
        ok: true,
        alreadyExisted: true,
        runId: args.runId,
      }
    }

    await ctx.db.insert("aiAgentRuns", {
      ...payload,
      createdAt: now,
    })

    return {
      ok: true,
      alreadyExisted: false,
      runId: args.runId,
    }
  },
})

export const appendAgentRunStepForServer = mutation({
  args: {
    serverSecret: v.string(),
    runId: v.string(),
    organizationWorkosId: v.string(),
    step: v.number(),
    promptTokens: v.number(),
    completionTokens: v.number(),
    totalTokens: v.number(),
    costUsd: v.number(),
    cumulativeCostUsd: v.number(),
    timestamp: v.number(),
    runPromptTokens: v.optional(v.number()),
    runCompletionTokens: v.optional(v.number()),
    runTotalTokens: v.optional(v.number()),
    status: v.optional(AGENT_RUN_STATUS),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const now = Date.now()
    const normalizedStep = Math.max(1, Math.floor(args.step))

    const existingStep = await ctx.db
      .query("aiAgentRunSteps")
      .withIndex("by_run_and_step", (q) => q.eq("runId", args.runId).eq("step", normalizedStep))
      .first()

    const stepPayload = {
      runId: args.runId,
      organizationWorkosId: args.organizationWorkosId,
      step: normalizedStep,
      promptTokens: Math.max(0, Math.floor(args.promptTokens)),
      completionTokens: Math.max(0, Math.floor(args.completionTokens)),
      totalTokens: Math.max(0, Math.floor(args.totalTokens)),
      costUsd: Math.max(0, args.costUsd),
      cumulativeCostUsd: Math.max(0, args.cumulativeCostUsd),
      timestamp: args.timestamp,
      updatedAt: now,
    }

    if (existingStep) {
      await ctx.db.patch(existingStep._id, stepPayload)
    } else {
      await ctx.db.insert("aiAgentRunSteps", {
        ...stepPayload,
        createdAt: now,
      })
    }

    const run = await ctx.db
      .query("aiAgentRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .first()

    if (run) {
      const runPromptTokens = args.runPromptTokens !== undefined
        ? Math.max(0, Math.floor(args.runPromptTokens))
        : run.promptTokens
      const runCompletionTokens = args.runCompletionTokens !== undefined
        ? Math.max(0, Math.floor(args.runCompletionTokens))
        : run.completionTokens
      const runTotalTokens = args.runTotalTokens !== undefined
        ? Math.max(0, Math.floor(args.runTotalTokens))
        : run.totalTokens

      await ctx.db.patch(run._id, {
        cumulativeCostUsd: Math.max(0, args.cumulativeCostUsd),
        promptTokens: Math.max(run.promptTokens, runPromptTokens),
        completionTokens: Math.max(run.completionTokens, runCompletionTokens),
        totalTokens: Math.max(run.totalTokens, runTotalTokens),
        stepsCount: Math.max(run.stepsCount, normalizedStep),
        ...(args.status ? { status: args.status } : {}),
        ...(args.error ? { error: args.error } : {}),
        updatedAt: now,
      })
    }

    return {
      ok: true,
      runId: args.runId,
      step: normalizedStep,
    }
  },
})

export const getAgentRunForServer = query({
  args: {
    serverSecret: v.string(),
    runId: v.string(),
    includeSteps: v.optional(v.boolean()),
    stepLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const run = await ctx.db
      .query("aiAgentRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .first()

    if (!run) return null

    const includeSteps = args.includeSteps ?? true
    if (!includeSteps) {
      return {
        ...run,
        steps: [] as unknown[],
      }
    }

    const stepLimit = Math.max(1, Math.min(500, Math.floor(args.stepLimit ?? 200)))
    const steps = await ctx.db
      .query("aiAgentRunSteps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .order("asc")
      .take(stepLimit)

    return {
      ...run,
      steps,
    }
  },
})

export const syncModelRegistrySnapshotForServer = mutation({
  args: {
    serverSecret: v.string(),
    snapshotId: v.string(),
    source: v.string(),
    updatedAt: v.number(),
    models: v.any(),
    pricing: v.any(),
    retention: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const now = Date.now()
    const retention = Math.max(1, Math.min(200, Math.floor(args.retention ?? 24)))
    const modelCount = Array.isArray(args.models) ? args.models.length : 0
    const pricingCount = Array.isArray(args.pricing) ? args.pricing.length : 0

    const existingModels = await ctx.db
      .query("aiModelSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .first()

    if (existingModels) {
      await ctx.db.patch(existingModels._id, {
        source: args.source,
        updatedAt: args.updatedAt,
        modelCount,
        models: args.models,
      })
    } else {
      await ctx.db.insert("aiModelSnapshots", {
        snapshotId: args.snapshotId,
        source: args.source,
        updatedAt: args.updatedAt,
        modelCount,
        models: args.models,
        createdAt: now,
      })
    }

    const existingPricing = await ctx.db
      .query("aiPricingSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .first()

    if (existingPricing) {
      await ctx.db.patch(existingPricing._id, {
        source: args.source,
        updatedAt: args.updatedAt,
        modelCount: pricingCount,
        pricing: args.pricing,
      })
    } else {
      await ctx.db.insert("aiPricingSnapshots", {
        snapshotId: args.snapshotId,
        source: args.source,
        updatedAt: args.updatedAt,
        modelCount: pricingCount,
        pricing: args.pricing,
        createdAt: now,
      })
    }

    const modelRows = await ctx.db
      .query("aiModelSnapshots")
      .withIndex("by_updated_at")
      .order("desc")
      .take(Math.max(retention + 32, retention))
    for (const row of modelRows.slice(retention)) {
      await ctx.db.delete(row._id)
    }

    const pricingRows = await ctx.db
      .query("aiPricingSnapshots")
      .withIndex("by_updated_at")
      .order("desc")
      .take(Math.max(retention + 32, retention))
    for (const row of pricingRows.slice(retention)) {
      await ctx.db.delete(row._id)
    }

    return {
      ok: true,
      snapshotId: args.snapshotId,
      modelCount,
      pricingCount,
    }
  },
})

export const getLatestModelRegistrySnapshotForServer = query({
  args: {
    serverSecret: v.string(),
    includePayload: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const includePayload = args.includePayload ?? false

    const [latestModels, latestPricing] = await Promise.all([
      ctx.db.query("aiModelSnapshots").withIndex("by_updated_at").order("desc").first(),
      ctx.db.query("aiPricingSnapshots").withIndex("by_updated_at").order("desc").first(),
    ])

    return {
      models: latestModels
        ? {
            snapshotId: latestModels.snapshotId,
            source: latestModels.source,
            updatedAt: latestModels.updatedAt,
            modelCount: latestModels.modelCount,
            ...(includePayload ? { models: latestModels.models } : {}),
          }
        : null,
      pricing: latestPricing
        ? {
            snapshotId: latestPricing.snapshotId,
            source: latestPricing.source,
            updatedAt: latestPricing.updatedAt,
            modelCount: latestPricing.modelCount,
            ...(includePayload ? { pricing: latestPricing.pricing } : {}),
          }
        : null,
    }
  },
})

export const upsertRouterRulesForServer = mutation({
  args: {
    serverSecret: v.string(),
    organizationWorkosId: v.string(),
    rules: v.any(),
    source: v.optional(v.string()),
    updatedByWorkosUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const now = Date.now()

    const existing = await ctx.db
      .query("aiRouterRules")
      .withIndex("by_organization", (q) => q.eq("organizationWorkosId", args.organizationWorkosId))
      .first()

    const payload = {
      organizationWorkosId: args.organizationWorkosId,
      rules: args.rules,
      version: String(now),
      source: args.source,
      updatedByWorkosUserId: args.updatedByWorkosUserId,
      updatedAt: now,
    }

    if (existing) {
      await ctx.db.patch(existing._id, payload)
    } else {
      await ctx.db.insert("aiRouterRules", {
        ...payload,
        createdAt: now,
      })
    }

    return {
      ok: true,
      organizationWorkosId: args.organizationWorkosId,
      version: payload.version,
    }
  },
})

export const getRouterRulesForServer = query({
  args: {
    serverSecret: v.string(),
    organizationWorkosId: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const rules = await ctx.db
      .query("aiRouterRules")
      .withIndex("by_organization_and_updated", (q) => q.eq("organizationWorkosId", args.organizationWorkosId))
      .order("desc")
      .first()

    if (!rules) return null

    return {
      organizationWorkosId: rules.organizationWorkosId,
      rules: rules.rules,
      version: rules.version,
      source: rules.source,
      updatedByWorkosUserId: rules.updatedByWorkosUserId,
      updatedAt: rules.updatedAt,
    }
  },
})

export const upsertRepoSessionForServer = mutation({
  args: {
    serverSecret: v.string(),
    sessionId: v.string(),
    organizationWorkosId: v.string(),
    projectId: v.optional(v.string()),
    workspaceRoot: v.string(),
    runtime: v.union(v.literal("local"), v.literal("cloud")),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const now = Date.now()
    const status = args.status ?? "active"

    const existing = await ctx.db
      .query("aiRepoSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first()

    const payload = {
      sessionId: args.sessionId,
      organizationWorkosId: args.organizationWorkosId,
      projectId: args.projectId,
      workspaceRoot: args.workspaceRoot,
      runtime: args.runtime,
      status,
      metadata: args.metadata,
      lastSeenAt: now,
      updatedAt: now,
    }

    if (existing) {
      await ctx.db.patch(existing._id, payload)
    } else {
      await ctx.db.insert("aiRepoSessions", {
        ...payload,
        createdAt: now,
      })
    }

    return {
      ok: true,
      sessionId: args.sessionId,
      status,
    }
  },
})

export const getRepoSessionForServer = query({
  args: {
    serverSecret: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    return await ctx.db
      .query("aiRepoSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first()
  },
})
