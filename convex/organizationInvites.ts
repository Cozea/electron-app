import { ConvexError, v } from "convex/values"

import type { Doc } from "./_generated/dataModel"
import { mutation, query, type QueryCtx } from "./_generated/server"
import { requireOrgAdmin, requireOrgMember } from "./lib/orgAccess"
import {
  findUserByNormalizedEmail,
  normalizeProjectInviteEmail,
} from "./lib/projectSharing"

type OrganizationInviteDoc = Doc<"organizationInvites">

async function enrichInvite(ctx: QueryCtx, invite: OrganizationInviteDoc) {
  const organization = await ctx.db.get(invite.organizationId)
  const inviter = await ctx.db.get(invite.invitedBy)
  const inviteeUser = await findUserByNormalizedEmail(
    ctx,
    normalizeProjectInviteEmail(invite.email),
  )

  return {
    ...invite,
    organization: organization
      ? { id: organization._id, name: organization.name }
      : null,
    inviter: inviter
      ? {
          id: inviter._id,
          email: inviter.email,
          firstName: inviter.firstName,
          lastName: inviter.lastName,
          profileImageUrl: inviter.profileImageUrl,
        }
      : null,
    user: inviteeUser
      ? {
          id: inviteeUser._id,
          email: inviteeUser.email,
          firstName: inviteeUser.firstName,
          lastName: inviteeUser.lastName,
          profileImageUrl: inviteeUser.profileImageUrl,
        }
      : null,
  }
}

export const listPendingForMe = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user?.email) return []
    const email = normalizeProjectInviteEmail(user.email)
    if (!email) return []

    const invites = await ctx.db
      .query("organizationInvites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect()

    return await Promise.all(
      invites
        .filter((invite) => invite.status === "pending")
        .map((invite) => enrichInvite(ctx, invite)),
    )
  },
})

export const listForOrganization = query({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.organizationId, args.userId)
    const invites = await ctx.db
      .query("organizationInvites")
      .withIndex("by_organization_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "pending"),
      )
      .collect()
    return await Promise.all(invites.map((invite) => enrichInvite(ctx, invite)))
  },
})

export const inviteMember = mutation({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId, args.userId)
    const email = normalizeProjectInviteEmail(args.email)
    if (!email) {
      throw new ConvexError("Email cannot be blank")
    }

    const existingUser = await findUserByNormalizedEmail(ctx, email)
    if (existingUser) {
      const membership = await ctx.db
        .query("organizationMembers")
        .withIndex("by_organization_and_user", (q) =>
          q.eq("organizationId", args.organizationId).eq("userId", existingUser._id),
        )
        .first()
      if (membership) {
        throw new ConvexError("That person is already in this organization")
      }
    }

    const pending = await ctx.db
      .query("organizationInvites")
      .withIndex("by_organization_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "pending"),
      )
      .collect()
    if (pending.some((invite) => normalizeProjectInviteEmail(invite.email) === email)) {
      throw new ConvexError("An invite is already pending for that email")
    }

    const inviteId = await ctx.db.insert("organizationInvites", {
      organizationId: args.organizationId,
      email,
      role: args.role,
      invitedBy: args.userId,
      invitedAt: Date.now(),
      status: "pending",
    })

    return { inviteId }
  },
})

export const cancelInvite = mutation({
  args: {
    userId: v.id("users"),
    inviteId: v.id("organizationInvites"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) {
      throw new ConvexError("Invite not found")
    }
    await requireOrgAdmin(ctx, invite.organizationId, args.userId)
    await ctx.db.patch(args.inviteId, { status: "expired" })
    return { cancelled: true }
  },
})

export const acceptInvite = mutation({
  args: {
    userId: v.id("users"),
    inviteId: v.id("organizationInvites"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite || invite.status !== "pending") {
      throw new ConvexError("Invite is not available")
    }

    const user = await ctx.db.get(args.userId)
    if (!user?.email) {
      throw new ConvexError("User not found")
    }
    if (normalizeProjectInviteEmail(user.email) !== normalizeProjectInviteEmail(invite.email)) {
      throw new ConvexError("This invite was sent to a different email")
    }

    const existing = await ctx.db
      .query("organizationMembers")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", invite.organizationId).eq("userId", args.userId),
      )
      .first()
    if (!existing) {
      await ctx.db.insert("organizationMembers", {
        organizationId: invite.organizationId,
        userId: args.userId,
        role: invite.role,
        addedAt: Date.now(),
        addedBy: invite.invitedBy,
      })
    }

    await ctx.db.patch(args.inviteId, { status: "accepted" })
    return { organizationId: invite.organizationId }
  },
})
