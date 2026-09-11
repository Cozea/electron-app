/**
 * Collaboration Sessions control plane mutations and queries.
 *
 * Master Specification: Section 4.1, 6.1 - 6.8, 25.1 - 25.4
 */

import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

export const get = query({
  args: { sessionId: v.id("collaborationSessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId)
  },
})

export const getByPublicId = query({
  args: { publicSessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("collaborationSessions")
      .withIndex("by_public_session_id", (q) => q.eq("publicSessionId", args.publicSessionId))
      .first()
  },
})

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("collaborationSessions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.neq(q.field("lifecycle"), "CLOSED"))
      .collect()
  },
})

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    repositoryBindingId: v.string(),
    branchName: v.string(),
    targetBranch: v.string(),
    accessMode: v.union(v.literal("invite_only"), v.literal("organization_available")),
    organizationId: v.optional(v.id("organizations")),
    creatorPrincipalId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    // Check branch uniqueness: no duplicate non-closed session for the same branch (Section 6.1)
    const existing = await ctx.db
      .query("collaborationSessions")
      .withIndex("by_project_and_branch", (q) =>
        q.eq("projectId", args.projectId).eq("branchName", args.branchName),
      )
      .filter((q) => q.neq(q.field("lifecycle"), "CLOSED"))
      .first()

    if (existing) {
      throw new Error(
        `A non-closed collaboration session already exists for branch '${args.branchName}' (session: ${existing.publicSessionId})`,
      )
    }

    const now = Date.now()
    const publicSessionId = `czs_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`

    const sessionId = await ctx.db.insert("collaborationSessions", {
      publicSessionId,
      projectId: args.projectId,
      repositoryBindingId: args.repositoryBindingId,
      branchName: args.branchName,
      targetBranch: args.targetBranch,
      createdByPrincipalId: args.creatorPrincipalId,
      lifecycle: "ACTIVE",
      accessMode: args.accessMode,
      organizationId: args.organizationId,
      createdAt: now,
      updatedAt: now,
      pausedAt: undefined,
      closedAt: undefined,
      lastDurableSeq: 0,
      lastSnapshotSeq: 0,
      lastAutoGitCheckpointSeq: undefined,
      lastAutoGitCommitOid: undefined,
    })

    // Add creator as project_manager member
    await ctx.db.insert("collaborationSessionMembers", {
      sessionId,
      projectId: args.projectId,
      principalId: args.creatorPrincipalId,
      role: "project_manager",
      status: "active",
      joinedAt: now,
    })

    // Initialize AutoGit election state
    await ctx.db.insert("collaborationAutoGit", {
      sessionId,
      leaderIdentityKey: undefined,
      leaseGeneration: 0,
      leaseExpiresAt: 0,
      updatedAt: now,
    })

    return { sessionId, publicSessionId }
  },
})

export const join = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
    principalId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId)
    if (!session) {
      throw new Error("Collaboration session not found")
    }
    if (session.lifecycle === "CLOSED") {
      throw new Error("Cannot join closed collaboration session")
    }

    const now = Date.now()

    // Check existing membership
    const existingMember = await ctx.db
      .query("collaborationSessionMembers")
      .withIndex("by_session_and_principal", (q) =>
        q.eq("sessionId", args.sessionId).eq("principalId", args.principalId),
      )
      .first()

    if (existingMember) {
      if (existingMember.status === "revoked") {
        throw new Error("Device access to this session has been revoked")
      }
      if (existingMember.status === "left") {
        await ctx.db.patch(existingMember._id, { status: "active", joinedAt: now })
      }
      return { memberId: existingMember._id, status: "active" }
    }

    // Access control: if invite_only, verify valid accepted invitation
    if (session.accessMode === "invite_only") {
      const invite = await ctx.db
        .query("collaborationSessionInvitations")
        .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
        .filter((q) => q.eq(q.field("targetPrincipalId"), args.principalId))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .first()

      if (!invite) {
        throw new Error("Invitation required to join this invite-only session")
      }

      await ctx.db.patch(invite._id, { status: "accepted", resolvedAt: now })
    }

    // Ensure project membership atomically (Section 6.1 / 6.3)
    const projectMember = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_principal", (q) =>
        q.eq("projectId", session.projectId).eq("principalId", args.principalId),
      )
      .first()

    if (!projectMember) {
      await ctx.db.insert("projectMembers", {
        projectId: session.projectId,
        principalId: args.principalId,
        role: "developer",
        addedAt: now,
        addedBy: session.createdByPrincipalId,
      })
    }

    const memberId = await ctx.db.insert("collaborationSessionMembers", {
      sessionId: args.sessionId,
      projectId: session.projectId,
      principalId: args.principalId,
      role: "developer",
      status: "active",
      joinedAt: now,
    })

    // If session was DORMANT, revive to ACTIVE
    if (session.lifecycle === "DORMANT") {
      await ctx.db.patch(session._id, { lifecycle: "ACTIVE", updatedAt: now })
    }

    return { memberId, status: "active" }
  },
})

