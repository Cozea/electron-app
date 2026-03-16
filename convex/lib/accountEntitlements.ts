import type { Id, Doc, TableNames } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

type BillingCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">

export type AccountSubscriptionPlan = "free" | "pro" | "max" | "startup" | "enterprise"
export type AccountSubscriptionStatus = "active" | "canceled" | "past_due" | "trialing"
type OrganizationSeatManagedPlan = "startup" | "enterprise"

const PAST_DUE_GRACE_MS = 14 * 24 * 60 * 60 * 1000
export type AccountBillingCycle = "monthly" | "yearly"
export type EntitlementSource = "account" | "legacy" | "trial" | "free"
const PERSONAL_WORKSPACE_PREFIX = "personal:"

export const ACCOUNT_MIN_STARTUP_SEATS = 2
export const ACCOUNT_TRIAL_LENGTH_MS = 7 * 24 * 60 * 60 * 1000

interface AccountSubscriptionRecord {
  _id: string
  accountUserId: Id<"users">
  plan: AccountSubscriptionPlan
  status: AccountSubscriptionStatus
  cycle?: AccountBillingCycle
  seatQuantity?: number
  trialStart?: number
  trialEnd?: number
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  stripePriceId?: string
  stripeProductId?: string
  currentPeriodStart?: number
  currentPeriodEnd?: number
  cancelAt?: number
  canceledAt?: number
  legacyOrganizationId?: Id<"organizations">
  createdAt: number
  updatedAt: number
}

interface OrganizationBillingAccountRecord {
  _id: string
  organizationId: Id<"organizations">
  billingUserId: Id<"users">
  mode: "account"
  migratedFromLegacyWorkspaceBilling?: boolean
  createdAt: number
  updatedAt: number
}

interface AccountSeatAssignmentRecord {
  _id: string
  organizationId: Id<"organizations">
  billingUserId: Id<"users">
  assignedUserId: Id<"users">
  assignedByUserId?: Id<"users">
  source?: "owner_auto" | "manual" | "migration"
  status: "active" | "revoked"
  assignedAt: number
  revokedAt?: number
  updatedAt: number
}

export interface AccountEntitlement {
  source: EntitlementSource
  organizationId: Id<"organizations">
  userId: Id<"users">
  billingUserId: Id<"users"> | null
  plan: AccountSubscriptionPlan
  status: AccountSubscriptionStatus
  cycle?: AccountBillingCycle
  trialActive: boolean
  hasPaidSeat: boolean
  canUseAi: boolean
  canUseSync: boolean
  seatCounts: {
    total: number
    assigned: number
    available: number
    minimum: number
    userAssigned: boolean
    ownerAssigned: boolean
  }
  legacyWorkspacePlan?: string
  trialEndsAt?: number
  currentPeriodStart?: number
  currentPeriodEnd?: number
  stripeSubscriptionId?: string
  stripeCustomerId?: string
}

export interface OrganizationBillingSnapshot {
  source: "account" | "legacy" | "free"
  organizationId: Id<"organizations">
  billingUserId: Id<"users"> | null
  plan: AccountSubscriptionPlan
  status: AccountSubscriptionStatus
  cycle?: AccountBillingCycle
  trialActive: boolean
  trialEndsAt?: number
  currentPeriodStart?: number
  currentPeriodEnd?: number
  stripeSubscriptionId?: string
  stripeCustomerId?: string
  seatQuantity?: number
  legacyWorkspacePlan?: string
}

function queryTable<TableName extends TableNames>(ctx: BillingCtx, tableName: TableName) {
  return ctx.db.query(tableName)
}

function normalizeAccountPlan(plan: string | undefined | null): AccountSubscriptionPlan {
  if (plan === "pro" || plan === "max" || plan === "startup" || plan === "enterprise") {
    return plan
  }
  if (plan === "team") {
    return "startup"
  }
  return "free"
}

