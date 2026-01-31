import { mutation, query } from "./_generated/server"
import type { DatabaseReader, DatabaseWriter } from "./_generated/server"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import {
  calculateCredits,
  getModelTier,
  getOverageRate,
  planAllowsOverage,
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

// Provider union type
const providerValidator = v.union(
  v.literal("anthropic"),
  v.literal("openai"),
  v.literal("google")
)

// Extended usage from AI SDK v6
const extendedUsageValidator = v.optional(
  v.object({
    reasoningTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    toolCallTokens: v.optional(v.number()),
  })
)

// Tool calls tracking
const toolCallsValidator = v.optional(
  v.object({
    count: v.number(),
    names: v.array(v.string()),
    approvalCount: v.optional(v.number()),
  })
)

/**
 * Credit source breakdown - tracks where credits were deducted from
 */
interface CreditSourceBreakdown {
  fromSubscription: number
  fromPurchased: number
  fromOverage: number
}

/**
 * Result of credit deduction
 */
interface DeductionResult {
  success: boolean
  creditsCharged: number
  breakdown: CreditSourceBreakdown
  error?: string
}

/**
 * Deduct credits from organization following the spend order:
 * 1. Subscription credits first
 * 2. Purchased credit lots (FIFO by purchase date)
 * 3. Overage (if enabled and under spending cap)
 */
async function deductCredits(
  ctx: { db: DatabaseWriter },
  organizationId: Id<"organizations">,
  creditsNeeded: number
): Promise<DeductionResult> {
  const org = await ctx.db.get(organizationId) as Doc<"organizations"> | null
  if (!org) {
    return {
      success: false,
      creditsCharged: 0,
      breakdown: { fromSubscription: 0, fromPurchased: 0, fromOverage: 0 },
      error: "Organization not found",
    }
  }

  let remaining = creditsNeeded
  const breakdown: CreditSourceBreakdown = {
    fromSubscription: 0,
    fromPurchased: 0,
    fromOverage: 0,
  }

  // 1. First, use subscription credits
  const subscriptionRemaining = org.credits.subscriptionCreditsRemaining ?? 0
  if (subscriptionRemaining > 0 && remaining > 0) {
    const fromSubscription = Math.min(remaining, subscriptionRemaining)
    remaining -= fromSubscription
    breakdown.fromSubscription = fromSubscription

    await ctx.db.patch(organizationId, {
      credits: {
        ...org.credits,
        subscriptionCreditsRemaining: subscriptionRemaining - fromSubscription,
      },
    })
  }

  if (remaining <= 0) {
    return { success: true, creditsCharged: creditsNeeded, breakdown }
  }

  // 2. Then, use purchased credit lots (oldest first, by purchase date - FIFO)
  const activeLots = await ctx.db
    .query("creditLots")
    .withIndex("by_organization_and_status", (q) =>
      q.eq("organizationId", organizationId).eq("status", "active")
    )
    .collect()

  // Sort by purchase date (FIFO - oldest first)
  activeLots.sort((a, b) => a.purchasedAt - b.purchasedAt)

  for (const lot of activeLots) {
    if (remaining <= 0) break

    const fromLot = Math.min(remaining, lot.remainingCredits)
    remaining -= fromLot
    breakdown.fromPurchased += fromLot

    const newRemaining = lot.remainingCredits - fromLot
    await ctx.db.patch(lot._id, {
      remainingCredits: newRemaining,
      status: newRemaining <= 0 ? "exhausted" : "active",
    })
  }

  if (remaining <= 0) {
    return { success: true, creditsCharged: creditsNeeded, breakdown }
  }

  // 3. Finally, track overage (only for paid plans with overage enabled)
  const plan = org.subscription.plan
  if (!planAllowsOverage(plan)) {
    return {
      success: false,
      creditsCharged: creditsNeeded - remaining,
      breakdown,
      error: `Insufficient credits. ${plan === "free" ? "Free plan does not include credits." : "Plan does not support overage."}`,
    }
  }

  // Check if overage is enabled for this org
  const overageEnabled = org.aiSettings?.overageEnabled !== false // Default to true for paid plans

  if (!overageEnabled) {
    return {
      success: false,
      creditsCharged: creditsNeeded - remaining,
      breakdown,
      error: "Overage is disabled for this workspace.",
    }
  }

  // Check spending cap
  const spendingCapCents = org.aiSettings?.monthlySpendingCapCents
  const overageRate = getOverageRate(plan)
  const currentOverageCents = org.credits.overageAmountCents ?? 0
  const projectedOverageCents = currentOverageCents + remaining * overageRate

  if (spendingCapCents !== undefined && projectedOverageCents > spendingCapCents) {
    return {
      success: false,
      creditsCharged: creditsNeeded - remaining,
      breakdown,
      error: `Would exceed spending cap. Current: $${(currentOverageCents / 100).toFixed(2)}, Cap: $${(spendingCapCents / 100).toFixed(2)}`,
    }
  }

  // Apply overage
  breakdown.fromOverage = remaining
  const overageCredits = (org.credits.overageCreditsUsed ?? 0) + remaining
  const overageCents = currentOverageCents + Math.ceil(remaining * overageRate)

  // Refresh org to get latest state
  const freshOrg = await ctx.db.get(organizationId) as Doc<"organizations">

  await ctx.db.patch(organizationId, {
    credits: {
      ...freshOrg.credits,
      overageCreditsUsed: overageCredits,
      overageAmountCents: overageCents,
    },
  })

  return { success: true, creditsCharged: creditsNeeded, breakdown }
}

/**
 * Log AI usage from AI SDK response with idempotency
 */
export const log = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    model: v.string(),
    provider: providerValidator,
    promptTokens: v.number(),
    completionTokens: v.number(),
    totalTokens: v.number(),
    keySource: v.union(v.literal("organization"), v.literal("byok")),
    // New fields
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

    // Idempotency check - if requestId exists, check for duplicate
    if (args.requestId) {
      const existing = await ctx.db
        .query("aiUsage")
        .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
        .first()

      if (existing) {
        // Already processed this request, return existing credits
        return {
          creditsUsed: existing.creditsUsed,
          alreadyProcessed: true,
        }
      }
    }

    // Calculate credits using model tier pricing
    const creditsUsed = calculateCredits(
      args.model,
      args.promptTokens,
      args.completionTokens
    )
    const modelTier = getModelTier(args.model)

    // Prepare the base usage record
    const usageRecord = {
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
      creditsUsed,
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
      creditSourceBreakdown: undefined as CreditSourceBreakdown | undefined,
    }

    // Only deduct credits if using organization keys
    if (args.keySource === "organization") {
      const deductionResult = await deductCredits(
        ctx,
        args.organizationId,
        creditsUsed
      )

      usageRecord.creditSourceBreakdown = deductionResult.breakdown

      if (!deductionResult.success) {
        // Still log the usage attempt but mark it
        usageRecord.creditsUsed = deductionResult.creditsCharged
        await ctx.db.insert("aiUsage", usageRecord)

        return {
          creditsUsed: deductionResult.creditsCharged,
          error: deductionResult.error,
          breakdown: deductionResult.breakdown,
        }
      }
    }

    // Insert usage record
    await ctx.db.insert("aiUsage", usageRecord)

    // Update daily aggregate
    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    await updateAggregate(ctx, args, "daily", dayStart.getTime(), creditsUsed)

    // Update monthly aggregate
    const monthStart = new Date(now)
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    await updateAggregate(ctx, args, "monthly", monthStart.getTime(), creditsUsed)

    return {
      creditsUsed,
      modelTier,
    }
  },
})

