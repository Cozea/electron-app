import { mutation, query, internalMutation } from "./_generated/server"
import { v } from "convex/values"
import { hasPermission, type Role } from "./lib/permissions"
import { checkSeatLimit } from "./lib/seatLimits"

// Generate a cryptographically secure random token.
function generateToken(): string {
  const uuid1 = crypto.randomUUID().replace(/-/g, "")
  const uuid2 = crypto.randomUUID().replace(/-/g, "")
  return (uuid1 + uuid2).slice(0, 48)
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function rolePriority(role: "admin" | "member" | "viewer"): number {
  switch (role) {
    case "admin":
      return 3
    case "member":
      return 2
    default:
      return 1
  }
}

function pickCanonicalMembership<
  T extends { role: "admin" | "member" | "viewer"; updatedAt?: number; joinedAt?: number; _id: unknown },
>(memberships: T[]): T | null {
  if (memberships.length === 0) return null
  return [...memberships].sort((a, b) => {
    const roleDelta = rolePriority(b.role) - rolePriority(a.role)
    if (roleDelta !== 0) return roleDelta
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    const joinedDelta = (b.joinedAt || 0) - (a.joinedAt || 0)
    if (joinedDelta !== 0) return joinedDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

// Invite a user to an organization.
export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    invitedBy: v.id("users"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member"), v.literal("viewer")),
    workosInvitationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const seatCheck = await checkSeatLimit(ctx, args.orgId)
    if (!seatCheck.allowed) {
      throw new Error(seatCheck.message || "Seat limit reached")
    }

    const inviterMemberships = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.orgId).eq("userId", args.invitedBy)
      )
      .collect()
    const inviterMembership = pickCanonicalMembership(inviterMemberships)

    if (!inviterMembership || !hasPermission(inviterMembership.role as Role, "invitations:send")) {
      throw new Error("Unauthorized to invite members")
    }

    // Check if user is already a member using normalized email matching.
    const normalizedInviteEmail = normalizeEmail(args.email)
    const byNormalizedEmail = await ctx.db
      .query("users")
      .withIndex("by_normalized_email", (q) => q.eq("normalizedEmail", normalizedInviteEmail))
      .collect()
    const byExactEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect()

    const candidateUsers = new Map<string, (typeof byNormalizedEmail)[number]>()
    for (const user of byNormalizedEmail) {
      candidateUsers.set(String(user._id), user)
    }
    for (const user of byExactEmail) {
      candidateUsers.set(String(user._id), user)
    }

    for (const user of candidateUsers.values()) {
      const memberships = await ctx.db
        .query("members")
        .withIndex("by_organization_and_user", (q) =>
          q.eq("organizationId", args.orgId).eq("userId", user._id)
        )
        .collect()
      if (pickCanonicalMembership(memberships)) {
        throw new Error("User is already a member of this organization")
      }
    }

    // Prevent duplicate pending invites for the same normalized email.
    const pendingInvites = await ctx.db
      .query("invitations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect()
    const duplicatePendingInvite = pendingInvites.find(
      (invite) => normalizeEmail(invite.email) === normalizedInviteEmail
    )
    if (duplicatePendingInvite) {
      throw new Error("Invitation already pending for this email")
    }

    const now = Date.now()
    const token = generateToken()

    const invitationId = await ctx.db.insert("invitations", {
      organizationId: args.orgId,
      email: args.email,
      role: args.role,
      invitedBy: args.invitedBy,
      token,
      workosInvitationId: args.workosInvitationId,
      status: "pending",
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      createdAt: now,
    })

    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.invitedBy,
      action: "member.invited",
      resourceType: "invitation",
      resourceId: invitationId,
      metadata: { email: args.email, role: args.role },
      timestamp: now,
    })

    return { invitationId, token }
  },
})

// Legacy Convex token acceptance is retired. WorkOS invite acceptance is authoritative.
export const accept = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async () => {
    throw new Error(
      "legacy_invitation_accept_disabled: WorkOS is the authority for membership acceptance. Ask an admin to resend the WorkOS invite."
    )
  },
})

// Get pending invitations for an organization (excludes expired).
export const listForOrganization = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db
      .query("invitations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .filter((q) =>
        q.and(q.eq(q.field("status"), "pending"), q.gt(q.field("expiresAt"), now))
      )
      .collect()
  },
})

// Get invitation by token.
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first()

    if (!invitation) return null

    const org = await ctx.db.get(invitation.organizationId)
    return {
      ...invitation,
      organization: org ? { name: org.name, slug: org.slug } : null,
    }
  },
})

// Revoke an invitation.
export const revoke = mutation({
  args: {
    invitationId: v.id("invitations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId)
    if (!invitation) {
      throw new Error("Invitation not found")
    }

    const memberships = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", invitation.organizationId).eq("userId", args.userId)
      )
      .collect()
    const membership = pickCanonicalMembership(memberships)
    if (!membership || !hasPermission(membership.role as Role, "invitations:revoke")) {
      throw new Error("Unauthorized")
    }

    await ctx.db.delete(args.invitationId)

    await ctx.db.insert("auditLogs", {
      organizationId: invitation.organizationId,
      userId: args.userId,
      action: "invitation.revoked",
      resourceType: "invitation",
      resourceId: args.invitationId,
      metadata: { email: invitation.email },
      timestamp: Date.now(),
    })
  },
})

// Internal: clean up expired invitations (called by cron job).
export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const expiredInvitations = await ctx.db
      .query("invitations")
      .filter((q) => q.and(q.eq(q.field("status"), "pending"), q.lt(q.field("expiresAt"), now)))
      .collect()

    for (const invitation of expiredInvitations) {
      await ctx.db.patch(invitation._id, { status: "expired" })
    }

    return { cleaned: expiredInvitations.length }
  },
})
