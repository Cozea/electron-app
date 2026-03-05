import { internalMutation, mutation, query } from "./_generated/server"
import type { DatabaseWriter, MutationCtx, QueryCtx } from "./_generated/server"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import {
  normalizeStartupSeatQuantity,
  resolveAccountEntitlementForOrganization,
  resolveAccountEntitlementForProject,
  ACCOUNT_TRIAL_LENGTH_MS,
} from "./lib/accountEntitlements"
import { grantIncludedWalletBalance } from "./aiWallets"
import { hasPermission, type Role } from "./lib/permissions"

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
      startupMonthly: v.optional(v.object({ productId: v.string(), priceId: v.string() })),
      startupYearly: v.optional(v.object({ productId: v.string(), priceId: v.string() })),
      proMonthly: v.optional(v.object({ productId: v.string(), priceId: v.string() })),
      proYearly: v.optional(v.object({ productId: v.string(), priceId: v.string() })),
      maxMonthly: v.optional(v.object({ productId: v.string(), priceId: v.string() })),
      maxYearly: v.optional(v.object({ productId: v.string(), priceId: v.string() })),
      // Legacy aliases kept for compatibility with older catalog payloads.
      pro: v.optional(v.object({ productId: v.string(), priceId: v.string() })),
      max: v.optional(v.object({ productId: v.string(), priceId: v.string() })),
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
      v.literal("startup"),
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
      v.literal("startup"),
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
    plan: "free" | "pro" | "max" | "startup" | "team" | "enterprise"
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
        "openai",
        "anthropic",
        "google",
        "xai",
        "moonshotai",
      ],
    },
    updatedAt: now,
  })

  return { success: true, plan: args.plan }
}

type BillingReadCtx = Pick<QueryCtx | MutationCtx, "db">
type BillingWriteCtx = Pick<MutationCtx, "db">

function orgRolePriority(role: Doc<"members">["role"]): number {
  switch (role) {
    case "admin":
      return 3
    case "member":
      return 2
    default:
      return 1
  }
}