/**
 * Helper to update usage aggregates
 */
async function updateAggregate(
  ctx: { db: DatabaseWriter },
  args: {
    organizationId: Id<"organizations">
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    userId: Id<"users">
  },
  period: "daily" | "monthly",
  periodStart: number,
  creditsUsed: number
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
    // Update existing aggregate
    const byModel = (existing.byModel || {}) as Record<string, number>
    byModel[args.model] = (byModel[args.model] || 0) + args.totalTokens

    const byUser = (existing.byUser || {}) as Record<string, number>
    const userIdStr = String(args.userId)
    byUser[userIdStr] = (byUser[userIdStr] || 0) + args.totalTokens

    await ctx.db.patch(existing._id, {
      totalPromptTokens: existing.totalPromptTokens + args.promptTokens,
      totalCompletionTokens: existing.totalCompletionTokens + args.completionTokens,
      totalTokens: existing.totalTokens + args.totalTokens,
      totalCreditsUsed: existing.totalCreditsUsed + creditsUsed,
      requestCount: existing.requestCount + 1,
      byModel,
      byUser,
      updatedAt: now,
    })
  } else {
    // Create new aggregate
    await ctx.db.insert("aiUsageAggregates", {
      organizationId: args.organizationId,
      period,
      periodStart,
      totalPromptTokens: args.promptTokens,
      totalCompletionTokens: args.completionTokens,
      totalTokens: args.totalTokens,
      totalCreditsUsed: creditsUsed,
      requestCount: 1,
      byModel: { [args.model]: args.totalTokens },
      byUser: { [String(args.userId)]: args.totalTokens },
      updatedAt: now,
    })
  }
}

/**
 * Internal function to check credits (can be called from other handlers)
 */
