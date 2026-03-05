import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

const PERSONAL_WORKSPACE_PREFIX = "personal:"

// ============================================
// INVITE QUERIES
// ============================================

// List all pending invites for a project
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const invites = await ctx.db
      .query("projectInvites")
      .withIndex("by_project_and_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "pending")
      )
      .collect()

    // Get inviter details
    return await Promise.all(
      invites.map(async (invite) => {
        const inviter = await ctx.db.get(invite.invitedBy)
        const normalizedInviteEmail = invite.email.trim().toLowerCase()
        const inviteeUserByNormalizedEmail = await ctx.db
          .query("users")
          .withIndex("by_normalized_email", (q) =>
            q.eq("normalizedEmail", normalizedInviteEmail)
          )
          .first()
        const inviteeUser =
          inviteeUserByNormalizedEmail ??
          (await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", normalizedInviteEmail))
            .first())

        return {
          ...invite,
          inviter: inviter
            ? {
                id: inviter._id,
                email: inviter.email,
                firstName: inviter.firstName,
                lastName: inviter.lastName,
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
      })
    )
  },
})

// List all pending invites for a user's email
export const listForEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const invites = await ctx.db
      .query("projectInvites")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect()

    // Get project details for each invite
    return await Promise.all(
      invites.map(async (invite) => {
        const project = await ctx.db.get(invite.projectId)
        const inviter = await ctx.db.get(invite.invitedBy)
        return {
          ...invite,
          project: project
            ? {
                id: project._id,
                name: project.name,
                slug: project.slug,
              }
            : null,
          inviter: inviter
            ? {
                id: inviter._id,
                email: inviter.email,
                firstName: inviter.firstName,
                lastName: inviter.lastName,
              }
            : null,
        }
      })
    )
  },
})

export const listIncomingForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) return []

    const email = user.email.trim().toLowerCase()
    if (!email) return []

    const invites = await ctx.db
      .query("projectInvites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect()

    const enriched = await Promise.all(
      invites.map(async (invite) => {
        const project = await ctx.db.get(invite.projectId)
        if (!project || project.status === "deleted") return null

        const ownerWorkspace = await ctx.db.get(project.organizationId)
        if (
          !ownerWorkspace ||
          !ownerWorkspace.workosId ||
          !ownerWorkspace.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)
        ) {
          return null
        }

        const inviter = await ctx.db.get(invite.invitedBy)
        const ownerUser = await ctx.db.get(project.createdBy)

        return {
          ...invite,
          project: {
            id: project._id,
            name: project.name,
            slug: project.slug,
            organizationId: project.organizationId,
          },
          ownerWorkspace: {
            organizationId: ownerWorkspace._id,
            workosId: ownerWorkspace.workosId,
            name: ownerWorkspace.name,
          },
          ownerUser: ownerUser
            ? {
                id: ownerUser._id,
                email: ownerUser.email,
                firstName: ownerUser.firstName,
                lastName: ownerUser.lastName,
                profileImageUrl: ownerUser.profileImageUrl,
              }
            : null,
          inviter: inviter
            ? {
                id: inviter._id,
                email: inviter.email,
                firstName: inviter.firstName,
                lastName: inviter.lastName,
              }
            : null,
        }
      })
    )

    return enriched
      .filter((item): item is Exclude<(typeof enriched)[number], null> => item !== null)
      .sort((a, b) => b.invitedAt - a.invitedAt)
  },
})

// Get a specific invite by ID
export const get = query({
  args: { inviteId: v.id("projectInvites") },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) return null

    const project = await ctx.db.get(invite.projectId)
    const inviter = await ctx.db.get(invite.invitedBy)

    return {
      ...invite,
      project: project
        ? {
            id: project._id,
            name: project.name,
            slug: project.slug,
          }
        : null,
      inviter: inviter
        ? {
            id: inviter._id,
            email: inviter.email,
            firstName: inviter.firstName,
            lastName: inviter.lastName,
          }
        : null,
    }
  },
})

// ============================================
// INVITE MUTATIONS
// ============================================

