import { mutation, query, internalMutation } from "./_generated/server"
import { v } from "convex/values"
import { hasPermission, type Role } from "./lib/permissions"
import { checkSeatLimit } from "./lib/seatLimits"

// Generate a cryptographically secure random token
function generateToken(): string {
  // Use crypto.randomUUID() which provides cryptographically secure random values
  // Generate two UUIDs and combine for a 64-char token (removing hyphens)
  const uuid1 = crypto.randomUUID().replace(/-/g, '')
  const uuid2 = crypto.randomUUID().replace(/-/g, '')
  return (uuid1 + uuid2).slice(0, 48) // 48 chars of cryptographic randomness
}

// Invite a user to an organization
export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    invitedBy: v.id("users"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member"), v.literal("viewer")),
    workosInvitationId: v.optional(v.string()), // WorkOS invitation ID for revocation
  },
  handler: async (ctx, args) => {
    // Check seat limit first
    const seatCheck = await checkSeatLimit(ctx, args.orgId)
    if (!seatCheck.allowed) {
      throw new Error(seatCheck.message || "Seat limit reached")
    }

    // Verify inviter has permission
    const membership = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.orgId).eq("userId", args.invitedBy)
      )
      .first()

    if (!membership || !hasPermission(membership.role as Role, "invitations:send")) {
      throw new Error("Unauthorized to invite members")
    }

    // Check if user is already a member
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first()

    if (existingUser) {
      const existingMembership = await ctx.db
        .query("members")
        .withIndex("by_organization_and_user", (q) =>
          q.eq("organizationId", args.orgId).eq("userId", existingUser._id)
        )
        .first()

      if (existingMembership) {
        throw new Error("User is already a member of this organization")
      }
    }

    // Check for existing pending invitation
    const existingInvite = await ctx.db
      .query("invitations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .filter((q) =>
        q.and(
          q.eq(q.field("organizationId"), args.orgId),
          q.eq(q.field("status"), "pending")
        )
      )
      .first()

    if (existingInvite) {
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
      expiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days
      createdAt: now,
    })

    // Audit log
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

// Accept an invitation
export const accept = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first()

    if (!invitation) {
      throw new Error("Invitation not found")
    }

    if (invitation.status !== "pending") {
      throw new Error("Invitation is no longer valid")
    }

    const now = Date.now()
    if (invitation.expiresAt < now) {
      await ctx.db.patch(invitation._id, { status: "expired" })
      throw new Error("Invitation has expired")
    }

    // Verify user email matches invitation
    const user = await ctx.db.get(args.userId)
    if (!user || user.email !== invitation.email) {
      throw new Error("Invitation email does not match user")
    }

    // Check if already a member
    const existingMembership = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", invitation.organizationId).eq("userId", args.userId)
      )
      .first()

    if (existingMembership) {
      throw new Error("Already a member of this organization")
    }

    // Create membership
    // Note: workosId is a placeholder - in production, this should create
    // the membership in WorkOS first and use that ID
    await ctx.db.insert("members", {
      workosId: `convex_${args.userId}_${invitation.organizationId}`,
      organizationId: invitation.organizationId,
      userId: args.userId,
      role: invitation.role,
      joinedAt: now,
      updatedAt: now,
    })

    // Update invitation status
    await ctx.db.patch(invitation._id, { status: "accepted" })

    // Audit log
    await ctx.db.insert("auditLogs", {
      organizationId: invitation.organizationId,
      userId: args.userId,
      action: "member.joined",
      resourceType: "member",
      resourceId: args.userId,
      metadata: { role: invitation.role, invitationId: invitation._id },
      timestamp: now,
    })

    return invitation.organizationId
  },
})

// Get pending invitations for an organization (excludes expired)
export const listForOrganization = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db
      .query("invitations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "pending"),
          q.gt(q.field("expiresAt"), now) // Only return non-expired invitations
        )
      )
      .collect()
  },
})

// Get invitation by token
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first()

    if (!invitation) return null

    // Get organization details
    const org = await ctx.db.get(invitation.organizationId)

    return {
      ...invitation,
      organization: org ? { name: org.name, slug: org.slug } : null,
    }
  },
})

// Revoke an invitation
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

    // Verify user has permission
    const membership = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", invitation.organizationId).eq("userId", args.userId)
      )
      .first()

    if (!membership || !hasPermission(membership.role as Role, "invitations:revoke")) {
      throw new Error("Unauthorized")
    }

    await ctx.db.delete(args.invitationId)

    // Audit log
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

// Internal: Clean up expired invitations (called by cron job)
export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()

    // Find all expired pending invitations
    const expiredInvitations = await ctx.db
      .query("invitations")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "pending"),
          q.lt(q.field("expiresAt"), now)
        )
      )
      .collect()

    // Mark them as expired
    for (const invitation of expiredInvitations) {
      await ctx.db.patch(invitation._id, { status: "expired" })
    }

    return { cleaned: expiredInvitations.length }
  },
})
