import { internalMutation, mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import { v } from "convex/values"

import {
  resolveAccountEntitlementForOrganization,
  type AccountBillingCycle,
  type AccountSubscriptionPlan,
} from "./lib/accountEntitlements"
import { isSeatManagedWalletPlan, resolveIncludedWalletCents } from "./lib/walletPolicy"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET
const WALLET_CURRENCY = "USD"

type WalletReadCtx = Pick<QueryCtx | MutationCtx, "db">
type WalletDoc = Doc<"aiWallets">

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

function toOrgUserScopeKey(
  organizationId: Id<"organizations">,
  ownerUserId: Id<"users">
): string {
  return `org:${String(organizationId)}:user:${String(ownerUserId)}`
}

function normalizeCurrency(): string {
  return WALLET_CURRENCY
}

function getAvailableCents(wallet: WalletDoc): number {
  return Math.max(0, wallet.balanceCents - wallet.heldCents)
}

function normalizeGrantMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined
  }
  return metadata as Record<string, unknown>
}

async function getWalletByScopeKey(
  ctx: WalletReadCtx,
  scopeKey: string
): Promise<WalletDoc | null> {
  return await ctx.db
    .query("aiWallets")
    .withIndex("by_scope_key", (q) => q.eq("scopeKey", scopeKey))
    .first()
}

async function getOrCreateWalletForUserInOrganization(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">
    ownerUserId: Id<"users">
  }
): Promise<WalletDoc> {
  const scopeKey = toOrgUserScopeKey(args.organizationId, args.ownerUserId)
  const existing = await getWalletByScopeKey(ctx, scopeKey)
  if (existing) {
    if (existing.currency !== WALLET_CURRENCY) {
      const now = Date.now()
      await ctx.db.patch(existing._id, {
        currency: WALLET_CURRENCY,
        updatedAt: now,
      })
      return {
        ...existing,
        currency: WALLET_CURRENCY,
        updatedAt: now,
      }
    }
    return existing
  }

  const now = Date.now()
  const walletId = await ctx.db.insert("aiWallets", {
    scopeType: "user",
    scopeKey,
    ownerUserId: args.ownerUserId,
    organizationId: args.organizationId,
    currency: normalizeCurrency(),
    balanceCents: 0,
    heldCents: 0,
    totalDebitedCents: 0,
    totalCreditedCents: 0,
    createdAt: now,
    updatedAt: now,
  })

  const wallet = await ctx.db.get(walletId)
  if (!wallet) {
    throw new Error("Failed to create wallet")
  }
  return wallet
}

function resolveWalletOwnerUserId(args: {
  userId: Id<"users">
  entitlement: Awaited<ReturnType<typeof resolveAccountEntitlementForOrganization>>
}): Id<"users"> {
  const { entitlement, userId } = args
  if (entitlement.source === "trial") {
    return userId
  }
  if (isSeatManagedWalletPlan(entitlement.plan)) {
    return userId
  }
  return (entitlement.billingUserId as Id<"users"> | null) ?? userId
}

