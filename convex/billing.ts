/**
 * Billing Module
 *
 * Handles billing-related operations:
 * - Overage invoice generation
 * - Credit lot expiration
 * - Billing period resets
 */

import { internalMutation, mutation, query } from "./_generated/server"
import type { DatabaseWriter } from "./_generated/server"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { getPlanCredits, CREDIT_PACKS, type CreditPackType } from "./lib/modelTiers"

// Minimum overage threshold for invoice generation (500 cents = $5)
const OVERAGE_INVOICE_THRESHOLD_CENTS = 500
const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

/**
 * Get latest Stripe catalog
 */
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

/**
 * Upsert Stripe catalog (server-only)
 */
export const setStripeCatalog = mutation({
  args: {
    catalogVersion: v.string(),
    mode: v.union(v.literal("test"), v.literal("live")),
    subscriptionPrices: v.object({
      pro: v.object({ productId: v.string(), priceId: v.string() }),
      max: v.object({ productId: v.string(), priceId: v.string() }),
      team: v.object({ productId: v.string(), priceId: v.string() }),
    }),
    creditPackPrices: v.object({
      starter: v.object({ productId: v.string(), priceId: v.string() }),
      plus: v.object({ productId: v.string(), priceId: v.string() }),
      pro: v.object({ productId: v.string(), priceId: v.string() }),
      max: v.object({ productId: v.string(), priceId: v.string() }),
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
        creditPackPrices: args.creditPackPrices,
        updatedAt: now,
      })
      return { catalogId: existing._id, updated: true }
    }

    const catalogId = await ctx.db.insert("stripeCatalog", {
      catalogVersion: args.catalogVersion,
      mode: args.mode,
      subscriptionPrices: args.subscriptionPrices,
      creditPackPrices: args.creditPackPrices,
      createdAt: now,
      updatedAt: now,
    })

    return { catalogId, updated: false }
  },
})

/**
 * Check all organizations for overage thresholds and create invoices
 * Called by daily cron job
 */
export const checkOverageThresholds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()

    // Get all organizations with active subscriptions
    const organizations = await ctx.db
      .query("organizations")
      .filter((q) =>
        q.eq(q.field("subscription.status"), "active")
      )
      .collect()

    let invoicesCreated = 0

    for (const org of organizations) {
      const overageAmountCents = org.credits.overageAmountCents ?? 0

      // Skip if under threshold
      if (overageAmountCents < OVERAGE_INVOICE_THRESHOLD_CENTS) {
        continue
      }

      // Check if we already have a draft invoice for this period
      const existingInvoice = await ctx.db
        .query("invoices")
        .withIndex("by_organization_and_status", (q) =>
          q.eq("organizationId", org._id).eq("status", "draft")
        )
        .first()

      if (existingInvoice) {
        // Update existing draft invoice
        await ctx.db.patch(existingInvoice._id, {
          overageAmountCents,
          overageCreditsUsed: org.credits.overageCreditsUsed ?? 0,
          totalAmountCents: existingInvoice.subscriptionAmountCents + overageAmountCents + existingInvoice.creditPackAmountCents,
        })
      } else {
        // Create new draft invoice
        await ctx.db.insert("invoices", {
          organizationId: org._id,
          periodStart: org.credits.currentPeriodStart ?? Date.now(),
          periodEnd: org.credits.currentPeriodEnd ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
          subscriptionAmountCents: 0, // Subscription is billed separately via Stripe
          overageAmountCents,
          creditPackAmountCents: 0,
          totalAmountCents: overageAmountCents,
          overageCreditsUsed: org.credits.overageCreditsUsed ?? 0,
          status: "draft",
          createdAt: now,
        })
        invoicesCreated++
      }
    }

    return { checked: organizations.length, invoicesCreated }
  },
})

/**
 * Expire credit lots that have passed their expiration date
 * Called by daily cron job
 */
