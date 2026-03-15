import { internalMutation, mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import { v } from "convex/values"

import {
  resolveAccountEntitlementForOrganization,
  type AccountBillingCycle,
  type AccountSubscriptionPlan,
} from "./lib/accountEntitlements"
import {
  isSeatManagedWalletPlan,
  resolveEffectiveIncludedWalletCents,
  resolveIncludedWalletCents,
} from "./lib/walletPolicy"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET
const WALLET_CURRENCY = "USD"

type WalletReadCtx = Pick<QueryCtx | MutationCtx, "db">
type WalletDoc = Doc<"aiWallets">
type WalletScopeType = "organization" | "user"
const PERSONAL_WORKSPACE_PREFIX = "personal:"

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

function toWorkspaceSeatScopeKey(
  organizationId: Id<"organizations">,
  ownerUserId: Id<"users">
): string {
  return `org:${String(organizationId)}:user:${String(ownerUserId)}`
}

function toPersonalScopeKey(ownerUserId: Id<"users">): string {
  return `user:${String(ownerUserId)}`
}

function normalizeCurrency(): string {
  return WALLET_CURRENCY
}

function isPersonalWorkspaceOrganization(organization: Doc<"organizations">): boolean {
  return organization.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)
}

function getAvailableCents(wallet: WalletDoc): number {
  return Math.max(0, wallet.balanceCents - wallet.heldCents)
}