async function checkCreditsInternal(
  ctx: { db: DatabaseReader },
  args: { organizationId: Id<"organizations">; estimatedCredits: number }
) {
  const org = await ctx.db.get(args.organizationId)
  if (!org) {
    return {
      hasCredits: false,
      reason: "Organization not found",
      source: null,
      details: null,
    }
  }

  // Calculate total available from subscription
  const subscriptionRemaining = org.credits.subscriptionCreditsRemaining ?? 0

  // Sum active credit lots
  const activeLots = await ctx.db
    .query("creditLots")
    .withIndex("by_organization_and_status", (q) =>
      q.eq("organizationId", args.organizationId).eq("status", "active")
    )
    .collect()

  const purchasedRemaining = activeLots.reduce(
    (sum, lot) => sum + lot.remainingCredits,
    0
  )

  const totalAvailable = subscriptionRemaining + purchasedRemaining

  // Check if overage is allowed
  const plan = org.subscription.plan
  const canOverage = planAllowsOverage(plan)
  const overageEnabled = org.aiSettings?.overageEnabled !== false

  // Check spending cap
  const spendingCapCents = org.aiSettings?.monthlySpendingCapCents
  const currentOverageCents = org.credits.overageAmountCents ?? 0
  const overageRate = getOverageRate(plan)
  const projectedOverageCents =
    currentOverageCents +
    Math.max(0, args.estimatedCredits - totalAvailable) * overageRate

  const details = {
    subscriptionCreditsRemaining: subscriptionRemaining,
    subscriptionCreditsTotal: org.credits.subscriptionCreditsTotal ?? 0,
    purchasedCreditsRemaining: purchasedRemaining,
    totalAvailable,
    currentOverageCents,
    plan,
    overageEnabled: canOverage && overageEnabled,
    spendingCapCents,
  }

  // Sufficient credits available
  if (args.estimatedCredits <= totalAvailable) {
    return {
      hasCredits: true,
      source: subscriptionRemaining >= args.estimatedCredits ? "subscription" : "mixed",
      reason: null,
      details,
    }
  }

  // Need overage
  if (canOverage && overageEnabled) {
    // Check spending cap
    if (spendingCapCents !== undefined && projectedOverageCents > spendingCapCents) {
      return {
        hasCredits: false,
        source: null,
        reason: `Would exceed spending cap of $${(spendingCapCents / 100).toFixed(2)}`,
        details,
      }
    }

    return {
      hasCredits: true,
      source: "overage",
      reason: null,
      details,
    }
  }

  // No credits available
  const reason =
    plan === "free"
      ? "Free plan requires BYOK (Bring Your Own Key)"
      : !overageEnabled
        ? "Overage is disabled. Purchase a credit pack or enable overage."
        : "Insufficient credits"

  return {
    hasCredits: false,
    source: null,
    reason,
    details,
  }
}

/**
 * Check if organization has sufficient credits for a request
 * Returns detailed information about credit availability
 */
export const checkCredits = query({
  args: {
    organizationId: v.id("organizations"),
    estimatedCredits: v.number(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    return checkCreditsInternal(ctx, { organizationId: args.organizationId, estimatedCredits: args.estimatedCredits })
  },
})

/**
 * Legacy hasCredits query (for backward compatibility)
 */
export const hasCredits = query({
  args: {
    organizationId: v.id("organizations"),
    estimatedCredits: v.number(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const result = await checkCreditsInternal(ctx, { organizationId: args.organizationId, estimatedCredits: args.estimatedCredits })
    return result.hasCredits
  },
})

/**
 * Get recent usage for a user
 */
export const getRecentForUser = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiUsage")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit || 50)
  },
})

/**
 * Get recent usage for an organization
 */
export const getRecentForOrganization = query({
  args: {
    organizationId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiUsage")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .order("desc")
      .take(args.limit || 100)
  },
})

/**
 * Get usage aggregates with date range filtering
 */
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

    return await ctx.db
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
  },
})

/**
 * Get credit balance summary for an organization
 */
export const getCreditSummary = query({
  args: {
    organizationId: v.id("organizations"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const org = await ctx.db.get(args.organizationId) as Doc<"organizations"> | null
    if (!org) {
      return null
    }

    // Get active credit lots
    const activeLots = await ctx.db
      .query("creditLots")
      .withIndex("by_organization_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "active")
      )
      .collect()

    const purchasedCreditsRemaining = activeLots.reduce(
      (sum, lot) => sum + lot.remainingCredits,
      0
    )

    const subscriptionCreditsRemaining = org.credits.subscriptionCreditsRemaining ?? 0
    const subscriptionCreditsTotal = org.credits.subscriptionCreditsTotal ?? 0

    return {
      // Subscription credits
      subscriptionCreditsRemaining,
      subscriptionCreditsTotal,
      subscriptionCreditsUsed: subscriptionCreditsTotal - subscriptionCreditsRemaining,

      // Purchased credits
      purchasedCreditsRemaining,
      purchasedCreditLots: activeLots.map((lot) => ({
        id: lot._id,
        packType: lot.packType,
        remaining: lot.remainingCredits,
        original: lot.originalCredits,
        expiresAt: lot.expiresAt,
      })),

      // Overage
      overageCreditsUsed: org.credits.overageCreditsUsed ?? 0,
      overageAmountCents: org.credits.overageAmountCents ?? 0,

      // Totals
      totalCreditsRemaining: subscriptionCreditsRemaining + purchasedCreditsRemaining,

      // Period info
      currentPeriodStart: org.credits.currentPeriodStart,
      currentPeriodEnd: org.credits.currentPeriodEnd,

      // Plan info
      plan: org.subscription.plan,
      overageEnabled: org.aiSettings?.overageEnabled !== false,
      spendingCapCents: org.aiSettings?.monthlySpendingCapCents,
    }
  },
})
