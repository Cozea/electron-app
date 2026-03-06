import { mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import {
  calculateCredits,
  calculateSpendCents,
  getModelTier,
} from "./lib/modelTiers"
import {
  getTrailingUtcDayRange,
  getUtcDayStartTimestamp,
  getUtcMonthStartTimestamp,
} from "./lib/usagePeriods"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET
type UsageReadCtx = Pick<QueryCtx, "db">
type UsageRecord = Doc<"aiUsage">

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
    cacheWriteTokens: v.optional(v.number()),
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

function normalizeReportedSpendCents(
  spendCents: number | undefined,
  fallbackArgs: {
    model: string
    promptTokens: number
    completionTokens: number
    cachedInputTokens?: number
  }
): number {
  if (typeof spendCents === "number" && Number.isFinite(spendCents)) {
    return Math.max(0, Math.ceil(spendCents))
  }

  return calculateSpendCents(
    fallbackArgs.model,
    fallbackArgs.promptTokens,
    fallbackArgs.completionTokens,
    fallbackArgs.cachedInputTokens ?? 0
  )
}

async function attachDebitAmounts(ctx: UsageReadCtx, records: UsageRecord[]) {
  return await Promise.all(
    records.map(async (record) => {
      if (record.keySource !== "organization" || !record.requestId) {
        return {
          ...record,
          trackedUnits: record.trackedUnits,
          debitCents: undefined,
        }
      }

      const ledger = await ctx.db
        .query("aiWalletLedger")
        .withIndex("by_request", (q) => q.eq("requestId", record.requestId!))
        .collect()

      const debitCents = ledger.reduce((sum, entry) => {
        if (
          entry.kind !== "debit" ||
          String(entry.organizationId) !== String(record.organizationId)
        ) {
          return sum
        }
        return sum + entry.amountCents
      }, 0)

      return {
        ...record,
        trackedUnits: record.trackedUnits,
        debitCents: debitCents > 0 ? debitCents : undefined,
      }
    })
  )
}

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
    spendCents: v.optional(v.number()),
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
        const spendCents = normalizeReportedSpendCents(args.spendCents, {
          model: existing.model,
          promptTokens: existing.promptTokens,
          completionTokens: existing.completionTokens,
          cachedInputTokens: existing.extendedUsage?.cachedInputTokens ?? 0,
        })
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
    const spendCents = normalizeReportedSpendCents(args.spendCents, {
      model: args.model,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      cachedInputTokens,
    })

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

    await updateAggregate(
      ctx,
      args,
      "daily",
      getUtcDayStartTimestamp(now),
      trackedUnits
    )

    await updateAggregate(
      ctx,
      args,
      "monthly",
      getUtcMonthStartTimestamp(now),
      trackedUnits
    )

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

    return await attachDebitAmounts(ctx, records)
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

    return await attachDebitAmounts(ctx, records)
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
    const defaultRange = getTrailingUtcDayRange(30, now)

    const aggregates = await ctx.db
      .query("aiUsageAggregates")
      .withIndex("by_organization_and_period", (q) =>
        q.eq("organizationId", args.organizationId).eq("period", args.period)
      )
      .filter((q) =>
        q.and(
          q.gte(q.field("periodStart"), args.startDate ?? defaultRange.startDate),
          q.lte(q.field("periodStart"), args.endDate ?? defaultRange.endDate)
        )
      )
      .collect()

    return aggregates.map((aggregate) => ({
      ...aggregate,
      totalTrackedUnits: aggregate.totalTrackedUnits,
    }))
  },
})

export const getDailyHistory = query({
  args: {
    organizationId: v.id("organizations"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const defaultRange = getTrailingUtcDayRange(30, now)
    const startDate = args.startDate ?? defaultRange.startDate
    const endDate = args.endDate ?? defaultRange.endDate

    const [aggregates, ledgerEntries] = await Promise.all([
      ctx.db
        .query("aiUsageAggregates")
        .withIndex("by_organization_and_period", (q) =>
          q.eq("organizationId", args.organizationId).eq("period", "daily")
        )
        .filter((q) =>
          q.and(
            q.gte(q.field("periodStart"), startDate),
            q.lte(q.field("periodStart"), endDate)
          )
        )
        .collect(),
      ctx.db
        .query("aiWalletLedger")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
        .filter((q) =>
          q.and(
            q.eq(q.field("kind"), "debit"),
            q.gte(q.field("createdAt"), startDate),
            q.lte(q.field("createdAt"), endDate)
          )
        )
        .collect(),
    ])

    const rows = new Map<number, {
      periodStart: number
      requestCount: number
      totalPromptTokens: number
      totalCompletionTokens: number
      totalTokens: number
      totalTrackedUnits: number
      debitCents: number
    }>()

    for (const aggregate of aggregates) {
      rows.set(aggregate.periodStart, {
        periodStart: aggregate.periodStart,
        requestCount: aggregate.requestCount,
        totalPromptTokens: aggregate.totalPromptTokens,
        totalCompletionTokens: aggregate.totalCompletionTokens,
        totalTokens: aggregate.totalTokens,
        totalTrackedUnits: aggregate.totalTrackedUnits,
        debitCents: 0,
      })
    }

    for (const entry of ledgerEntries) {
      const dayStart = getUtcDayStartTimestamp(entry.createdAt)
      const existing = rows.get(dayStart)
      if (existing) {
        existing.debitCents += entry.amountCents
        continue
      }

      rows.set(dayStart, {
        periodStart: dayStart,
        requestCount: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalTrackedUnits: 0,
        debitCents: entry.amountCents,
      })
    }

    return Array.from(rows.values()).sort((a, b) => b.periodStart - a.periodStart)
  },
})

export const getDetailedHistory = query({
  args: {
    organizationId: v.id("organizations"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const defaultRange = getTrailingUtcDayRange(30, now)
    const startDate = args.startDate ?? defaultRange.startDate
    const endDate = args.endDate ?? defaultRange.endDate

    const records = await ctx.db
      .query("aiUsage")
      .withIndex("by_organization_and_timestamp", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .gte("timestamp", startDate)
          .lte("timestamp", endDate)
      )
      .order("desc")
      .collect()

    return await attachDebitAmounts(ctx, records)
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

    const monthStart = getUtcMonthStartTimestamp(Date.now())

    const monthlyAggregate = await ctx.db
      .query("aiUsageAggregates")
      .withIndex("by_organization_and_period", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("period", "monthly")
          .eq("periodStart", monthStart)
      )
      .first()

    const trackedUnits = monthlyAggregate?.totalTrackedUnits ?? 0

    return {
      period: "monthly",
      periodStart: monthStart,
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