export async function grantIncludedWalletBalance(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">
    targetUserId: Id<"users">
    billingUserId?: Id<"users">
    actorUserId?: Id<"users">
    plan: AccountSubscriptionPlan
    cycle?: AccountBillingCycle
    periodStart?: number
    periodEnd?: number
    source: "subscription_cycle" | "seat_assignment" | "manual"
    grantKey: string
    metadata?: unknown
  }
): Promise<{
  ok: boolean
  alreadyProcessed: boolean
  walletId: Id<"aiWallets">
  grantId: Id<"aiWalletPeriodGrants">
  includedCents: number
  appliedDeltaCents: number
  balanceCents: number
  heldCents: number
  availableCents: number
}> {
  const now = Date.now()
  const existingGrant = await ctx.db
    .query("aiWalletPeriodGrants")
    .withIndex("by_grant_key", (q) => q.eq("grantKey", args.grantKey))
    .first()

  if (existingGrant) {
    const existingWallet = await ctx.db.get(existingGrant.walletId)
    if (!existingWallet) {
      throw new Error("Wallet period grant references missing wallet")
    }
    return {
      ok: true,
      alreadyProcessed: true,
      walletId: existingWallet._id,
      grantId: existingGrant._id,
      includedCents: existingGrant.includedCents,
      appliedDeltaCents: existingGrant.appliedDeltaCents,
      balanceCents: existingWallet.balanceCents,
      heldCents: existingWallet.heldCents,
      availableCents: getAvailableCents(existingWallet),
    }
  }

  const wallet = await getOrCreateWalletForUserInOrganization(ctx, {
    organizationId: args.organizationId,
    ownerUserId: args.targetUserId,
  })

  const includedCents = resolveIncludedWalletCents({
    plan: args.plan,
    cycle: args.cycle,
  })

  // Reset policy: every funding event restores available funds to the included amount.
  // Keep in-flight holds intact so active requests can still settle safely.
  const nextBalanceCents = includedCents + wallet.heldCents
  const appliedDeltaCents = nextBalanceCents - wallet.balanceCents
  const normalizedCurrency = normalizeCurrency()

  await ctx.db.patch(wallet._id, {
    balanceCents: nextBalanceCents,
    currency: normalizedCurrency,
    totalCreditedCents:
      wallet.totalCreditedCents + (appliedDeltaCents > 0 ? appliedDeltaCents : 0),
    updatedAt: now,
  })

  if (appliedDeltaCents !== 0) {
    await ctx.db.insert("aiWalletLedger", {
      walletId: wallet._id,
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      payerUserId: args.billingUserId ?? args.targetUserId,
      kind: appliedDeltaCents > 0 ? "credit" : "adjustment",
      amountCents: Math.abs(appliedDeltaCents),
      balanceAfterCents: nextBalanceCents,
      availableAfterCents: includedCents,
      metadata: {
        reason: "included_wallet_reset",
        source: args.source,
        grantKey: args.grantKey,
        direction: appliedDeltaCents > 0 ? "increase" : "decrease",
        plan: args.plan,
        cycle: args.cycle,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
        ...(normalizeGrantMetadata(args.metadata) ?? {}),
      },
      createdAt: now,
    })
  }

  const grantId = await ctx.db.insert("aiWalletPeriodGrants", {
    grantKey: args.grantKey,
    walletId: wallet._id,
    organizationId: args.organizationId,
    targetUserId: args.targetUserId,
    billingUserId: args.billingUserId,
    actorUserId: args.actorUserId,
    plan: args.plan,
    cycle: args.cycle,
    source: args.source,
    includedCents,
    appliedDeltaCents,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    metadata: normalizeGrantMetadata(args.metadata),
    createdAt: now,
    updatedAt: now,
  })

  return {
    ok: true,
    alreadyProcessed: false,
    walletId: wallet._id,
    grantId,
    includedCents,
    appliedDeltaCents,
    balanceCents: nextBalanceCents,
    heldCents: wallet.heldCents,
    availableCents: includedCents,
  }
}

export const reserveForServer = mutation({
  args: {
    organizationId: v.id("organizations"),
    actorUserId: v.id("users"),
    billingUserId: v.optional(v.id("users")),
    requestId: v.string(),
    estimatedCents: v.number(),
    feature: v.optional(v.string()),
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const ownerUserId = args.billingUserId ?? args.actorUserId
    const normalizedEstimated = Math.max(0, Math.ceil(args.estimatedCents))
    if (normalizedEstimated <= 0) {
      throw new Error("estimatedCents must be greater than zero")
    }

    const now = Date.now()
    const wallet = await getOrCreateWalletForUserInOrganization(ctx, {
      organizationId: args.organizationId,
      ownerUserId,
    })

    const existingHold = await ctx.db
      .query("aiWalletHolds")
      .withIndex("by_wallet_and_request", (q) =>
        q.eq("walletId", wallet._id).eq("requestId", args.requestId)
      )
      .first()

    if (existingHold) {
      return {
        ok: existingHold.status === "held",
        holdId: existingHold._id,
        walletId: wallet._id,
        payerUserId: ownerUserId,
        reason: existingHold.status === "held" ? undefined : "hold_not_active",
        availableCents: getAvailableCents(wallet),
      }
    }

    const availableCents = wallet.balanceCents - wallet.heldCents
    if (availableCents < normalizedEstimated) {
      return {
        ok: false,
        reason: "insufficient_funds",
        walletId: wallet._id,
        payerUserId: ownerUserId,
        availableCents: Math.max(0, availableCents),
        requiredCents: normalizedEstimated,
      }
    }

    const holdId = await ctx.db.insert("aiWalletHolds", {
      walletId: wallet._id,
      requestId: args.requestId,
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      payerUserId: ownerUserId,
      amountCents: normalizedEstimated,
      capturedCents: 0,
      releasedCents: 0,
      status: "held",
      feature: args.feature,
      model: args.model,
      provider: args.provider,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 15 * 60 * 1000,
    })

    const nextHeldCents = wallet.heldCents + normalizedEstimated
    await ctx.db.patch(wallet._id, {
      heldCents: nextHeldCents,
      updatedAt: now,
    })

    await ctx.db.insert("aiWalletLedger", {
      walletId: wallet._id,
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      payerUserId: ownerUserId,
      holdId,
      requestId: args.requestId,
      kind: "hold",
      amountCents: normalizedEstimated,
      balanceAfterCents: wallet.balanceCents,
      availableAfterCents: wallet.balanceCents - nextHeldCents,
      metadata: {
        feature: args.feature,
        model: args.model,
        provider: args.provider,
      },
      createdAt: now,
    })

    return {
      ok: true,
      holdId,
      walletId: wallet._id,
      payerUserId: ownerUserId,
      availableCents: Math.max(0, wallet.balanceCents - nextHeldCents),
    }
  },
})

