import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

// Credit costs per 1000 tokens (adjust based on pricing)
const CREDIT_COSTS: Record<string, { prompt: number; completion: number }> = {
  "claude-opus-4-20250514": { prompt: 0.15, completion: 0.75 },
  "claude-sonnet-4-20250514": { prompt: 0.03, completion: 0.15 },
  "claude-3-5-haiku-20241022": { prompt: 0.01, completion: 0.05 },
  "gpt-4o": { prompt: 0.025, completion: 0.1 },
  "gpt-4o-mini": { prompt: 0.0015, completion: 0.006 },
}

function calculateCredits(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const costs = CREDIT_COSTS[model] || { prompt: 0.03, completion: 0.15 }
  return (
    (promptTokens / 1000) * costs.prompt +
    (completionTokens / 1000) * costs.completion
  )
}

// Log AI usage from AI SDK response
export const log = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    model: v.string(),
    provider: v.union(v.literal("anthropic"), v.literal("openai")),
    promptTokens: v.number(),
    completionTokens: v.number(),
    totalTokens: v.number(),
    keySource: v.union(v.literal("organization"), v.literal("byok")),
    feature: v.optional(v.string()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const creditsUsed = calculateCredits(
      args.model,
      args.promptTokens,
      args.completionTokens
    )
    const now = Date.now()

    // Insert usage record
    await ctx.db.insert("aiUsage", {
      organizationId: args.organizationId,
      userId: args.userId,
      model: args.model,
      provider: args.provider,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      totalTokens: args.totalTokens,
      creditsUsed,
      keySource: args.keySource,
      feature: args.feature,
      projectId: args.projectId,
      timestamp: now,
    })

    // Deduct credits from organization balance (only for org keys)
    if (args.keySource === "organization") {
      const org = await ctx.db.get(args.organizationId)
      if (org) {
        await ctx.db.patch(args.organizationId, {
          credits: {
            ...org.credits,
            balance: Math.max(0, org.credits.balance - creditsUsed),
          },
        })
      }
    }

    // Update daily aggregate
    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    await updateAggregate(ctx, args, "daily", dayStart.getTime(), creditsUsed)

    // Update monthly aggregate
    const monthStart = new Date(now)
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    await updateAggregate(ctx, args, "monthly", monthStart.getTime(), creditsUsed)

    return { creditsUsed }
  },
})

// Helper to update aggregates
async function updateAggregate(
  ctx: { db: { query: Function; patch: Function; insert: Function } },
  args: {
    organizationId: any
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    userId: any
  },
  period: "daily" | "monthly",
  periodStart: number,
  creditsUsed: number
) {
  const existing = await ctx.db
    .query("aiUsageAggregates")
    .withIndex("by_organization_and_period", (q: any) =>
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

// Get recent usage for a user
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

// Get recent usage for an organization
export const getRecentForOrganization = query({
  args: {
    organizationId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiUsage")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .take(args.limit || 100)
  },
})

// Get usage aggregates
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

// Check if organization has sufficient credits
export const hasCredits = query({
  args: {
    organizationId: v.id("organizations"),
    estimatedCredits: v.number(),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.organizationId)
    if (!org) return false

    return org.credits.balance >= args.estimatedCredits
  },
})