export const expireCreditLots = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()

    // Find all active credit lots that have expired
    const expiredLots = await ctx.db
      .query("creditLots")
      .withIndex("by_expiration")
      .filter((q) =>
        q.and(
          q.lt(q.field("expiresAt"), now),
          q.eq(q.field("status"), "active")
        )
      )
      .collect()

    let lotsExpired = 0
    let creditsLost = 0

    for (const lot of expiredLots) {
      creditsLost += lot.remainingCredits
      await ctx.db.patch(lot._id, {
        status: "expired",
      })
      lotsExpired++
    }

    return { lotsExpired, creditsLost }
  },
})

/**
 * Check all organizations for billing period resets
 * Called by daily cron job
 */
export const checkBillingPeriodResets = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()

    // Find organizations whose billing period has ended
    const organizations = await ctx.db
      .query("organizations")
      .filter((q) =>
        q.and(
          q.eq(q.field("subscription.status"), "active"),
          q.lt(q.field("credits.currentPeriodEnd"), now)
        )
      )
      .collect()

    let periodsReset = 0

    for (const org of organizations) {
      await resetBillingPeriodForOrg(ctx, org)
      periodsReset++
    }

    return { organizationsChecked: organizations.length, periodsReset }
  },
})

/**
 * Reset billing period for a single organization
 * Can be called directly or via the batch check
 */
async function resetBillingPeriodForOrg(
  ctx: { db: DatabaseWriter },
  org: Doc<"organizations">
) {
  const now = Date.now()

  // Calculate new period (monthly)
  const oldPeriodEnd = org.credits.currentPeriodEnd ?? now
  const newPeriodStart = oldPeriodEnd
  const newPeriodEnd = new Date(newPeriodStart as number)
  newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1)

  // Get subscription credits for the plan
  const plan = org.subscription.plan
  const seatCount = org.subscription.seatCount
  const subscriptionCredits = getPlanCredits(plan, seatCount)

  // Finalize any draft invoices from the old period
  const draftInvoice = await ctx.db
    .query("invoices")
    .withIndex("by_organization_and_status", (q) =>
      q.eq("organizationId", org._id).eq("status", "draft")
    )
    .first()

  if (draftInvoice && draftInvoice.totalAmountCents > 0) {
    // Mark invoice as open for collection
    await ctx.db.patch(draftInvoice._id, {
      status: "open",
      dueAt: now + 30 * 24 * 60 * 60 * 1000, // Due in 30 days
    })
  } else if (draftInvoice) {
    // No charges, void the draft
    await ctx.db.patch(draftInvoice._id, {
      status: "void",
    })
  }

  // Reset credits for new period
  await ctx.db.patch(org._id, {
    credits: {
      subscriptionCreditsRemaining: subscriptionCredits,
      subscriptionCreditsTotal: subscriptionCredits,
      overageCreditsUsed: 0,
      overageAmountCents: 0,
      currentPeriodStart: newPeriodStart,
      currentPeriodEnd: newPeriodEnd.getTime(),
    },
    subscription: {
      ...org.subscription,
      currentPeriodStart: newPeriodStart,
      currentPeriodEnd: newPeriodEnd.getTime(),
    },
    updatedAt: now,
  })

  return {
    newPeriodStart,
    newPeriodEnd: newPeriodEnd.getTime(),
    subscriptionCredits,
  }
}

/**
 * Manually reset billing period for a specific organization
 * Used for admin operations or testing
 */
export const resetBillingPeriod = internalMutation({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.organizationId)
    if (!org) {
      throw new Error("Organization not found")
    }

    return await resetBillingPeriodForOrg(ctx, org)
  },
})

/**
 * Purchase a credit pack
 * Creates a new credit lot after Stripe payment confirmation
 */
