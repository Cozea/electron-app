import { v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import { type QueryCtx } from "./_generated/server"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { canAccessProjectByWorkspaceOrMembership } from "./lib/workspaceProjectAccess"
import {
  buildPendingProjectInviteRecord,
  findPendingProjectInviteByEmail,
  findUserByNormalizedEmail,
  getProjectMembership,
  getProjectShareScope,
  normalizeProjectInviteEmail,
  requireProjectManagerMembership,
  trustProjectDevice,
} from "./lib/projectSharing"

type ProjectInviteDoc = Doc<"projectInvites">

async function enrichInvite(ctx: QueryCtx, invite: ProjectInviteDoc) {
  const projectRecord = await ctx.db.get(invite.projectId)
  const project =
    projectRecord && projectRecord.status !== "deleted" ? projectRecord : null
  const inviter = await ctx.db.get(invite.invitedBy)
  const normalizedInviteEmail = normalizeProjectInviteEmail(invite.email)
  const inviteeUser = await findUserByNormalizedEmail(ctx, normalizedInviteEmail)
  const ownerUser = project ? await ctx.db.get(project.createdBy) : null

  return {
    ...invite,
    project: project
      ? {
          id: project._id,
          name: project.name,
          slug: project.slug,
        }
      : null,
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

export const listForProject = query({
  args: {
    projectId: v.id("projects"),
    viewerUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const canAccess = await canAccessProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.viewerUserId
    )
    if (!canAccess) {
      return []
    }

    const invites = await ctx.db
      .query("projectInvites")
      .withIndex("by_project_and_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "pending")
      )
      .collect()

    return await Promise.all(invites.map((invite) => enrichInvite(ctx, invite)))
  },
})

export const listPersonalContactsForUser = query({
  args: {
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const viewer = await ctx.db.get(args.userId)
    if (!viewer?.email) {
      return []
    }

    const viewerEmail = normalizeProjectInviteEmail(viewer.email)
    const userCacheById = new Map<string, Promise<Doc<"users"> | null>>()
    const userCacheByEmail = new Map<string, Promise<Doc<"users"> | null>>()
    const contacts = new Map<
      string,
      {
        email: string
        user: {
          id: Id<"users">
          email: string
          firstName?: string | null
          lastName?: string | null
          profileImageUrl?: string | null
        } | null
        lastSharedAt: number
      }
    >()

    const getCachedUserById = (userId: Id<"users">) => {
      const cacheKey = String(userId)
      let request = userCacheById.get(cacheKey)
      if (!request) {
        request = ctx.db.get(userId)
        userCacheById.set(cacheKey, request)
      }
      return request
    }

    const getCachedUserByEmail = (email: string) => {
      const normalizedEmail = normalizeProjectInviteEmail(email)
      let request = userCacheByEmail.get(normalizedEmail)
      if (!request) {
        request = findUserByNormalizedEmail(ctx, normalizedEmail)
        userCacheByEmail.set(normalizedEmail, request)
      }
      return request
    }

    const excludedEmails = new Set<string>()

    if (args.projectId) {
      const canAccess = await canAccessProjectByWorkspaceOrMembership(
        ctx,
        args.projectId,
        args.userId
      )
      if (!canAccess) {
        return []
      }

      const [projectMembers, pendingInvites] = await Promise.all([
        ctx.db
          .query("projectMembers")
          .withIndex("by_project", (q) => q.eq("projectId", args.projectId!))
          .collect(),
        ctx.db
          .query("projectInvites")
          .withIndex("by_project_and_status", (q) =>
            q.eq("projectId", args.projectId!).eq("status", "pending")
          )
          .collect(),
      ])

      for (const member of projectMembers) {
        const memberUser = await getCachedUserById(member.userId)
        if (!memberUser?.email) continue
        excludedEmails.add(normalizeProjectInviteEmail(memberUser.email))
      }

      for (const invite of pendingInvites) {
        const normalizedEmail = normalizeProjectInviteEmail(invite.email)
        if (normalizedEmail) {
          excludedEmails.add(normalizedEmail)
        }
      }
    }

    const addContact = async (input: {
      email: string
      userId?: Id<"users">
      timestamp: number
    }) => {
      const normalizedEmail = normalizeProjectInviteEmail(input.email)
      if (!normalizedEmail || normalizedEmail === viewerEmail || excludedEmails.has(normalizedEmail)) {
        return
      }

      let contactUser: Doc<"users"> | null = null
      if (input.userId) {
        contactUser = await getCachedUserById(input.userId)
      }
      if (!contactUser) {
        contactUser = await getCachedUserByEmail(normalizedEmail)
      }

      const nextEntry = {
        email: contactUser?.email ?? normalizedEmail,
        user: contactUser
          ? {
              id: contactUser._id,
              email: contactUser.email,
              firstName: contactUser.firstName,
              lastName: contactUser.lastName,
              profileImageUrl: contactUser.profileImageUrl,
            }
          : null,
        lastSharedAt: input.timestamp,
      }

      const existing = contacts.get(normalizedEmail)
      if (!existing || nextEntry.lastSharedAt > existing.lastSharedAt) {
        contacts.set(normalizedEmail, nextEntry)
      }
    }

    const ownedProjects = await ctx.db
      .query("projects")
      .withIndex("by_created_by", (q) => q.eq("createdBy", args.userId))
      .collect()

    for (const project of ownedProjects) {
      if (project.status === "deleted") continue

      const projectMembers = await ctx.db
        .query("projectMembers")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect()

      for (const membership of projectMembers) {
        if (membership.userId === args.userId) continue
        const memberUser = await getCachedUserById(membership.userId)
        if (!memberUser?.email) continue
        await addContact({
          email: memberUser.email,
          userId: memberUser._id,
          timestamp: membership.addedAt,
        })
      }

      const projectInvites = await ctx.db
        .query("projectInvites")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect()

      for (const invite of projectInvites) {
        if (invite.invitedBy !== args.userId) continue
        await addContact({
          email: invite.email,
          timestamp: invite.invitedAt,
        })
      }
    }

    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    for (const membership of memberships) {
      const project = await ctx.db.get(membership.projectId)
      if (!project || project.status === "deleted" || project.createdBy === args.userId) {
        continue
      }

      const owner = await getCachedUserById(project.createdBy)
      if (owner?.email) {
        await addContact({
          email: owner.email,
          userId: owner._id,
          timestamp: project.updatedAt ?? project.createdAt,
        })
      }
    }

    const incomingInvites = await ctx.db
      .query("projectInvites")
      .withIndex("by_email", (q) => q.eq("email", viewerEmail))
      .collect()

    for (const invite of incomingInvites) {
      const inviter = await getCachedUserById(invite.invitedBy)
      if (inviter?.email) {
        await addContact({
          email: inviter.email,
          userId: inviter._id,
          timestamp: invite.invitedAt,
        })
      }
    }

    return [...contacts.values()]
      .sort((left, right) => {
        const timestampDelta = right.lastSharedAt - left.lastSharedAt
        if (timestampDelta !== 0) return timestampDelta
        return left.email.localeCompare(right.email)
      })
      .slice(0, 50)
  },
})

export const listIncomingForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) return []

    const email = normalizeProjectInviteEmail(user.email)
    if (!email) return []

    const invites = await ctx.db
      .query("projectInvites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect()

    const enriched = await Promise.all(
      invites.map(async (invite) => {
        const entry = await enrichInvite(ctx, invite)
        return entry.project ? entry : null
      })
    )

    return enriched
      .filter((item): item is Exclude<(typeof enriched)[number], null> => item !== null)
      .sort((a, b) => b.invitedAt - a.invitedAt)
  },
})