function normalizeOrganizationSeatManagedPlan(
  plan: AccountSubscriptionPlan | undefined | null
): OrganizationSeatManagedPlan | null {
  if (plan === "enterprise") {
    return "enterprise"
  }
  if (plan === "startup" || plan === "pro" || plan === "max") {
    return "startup"
  }
  return null
}

function isIndividualPlan(plan: AccountSubscriptionPlan): plan is "pro" | "max" {
  return plan === "pro" || plan === "max"
}

function isPersonalWorkspaceOrganization(organization: Doc<"organizations">): boolean {
  return organization.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)
}

function normalizeStartupSeats(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return ACCOUNT_MIN_STARTUP_SEATS
  }
  return Math.max(ACCOUNT_MIN_STARTUP_SEATS, Math.floor(value))
}

export function normalizeStartupSeatQuantity(value: number | undefined): number {
  return normalizeStartupSeats(value)
}

function isLegacySubscriptionEntitled(
  subscription: Doc<"organizations">["subscription"]
): boolean {
  if (!subscription) return false
  if (subscription.plan === "free") return false
  return subscription.status === "active" || subscription.status === "trialing"
}

export function isAccountStatusEntitled(status: AccountSubscriptionStatus): boolean {
  return status === "active" || status === "trialing"
}

function resolveEffectiveAccountStatus(
  subscription: AccountSubscriptionRecord,
  now: number
): AccountSubscriptionStatus {
  if (subscription.status !== "past_due") {
    return subscription.status
  }

  const pastDueAnchor =
    subscription.currentPeriodEnd ??
    subscription.updatedAt ??
    subscription.createdAt

  if (typeof pastDueAnchor !== "number") {
    return subscription.status
  }

  return now >= pastDueAnchor + PAST_DUE_GRACE_MS ? "canceled" : "past_due"
}

function dedupeActiveAssignments(
  assignments: AccountSeatAssignmentRecord[]
): AccountSeatAssignmentRecord[] {
  const byUser = new Map<string, AccountSeatAssignmentRecord>()
  const ordered = [...assignments].sort((a, b) => {
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    return String(a._id).localeCompare(String(b._id))
  })

  for (const assignment of ordered) {
    if (assignment.status !== "active") continue
    const key = String(assignment.assignedUserId)
    if (!byUser.has(key)) {
      byUser.set(key, assignment)
    }
  }

  return [...byUser.values()]
}

