import { ConvexError } from "convex/values"

import type { Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { MAX_ORGANIZATION_USERS, MAX_PROJECT_USERS } from "../../shared/seatLimits"

type SeatCtx = Pick<QueryCtx | MutationCtx, "db">

/** Members plus invitations that have not expired: a seat is spoken for either way. */
export async function countProjectSeats(ctx: SeatCtx, projectId: Id<"projects">) {
  const members = await ctx.db.query("projectMembers")
    .withIndex("by_project", (q) => q.eq("projectId", projectId)).collect()
  const pending = await ctx.db.query("projectDeviceEnrollments")
    .withIndex("by_project_and_status", (q) => q.eq("projectId", projectId).eq("status", "pending"))
    .collect()
  const now = Date.now()
  return {
    used: members.length + pending.filter((row) => row.expiresAt > now).length,
    limit: MAX_PROJECT_USERS,
  }
}

export async function requireProjectSeats(ctx: SeatCtx, projectId: Id<"projects">, wanted = 1) {
  const { used, limit } = await countProjectSeats(ctx, projectId)
  if (used + wanted > limit) {
    throw new ConvexError(
      `This project is limited to ${limit} devices, and ${used} of them are taken. Remove someone, or cancel a pending invitation, to make room.`,
    )
  }
}

export async function countOrganizationSeats(ctx: SeatCtx, organizationId: Id<"organizations">) {
  const members = await ctx.db.query("organizationMembers")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).collect()
  const pending = await ctx.db.query("organizationDeviceEnrollments")
    .withIndex("by_organization_and_status", (q) =>
      q.eq("organizationId", organizationId).eq("status", "pending"))
    .collect()
  const now = Date.now()
  return {
    used: members.length + pending.filter((row) => row.expiresAt > now).length,
    limit: MAX_ORGANIZATION_USERS,
  }
}

export async function requireOrganizationSeats(
  ctx: SeatCtx,
  organizationId: Id<"organizations">,
  wanted = 1,
) {
  const { used, limit } = await countOrganizationSeats(ctx, organizationId)
  if (used + wanted > limit) {
    throw new ConvexError(
      `This group is limited to ${limit} devices, and ${used} of them are taken. Remove someone, or cancel a pending invitation, to make room.`,
    )
  }
}