export const get = query({
  args: { inviteId: v.id("projectInvites") },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) return null

    const scope = await getProjectShareScope(ctx, invite.projectId).catch(() => null)
    if (!scope) {
      return null
    }

    return await enrichInvite(ctx, invite)
  },
})

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
    const email = normalizeProjectInviteEmail(args.email)
    if (!email.includes("@")) {
      throw new Error("Invalid email address")
    }

    await requireProjectManagerMembership(
      ctx,
      args.projectId,
      args.invitedBy,
      "Only project managers can invite members"
    )

    const existingInvite = await findPendingProjectInviteByEmail(
      ctx,
      args.projectId,
      email
    )
    if (existingInvite) {
      throw new Error("An invite has already been sent to this email")
    }

    const existingUser = await findUserByNormalizedEmail(ctx, email)
    if (existingUser) {
      const existingMembership = await getProjectMembership(
        ctx,
        args.projectId,
        existingUser._id
      )
      if (existingMembership) {
        throw new Error("This user is already a member of the project")
      }
    }

    const inviteId = await ctx.db.insert(
      "projectInvites",
      buildPendingProjectInviteRecord({
        projectId: args.projectId,
        email,
        role: args.role,
        invitedBy: args.invitedBy,
        invitedAt: now,
      })
    )

    return {
      inviteId,
      emailDelivery: "not_configured" as const,
    }
  },
})