export const leave = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
    principalId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    const member = await ctx.db
      .query("collaborationSessionMembers")
      .withIndex("by_session_and_principal", (q) =>
        q.eq("sessionId", args.sessionId).eq("principalId", args.principalId),
      )
      .first()

    if (member) {
      await ctx.db.patch(member._id, { status: "left", leftAt: Date.now() })
    }

    // If no active members remain, transition to DORMANT (Section 4.1)
    const activeMembers = await ctx.db
      .query("collaborationSessionMembers")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect()

    if (activeMembers.length === 0) {
      await ctx.db.patch(args.sessionId, { lifecycle: "DORMANT", updatedAt: Date.now() })
    }

    return { success: true }
  },
})

export const pause = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    await ctx.db.patch(args.sessionId, {
      lifecycle: "PAUSED",
      pausedAt: now,
      updatedAt: now,
    })
    return { success: true }
  },
})

export const resume = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    await ctx.db.patch(args.sessionId, {
      lifecycle: "ACTIVE",
      pausedAt: undefined,
      updatedAt: now,
    })
    return { success: true }
  },
})

export const close = mutation({
  args: {
    sessionId: v.id("collaborationSessions"),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    await ctx.db.patch(args.sessionId, {
      lifecycle: "CLOSED",
      closedAt: now,
      updatedAt: now,
    })
    return { success: true }
  },
})

export const listIncomingInvitations = query({
  args: {
    principalId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const invitations = await ctx.db
      .query("collaborationSessionInvitations")
      .withIndex("by_target_principal", (q) => q.eq("targetPrincipalId", args.principalId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .filter((q) => q.gt(q.field("expiresAt"), now))
      .collect()

    const results = []
    for (const invite of invitations) {
      const session = await ctx.db.get(invite.sessionId)
      const project = await ctx.db.get(invite.projectId)
      const inviter = await ctx.db.get(invite.createdByPrincipalId)

      if (session && project) {
        results.push({
          invitationId: invite._id,
          sessionId: session._id,
          publicSessionId: session.publicSessionId,
          projectId: project._id,
          projectName: project.name,
          branchName: session.branchName,
          targetBranch: session.targetBranch,
          role: invite.role,
          sessionLifecycle: session.lifecycle,
          inviterName: inviter?.displayName ?? "A team member",
          expiresAt: invite.expiresAt,
          createdAt: invite.createdAt,
        })
      }
    }

    return results
  },
})

export const resolveInvitation = mutation({
  args: {
    invitationId: v.id("collaborationSessionInvitations"),
    accept: v.boolean(),
    principalId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.invitationId)
    if (!invite || invite.status !== "pending") {
      throw new Error("Invitation not found or no longer pending")
    }

    const now = Date.now()

    if (!args.accept) {
      await ctx.db.patch(invite._id, { status: "declined", resolvedAt: now })
      return { accepted: false }
    }

    const session = await ctx.db.get(invite.sessionId)
    if (!session || session.lifecycle === "CLOSED") {
      throw new Error("Session no longer available")
    }

    // Atomically ensure project membership
    const projectMember = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_principal", (q) =>
        q.eq("projectId", session.projectId).eq("principalId", args.principalId),
      )
      .first()

    if (!projectMember) {
      await ctx.db.insert("projectMembers", {
        projectId: session.projectId,
        principalId: args.principalId,
        role: "developer",
        addedAt: now,
        addedBy: invite.createdByPrincipalId,
      })
    }

    // Add session membership
    const memberId = await ctx.db.insert("collaborationSessionMembers", {
      sessionId: session._id,
      projectId: session.projectId,
      principalId: args.principalId,
      role: invite.role,
      status: "active",
      joinedAt: now,
    })

    await ctx.db.patch(invite._id, { status: "accepted", resolvedAt: now })

    return {
      accepted: true,
      sessionId: session._id,
      publicSessionId: session.publicSessionId,
      projectId: session.projectId,
      branchName: session.branchName,
      memberId,
    }
  },
})