// Invite a user to a project by email
export const inviteMember = mutation({
  args: {
    projectId: v.id("projects"),
    email: v.string(),
    role: v.union(
      v.literal("project_manager"),
      v.literal("developer"),
      v.literal("designer"),
      v.literal("viewer")
    ),
    invitedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const email = args.email.toLowerCase()

    // Verify inviter has permission (must be a project manager)
    const inviterMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.invitedBy)
      )
      .first()

    if (!inviterMembership || inviterMembership.role !== "project_manager") {
      throw new Error("Only project managers can invite members")
    }

    // Check if there's already a pending invite for this email
    const existingInvite = await ctx.db
      .query("projectInvites")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) =>
        q.and(q.eq(q.field("email"), email), q.eq(q.field("status"), "pending"))
      )
      .first()

    if (existingInvite) {
      throw new Error("An invite has already been sent to this email")
    }

    // Check if user is already a member
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first()

    if (existingUser) {
      const existingMembership = await ctx.db
        .query("projectMembers")
        .withIndex("by_project_and_user", (q) =>
          q.eq("projectId", args.projectId).eq("userId", existingUser._id)
        )
        .first()

      if (existingMembership) {
        throw new Error("This user is already a member of the project")
      }
    }

    // Create the invite
    const inviteId = await ctx.db.insert("projectInvites", {
      projectId: args.projectId,
      email,
      role: args.role,
      invitedBy: args.invitedBy,
      invitedAt: now,
      status: "pending",
    })

    // TODO: Send invitation email via action

    return inviteId
  },
})

// Accept an invite
export const acceptInvite = mutation({
  args: {
    inviteId: v.id("projectInvites"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    const invite = await ctx.db.get(args.inviteId)
    if (!invite) throw new Error("Invite not found")

    if (invite.status !== "pending") {
      throw new Error("This invite is no longer valid")
    }

    // Verify the user's email matches the invite
    const user = await ctx.db.get(args.userId)
    if (!user) throw new Error("User not found")

    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new Error("This invite was sent to a different email address")
    }

    // Check if user is already a member
    const existingMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", invite.projectId).eq("userId", args.userId)
      )
      .first()

    if (existingMembership) {
      // Mark invite as accepted even if already a member
      await ctx.db.patch(args.inviteId, { status: "accepted" })
      return existingMembership._id
    }

    // Add user as project member
    const membershipId = await ctx.db.insert("projectMembers", {
      projectId: invite.projectId,
      userId: args.userId,
      role: invite.role,
      addedAt: now,
      addedBy: invite.invitedBy,
    })

    // Mark invite as accepted
    await ctx.db.patch(args.inviteId, { status: "accepted" })

    return membershipId
  },
})

// Decline an invite
export const declineInvite = mutation({
  args: {
    inviteId: v.id("projectInvites"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) throw new Error("Invite not found")

    // Verify the user's email matches the invite
    const user = await ctx.db.get(args.userId)
    if (!user) throw new Error("User not found")

    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new Error("This invite was sent to a different email address")
    }

    // Delete the invite (or mark as expired)
    await ctx.db.delete(args.inviteId)
  },
})

// Cancel an invite (by project manager)
export const cancelInvite = mutation({
  args: {
    inviteId: v.id("projectInvites"),
    cancelledBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) throw new Error("Invite not found")

    // Verify canceller has permission
    const cancellerMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", invite.projectId).eq("userId", args.cancelledBy)
      )
      .first()

    if (!cancellerMembership || cancellerMembership.role !== "project_manager") {
      throw new Error("Only project managers can cancel invites")
    }

    await ctx.db.delete(args.inviteId)
  },
})

// Resend an invite
export const resendInvite = mutation({
  args: {
    inviteId: v.id("projectInvites"),
    resentBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) throw new Error("Invite not found")

    if (invite.status !== "pending") {
      throw new Error("This invite is no longer valid")
    }

    // Verify resender has permission
    const resenderMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", invite.projectId).eq("userId", args.resentBy)
      )
      .first()

    if (!resenderMembership || resenderMembership.role !== "project_manager") {
      throw new Error("Only project managers can resend invites")
    }

    // Update the invite timestamp
    await ctx.db.patch(args.inviteId, {
      invitedAt: Date.now(),
    })

    // TODO: Resend invitation email via action

    return { success: true }
  },
})

// Update invite role before acceptance
export const updateInviteRole = mutation({
  args: {
    inviteId: v.id("projectInvites"),
    newRole: v.union(
      v.literal("project_manager"),
      v.literal("developer"),
      v.literal("designer"),
      v.literal("viewer")
    ),
    updatedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) throw new Error("Invite not found")

    if (invite.status !== "pending") {
      throw new Error("Cannot update a processed invite")
    }

    // Verify updater has permission
    const updaterMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", invite.projectId).eq("userId", args.updatedBy)
      )
      .first()

    if (!updaterMembership || updaterMembership.role !== "project_manager") {
      throw new Error("Only project managers can update invites")
    }

    await ctx.db.patch(args.inviteId, {
      role: args.newRole,
    })
  },
})