export const acceptInvite = mutation({
  args: {
    inviteId: v.id("projectInvites"),
    userId: v.id("users"),
    deviceId: v.string(),
    deviceLabel: v.string(),
    platform: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) throw new Error("Invite not found")
    if (invite.status !== "pending") {
      throw new Error("This invite is no longer valid")
    }

    await getProjectShareScope(ctx, invite.projectId)

    const existingMembership = await getProjectMembership(
      ctx,
      invite.projectId,
      args.userId
    )

    if (existingMembership) {
      if (!existingMembership.contactEmail) {
        await ctx.db.patch(existingMembership._id, {
          contactEmail: invite.email,
        })
      }
      await trustProjectDevice(ctx, {
        projectId: invite.projectId,
        userId: args.userId,
        deviceId: args.deviceId,
        deviceLabel: args.deviceLabel,
        platform: args.platform,
        fingerprint: args.fingerprint,
        role: existingMembership.role,
        addedByUserId: invite.invitedBy,
      })
    } else {
      await ctx.db.insert("projectMembers", {
        projectId: invite.projectId,
        userId: args.userId,
        contactEmail: invite.email,
        role: invite.role,
        addedAt: now,
        addedBy: invite.invitedBy,
      })
      await trustProjectDevice(ctx, {
        projectId: invite.projectId,
        userId: args.userId,
        deviceId: args.deviceId,
        deviceLabel: args.deviceLabel,
        platform: args.platform,
        fingerprint: args.fingerprint,
        role: invite.role,
        addedByUserId: invite.invitedBy,
      })
    }

    await ctx.db.patch(invite._id, {
      status: "accepted",
    })

    return { success: true }
  },
})

export const declineInvite = mutation({
  args: {
    inviteId: v.id("projectInvites"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) {
      return { success: true }
    }

    await ctx.db.patch(args.inviteId, {
      status: "expired",
    })

    return { success: true }
  },
})

export const cancelInvite = mutation({
  args: {
    inviteId: v.id("projectInvites"),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) {
      return { success: true }
    }

    await requireProjectManagerMembership(ctx, invite.projectId, args.actorUserId)
    await ctx.db.delete(invite._id)
    return { success: true }
  },
})

export const resendInvite = mutation({
  args: {
    inviteId: v.id("projectInvites"),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) {
      throw new Error("Invite not found")
    }

    await requireProjectManagerMembership(ctx, invite.projectId, args.actorUserId)

    if (invite.status !== "pending") {
      throw new Error("Only pending invites can be resent")
    }

    await ctx.db.patch(invite._id, {
      invitedAt: Date.now(),
    })

    return { emailDelivery: "not_configured" as const }
  },
})

export const updateInviteRole = mutation({
  args: {
    inviteId: v.id("projectInvites"),
    actorUserId: v.id("users"),
    role: v.union(
      v.literal("project_manager"),
      v.literal("developer"),
      v.literal("designer"),
      v.literal("viewer")
    ),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) {
      throw new Error("Invite not found")
    }

    await requireProjectManagerMembership(ctx, invite.projectId, args.actorUserId)

    if (invite.status !== "pending") {
      throw new Error("Only pending invites can be updated")
    }

    await ctx.db.patch(invite._id, {
      role: args.role,
    })

    return { success: true }
  },
})