export const captureForServer = mutation({
  args: {
    holdId: v.id("aiWalletHolds"),
    finalCents: v.number(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const hold = await ctx.db.get(args.holdId)
    if (!hold) {
      throw new Error("Wallet hold not found")
    }

    const wallet = await ctx.db.get(hold.walletId)
    if (!wallet) {
      throw new Error("Wallet not found")
    }

    if (hold.status === "captured") {
      return {
        ok: true,
        alreadyProcessed: true,
        walletId: wallet._id,
        balanceCents: wallet.balanceCents,
      }
    }
    if (hold.status !== "held") {
      return {
        ok: false,
        reason: "hold_not_active",
        walletId: wallet._id,
        balanceCents: wallet.balanceCents,
      }
    }

    const now = Date.now()
    const normalizedFinal = Math.max(0, Math.ceil(args.finalCents))
    const capturedCents = Math.min(normalizedFinal, hold.amountCents)
    const releasedCents = Math.max(0, hold.amountCents - capturedCents)

    const nextHeldCents = Math.max(0, wallet.heldCents - hold.amountCents)
    const nextBalanceCents = Math.max(0, wallet.balanceCents - capturedCents)

    await ctx.db.patch(wallet._id, {
      heldCents: nextHeldCents,
      balanceCents: nextBalanceCents,
      totalDebitedCents: wallet.totalDebitedCents + capturedCents,
      updatedAt: now,
    })

    await ctx.db.patch(hold._id, {
      status: "captured",
      capturedCents,
      releasedCents,
      capturedAt: now,
      updatedAt: now,
    })

    if (capturedCents > 0) {
      await ctx.db.insert("aiWalletLedger", {
        walletId: wallet._id,
        organizationId: hold.organizationId,
        actorUserId: hold.actorUserId,
        payerUserId: hold.payerUserId,
        holdId: hold._id,
        requestId: hold.requestId,
        kind: "debit",
        amountCents: capturedCents,
        balanceAfterCents: nextBalanceCents,
        availableAfterCents: nextBalanceCents - nextHeldCents,
        metadata: {
          feature: hold.feature,
          model: hold.model,
          provider: hold.provider,
        },
        createdAt: now,
      })
    }

    if (releasedCents > 0) {
      await ctx.db.insert("aiWalletLedger", {
        walletId: wallet._id,
        organizationId: hold.organizationId,
        actorUserId: hold.actorUserId,
        payerUserId: hold.payerUserId,
        holdId: hold._id,
        requestId: hold.requestId,
        kind: "release",
        amountCents: releasedCents,
        balanceAfterCents: nextBalanceCents,
        availableAfterCents: nextBalanceCents - nextHeldCents,
        metadata: {
          feature: hold.feature,
          model: hold.model,
          provider: hold.provider,
        },
        createdAt: now,
      })
    }

    return {
      ok: true,
      walletId: wallet._id,
      capturedCents,
      releasedCents,
      balanceCents: nextBalanceCents,
      availableCents: Math.max(0, nextBalanceCents - nextHeldCents),
    }
  },
})

export const releaseForServer = mutation({
  args: {
    holdId: v.id("aiWalletHolds"),
    reason: v.optional(v.string()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const hold = await ctx.db.get(args.holdId)
    if (!hold) {
      throw new Error("Wallet hold not found")
    }

    const wallet = await ctx.db.get(hold.walletId)
    if (!wallet) {
      throw new Error("Wallet not found")
    }

    if (hold.status === "released") {
      return {
        ok: true,
        alreadyProcessed: true,
        walletId: wallet._id,
      }
    }
    if (hold.status === "captured") {
      return {
        ok: false,
        reason: "hold_already_captured",
        walletId: wallet._id,
      }
    }

    const now = Date.now()
    const nextHeldCents = Math.max(0, wallet.heldCents - hold.amountCents)

    await ctx.db.patch(wallet._id, {
      heldCents: nextHeldCents,
      updatedAt: now,
    })

    await ctx.db.patch(hold._id, {
      status: "released",
      releasedCents: hold.amountCents,
      updatedAt: now,
    })

    await ctx.db.insert("aiWalletLedger", {
      walletId: wallet._id,
      organizationId: hold.organizationId,
      actorUserId: hold.actorUserId,
      payerUserId: hold.payerUserId,
      holdId: hold._id,
      requestId: hold.requestId,
      kind: "release",
      amountCents: hold.amountCents,
      balanceAfterCents: wallet.balanceCents,
      availableAfterCents: wallet.balanceCents - nextHeldCents,
      metadata: {
        reason: args.reason,
        feature: hold.feature,
        model: hold.model,
        provider: hold.provider,
      },
      createdAt: now,
    })

    return {
      ok: true,
      walletId: wallet._id,
      balanceCents: wallet.balanceCents,
      availableCents: Math.max(0, wallet.balanceCents - nextHeldCents),
    }
  },
})

const grantArgs = {
  organizationId: v.id("organizations"),
  targetUserId: v.id("users"),
  billingUserId: v.optional(v.id("users")),
  actorUserId: v.optional(v.id("users")),
  plan: v.union(
    v.literal("free"),
    v.literal("pro"),
    v.literal("max"),
    v.literal("startup"),
    v.literal("enterprise")
  ),
  cycle: v.optional(v.union(v.literal("monthly"), v.literal("yearly"))),
  periodStart: v.optional(v.number()),
  periodEnd: v.optional(v.number()),
  source: v.union(
    v.literal("subscription_cycle"),
    v.literal("seat_assignment"),
    v.literal("manual")
  ),
  grantKey: v.string(),
  metadata: v.optional(v.any()),
}

export const grantIncludedBalanceInternal = internalMutation({
  args: grantArgs,
  handler: async (ctx, args) => {
    return await grantIncludedWalletBalance(ctx, args)
  },
})

export const grantIncludedBalanceForServer = mutation({
  args: {
    ...grantArgs,
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    return await grantIncludedWalletBalance(ctx, args)
  },
})

export const getWalletForServer = query({
  args: {
    ownerUserId: v.id("users"),
    organizationId: v.optional(v.id("organizations")),
    ledgerLimit: v.optional(v.number()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const wallet = args.organizationId
      ? await getWalletByScopeKey(
          ctx,
          toOrgUserScopeKey(args.organizationId, args.ownerUserId)
        )
      : await ctx.db
          .query("aiWallets")
          .withIndex("by_owner_user", (q) => q.eq("ownerUserId", args.ownerUserId))
          .order("desc")
          .first()

    if (!wallet) {
      return null
    }

    const limit = Math.max(1, Math.min(100, Math.floor(args.ledgerLimit ?? 20)))
    const ledger = await ctx.db
      .query("aiWalletLedger")
      .withIndex("by_wallet_and_created", (q) => q.eq("walletId", wallet._id))
      .order("desc")
      .take(limit)

    return {
      ...wallet,
      currency: WALLET_CURRENCY,
      availableCents: getAvailableCents(wallet),
      ledger,
    }
  },
})

export const getWalletForViewer = query({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const [organization, user] = await Promise.all([
      ctx.db.get(args.organizationId),
      ctx.db.get(args.userId),
    ])
    if (!organization || !user) {
      throw new Error("Organization or user not found")
    }

    const memberships = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.userId)
      )
      .collect()
    if (memberships.length === 0) {
      throw new Error("Unauthorized")
    }

    const entitlement = await resolveAccountEntitlementForOrganization(ctx, {
      organization,
      user,
    })
    const ownerUserId = resolveWalletOwnerUserId({
      userId: args.userId,
      entitlement,
    })

    const scopeKey = toOrgUserScopeKey(args.organizationId, ownerUserId)
    const wallet = await getWalletByScopeKey(ctx, scopeKey)
    const includedCentsPerCycle = resolveIncludedWalletCents({
      plan: entitlement.plan,
      cycle: entitlement.cycle,
    })

    const ledger = wallet
      ? await ctx.db
          .query("aiWalletLedger")
          .withIndex("by_wallet_and_created", (q) => q.eq("walletId", wallet._id))
          .order("desc")
          .take(20)
      : []

    return {
      ownerUserId,
      plan: entitlement.plan,
      source: entitlement.source,
      cycle: entitlement.cycle,
      includedCentsPerCycle,
      wallet: wallet
        ? {
            _id: wallet._id,
            currency: WALLET_CURRENCY,
            balanceCents: wallet.balanceCents,
            heldCents: wallet.heldCents,
            availableCents: getAvailableCents(wallet),
            updatedAt: wallet.updatedAt,
            totalDebitedCents: wallet.totalDebitedCents,
            totalCreditedCents: wallet.totalCreditedCents,
          }
        : null,
      ledger,
    }
  },
})