function pickCanonicalOrganizationMembership(
  memberships: Doc<"members">[]
): Doc<"members"> | null {
  if (memberships.length === 0) return null
  return [...memberships].sort((a, b) => {
    const roleDelta = orgRolePriority(b.role) - orgRolePriority(a.role)
    if (roleDelta !== 0) return roleDelta
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    const joinedDelta = (b.joinedAt || 0) - (a.joinedAt || 0)
    if (joinedDelta !== 0) return joinedDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

async function getCanonicalOrganizationMembership(
  ctx: BillingReadCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">
): Promise<Doc<"members"> | null> {
  const memberships = await ctx.db
    .query("members")
    .withIndex("by_organization_and_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId)
    )
    .collect()
  return pickCanonicalOrganizationMembership(memberships)
}

function pickCanonicalRecord<T extends { _id: unknown; updatedAt?: number; createdAt?: number }>(
  records: T[]
): T | null {
  if (records.length === 0) return null
  return [...records].sort((a, b) => {
    const updateDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updateDelta !== 0) return updateDelta
    const createdDelta = (b.createdAt || 0) - (a.createdAt || 0)
    if (createdDelta !== 0) return createdDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

async function getCanonicalBillingAccountByOrganization(
  ctx: BillingReadCtx,
  organizationId: Id<"organizations">
): Promise<Doc<"organizationBillingAccounts"> | null> {
  const records = await ctx.db
    .query("organizationBillingAccounts")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect()
  return pickCanonicalRecord(records)
}

async function getCanonicalAccountSubscription(
  ctx: BillingReadCtx,
  accountUserId: Id<"users">
): Promise<Doc<"accountSubscriptions"> | null> {
  const records = await ctx.db
    .query("accountSubscriptions")
    .withIndex("by_account_user", (q) => q.eq("accountUserId", accountUserId))
    .collect()
  return pickCanonicalRecord(records)
}

async function getCanonicalSeatAssignment(
  ctx: BillingReadCtx,
  billingUserId: Id<"users">,
  organizationId: Id<"organizations">,
  assignedUserId: Id<"users">
): Promise<Doc<"accountSeatAssignments"> | null> {
  const records = await ctx.db
    .query("accountSeatAssignments")
    .withIndex("by_billing_org_assigned", (q) =>
      q
        .eq("billingUserId", billingUserId)
        .eq("organizationId", organizationId)
        .eq("assignedUserId", assignedUserId)
    )
    .collect()
  return pickCanonicalRecord(records)
}

async function upsertSeatAssignmentRecord(
  ctx: BillingWriteCtx,
  args: {
    organizationId: Id<"organizations">
    billingUserId: Id<"users">
    assignedUserId: Id<"users">
    assignedByUserId?: Id<"users">
    active: boolean
    source?: "owner_auto" | "manual" | "migration"
  }
): Promise<Id<"accountSeatAssignments">> {
  const now = Date.now()
  const existing = await getCanonicalSeatAssignment(
    ctx,
    args.billingUserId,
    args.organizationId,
    args.assignedUserId
  )

  if (existing) {
    await ctx.db.patch(existing._id, {
      status: args.active ? "active" : "revoked",
      assignedByUserId: args.assignedByUserId ?? existing.assignedByUserId,
      source: args.source ?? existing.source,
      assignedAt: args.active ? now : existing.assignedAt,
      revokedAt: args.active ? undefined : now,
      updatedAt: now,
    })
    return existing._id
  }

  return await ctx.db.insert("accountSeatAssignments", {
    organizationId: args.organizationId,
    billingUserId: args.billingUserId,
    assignedUserId: args.assignedUserId,
    assignedByUserId: args.assignedByUserId,
    source: args.source,
    status: args.active ? "active" : "revoked",
    assignedAt: now,
    revokedAt: args.active ? undefined : now,
    updatedAt: now,
  })
}

export const getAccountSubscriptionForServer = query({
  args: {
    accountUserId: v.id("users"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    return await ctx.db
      .query("accountSubscriptions")
      .withIndex("by_account_user", (q) => q.eq("accountUserId", args.accountUserId))
      .order("desc")
      .first()
  },
})

export const upsertOrganizationBillingAccountForServer = mutation({
  args: {
    organizationId: v.id("organizations"),
    billingUserId: v.id("users"),
    migratedFromLegacyWorkspaceBilling: v.optional(v.boolean()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const now = Date.now()
    const existing = await getCanonicalBillingAccountByOrganization(ctx, args.organizationId)

    if (existing) {
      await ctx.db.patch(existing._id, {
        organizationId: args.organizationId,
        billingUserId: args.billingUserId,
        mode: "account",
        migratedFromLegacyWorkspaceBilling:
          args.migratedFromLegacyWorkspaceBilling ?? existing.migratedFromLegacyWorkspaceBilling,
        updatedAt: now,
      })
      return existing._id
    }

    return await ctx.db.insert("organizationBillingAccounts", {
      organizationId: args.organizationId,
      billingUserId: args.billingUserId,
      mode: "account",
      migratedFromLegacyWorkspaceBilling: args.migratedFromLegacyWorkspaceBilling,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const upsertAccountSubscriptionForServer = mutation({
  args: {
    accountUserId: v.id("users"),
    plan: v.union(
      v.literal("free"),
      v.literal("pro"),
      v.literal("max"),
      v.literal("startup"),
      v.literal("enterprise")
    ),
    status: v.union(
      v.literal("active"),
      v.literal("canceled"),
      v.literal("past_due"),
      v.literal("trialing")
    ),
    cycle: v.optional(v.union(v.literal("monthly"), v.literal("yearly"))),
    seatQuantity: v.optional(v.number()),
    trialStart: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    stripeProductId: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    legacyOrganizationId: v.optional(v.id("organizations")),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const now = Date.now()
    const existing = await getCanonicalAccountSubscription(ctx, args.accountUserId)
    const normalizedSeatQuantity =
      args.plan === "startup" || args.plan === "enterprise"
        ? normalizeStartupSeatQuantity(args.seatQuantity)
        : undefined
    const computedTrialStart =
      args.status === "trialing"
        ? args.trialStart ?? existing?.trialStart ?? now
        : args.trialStart
    const computedTrialEnd =
      args.status === "trialing"
        ? args.trialEnd ?? (computedTrialStart !== undefined ? computedTrialStart + ACCOUNT_TRIAL_LENGTH_MS : undefined)
        : args.trialEnd

    if (existing) {
      await ctx.db.patch(existing._id, {
        accountUserId: args.accountUserId,
        plan: args.plan,
        status: args.status,
        cycle: args.cycle,
        seatQuantity: normalizedSeatQuantity,
        trialStart: computedTrialStart,
        trialEnd: computedTrialEnd,
        stripeCustomerId: args.stripeCustomerId ?? existing.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId ?? existing.stripeSubscriptionId,
        stripePriceId: args.stripePriceId ?? existing.stripePriceId,
        stripeProductId: args.stripeProductId ?? existing.stripeProductId,
        currentPeriodStart: args.currentPeriodStart,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAt: args.cancelAt,
        canceledAt: args.canceledAt,
        legacyOrganizationId: args.legacyOrganizationId ?? existing.legacyOrganizationId,
        updatedAt: now,
      })
      return existing._id
    }

    return await ctx.db.insert("accountSubscriptions", {
      accountUserId: args.accountUserId,
      plan: args.plan,
      status: args.status,
      cycle: args.cycle,
      seatQuantity: normalizedSeatQuantity,
      trialStart: computedTrialStart,
      trialEnd: computedTrialEnd,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripePriceId: args.stripePriceId,
      stripeProductId: args.stripeProductId,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAt: args.cancelAt,
      canceledAt: args.canceledAt,
      legacyOrganizationId: args.legacyOrganizationId,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const setAccountSeatAssignmentForServer = mutation({
  args: {
    organizationId: v.id("organizations"),
    billingUserId: v.id("users"),
    assignedUserId: v.id("users"),
    assignedByUserId: v.optional(v.id("users")),
    active: v.boolean(),
    source: v.optional(v.union(v.literal("owner_auto"), v.literal("manual"), v.literal("migration"))),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const assignmentId = await upsertSeatAssignmentRecord(ctx, {
      organizationId: args.organizationId,
      billingUserId: args.billingUserId,
      assignedUserId: args.assignedUserId,
      assignedByUserId: args.assignedByUserId,
      active: args.active,
      source: args.source,
    })

    if (args.active) {
      const accountSubscription = await getCanonicalAccountSubscription(ctx, args.billingUserId)
      const walletPlan =
        accountSubscription?.plan === "startup" || accountSubscription?.plan === "enterprise"
          ? accountSubscription.plan
          : null

      if (walletPlan) {
        await grantIncludedWalletBalance(ctx, {
          organizationId: args.organizationId,
          targetUserId: args.assignedUserId,
          billingUserId: args.billingUserId,
          actorUserId: args.assignedByUserId ?? args.billingUserId,
          plan: walletPlan,
          cycle: accountSubscription?.cycle ?? "monthly",
          periodStart: accountSubscription?.currentPeriodStart,
          periodEnd: accountSubscription?.currentPeriodEnd,
          source: "seat_assignment",
          grantKey: `server-seat-assignment:${String(assignmentId)}:${Date.now()}`,
          metadata: {
            source: args.source,
          },
        })
      }
    }

    return assignmentId
  },
})

export const getSeatManagement = query({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const [organization, user] = await Promise.all([
      ctx.db.get(args.organizationId),
      ctx.db.get(args.userId),
    ])

    if (!organization) {
      throw new Error("Organization not found")
    }
    if (!user) {
      throw new Error("User not found")
    }

    const membership = await getCanonicalOrganizationMembership(
      ctx,
      args.organizationId,
      args.userId
    )
    if (!membership) {
      throw new Error("Unauthorized")
    }

    const billingAccount = await getCanonicalBillingAccountByOrganization(ctx, args.organizationId)
    const entitlement = await resolveAccountEntitlementForOrganization(ctx, {
      organization,
      user,
    })

    const [billingUser, billingAccountSubscription, viewerAccountSubscription, assignmentRows] = await Promise.all([
      billingAccount ? ctx.db.get(billingAccount.billingUserId) : Promise.resolve(null),
      billingAccount
        ? getCanonicalAccountSubscription(ctx, billingAccount.billingUserId)
        : Promise.resolve(null),
      getCanonicalAccountSubscription(ctx, args.userId),
      billingAccount
        ? ctx.db
            .query("accountSeatAssignments")
            .withIndex("by_billing_user_and_organization", (q) =>
              q
                .eq("billingUserId", billingAccount.billingUserId)
                .eq("organizationId", args.organizationId)
            )
            .collect()
        : Promise.resolve([] as Doc<"accountSeatAssignments">[]),
    ])

    const seatAssignments = [...assignmentRows]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .reduce<Doc<"accountSeatAssignments">[]>((acc, row) => {
        if (row.status !== "active") return acc
        const alreadyTracked = acc.some(
          (entry) => String(entry.assignedUserId) === String(row.assignedUserId)
        )
        if (!alreadyTracked) {
          acc.push(row)
        }
        return acc
      }, [])
      .sort((a, b) => a.assignedAt - b.assignedAt)

    const seatAssignmentsEnabled =
      billingAccountSubscription?.plan === "startup" ||
      billingAccountSubscription?.plan === "enterprise" ||
      entitlement.source === "trial"

    const canManageSeats = Boolean(
      seatAssignmentsEnabled &&
        billingAccount &&
        String(billingAccount.billingUserId) === String(args.userId) &&
        hasPermission(membership.role as Role, "org:manage_billing")
    )

    const accountSubscription = billingAccountSubscription ?? viewerAccountSubscription

    return {
      membershipRole: membership.role,
      canManageSeats,
      entitlement,
      billingAccount,
      billingUser: billingUser
        ? {
            _id: billingUser._id,
            email: billingUser.email,
            firstName: billingUser.firstName,
            lastName: billingUser.lastName,
            profileImageUrl: billingUser.profileImageUrl,
          }
        : null,
      accountSubscription: accountSubscription
        ? {
            _id: accountSubscription._id,
            accountUserId: accountSubscription.accountUserId,
            plan: accountSubscription.plan,
            status: accountSubscription.status,
            cycle: accountSubscription.cycle,
            seatQuantity: accountSubscription.seatQuantity,
            trialStart: accountSubscription.trialStart,
            trialEnd: accountSubscription.trialEnd,
            currentPeriodStart: accountSubscription.currentPeriodStart,
            currentPeriodEnd: accountSubscription.currentPeriodEnd,
            cancelAt: accountSubscription.cancelAt,
            canceledAt: accountSubscription.canceledAt,
            stripeCustomerId: accountSubscription.stripeCustomerId,
            stripeSubscriptionId: accountSubscription.stripeSubscriptionId,
            updatedAt: accountSubscription.updatedAt,
          }
        : null,
      seatAssignments: seatAssignments.map((assignment) => ({
        _id: assignment._id,
        organizationId: assignment.organizationId,
        billingUserId: assignment.billingUserId,
        assignedUserId: assignment.assignedUserId,
        assignedByUserId: assignment.assignedByUserId,
        source: assignment.source,
        status: assignment.status,
        assignedAt: assignment.assignedAt,
        revokedAt: assignment.revokedAt,
        updatedAt: assignment.updatedAt,
      })),
    }
  },
})

export const setSeatAssignment = mutation({
  args: {
    organizationId: v.id("organizations"),
    actorUserId: v.id("users"),
    assignedUserId: v.id("users"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const organization = await ctx.db.get(args.organizationId)
    if (!organization) {
      throw new Error("Organization not found")
    }

    const actorMembership = await getCanonicalOrganizationMembership(
      ctx,
      args.organizationId,
      args.actorUserId
    )
    if (
      !actorMembership ||
      !hasPermission(actorMembership.role as Role, "org:manage_billing")
    ) {
      throw new Error("Unauthorized")
    }

    const assignedMembership = await getCanonicalOrganizationMembership(
      ctx,
      args.organizationId,
      args.assignedUserId
    )
    if (!assignedMembership) {
      throw new Error("Assigned user is not a workspace member")
    }

    const billingAccount = await getCanonicalBillingAccountByOrganization(ctx, args.organizationId)
    if (!billingAccount) {
      throw new Error("Billing account is not configured for this workspace")
    }

    if (String(billingAccount.billingUserId) !== String(args.actorUserId)) {
      throw new Error("Only the billing owner can manage paid seats")
    }

    const billingUser = await ctx.db.get(billingAccount.billingUserId)
    if (!billingUser) {
      throw new Error("Billing owner user not found")
    }

    const existing = await getCanonicalSeatAssignment(
      ctx,
      billingAccount.billingUserId,
      args.organizationId,
      args.assignedUserId
    )

    if (!args.active && !existing) {
      return {
        success: true,
        assignmentId: null,
        noop: true,
      }
    }

    const ownerEntitlement = await resolveAccountEntitlementForOrganization(ctx, {
      organization,
      user: billingUser,
    })

    const seatAssignmentsEnabled =
      ownerEntitlement.plan === "startup" ||
      ownerEntitlement.plan === "enterprise" ||
      ownerEntitlement.source === "trial" ||
      ownerEntitlement.source === "legacy"

    if (!seatAssignmentsEnabled) {
      throw new Error(
        "Seat assignments are only available on Startup or Enterprise centralized billing."
      )
    }

    if (args.active) {
      const alreadyAssigned = Boolean(existing && existing.status === "active")
      const activatingOwnerImplicitSeat =
        String(args.assignedUserId) === String(billingAccount.billingUserId) &&
        !ownerEntitlement.seatCounts.ownerAssigned

      if (
        !alreadyAssigned &&
        !activatingOwnerImplicitSeat &&
        ownerEntitlement.seatCounts.available <= 0
      ) {
        throw new Error(
          "No paid seats are available. Increase your seat quantity before assigning another member."
        )
      }
    }

    const assignmentId = await upsertSeatAssignmentRecord(ctx, {
      organizationId: args.organizationId,
      billingUserId: billingAccount.billingUserId,
      assignedUserId: args.assignedUserId,
      assignedByUserId: args.actorUserId,
      active: args.active,
      source: "manual",
    })

    if (
      args.active &&
      (ownerEntitlement.source === "trial" ||
        ownerEntitlement.plan === "startup" ||
        ownerEntitlement.plan === "enterprise")
    ) {
      await grantIncludedWalletBalance(ctx, {
        organizationId: args.organizationId,
        targetUserId: args.assignedUserId,
        billingUserId: billingAccount.billingUserId,
        actorUserId: args.actorUserId,
        plan:
          ownerEntitlement.plan === "startup" || ownerEntitlement.plan === "enterprise"
            ? ownerEntitlement.plan
            : "startup",
        cycle: ownerEntitlement.cycle ?? "monthly",
        periodStart: ownerEntitlement.currentPeriodStart,
        periodEnd: ownerEntitlement.currentPeriodEnd,
        source: "seat_assignment",
        grantKey: `seat-assignment:${String(assignmentId)}:${Date.now()}`,
        metadata: {
          assignedByUserId: args.actorUserId,
          billingUserId: billingAccount.billingUserId,
          entitlementSource: ownerEntitlement.source,
        },
      })
    }

    await ctx.db.insert("auditLogs", {
      organizationId: args.organizationId,
      userId: args.actorUserId,
      action: args.active ? "billing.seat_assigned" : "billing.seat_revoked",
      resourceType: "accountSeatAssignment",
      resourceId: String(assignmentId),
      metadata: {
        billingUserId: billingAccount.billingUserId,
        assignedUserId: args.assignedUserId,
        active: args.active,
      },
      timestamp: Date.now(),
    })

    return {
      success: true,
      assignmentId,
      noop: false,
    }
  },
})

export const listAccountSeatAssignmentsForServer = query({
  args: {
    organizationId: v.id("organizations"),
    billingUserId: v.id("users"),
    includeRevoked: v.optional(v.boolean()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const rows = await ctx.db
      .query("accountSeatAssignments")
      .withIndex("by_billing_user_and_organization", (q) =>
        q.eq("billingUserId", args.billingUserId).eq("organizationId", args.organizationId)
      )
      .collect()

    const includeRevoked = args.includeRevoked === true
    return rows.filter((row) => includeRevoked || row.status === "active")
  },
})

export const getAccountEntitlementForServer = query({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const [organization, user] = await Promise.all([
      ctx.db.get(args.organizationId),
      ctx.db.get(args.userId),
    ])

    if (!organization) {
      throw new Error("Organization not found")
    }
    if (!user) {
      throw new Error("User not found")
    }

    return await resolveAccountEntitlementForOrganization(ctx, {
      organization,
      user,
    })
  },
})

export const getAccountEntitlementForProjectForServer = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const user = await ctx.db.get(args.userId)
    if (!user) {
      throw new Error("User not found")
    }

    return await resolveAccountEntitlementForProject(ctx, {
      projectId: args.projectId,
      user,
    })
  },
})
