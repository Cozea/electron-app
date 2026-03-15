import type { QueryCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { resolveOrganizationBillingSnapshot } from "./accountEntitlements"

/**
 * Get the member limit for a given plan.
 * Returns -1 for unlimited seat-based workspace plans.
 * Legacy `team` is treated as a compatibility alias for `startup`.
 */
export function getPlanMemberLimit(plan: string): number {
  switch (plan) {
    case "free":
      // Free is intentionally solo-only.
      return 1
    case "pro":
      // Pro
      return 2
    case "max":
      // Max
      return 10
    case "startup":
      return -1
    case "team":
      // Legacy alias for Startup workspaces.
      return -1
    case "enterprise":
      return -1
    default:
      return 1
  }
}

export interface SeatStatus {
  allowed: boolean
  current: number
  limit: number
  overLimit: boolean
  message?: string
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function dedupeMembersByUserId<T extends { userId: Id<"users"> }>(members: T[]): T[] {
  const byUser = new Map<string, T>()
  for (const member of members) {
    const key = String(member.userId)
    if (!byUser.has(key)) {
      byUser.set(key, member)
    }
  }
  return [...byUser.values()]
}

function dedupePendingInvitesByEmail<T extends { email: string; createdAt?: number }>(invites: T[]): T[] {
  const byEmail = new Map<string, T>()
  for (const invite of invites) {
    const key = normalizeEmail(invite.email)
    const existing = byEmail.get(key)
    if (!existing) {
      byEmail.set(key, invite)
      continue
    }
    if ((invite.createdAt || 0) >= (existing.createdAt || 0)) {
      byEmail.set(key, invite)
    }
  }
  return [...byEmail.values()]
}

/**
 * Check if an organization can add more members based on their subscription
 * Counts both active members and pending invitations
 */
export async function checkSeatLimit(
  ctx: QueryCtx,
  orgId: Id<"organizations">
): Promise<SeatStatus> {
  const org = await ctx.db.get(orgId)
  if (!org) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      overLimit: false,
      message: "Organization not found",
    }
  }

  const billingSnapshot = await resolveOrganizationBillingSnapshot(ctx, {
    organization: org,
  })
  const plan = billingSnapshot.plan
  const limit = getPlanMemberLimit(plan)

  // Team plan has unlimited members
  if (limit === -1) {
    // Still count members for display purposes
    const rawMembers = await ctx.db
      .query("members")
      .withIndex("by_organization", (q) => q.eq("organizationId", orgId))
      .collect()
    const members = dedupeMembersByUserId(rawMembers)

    return {
      allowed: true,
      current: members.length,
      limit: -1,
      overLimit: false,
    }
  }

  // Count active members
  const rawMembers = await ctx.db
    .query("members")
    .withIndex("by_organization", (q) => q.eq("organizationId", orgId))
    .collect()
  const members = dedupeMembersByUserId(rawMembers)

  // Count pending invitations
  const rawPendingInvites = await ctx.db
    .query("invitations")
    .withIndex("by_organization", (q) => q.eq("organizationId", orgId))
    .filter((q) => q.eq(q.field("status"), "pending"))
    .collect()
  const pendingInvites = dedupePendingInvitesByEmail(rawPendingInvites)

  const current = members.length + pendingInvites.length
  const overLimit = current > limit

  return {
    allowed: current < limit,
    current,
    limit,
    overLimit,
    message: overLimit
      ? `Over limit (${current}/${limit}). Remove members or upgrade your workspace plan to invite more.`
      : current >= limit
        ? `Seat limit reached (${current}/${limit}). Upgrade your workspace plan to add more members.`
        : undefined,
  }
}