export const getSeatWalletsForViewer = query({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const [organization, user] = await Promise.all([
      ctx.db.get(args.organizationId),
      ctx.db.get(args.userId),
    ])
    if (!organization || !user) {
      throw new Error("Organization or user not found")
    }

    const memberships = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.userId)
      )
      .collect()
    if (memberships.length === 0) {
      throw new Error("Unauthorized")
    }

    const entitlement = await resolveAccountEntitlementForOrganization(ctx, {
      organization,
      user,
    })

    const seatManaged =
      entitlement.source === "trial" || isSeatManagedWalletPlan(entitlement.plan)
    const canManage =
      seatManaged &&
      Boolean(entitlement.billingUserId) &&
      String(entitlement.billingUserId) === String(args.userId)

    if (!canManage || !entitlement.billingUserId) {
      return {
        canManage: false,
        includedCentsPerCycle: 0,
        wallets: [] as Array<{
          userId: Id<"users">
          email: string
          firstName?: string
          lastName?: string
          profileImageUrl?: string
          isBillingOwner: boolean
          walletId: Id<"aiWallets"> | null
          balanceCents: number
          heldCents: number
          availableCents: number
          updatedAt: number | null
        }>,
      }
    }

    const billingUserId = entitlement.billingUserId as Id<"users">
    const assignments = await ctx.db
      .query("accountSeatAssignments")
      .withIndex("by_billing_user_and_organization", (q) =>
        q.eq("billingUserId", billingUserId).eq("organizationId", args.organizationId)
      )
      .collect()

    const activeAssignedUserIds = new Set<string>(
      assignments
        .filter((assignment) => assignment.status === "active")
        .map((assignment) => String(assignment.assignedUserId))
    )
    activeAssignedUserIds.add(String(billingUserId))

    const seatUserIds = [...activeAssignedUserIds].map(
      (id) => id as Id<"users">
    )

    const includedCentsPerCycle = resolveIncludedWalletCents({
      plan: entitlement.plan,
      cycle: entitlement.cycle,
    })

    const walletEntries = await Promise.all(
      seatUserIds.map(async (seatUserId) => {
        const [seatUser, wallet] = await Promise.all([
          ctx.db.get(seatUserId),
          getWalletByScopeKey(
            ctx,
            toOrgUserScopeKey(args.organizationId, seatUserId)
          ),
        ])

        return {
          userId: seatUserId,
          email: seatUser?.email || "Unknown",
          firstName: seatUser?.firstName,
          lastName: seatUser?.lastName,
          profileImageUrl: seatUser?.profileImageUrl,
          isBillingOwner: String(seatUserId) === String(billingUserId),
          walletId: wallet?._id ?? null,
          balanceCents: wallet?.balanceCents ?? 0,
          heldCents: wallet?.heldCents ?? 0,
          availableCents: wallet ? getAvailableCents(wallet) : 0,
          updatedAt: wallet?.updatedAt ?? null,
        }
      })
    )

    walletEntries.sort((a, b) => {
      if (a.isBillingOwner && !b.isBillingOwner) return -1
      if (!a.isBillingOwner && b.isBillingOwner) return 1
      return a.email.localeCompare(b.email)
    })

    return {
      canManage: true,
      includedCentsPerCycle,
      wallets: walletEntries,
    }
  },
})
