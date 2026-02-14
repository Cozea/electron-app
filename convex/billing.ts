import { internalMutation, mutation, query } from "./_generated/server"
import type { DatabaseWriter } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

export const getStripeCatalog = query({
  args: {},
  handler: async (ctx) => {
    const latest = await ctx.db
      .query("stripeCatalog")
      .withIndex("by_updated_at")
      .order("desc")
      .first()
    return latest || null
  },
})

export const setStripeCatalog = mutation({
  args: {
    catalogVersion: v.string(),
    mode: v.union(v.literal("test"), v.literal("live")),
    subscriptionPrices: v.object({
      pro: v.object({ productId: v.string(), priceId: v.string() }),
      max: v.object({ productId: v.string(), priceId: v.string() }),
      team: v.optional(v.object({ productId: v.string(), priceId: v.string() })),
    }),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const now = Date.now()
    const existing = await ctx.db
      .query("stripeCatalog")
      .withIndex("by_version", (q) => q.eq("catalogVersion", args.catalogVersion))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        catalogVersion: args.catalogVersion,
        mode: args.mode,
        subscriptionPrices: args.subscriptionPrices,
        updatedAt: now,
      })
      return { catalogId: existing._id, updated: true }
    }

    const catalogId = await ctx.db.insert("stripeCatalog", {
      catalogVersion: args.catalogVersion,
      mode: args.mode,
      subscriptionPrices: args.subscriptionPrices,
      createdAt: now,
      updatedAt: now,
    })

    return { catalogId, updated: false }
  },
})

export const updateSubscription = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    plan: v.union(
      v.literal("free"),
      v.literal("pro"),
      v.literal("max"),
      v.literal("team"),
      v.literal("enterprise")
    ),
    status: v.union(
      v.literal("active"),
      v.literal("canceled"),
      v.literal("past_due"),
      v.literal("trialing")
    ),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    seatCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await updateSubscriptionHandler(ctx, args)
  },
})

export const updateSubscriptionForServer = mutation({
  args: {
    organizationId: v.string(),
    plan: v.union(
      v.literal("free"),
      v.literal("pro"),
      v.literal("max"),
      v.literal("team"),
      v.literal("enterprise")
    ),
    status: v.union(
      v.literal("active"),
      v.literal("canceled"),
      v.literal("past_due"),
      v.literal("trialing")
    ),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    seatCount: v.optional(v.number()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const orgId = ctx.db.normalizeId("organizations", args.organizationId)
    if (!orgId) {
      throw new Error("Invalid organization ID")
    }

    return await updateSubscriptionHandler(ctx, {
      organizationId: orgId,
      plan: args.plan,
      status: args.status,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      seatCount: args.seatCount,
    })
  },
})

async function updateSubscriptionHandler(
  ctx: { db: DatabaseWriter },
  args: {
    organizationId: Id<"organizations">
    plan: "free" | "pro" | "max" | "team" | "enterprise"
    status: "active" | "canceled" | "past_due" | "trialing"
    stripeCustomerId?: string
    stripeSubscriptionId?: string
    currentPeriodStart?: number
    currentPeriodEnd?: number
    seatCount?: number
  }
) {
  const now = Date.now()

  const org = await ctx.db.get(args.organizationId)
  if (!org) {
    throw new Error("Organization not found")
  }

  await ctx.db.patch(args.organizationId, {
    subscription: {
      ...org.subscription,
      plan: args.plan,
      status: args.status,
      stripeCustomerId: args.stripeCustomerId ?? org.subscription.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId ?? org.subscription.stripeSubscriptionId,
      currentPeriodStart: args.currentPeriodStart ?? org.subscription.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd ?? org.subscription.currentPeriodEnd,
      seatCount: args.seatCount ?? org.subscription.seatCount,
    },
    aiSettings: {
      ...org.aiSettings,
      allowedProviders: org.aiSettings?.allowedProviders ?? [
        "anthropic",
        "openai",
        "google",
        "xai",
      ],
    },
    updatedAt: now,
  })

  return { success: true, plan: args.plan }
}