function toWalletSummary(wallet: WalletDoc) {
  return {
    _id: wallet._id,
    currency: WALLET_CURRENCY,
    balanceCents: wallet.balanceCents,
    heldCents: wallet.heldCents,
    availableCents: getAvailableCents(wallet),
    updatedAt: wallet.updatedAt,
    totalDebitedCents: wallet.totalDebitedCents,
    totalCreditedCents: wallet.totalCreditedCents,
  }
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

async function ensureWalletCurrency(
  ctx: MutationCtx,
  wallet: WalletDoc
): Promise<WalletDoc> {
  if (wallet.currency === WALLET_CURRENCY) {
    return wallet
  }

  const now = Date.now()
  await ctx.db.patch(wallet._id, {
    currency: WALLET_CURRENCY,
    updatedAt: now,
  })
  return {
    ...wallet,
    currency: WALLET_CURRENCY,
    updatedAt: now,
  }
}

async function createWallet(
  ctx: MutationCtx,
  args: {
    scopeType: WalletScopeType
    scopeKey: string
    organizationId?: Id<"organizations">
    ownerUserId?: Id<"users">
  }
): Promise<WalletDoc> {
  const now = Date.now()
  const walletId = await ctx.db.insert("aiWallets", {
    scopeType: args.scopeType,
    scopeKey: args.scopeKey,
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

function hasWorkspaceSeatWalletAccess(
  entitlement: Awaited<ReturnType<typeof resolveAccountEntitlementForOrganization>>
): boolean {
  const seatManaged =
    entitlement.source === "trial" || isSeatManagedWalletPlan(entitlement.plan)
  if (!seatManaged) return false
  return entitlement.hasPaidSeat
}

async function getWalletForWorkspaceSeatContext(
  ctx: WalletReadCtx,
  args: {
    organizationId: Id<"organizations">
    ownerUserId: Id<"users">
  }
): Promise<WalletDoc | null> {
  return await getWalletByScopeKey(
    ctx,
    toWorkspaceSeatScopeKey(args.organizationId, args.ownerUserId)
  )
}

async function getOrCreateWalletForWorkspaceSeatContext(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">
    ownerUserId: Id<"users">
  }
): Promise<WalletDoc> {
  const scopeKey = toWorkspaceSeatScopeKey(args.organizationId, args.ownerUserId)
  const existing = await getWalletByScopeKey(ctx, scopeKey)
  if (existing) {
    return await ensureWalletCurrency(ctx, existing)
  }

  return await createWallet(ctx, {
    scopeType: "organization",
    scopeKey,
    organizationId: args.organizationId,
    ownerUserId: args.ownerUserId,
  })
}

async function findLegacyIndividualWalletForUser(
  ctx: WalletReadCtx,
  ownerUserId: Id<"users">
): Promise<WalletDoc | null> {
  const grants = await ctx.db
    .query("aiWalletPeriodGrants")
    .withIndex("by_target_user", (q) => q.eq("targetUserId", ownerUserId))
    .order("desc")
    .take(100)

  for (const grant of grants) {
    if (grant.plan !== "pro" && grant.plan !== "max") continue
    const wallet = await ctx.db.get(grant.walletId)
    if (!wallet) continue
    if (wallet.ownerUserId && String(wallet.ownerUserId) !== String(ownerUserId)) continue
    return wallet
  }

  return null
}

async function getPersonalWallet(
  ctx: WalletReadCtx,
  args: { ownerUserId: Id<"users"> }
): Promise<WalletDoc | null> {
  const personalWallet = await getWalletByScopeKey(
    ctx,
    toPersonalScopeKey(args.ownerUserId)
  )
  if (personalWallet) {
    return personalWallet
  }

  return await findLegacyIndividualWalletForUser(ctx, args.ownerUserId)
}

async function getOrCreatePersonalWallet(
  ctx: MutationCtx,
  args: { ownerUserId: Id<"users"> }
): Promise<WalletDoc> {
  const personalScopeKey = toPersonalScopeKey(args.ownerUserId)
  const personalWallet = await getWalletByScopeKey(ctx, personalScopeKey)
  if (personalWallet) {
    return await ensureWalletCurrency(ctx, personalWallet)
  }

  const legacyWallet = await findLegacyIndividualWalletForUser(ctx, args.ownerUserId)
  if (legacyWallet) {
    const now = Date.now()
    await ctx.db.patch(legacyWallet._id, {
      scopeType: "user",
      scopeKey: personalScopeKey,
      ownerUserId: args.ownerUserId,
      currency: WALLET_CURRENCY,
      updatedAt: now,
    })

    return {
      ...legacyWallet,
      scopeType: "user",
      scopeKey: personalScopeKey,
      ownerUserId: args.ownerUserId,
      currency: WALLET_CURRENCY,
      updatedAt: now,
    }
  }

  return await createWallet(ctx, {
    scopeType: "user",
    scopeKey: personalScopeKey,
    ownerUserId: args.ownerUserId,
  })
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
    includedCentsOverride?: number
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

  const useWorkspaceSeatWallet = isSeatManagedWalletPlan(args.plan)
  const wallet = useWorkspaceSeatWallet
    ? await getOrCreateWalletForWorkspaceSeatContext(ctx, {
        organizationId: args.organizationId,
        ownerUserId: args.targetUserId,
      })
    : await getOrCreatePersonalWallet(ctx, {
        ownerUserId: args.targetUserId,
      })

  const includedCents =
    typeof args.includedCentsOverride === "number" && Number.isFinite(args.includedCentsOverride)
      ? Math.max(0, Math.floor(args.includedCentsOverride))
      : resolveIncludedWalletCents({
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

async function revokeWalletAvailableBalance(
  ctx: MutationCtx,
  args: {
    wallet: WalletDoc
    organizationId: Id<"organizations">
    actorUserId?: Id<"users">
    payerUserId: Id<"users">
    reason:
      | "subscription_canceled"
      | "subscription_trial_ended"
    metadata?: unknown
  }
): Promise<{
  walletId: Id<"aiWallets">
  appliedDeltaCents: number
  balanceCents: number
  heldCents: number
  availableCents: number
}> {
  const now = Date.now()
  const nextBalanceCents = Math.max(args.wallet.heldCents, 0)
  const appliedDeltaCents = nextBalanceCents - args.wallet.balanceCents

  if (appliedDeltaCents === 0) {
    return {
      walletId: args.wallet._id,
      appliedDeltaCents: 0,
      balanceCents: args.wallet.balanceCents,
      heldCents: args.wallet.heldCents,
      availableCents: getAvailableCents(args.wallet),
    }
  }

  await ctx.db.patch(args.wallet._id, {
    balanceCents: nextBalanceCents,
    updatedAt: now,
  })

  await ctx.db.insert("aiWalletLedger", {
    walletId: args.wallet._id,
    organizationId: args.organizationId,
    actorUserId: args.actorUserId,
    payerUserId: args.payerUserId,
    kind: appliedDeltaCents > 0 ? "credit" : "adjustment",
    amountCents: Math.abs(appliedDeltaCents),
    balanceAfterCents: nextBalanceCents,
    availableAfterCents: Math.max(0, nextBalanceCents - args.wallet.heldCents),
    metadata: {
      reason: args.reason,
      direction: appliedDeltaCents > 0 ? "increase" : "decrease",
      ...(normalizeGrantMetadata(args.metadata) ?? {}),
    },
    createdAt: now,
  })

  return {
    walletId: args.wallet._id,
    appliedDeltaCents,
    balanceCents: nextBalanceCents,
    heldCents: args.wallet.heldCents,
    availableCents: Math.max(0, nextBalanceCents - args.wallet.heldCents),
  }
}

export async function revokeIncludedWalletBalance(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">
    billingUserId: Id<"users">
    plan: AccountSubscriptionPlan
    actorUserId?: Id<"users">
    reason:
      | "subscription_canceled"
      | "subscription_trial_ended"
  }
): Promise<{
  ok: boolean
  revokedWalletCount: number
  revokedAvailableCents: number
}> {
  const walletTargets = new Map<string, Promise<WalletDoc | null>>()

  if (isSeatManagedWalletPlan(args.plan)) {
    const assignments = await ctx.db
      .query("accountSeatAssignments")
      .withIndex("by_billing_user_and_organization", (q) =>
        q.eq("billingUserId", args.billingUserId).eq("organizationId", args.organizationId)
      )
      .collect()

    const seatUserIds = new Set<Id<"users">>([args.billingUserId])
    for (const assignment of assignments) {
      if (assignment.status === "active") {
        seatUserIds.add(assignment.assignedUserId)
      }
    }

    for (const seatUserId of seatUserIds) {
      walletTargets.set(
        `org:${String(args.organizationId)}:user:${String(seatUserId)}`,
        getWalletForWorkspaceSeatContext(ctx, {
          organizationId: args.organizationId,
          ownerUserId: seatUserId,
        })
      )
    }
  } else if (args.plan === "pro" || args.plan === "max") {
    walletTargets.set(
      `user:${String(args.billingUserId)}`,
      getPersonalWallet(ctx, {
        ownerUserId: args.billingUserId,
      })
    )
  }

  let revokedWalletCount = 0
  let revokedAvailableCents = 0

  for (const walletPromise of walletTargets.values()) {
    const wallet = await walletPromise
    if (!wallet) continue

    const revokedAvailable = getAvailableCents(wallet)
    const result = await revokeWalletAvailableBalance(ctx, {
      wallet,
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      payerUserId: args.billingUserId,
      reason: args.reason,
      metadata: {
        plan: args.plan,
      },
    })

    if (result.appliedDeltaCents !== 0) {
      revokedWalletCount += 1
      revokedAvailableCents += revokedAvailable
    }
  }

  return {
    ok: true,
    revokedWalletCount,
    revokedAvailableCents,
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
    const personalOwnerUserId = args.billingUserId ?? args.actorUserId
    const normalizedEstimated = Math.max(0, Math.ceil(args.estimatedCents))
    if (normalizedEstimated <= 0) {
      throw new Error("estimatedCents must be greater than zero")
    }

    const now = Date.now()
    const [organization, actorUser] = await Promise.all([
      ctx.db.get(args.organizationId),
      ctx.db.get(args.actorUserId),
    ])
    if (!organization || !actorUser) {
      throw new Error("Organization or user not found")
    }
    const personalWorkspace = isPersonalWorkspaceOrganization(organization)

    const entitlement = await resolveAccountEntitlementForOrganization(ctx, {
      organization,
      user: actorUser,
    })

    const existingHold = await ctx.db
      .query("aiWalletHolds")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .first()

    if (existingHold) {
      const wallet = await ctx.db.get(existingHold.walletId)
      const availableCents = wallet ? getAvailableCents(wallet) : 0

      if (
        String(existingHold.organizationId) !== String(args.organizationId) ||
        String(existingHold.actorUserId) !== String(args.actorUserId)
      ) {
        return {
          ok: false,
          reason: "request_id_conflict",
          walletId: wallet?._id,
          payerUserId: existingHold.payerUserId,
          availableCents,
          requiredCents: normalizedEstimated,
        }
      }

      return {
        ok: existingHold.status === "held",
        holdId: existingHold._id,
        walletId: wallet?._id,
        payerUserId: existingHold.payerUserId,
        reason: existingHold.status === "held" ? undefined : "hold_not_active",
        availableCents,
      }
    }

    if (!entitlement.canUseAi) {
      return {
        ok: false,
        reason: "insufficient_funds" as const,
        availableCents: 0,
        requiredCents: normalizedEstimated,
      }
    }

    const [workspaceSeatWalletRaw, personalWalletRaw] = await Promise.all([
      hasWorkspaceSeatWalletAccess(entitlement)
        ? getWalletForWorkspaceSeatContext(ctx, {
            organizationId: args.organizationId,
            ownerUserId: args.actorUserId,
          })
        : Promise.resolve(null),
      personalWorkspace
        ? getPersonalWallet(ctx, {
            ownerUserId: personalOwnerUserId,
          })
        : Promise.resolve(null),
    ])

    const workspaceSeatWallet = workspaceSeatWalletRaw
      ? await ensureWalletCurrency(ctx, workspaceSeatWalletRaw)
      : null
    const personalWallet = personalWalletRaw
      ? await ensureWalletCurrency(ctx, personalWalletRaw)
      : null

    const workspaceSeatAvailable = workspaceSeatWallet
      ? getAvailableCents(workspaceSeatWallet)
      : 0
    const personalAvailable = personalWallet ? getAvailableCents(personalWallet) : 0

    const selectedWallet =
      workspaceSeatWallet && workspaceSeatAvailable >= normalizedEstimated
        ? workspaceSeatWallet
        : personalWallet && personalAvailable >= normalizedEstimated
          ? personalWallet
          : null

    const payerUserId =
      selectedWallet && selectedWallet._id === workspaceSeatWallet?._id
        ? args.actorUserId
        : personalWorkspace
          ? personalOwnerUserId
          : args.actorUserId

    if (!selectedWallet) {
      return {
        ok: false,
        reason: "insufficient_funds",
        walletId: workspaceSeatWallet?._id ?? personalWallet?._id,
        payerUserId,
        availableCents: Math.max(workspaceSeatAvailable, personalAvailable, 0),
        requiredCents: normalizedEstimated,
      }
    }

    const holdId = await ctx.db.insert("aiWalletHolds", {
      walletId: selectedWallet._id,
      requestId: args.requestId,
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      payerUserId,
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

    const nextHeldCents = selectedWallet.heldCents + normalizedEstimated
    await ctx.db.patch(selectedWallet._id, {
      heldCents: nextHeldCents,
      updatedAt: now,
    })

    await ctx.db.insert("aiWalletLedger", {
      walletId: selectedWallet._id,
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      payerUserId,
      holdId,
      requestId: args.requestId,
      kind: "hold",
      amountCents: normalizedEstimated,
      balanceAfterCents: selectedWallet.balanceCents,
      availableAfterCents: selectedWallet.balanceCents - nextHeldCents,
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
      walletId: selectedWallet._id,
      payerUserId,
      availableCents: Math.max(0, selectedWallet.balanceCents - nextHeldCents),
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
    const nextHeldCents = Math.max(0, wallet.heldCents - hold.amountCents)
    const maxCapturableCents = Math.max(0, wallet.balanceCents - nextHeldCents)
    const capturedCents = Math.min(normalizedFinal, maxCapturableCents)
    const releasedCents = Math.max(0, hold.amountCents - Math.min(capturedCents, hold.amountCents))
    const underCapturedByCents = Math.max(0, normalizedFinal - capturedCents)
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
      requestedCents: normalizedFinal,
      capturedCents,
      releasedCents,
      underCapturedByCents,
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
  includedCentsOverride: v.optional(v.number()),
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

export const revokeIncludedBalanceForServer = mutation({
  args: {
    organizationId: v.id("organizations"),
    billingUserId: v.id("users"),
    plan: v.union(
      v.literal("free"),
      v.literal("pro"),
      v.literal("max"),
      v.literal("startup"),
      v.literal("enterprise")
    ),
    actorUserId: v.optional(v.id("users")),
    reason: v.union(v.literal("subscription_canceled"), v.literal("subscription_trial_ended")),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    return await revokeIncludedWalletBalance(ctx, args)
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
      ? (
          await getWalletForWorkspaceSeatContext(ctx, {
            organizationId: args.organizationId,
            ownerUserId: args.ownerUserId,
          })
        ) ??
        (await getPersonalWallet(ctx, {
          ownerUserId: args.ownerUserId,
        }))
      : (await getPersonalWallet(ctx, {
          ownerUserId: args.ownerUserId,
        })) ??
        (await ctx.db
          .query("aiWallets")
          .withIndex("by_owner_user", (q) => q.eq("ownerUserId", args.ownerUserId))
          .order("desc")
          .first())

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
    const personalWorkspace = isPersonalWorkspaceOrganization(organization)

    const entitlement = await resolveAccountEntitlementForOrganization(ctx, {
      organization,
      user,
    })
    const personalOwnerUserId = args.userId

    const [workspaceSeatWallet, personalWallet] = await Promise.all([
      hasWorkspaceSeatWalletAccess(entitlement)
        ? getWalletForWorkspaceSeatContext(ctx, {
            organizationId: args.organizationId,
            ownerUserId: args.userId,
          })
        : Promise.resolve(null),
      personalWorkspace
        ? getPersonalWallet(ctx, {
            ownerUserId: personalOwnerUserId,
          })
        : Promise.resolve(null),
    ])

    const activeWalletContext = workspaceSeatWallet
      ? "workspace_seat"
      : personalWallet
        ? "personal"
        : "none"

    const activeWallet =
      activeWalletContext === "workspace_seat"
        ? workspaceSeatWallet
        : activeWalletContext === "personal"
          ? personalWallet
          : null

    const activePlan = personalWorkspace
      ? entitlement.plan === "pro" || entitlement.plan === "max"
        ? entitlement.plan
        : "free"
      : entitlement.plan

    const activeCycle = personalWorkspace
      ? entitlement.plan === "pro" || entitlement.plan === "max"
        ? entitlement.cycle
        : "monthly"
      : entitlement.cycle

    const includedCentsPerCycle = resolveEffectiveIncludedWalletCents({
      plan: activePlan,
      cycle: activeCycle,
      status: entitlement.status,
    })

    const ledger = activeWallet
      ? await ctx.db
          .query("aiWalletLedger")
          .withIndex("by_wallet_and_created", (q) => q.eq("walletId", activeWallet._id))
          .order("desc")
          .take(20)
      : []

    return {
      ownerUserId:
        activeWalletContext === "workspace_seat" || !personalWorkspace
          ? args.userId
          : personalOwnerUserId,
      plan: entitlement.plan,
      source: entitlement.source,
      cycle: entitlement.cycle,
      includedCentsPerCycle,
      wallet: activeWallet ? toWalletSummary(activeWallet) : null,
      ledger,
      walletContexts: {
        active: activeWalletContext,
        workspaceSeat: workspaceSeatWallet
          ? {
              ownerUserId: args.userId,
              includedCentsPerCycle: resolveEffectiveIncludedWalletCents({
                plan: entitlement.plan,
                cycle: entitlement.cycle,
                status: entitlement.status,
              }),
              wallet: toWalletSummary(workspaceSeatWallet),
            }
          : null,
        personal: personalWorkspace
          ? {
              ownerUserId: personalOwnerUserId,
              includedCentsPerCycle:
                entitlement.plan === "pro" || entitlement.plan === "max"
                  ? resolveEffectiveIncludedWalletCents({
                      plan: entitlement.plan,
                      cycle: entitlement.cycle,
                      status: entitlement.status,
                    })
                  : 0,
              wallet: personalWallet ? toWalletSummary(personalWallet) : null,
            }
          : null,
      },
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

    const includedCentsPerCycle = resolveEffectiveIncludedWalletCents({
      plan: entitlement.plan,
      cycle: entitlement.cycle,
      status: entitlement.status,
    })

    const walletEntries = await Promise.all(
      seatUserIds.map(async (seatUserId) => {
        const [seatUser, wallet] = await Promise.all([
          ctx.db.get(seatUserId),
          getWalletForWorkspaceSeatContext(ctx, {
            organizationId: args.organizationId,
            ownerUserId: seatUserId,
          }),
        ])
        const walletSummary = wallet ? toWalletSummary(wallet) : null

        return {
          userId: seatUserId,
          email: seatUser?.email || "Unknown",
          firstName: seatUser?.firstName,
          lastName: seatUser?.lastName,
          profileImageUrl: seatUser?.profileImageUrl,
          isBillingOwner: String(seatUserId) === String(billingUserId),
          walletId: wallet?._id ?? null,
          balanceCents: walletSummary?.balanceCents ?? 0,
          heldCents: walletSummary?.heldCents ?? 0,
          availableCents: walletSummary?.availableCents ?? 0,
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