async function getOrganizationBillingAccountRecord(
  ctx: BillingCtx,
  organizationId: Id<"organizations">
): Promise<OrganizationBillingAccountRecord | null> {
  const rows = await queryTable(ctx, "organizationBillingAccounts")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect()

  if (rows.length === 0) return null

  const canonical = [...rows].sort((a, b) => {
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]

  return canonical as OrganizationBillingAccountRecord
}

async function getAccountSubscriptionRecord(
  ctx: BillingCtx,
  accountUserId: Id<"users">
): Promise<AccountSubscriptionRecord | null> {
  const rows = await queryTable(ctx, "accountSubscriptions")
    .withIndex("by_account_user", (q) => q.eq("accountUserId", accountUserId))
    .collect()

  if (rows.length === 0) return null

  const canonical = [...rows].sort((a, b) => {
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]

  return canonical as AccountSubscriptionRecord
}

async function getUserByWorkosId(
  ctx: BillingCtx,
  workosId: string
): Promise<Doc<"users"> | null> {
  const user = await queryTable(ctx, "users")
    .withIndex("by_workos_id", (q) => q.eq("workosId", workosId))
    .first()

  return (user as Doc<"users"> | null) ?? null
}

async function listActiveSeatAssignments(
  ctx: BillingCtx,
  billingUserId: Id<"users">,
  organizationId: Id<"organizations">
): Promise<AccountSeatAssignmentRecord[]> {
  const rows = await queryTable(ctx, "accountSeatAssignments")
    .withIndex("by_billing_user_and_organization", (q) =>
      q.eq("billingUserId", billingUserId).eq("organizationId", organizationId)
    )
    .collect()

  return dedupeActiveAssignments(rows as AccountSeatAssignmentRecord[])
}

async function countOrganizationMembers(
  ctx: BillingCtx,
  organizationId: Id<"organizations">
): Promise<number> {
  const members = await ctx.db
    .query("members")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect()

  const uniqueUsers = new Set(members.map((member) => String(member.userId)))
  return uniqueUsers.size
}

function resolveSubscriptionTrialState(
  subscription: AccountSubscriptionRecord,
  now: number
): { trialActive: boolean; trialEndsAt?: number } {
  const trialEnd =
    subscription.trialEnd ??
    ((typeof subscription.trialStart === "number" ? subscription.trialStart : subscription.createdAt) +
      ACCOUNT_TRIAL_LENGTH_MS)

  if (subscription.status !== "trialing" || typeof trialEnd !== "number") {
    return { trialActive: false, trialEndsAt: trialEnd }
  }

  return {
    trialActive: now < trialEnd,
    trialEndsAt: trialEnd,
  }
}

function buildSeatEntitlement(args: {
  source: EntitlementSource
  organizationId: Id<"organizations">
  userId: Id<"users">
  billingUserId: Id<"users">
  plan: OrganizationSeatManagedPlan
  status: AccountSubscriptionStatus
  cycle?: AccountBillingCycle
  totalSeats: number
  assignments: AccountSeatAssignmentRecord[]
  currentPeriodStart?: number
  currentPeriodEnd?: number
  stripeSubscriptionId?: string
  stripeCustomerId?: string
  trialActive: boolean
  trialEndsAt?: number
}): AccountEntitlement {
  const entitledStatus = isAccountStatusEntitled(args.status)
  const assignedUserIds = new Set(args.assignments.map((assignment) => String(assignment.assignedUserId)))
  const userAssigned = assignedUserIds.has(String(args.userId))
  const ownerAssigned = assignedUserIds.has(String(args.billingUserId))
  const ownerImplicitSeatCount = !ownerAssigned && entitledStatus ? 1 : 0
  const effectiveAssigned = args.assignments.length + ownerImplicitSeatCount

  const hasPaidSeat =
    entitledStatus &&
    (userAssigned || (String(args.userId) === String(args.billingUserId) && !ownerAssigned))

  return {
    source: args.source,
    organizationId: args.organizationId,
    userId: args.userId,
    billingUserId: args.billingUserId,
    plan: args.plan,
    status: args.status,
    cycle: args.cycle,
    trialActive: args.trialActive,
    hasPaidSeat,
    canUseAi: hasPaidSeat,
    canUseSync: hasPaidSeat,
    seatCounts: {
      total: args.totalSeats,
      assigned: effectiveAssigned,
      available: Math.max(0, args.totalSeats - effectiveAssigned),
      minimum: ACCOUNT_MIN_STARTUP_SEATS,
      userAssigned,
      ownerAssigned,
    },
    trialEndsAt: args.trialEndsAt,
    currentPeriodStart: args.currentPeriodStart,
    currentPeriodEnd: args.currentPeriodEnd,
    stripeSubscriptionId: args.stripeSubscriptionId,
    stripeCustomerId: args.stripeCustomerId,
  }
}

function buildIndividualEntitlement(args: {
  source: EntitlementSource
  organizationId: Id<"organizations">
  userId: Id<"users">
  billingUserId: Id<"users"> | null
  plan: "pro" | "max"
  status: AccountSubscriptionStatus
  cycle?: AccountBillingCycle
  allowAccess: boolean
  currentPeriodStart?: number
  currentPeriodEnd?: number
  stripeSubscriptionId?: string
  stripeCustomerId?: string
  trialActive: boolean
  trialEndsAt?: number
}): AccountEntitlement {
  return {
    source: args.source,
    organizationId: args.organizationId,
    userId: args.userId,
    billingUserId: args.billingUserId,
    plan: args.plan,
    status: args.status,
    cycle: args.cycle,
    trialActive: args.trialActive,
    hasPaidSeat: false,
    canUseAi: args.allowAccess,
    canUseSync: args.allowAccess,
    seatCounts: {
      total: 0,
      assigned: 0,
      available: 0,
      minimum: 0,
      userAssigned: false,
      ownerAssigned: false,
    },
    trialEndsAt: args.trialEndsAt,
    currentPeriodStart: args.currentPeriodStart,
    currentPeriodEnd: args.currentPeriodEnd,
    stripeSubscriptionId: args.stripeSubscriptionId,
    stripeCustomerId: args.stripeCustomerId,
  }
}

function mapLegacyStatus(status: Doc<"organizations">["subscription"]["status"]): AccountSubscriptionStatus {
  if (status === "canceled") return "canceled"
  if (status === "past_due") return "past_due"
  if (status === "trialing") return "trialing"
  return "active"
}

function resolveWorkspaceSnapshotPlan(
  organization: Doc<"organizations">,
  normalizedPlan: AccountSubscriptionPlan
): AccountSubscriptionPlan {
  if (isPersonalWorkspaceOrganization(organization)) {
    return normalizedPlan
  }

  return normalizeOrganizationSeatManagedPlan(normalizedPlan) ?? "free"
}

export async function resolveOrganizationBillingSnapshot(
  ctx: BillingCtx,
  args: {
    organization: Doc<"organizations">
  }
): Promise<OrganizationBillingSnapshot> {
  const now = Date.now()
  const { organization } = args
  const organizationId = organization._id
  const personalWorkspace = isPersonalWorkspaceOrganization(organization)
  const billingAccount = await getOrganizationBillingAccountRecord(ctx, organizationId)

  if (billingAccount) {
    const billingSubscription = await getAccountSubscriptionRecord(ctx, billingAccount.billingUserId)
    if (billingSubscription) {
      const normalizedPlan = normalizeAccountPlan(billingSubscription.plan)
      const resolvedPlan = resolveWorkspaceSnapshotPlan(organization, normalizedPlan)
      const effectiveStatus = resolveEffectiveAccountStatus(billingSubscription, now)
      const trialState = resolveSubscriptionTrialState(billingSubscription, now)

      return {
        source: "account",
        organizationId,
        billingUserId: billingAccount.billingUserId,
        plan: resolvedPlan,
        status: effectiveStatus,
        cycle: billingSubscription.cycle,
        trialActive: trialState.trialActive,
        trialEndsAt: trialState.trialEndsAt,
        currentPeriodStart: billingSubscription.currentPeriodStart,
        currentPeriodEnd: billingSubscription.currentPeriodEnd,
        stripeSubscriptionId: billingSubscription.stripeSubscriptionId,
        stripeCustomerId: billingSubscription.stripeCustomerId,
        seatQuantity:
          !personalWorkspace && resolvedPlan !== "free"
            ? normalizeStartupSeats(billingSubscription.seatQuantity)
            : undefined,
      }
    }
  }

  if (personalWorkspace) {
    const ownerWorkosId = organization.workosId.slice(PERSONAL_WORKSPACE_PREFIX.length)
    if (ownerWorkosId) {
      const ownerUser = await getUserByWorkosId(ctx, ownerWorkosId)
      if (ownerUser) {
        const ownerSubscription = await getAccountSubscriptionRecord(ctx, ownerUser._id)
        if (ownerSubscription) {
          const normalizedPlan = normalizeAccountPlan(ownerSubscription.plan)
          const effectiveStatus = resolveEffectiveAccountStatus(ownerSubscription, now)
          const trialState = resolveSubscriptionTrialState(ownerSubscription, now)

          return {
            source: "account",
            organizationId,
            billingUserId: ownerUser._id,
            plan: normalizedPlan,
            status: effectiveStatus,
            cycle: ownerSubscription.cycle,
            trialActive: trialState.trialActive,
            trialEndsAt: trialState.trialEndsAt,
            currentPeriodStart: ownerSubscription.currentPeriodStart,
            currentPeriodEnd: ownerSubscription.currentPeriodEnd,
            stripeSubscriptionId: ownerSubscription.stripeSubscriptionId,
            stripeCustomerId: ownerSubscription.stripeCustomerId,
          }
        }
      }
    }
  }

  if (organization.subscription && organization.subscription.plan !== "free") {
    const normalizedPlan = normalizeAccountPlan(organization.subscription.plan)
    const resolvedPlan = resolveWorkspaceSnapshotPlan(organization, normalizedPlan)

    return {
      source: "legacy",
      organizationId,
      billingUserId: null,
      plan: resolvedPlan,
      status: mapLegacyStatus(organization.subscription.status),
      trialActive: organization.subscription.status === "trialing",
      currentPeriodStart: organization.subscription.currentPeriodStart,
      currentPeriodEnd: organization.subscription.currentPeriodEnd,
      stripeSubscriptionId: organization.subscription.stripeSubscriptionId,
      stripeCustomerId: organization.subscription.stripeCustomerId,
      seatQuantity:
        !personalWorkspace &&
        typeof organization.subscription.seatCount === "number" &&
        Number.isFinite(organization.subscription.seatCount)
          ? Math.max(1, Math.floor(organization.subscription.seatCount))
          : undefined,
      legacyWorkspacePlan: organization.subscription.plan,
    }
  }

  return {
    source: "free",
    organizationId,
    billingUserId: billingAccount?.billingUserId ?? null,
    plan: "free",
    status: "active",
    trialActive: false,
  }
}

export async function resolveAccountEntitlementForOrganization(
  ctx: BillingCtx,
  args: {
    organization: Doc<"organizations">
    user: Doc<"users">
  }
): Promise<AccountEntitlement> {
  const now = Date.now()
  const { organization, user } = args
  const organizationId = organization._id
  const userId = user._id
  const personalWorkspace = isPersonalWorkspaceOrganization(organization)

  const [billingAccount, userSubscription] = await Promise.all([
    getOrganizationBillingAccountRecord(ctx, organizationId),
    getAccountSubscriptionRecord(ctx, userId),
  ])

  if (billingAccount) {
    const billingUserId = billingAccount.billingUserId

    const [billingSubscription, assignments] = await Promise.all([
      getAccountSubscriptionRecord(ctx, billingUserId),
      listActiveSeatAssignments(ctx, billingUserId, organizationId),
    ])

    if (billingSubscription) {
      const normalizedPlan = normalizeAccountPlan(billingSubscription.plan)
      const organizationSeatPlan = personalWorkspace
        ? null
        : normalizeOrganizationSeatManagedPlan(normalizedPlan)
      const effectiveBillingStatus = resolveEffectiveAccountStatus(billingSubscription, now)
      const entitledStatus = isAccountStatusEntitled(effectiveBillingStatus)
      const trialState = resolveSubscriptionTrialState(billingSubscription, now)

      let workspaceEntitlement: AccountEntitlement
      if (organizationSeatPlan) {
        workspaceEntitlement = buildSeatEntitlement({
          source: "account",
          organizationId,
          userId,
          billingUserId,
          plan: organizationSeatPlan,
          status: effectiveBillingStatus,
          cycle: billingSubscription.cycle,
          totalSeats: normalizeStartupSeats(billingSubscription.seatQuantity),
          assignments,
          trialActive: trialState.trialActive,
          trialEndsAt: trialState.trialEndsAt,
          currentPeriodStart: billingSubscription.currentPeriodStart,
          currentPeriodEnd: billingSubscription.currentPeriodEnd,
          stripeSubscriptionId: billingSubscription.stripeSubscriptionId,
          stripeCustomerId: billingSubscription.stripeCustomerId,
        })
      } else if (personalWorkspace && isIndividualPlan(normalizedPlan)) {
        const isBillingUser = String(userId) === String(billingUserId)
        workspaceEntitlement = buildIndividualEntitlement({
          source: "account",
          organizationId,
          userId,
          billingUserId,
          plan: normalizedPlan,
          status: effectiveBillingStatus,
          cycle: billingSubscription.cycle,
          allowAccess: entitledStatus && isBillingUser,
          trialActive: trialState.trialActive,
          trialEndsAt: trialState.trialEndsAt,
          currentPeriodStart: billingSubscription.currentPeriodStart,
          currentPeriodEnd: billingSubscription.currentPeriodEnd,
          stripeSubscriptionId: billingSubscription.stripeSubscriptionId,
          stripeCustomerId: billingSubscription.stripeCustomerId,
        })
      } else {
        workspaceEntitlement = {
          source: "free",
          organizationId,
          userId,
          billingUserId,
          plan: "free",
          status: "active",
          trialActive: false,
          hasPaidSeat: false,
          canUseAi: false,
          canUseSync: false,
          seatCounts: {
            total: 0,
            assigned: 0,
            available: 0,
            minimum: 0,
            userAssigned: false,
            ownerAssigned: false,
          },
        }
      }

      if (workspaceEntitlement.canUseAi) {
        return workspaceEntitlement
      }

      if (personalWorkspace && String(userId) !== String(billingUserId) && userSubscription) {
        const userPlan = normalizeAccountPlan(userSubscription.plan)
        if (isIndividualPlan(userPlan)) {
          const userTrialState = resolveSubscriptionTrialState(userSubscription, now)
          const effectiveUserStatus = resolveEffectiveAccountStatus(userSubscription, now)
          return buildIndividualEntitlement({
            source: "account",
            organizationId,
            userId,
            billingUserId: userId,
            plan: userPlan,
            status: effectiveUserStatus,
            cycle: userSubscription.cycle,
            allowAccess: isAccountStatusEntitled(effectiveUserStatus),
            trialActive: userTrialState.trialActive,
            trialEndsAt: userTrialState.trialEndsAt,
            currentPeriodStart: userSubscription.currentPeriodStart,
            currentPeriodEnd: userSubscription.currentPeriodEnd,
            stripeSubscriptionId: userSubscription.stripeSubscriptionId,
            stripeCustomerId: userSubscription.stripeCustomerId,
          })
        }
      }

      return workspaceEntitlement
    }

    return {
      source: "free",
      organizationId,
      userId,
      billingUserId,
      plan: "free",
      status: "active",
      trialActive: false,
      hasPaidSeat: false,
      canUseAi: false,
      canUseSync: false,
      seatCounts: {
        total: 0,
        assigned: assignments.length,
        available: 0,
        minimum: ACCOUNT_MIN_STARTUP_SEATS,
        userAssigned: assignments.some(
          (assignment) => String(assignment.assignedUserId) === String(userId)
        ),
        ownerAssigned: assignments.some(
          (assignment) => String(assignment.assignedUserId) === String(billingUserId)
        ),
      },
    }
  }

  if (personalWorkspace && userSubscription) {
    const userPlan = normalizeAccountPlan(userSubscription.plan)
    if (isIndividualPlan(userPlan)) {
      const trialState = resolveSubscriptionTrialState(userSubscription, now)
      const effectiveUserStatus = resolveEffectiveAccountStatus(userSubscription, now)
      return buildIndividualEntitlement({
        source: "account",
        organizationId,
        userId,
        billingUserId: userId,
        plan: userPlan,
        status: effectiveUserStatus,
        cycle: userSubscription.cycle,
        allowAccess: isAccountStatusEntitled(effectiveUserStatus),
        trialActive: trialState.trialActive,
        trialEndsAt: trialState.trialEndsAt,
        currentPeriodStart: userSubscription.currentPeriodStart,
        currentPeriodEnd: userSubscription.currentPeriodEnd,
        stripeSubscriptionId: userSubscription.stripeSubscriptionId,
        stripeCustomerId: userSubscription.stripeCustomerId,
      })
    }
  }

  if (organization.subscription && organization.subscription.plan !== "free") {
    const memberCount = await countOrganizationMembers(ctx, organizationId)
    const legacyPlan = normalizeAccountPlan(organization.subscription.plan)
    const legacyOrganizationSeatPlan = personalWorkspace
      ? null
      : normalizeOrganizationSeatManagedPlan(legacyPlan)
    const legacyStatus = mapLegacyStatus(organization.subscription.status)
    const legacyEntitled = isLegacySubscriptionEntitled(organization.subscription)

    if (legacyOrganizationSeatPlan) {
      const legacySeatCount =
        typeof organization.subscription.seatCount === "number" &&
        Number.isFinite(organization.subscription.seatCount)
          ? Math.max(1, Math.floor(organization.subscription.seatCount))
          : Math.max(1, memberCount)

      return {
        source: "legacy",
        organizationId,
        userId,
        billingUserId: null,
        plan: legacyOrganizationSeatPlan,
        status: legacyStatus,
        trialActive: organization.subscription.status === "trialing",
        hasPaidSeat: legacyEntitled,
        canUseAi: legacyEntitled,
        canUseSync: legacyEntitled,
        seatCounts: {
          total: legacySeatCount,
          assigned: memberCount,
          available: Math.max(0, legacySeatCount - memberCount),
          minimum: ACCOUNT_MIN_STARTUP_SEATS,
          userAssigned: true,
          ownerAssigned: false,
        },
        legacyWorkspacePlan: organization.subscription.plan,
        currentPeriodStart: organization.subscription.currentPeriodStart,
        currentPeriodEnd: organization.subscription.currentPeriodEnd,
        stripeSubscriptionId: organization.subscription.stripeSubscriptionId,
        stripeCustomerId: organization.subscription.stripeCustomerId,
      }
    }

    if (personalWorkspace && (legacyPlan === "pro" || legacyPlan === "max")) {
      return {
        source: "legacy",
        organizationId,
        userId,
        billingUserId: null,
        plan: legacyPlan,
        status: legacyStatus,
        cycle: "monthly",
        trialActive: organization.subscription.status === "trialing",
        hasPaidSeat: false,
        canUseAi: legacyEntitled,
        canUseSync: legacyEntitled,
        seatCounts: {
          total: 0,
          assigned: 0,
          available: 0,
          minimum: 0,
          userAssigned: false,
          ownerAssigned: false,
        },
        legacyWorkspacePlan: organization.subscription.plan,
        currentPeriodStart: organization.subscription.currentPeriodStart,
        currentPeriodEnd: organization.subscription.currentPeriodEnd,
        stripeSubscriptionId: organization.subscription.stripeSubscriptionId,
        stripeCustomerId: organization.subscription.stripeCustomerId,
      }
    }
  }

  return {
    source: "free",
    organizationId,
    userId,
    billingUserId: null,
    plan: "free",
    status: "active",
    trialActive: false,
    hasPaidSeat: false,
    canUseAi: false,
    canUseSync: false,
    seatCounts: {
      total: 0,
      assigned: 0,
      available: 0,
      minimum: 0,
      userAssigned: false,
      ownerAssigned: false,
    },
  }
}

export async function resolveAccountEntitlementForProject(
  ctx: BillingCtx,
  args: {
    projectId: Id<"projects">
    user: Doc<"users">
  }
): Promise<AccountEntitlement & { projectId: Id<"projects"> }> {
  const project = await ctx.db.get(args.projectId)
  if (!project) {
    throw new Error("Project not found")
  }

  const organization = await ctx.db.get(project.organizationId)
  if (!organization) {
    throw new Error("Organization not found")
  }

  const entitlement = await resolveAccountEntitlementForOrganization(ctx, {
    organization,
    user: args.user,
  })

  return {
    ...entitlement,
    projectId: project._id,
  }
}
