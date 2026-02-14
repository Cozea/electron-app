import type { QueryCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"

/**
 * Get the member limit for a given plan
 * Returns -1 for unlimited (team plan)
 */
export function getPlanMemberLimit(plan: string): number {
  switch (plan) {
    case "free":
      // Free is intentionally solo-only.
      return 1
    case "pro":
      // Power Duo
      return 2
    case "max":
      // Winning Team
      return 10
    case "team":
      // Legacy "team" is treated as custom.
      return -1
    case "enterprise":
      // Custom
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

  const plan = org.subscription.plan
  const limit = getPlanMemberLimit(plan)

  // Team plan has unlimited members
  if (limit === -1) {
    // Still count members for display purposes
    const members = await ctx.db
      .query("members")
      .withIndex("by_organization", (q) => q.eq("organizationId", orgId))
      .collect()

    return {
      allowed: true,
      current: members.length,
      limit: -1,
      overLimit: false,
    }
  }

  // Count active members
  const members = await ctx.db
    .query("members")
    .withIndex("by_organization", (q) => q.eq("organizationId", orgId))
    .collect()

  // Count pending invitations
  const pendingInvites = await ctx.db
    .query("invitations")
    .withIndex("by_organization", (q) => q.eq("organizationId", orgId))
    .filter((q) => q.eq(q.field("status"), "pending"))
    .collect()

  const current = members.length + pendingInvites.length
  const overLimit = current > limit

  return {
    allowed: current < limit,
    current,
    limit,
    overLimit,
    message: overLimit
      ? `Over limit (${current}/${limit}). Remove members or upgrade to invite more.`
      : current >= limit
        ? `Seat limit reached (${current}/${limit}). Upgrade your plan to add more members.`
        : undefined,
  }
}