export const purchaseCreditPack = mutation({
  args: {
    organizationId: v.id("organizations"),
    packType: v.union(
      v.literal("starter"),
      v.literal("plus"),
      v.literal("pro"),
      v.literal("max")
    ),
    stripePaymentIntentId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    purchasedBy: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    const pack = CREDIT_PACKS[args.packType as CreditPackType]
    if (!pack) {
      throw new Error(`Invalid pack type: ${args.packType}`)
    }

    // Calculate expiration (12 months from now)
    const expiresAt = new Date(now)
    expiresAt.setMonth(expiresAt.getMonth() + pack.expirationMonths)

    // Create credit lot
    const lotId = await ctx.db.insert("creditLots", {
      organizationId: args.organizationId,
      packType: args.packType,
      originalCredits: pack.credits,
      remainingCredits: pack.credits,
      amountPaidCents: pack.priceCents,
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      purchasedAt: now,
      expiresAt: expiresAt.getTime(),
      status: "active",
      purchasedBy: args.purchasedBy,
    })

    return {
      lotId,
      credits: pack.credits,
      expiresAt: expiresAt.getTime(),
    }
  },
})

/**
 * Record credit pack purchase from Stripe webhook (internal)
 * Called internally after payment confirmation
 */
export const recordCreditPackPurchase = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    packType: v.union(
      v.literal("starter"),
      v.literal("plus"),
      v.literal("pro"),
      v.literal("max")
    ),
    stripePaymentIntentId: v.string(),
    stripeCheckoutSessionId: v.optional(v.string()),
    purchasedBy: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    return await recordCreditPackPurchaseHandler(ctx, args)
  },
})

/**
 * Record credit pack purchase - server-facing version
 * Called from the AI gateway server after Stripe webhook
 */
export const recordCreditPackPurchaseForServer = mutation({
  args: {
    organizationId: v.string(), // String ID from server
    packType: v.union(
      v.literal("starter"),
      v.literal("plus"),
      v.literal("pro"),
      v.literal("max")
    ),
    stripePaymentIntentId: v.string(),
    stripeCheckoutSessionId: v.optional(v.string()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    // Parse the organization ID
    const orgId = ctx.db.normalizeId("organizations", args.organizationId)
    if (!orgId) {
      throw new Error("Invalid organization ID")
    }

    return await recordCreditPackPurchaseHandler(ctx, {
      organizationId: orgId,
      packType: args.packType,
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
    })
  },
})

// Shared handler for credit pack purchases
async function recordCreditPackPurchaseHandler(
  ctx: { db: DatabaseWriter },
  args: {
    organizationId: Id<"organizations">
    packType: "starter" | "plus" | "pro" | "max"
    stripePaymentIntentId: string
    stripeCheckoutSessionId?: string
    purchasedBy?: Id<"users">
  }
) {
  const now = Date.now()

  // Check for duplicate (idempotency)
  const existing = await ctx.db
    .query("creditLots")
    .withIndex("by_stripe_payment", (q) =>
      q.eq("stripePaymentIntentId", args.stripePaymentIntentId)
    )
    .first()

  if (existing) {
    return { lotId: existing._id, alreadyProcessed: true }
  }

  const pack = CREDIT_PACKS[args.packType as CreditPackType]
  if (!pack) {
    throw new Error(`Invalid pack type: ${args.packType}`)
  }

  // Calculate expiration (12 months from now)
  const expiresAt = new Date(now)
  expiresAt.setMonth(expiresAt.getMonth() + pack.expirationMonths)

  // Create credit lot
  const lotId = await ctx.db.insert("creditLots", {
    organizationId: args.organizationId,
    packType: args.packType,
    originalCredits: pack.credits,
    remainingCredits: pack.credits,
    amountPaidCents: pack.priceCents,
    stripePaymentIntentId: args.stripePaymentIntentId,
    stripeCheckoutSessionId: args.stripeCheckoutSessionId,
    purchasedAt: now,
    expiresAt: expiresAt.getTime(),
    status: "active",
    purchasedBy: args.purchasedBy,
  })

  return { lotId, alreadyProcessed: false }
}

/**
 * Finalize overage invoice for a billing period
 * Called when Stripe subscription renews
 */
export const finalizeOverageInvoice = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    stripeInvoiceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    // Get the draft invoice for this org
    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_organization_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "draft")
      )
      .first()

    if (!invoice) {
      return { success: false, reason: "No draft invoice found" }
    }

    if (invoice.totalAmountCents === 0) {
      // No charges, void the invoice
      await ctx.db.patch(invoice._id, {
        status: "void",
      })
      return { success: true, voided: true }
    }

    // Finalize the invoice
    await ctx.db.patch(invoice._id, {
      status: "open",
      stripeInvoiceId: args.stripeInvoiceId,
      dueAt: now + 30 * 24 * 60 * 60 * 1000, // Due in 30 days
    })

    return { success: true, invoiceId: invoice._id, amountCents: invoice.totalAmountCents }
  },
})

