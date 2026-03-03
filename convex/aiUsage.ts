import { mutation, query } from "./_generated/server"
import type { MutationCtx } from "./_generated/server"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import {
  calculateCredits,
  calculateSpendCents,
  getModelTier,
} from "./lib/modelTiers"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

const providerValidator = v.union(
  v.literal("anthropic"),
  v.literal("openai"),
  v.literal("google"),
  v.literal("xai")
)

const extendedUsageValidator = v.optional(
  v.object({
    reasoningTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    toolCallTokens: v.optional(v.number()),
  })
)

const toolCallsValidator = v.optional(
  v.object({
    count: v.number(),
    names: v.array(v.string()),
    approvalCount: v.optional(v.number()),
  })
)

export const log = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    model: v.string(),
    provider: providerValidator,
    promptTokens: v.number(),
    completionTokens: v.number(),
    totalTokens: v.number(),
    keySource: v.union(v.literal("organization"), v.literal("provider_auth")),
    requestId: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    feature: v.optional(v.string()),
    actionType: v.optional(v.string()),
    projectId: v.optional(v.string()),
    extendedUsage: extendedUsageValidator,
    toolCalls: toolCallsValidator,
    durationMs: v.optional(v.number()),
    finishReason: v.optional(v.string()),
    rawFinishReason: v.optional(v.string()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const now = Date.now()

    if (args.requestId) {
      const existing = await ctx.db
        .query("aiUsage")
        .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
        .first()

      if (existing) {
        const trackedUnits = existing.trackedUnits
        const spendCents = calculateSpendCents(
          existing.model,
          existing.promptTokens,
          existing.completionTokens,
          existing.extendedUsage?.cachedInputTokens ?? 0
        )
        return {
          trackedUnits,
          spendCents,
          alreadyProcessed: true,
        }
      }
    }

    const cachedInputTokens = args.extendedUsage?.cachedInputTokens ?? 0
    const trackedUnits = calculateCredits(
      args.model,
      args.promptTokens,
      args.completionTokens,
      cachedInputTokens
    )
    const modelTier = getModelTier(args.model)
    const spendCents = calculateSpendCents(
      args.model,
      args.promptTokens,
      args.completionTokens,
      cachedInputTokens
    )

    await ctx.db.insert("aiUsage", {
      organizationId: args.organizationId,
      userId: args.userId,
      requestId: args.requestId,
      model: args.model,
      modelTier,
      provider: args.provider,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      totalTokens: args.totalTokens,
      extendedUsage: args.extendedUsage,
      trackedUnits,
      feature: args.feature,
      actionType: args.actionType,
      conversationId: args.conversationId,
      projectId: args.projectId,
      toolCalls: args.toolCalls,
      durationMs: args.durationMs,
      finishReason: args.finishReason,
      rawFinishReason: args.rawFinishReason,
      keySource: args.keySource,
      timestamp: now,
    })

    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    await updateAggregate(ctx, args, "daily", dayStart.getTime(), trackedUnits)

    const monthStart = new Date(now)
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    await updateAggregate(ctx, args, "monthly", monthStart.getTime(), trackedUnits)

    return {
      trackedUnits,
      modelTier,
      spendCents,
    }
  },
})

async function updateAggregate(
  ctx: MutationCtx,
  args: {
    organizationId: Doc<"organizations">["_id"]
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    userId: Doc<"users">["_id"]
  },
  period: "daily" | "monthly",
  periodStart: number,
  trackedUnits: number
) {
  const existing = await ctx.db
    .query("aiUsageAggregates")
    .withIndex("by_organization_and_period", (q) =>
      q
        .eq("organizationId", args.organizationId)
        .eq("period", period)
        .eq("periodStart", periodStart)
    )
    .first()

  const now = Date.now()

  if (existing) {
    const byModel = (existing.byModel || {}) as Record<string, number>
    byModel[args.model] = (byModel[args.model] || 0) + args.totalTokens

    const byUser = (existing.byUser || {}) as Record<string, number>
    const userIdStr = String(args.userId)
    byUser[userIdStr] = (byUser[userIdStr] || 0) + args.totalTokens

    await ctx.db.patch(existing._id, {
      totalPromptTokens: existing.totalPromptTokens + args.promptTokens,
      totalCompletionTokens: existing.totalCompletionTokens + args.completionTokens,
      totalTokens: existing.totalTokens + args.totalTokens,
      totalTrackedUnits: existing.totalTrackedUnits + trackedUnits,
      requestCount: existing.requestCount + 1,
      byModel,
      byUser,
      updatedAt: now,
    })
    return
  }

  await ctx.db.insert("aiUsageAggregates", {
    organizationId: args.organizationId,
    period,
    periodStart,
    totalPromptTokens: args.promptTokens,
    totalCompletionTokens: args.completionTokens,
    totalTokens: args.totalTokens,
    totalTrackedUnits: trackedUnits,
    requestCount: 1,
    byModel: { [args.model]: args.totalTokens },
    byUser: { [String(args.userId)]: args.totalTokens },
    updatedAt: now,
  })
}

export const getRecentForUser = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query("aiUsage")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit || 50)

    return records.map((record) => ({
      ...record,
      trackedUnits: record.trackedUnits,
    }))
  },
})

export const getRecentForOrganization = query({
  args: {
    organizationId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query("aiUsage")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .order("desc")
      .take(args.limit || 100)

    return records.map((record) => ({
      ...record,
      trackedUnits: record.trackedUnits,
    }))
  },
})

export const getAggregates = query({
  args: {
    organizationId: v.id("organizations"),
    period: v.union(v.literal("daily"), v.literal("monthly")),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

    const aggregates = await ctx.db
      .query("aiUsageAggregates")
      .withIndex("by_organization_and_period", (q) =>
        q.eq("organizationId", args.organizationId).eq("period", args.period)
      )
      .filter((q) =>
        q.and(
          q.gte(q.field("periodStart"), args.startDate || thirtyDaysAgo),
          q.lte(q.field("periodStart"), args.endDate || now)
        )
      )
      .collect()

    return aggregates.map((aggregate) => ({
      ...aggregate,
      totalTrackedUnits: aggregate.totalTrackedUnits,
    }))
  },
})

export const getUsageSummary = query({
  args: {
    organizationId: v.id("organizations"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const org = await ctx.db.get(args.organizationId)
    if (!org) {
      return null
    }

    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const monthlyAggregate = await ctx.db
      .query("aiUsageAggregates")
      .withIndex("by_organization_and_period", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("period", "monthly")
          .eq("periodStart", monthStart.getTime())
      )
      .first()

    const trackedUnits = monthlyAggregate?.totalTrackedUnits ?? 0

    return {
      period: "monthly",
      periodStart: monthStart.getTime(),
      requestCount: monthlyAggregate?.requestCount ?? 0,
      totalTokens: monthlyAggregate?.totalTokens ?? 0,
      totalPromptTokens: monthlyAggregate?.totalPromptTokens ?? 0,
      totalCompletionTokens: monthlyAggregate?.totalCompletionTokens ?? 0,
      trackedUnitsThisPeriod: trackedUnits,
      totalTrackedUnits: trackedUnits,
      currentPeriodStart: org.subscription.currentPeriodStart,
      currentPeriodEnd: org.subscription.currentPeriodEnd,
      plan: org.subscription.plan,
      note: "Tracked units are visibility metrics. Cozea-managed providers debit from the shared AI wallet.",
    }
  },
})