/**
 * Mark invoice as paid
 * Called from Stripe webhook when payment succeeds
 */
export const markInvoicePaid = internalMutation({
  args: {
    stripeInvoiceId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_stripe_invoice", (q) =>
        q.eq("stripeInvoiceId", args.stripeInvoiceId)
      )
      .first()

    if (!invoice) {
      return { success: false, reason: "Invoice not found" }
    }

    await ctx.db.patch(invoice._id, {
      status: "paid",
      paidAt: now,
    })

    return { success: true, invoiceId: invoice._id }
  },
})

/**
 * Get invoices for an organization
 */
export const getInvoices = query({
  args: {
    organizationId: v.id("organizations"),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("open"),
        v.literal("paid"),
        v.literal("void"),
        v.literal("uncollectible")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("invoices")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId)
      )

    if (args.status) {
      query = ctx.db
        .query("invoices")
        .withIndex("by_organization_and_status", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", args.status!)
        )
    }

    return await query
      .order("desc")
      .take(args.limit ?? 50)
  },
})

/**
 * Get active credit lots for an organization
 */
export const getCreditLots = query({
  args: {
    organizationId: v.id("organizations"),
    includeExpired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.includeExpired) {
      return await ctx.db
        .query("creditLots")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId)
        )
        .order("desc")
        .collect()
    }

    return await ctx.db
      .query("creditLots")
      .withIndex("by_organization_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "active")
      )
      .collect()
  },
})

/**
 * Update organization subscription after Stripe webhook (internal)
 */
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

/**
 * Update organization subscription - server-facing version
 * Called from the AI gateway server after Stripe webhook
 */
export const updateSubscriptionForServer = mutation({
  args: {
    organizationId: v.string(), // String ID from server
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

    // Parse the organization ID
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

// Shared handler for subscription updates
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

  // Calculate new credit allocation
  const subscriptionCredits = getPlanCredits(args.plan, args.seatCount)

  // Determine byokPolicy based on plan
  // Paid plans get "optional" (can use server credits or BYOK)
  // Free plan gets "required" (must use BYOK since no server credits)
  const byokPolicy = args.plan === "free" ? "required" : "optional"

  // Update subscription and aiSettings
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
    credits: {
      ...org.credits,
      subscriptionCreditsTotal: subscriptionCredits,
      // Only reset remaining if upgrading or at period start
      subscriptionCreditsRemaining:
        args.currentPeriodStart !== org.subscription.currentPeriodStart
          ? subscriptionCredits
          : org.credits.subscriptionCreditsRemaining,
    },
    aiSettings: {
      ...org.aiSettings,
      // Ensure allowedProviders is never undefined
      allowedProviders: org.aiSettings?.allowedProviders ?? ["anthropic", "openai", "google"],
      byokPolicy,
    },
    updatedAt: now,
  })

  return { success: true, plan: args.plan, credits: subscriptionCredits }
}
