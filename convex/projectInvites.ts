import { v } from "convex/values"

import { api, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import {
  internalAction,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { decrypt } from "./lib/encryption"
import {
  buildPendingProjectInviteRecord,
  findPendingProjectInviteByEmail,
  findUserByNormalizedEmail,
  getProjectMembership,
  getProjectShareScope,
  normalizeProjectInviteEmail,
  PERSONAL_WORKSPACE_PREFIX,
  requireProjectManagerMembership,
  trustProjectDevice,
} from "./lib/projectSharing"
import { hasOrganizationPermission } from "./lib/organizationRoles"
import { canAccessProjectByWorkspaceOrMembership } from "./lib/workspaceProjectAccess"
import {
  buildProjectInviteDeepLink,
  buildProjectInviteUrl,
  normalizeProjectShareBaseUrl,
} from "../shared/projectShare"

type ProjectInviteDoc = Doc<"projectInvites">
type ProjectInviteEmailDelivery = "scheduled" | "not_configured"

const PERSONAL_PROJECT_INVITE_ERROR =
  "Workspace projects do not support per-project invites. Invite people to the workspace first."

async function getPersonalProjectShareScopeOrThrow(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  errorMessage = PERSONAL_PROJECT_INVITE_ERROR
) {
  const scope = await getProjectShareScope(ctx, projectId)
  if (!scope.isPersonalProject) {
    throw new Error(errorMessage)
  }
  return scope
}

async function getCanonicalOrgMembership(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  organizationId: Id<"organizations">,
  userId: Id<"users">
) {
  const memberships = await ctx.db
    .query("members")
    .withIndex("by_organization_and_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId)
    )
    .collect()

  if (memberships.length === 0) {
    return null
  }

  return [...memberships].sort((a, b) => {
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    const joinedDelta = (b.joinedAt || 0) - (a.joinedAt || 0)
    if (joinedDelta !== 0) return joinedDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

function formatUserName(user: {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
} | null): string {
  const first = user?.firstName?.trim() ?? ""
  const last = user?.lastName?.trim() ?? ""
  const fullName = `${first} ${last}`.trim()
  return fullName || user?.email?.trim() || "A Cozea collaborator"
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function getInviteRoleLabel(role: ProjectInviteDoc["role"]): string {
  switch (role) {
    case "project_manager":
      return "Project Manager"
    case "developer":
      return "Developer"
    case "designer":
      return "Designer"
    case "viewer":
      return "Viewer"
    default:
      return "Collaborator"
  }
}

function getInviteSenderAddress(): string {
  const configured =
    process.env.PROJECT_INVITE_FROM_EMAIL?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    process.env.EMAIL_FROM?.trim()

  return configured && configured.length > 0
    ? configured
    : "Cozea <onboarding@resend.dev>"
}

function getProjectShareSiteBaseUrl(): string {
  return normalizeProjectShareBaseUrl(
    process.env.PROJECT_INVITE_BASE_URL ??
      process.env.SITE_URL ??
      process.env.VITE_SITE_URL ??
      null
  )
}

async function enrichInvite(
  ctx: QueryCtx,
  invite: ProjectInviteDoc
) {
  const projectRecord = await ctx.db.get(invite.projectId)
  const project =
    projectRecord && projectRecord.status !== "deleted" ? projectRecord : null
  const inviter = await ctx.db.get(invite.invitedBy)
  const normalizedInviteEmail = normalizeProjectInviteEmail(invite.email)
  const inviteeUser = await findUserByNormalizedEmail(ctx, normalizedInviteEmail)
  const ownerWorkspace = project ? await ctx.db.get(project.organizationId) : null
  const ownerUser = project ? await ctx.db.get(project.createdBy) : null

  return {
    ...invite,
    project: project
      ? {
          id: project._id,
          name: project.name,
          slug: project.slug,
          organizationId: project.organizationId,
        }
      : null,
    ownerWorkspace: ownerWorkspace
      ? {
          organizationId: ownerWorkspace._id,
          workosId: ownerWorkspace.workosId,
          name: ownerWorkspace.name,
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

async function scheduleInviteEmailIfConfigured(
  ctx: MutationCtx,
  inviteId: Id<"projectInvites">,
  organizationId: Id<"organizations">
): Promise<ProjectInviteEmailDelivery> {
  const resendIntegration = await ctx.db
    .query("integrations")
    .withIndex("by_organization_and_provider", (q) =>
      q.eq("organizationId", organizationId).eq("provider", "resend")
    )
    .first()

  if (!resendIntegration || resendIntegration.status !== "active") {
    return "not_configured"
  }

  await ctx.scheduler.runAfter(0, internal.projectInvites.sendInviteEmail, {
    inviteId,
  })

  return "scheduled"
}

// ============================================
// INVITE QUERIES
// ============================================

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

    const scope = await getProjectShareScope(ctx, args.projectId).catch(() => null)
    if (!scope?.isPersonalProject) {
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
    const relevantProjects = new Map<
      string,
      { project: Doc<"projects">; isOwnedByViewer: boolean }
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

      const scope = await getProjectShareScope(ctx, args.projectId).catch(() => null)
      if (!scope?.isPersonalProject) {
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
        if (!normalizedEmail) continue
        excludedEmails.add(normalizedEmail)
      }
    }

    const addContact = async (args: {
      email: string
      userId?: Id<"users">
      timestamp: number
    }) => {
      const normalizedEmail = normalizeProjectInviteEmail(args.email)
      if (!normalizedEmail || normalizedEmail === viewerEmail) {
        return
      }

      let contactUser: Doc<"users"> | null = null
      if (args.userId) {
        contactUser = await getCachedUserById(args.userId)
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
        lastSharedAt: args.timestamp,
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
      const scope = await getProjectShareScope(ctx, project._id).catch(() => null)
      if (!scope?.isPersonalProject) continue
      relevantProjects.set(String(project._id), {
        project,
        isOwnedByViewer: true,
      })
    }

    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    for (const membership of memberships) {
      const project = await ctx.db.get(membership.projectId)
      if (!project || project.status === "deleted") continue
      const scope = await getProjectShareScope(ctx, project._id).catch(() => null)
      if (!scope?.isPersonalProject) continue
      const cacheKey = String(project._id)
      if (!relevantProjects.has(cacheKey)) {
        relevantProjects.set(cacheKey, {
          project,
          isOwnedByViewer: project.createdBy === args.userId,
        })
      }
    }

    for (const { project, isOwnedByViewer } of relevantProjects.values()) {
      if (!isOwnedByViewer && project.createdBy !== args.userId) {
        const owner = await getCachedUserById(project.createdBy)
        if (owner?.email) {
          await addContact({
            email: owner.email,
            userId: owner._id,
            timestamp: project.updatedAt ?? project.createdAt,
          })
        }
      }

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

      if (isOwnedByViewer) {
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
    }

    const incomingInvites = await ctx.db
      .query("projectInvites")
      .withIndex("by_email", (q) => q.eq("email", viewerEmail))
      .collect()

    for (const invite of incomingInvites) {
      const scope = await getProjectShareScope(ctx, invite.projectId).catch(() => null)
      if (!scope?.isPersonalProject) continue
      const inviter = await getCachedUserById(invite.invitedBy)
      if (!inviter?.email) continue
      await addContact({
        email: inviter.email,
        userId: inviter._id,
        timestamp: invite.invitedAt,
      })
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

export const listForEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const invites = await ctx.db
      .query("projectInvites")
      .withIndex("by_email", (q) =>
        q.eq("email", normalizeProjectInviteEmail(args.email))
      )
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect()

    const enriched = await Promise.all(
      invites.map(async (invite) => {
        const scope = await getProjectShareScope(ctx, invite.projectId).catch(() => null)
        if (!scope?.isPersonalProject) {
          return null
        }
        return await enrichInvite(ctx, invite)
      })
    )

    return enriched.filter((invite): invite is Exclude<(typeof enriched)[number], null> => invite !== null)
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
        const scope = await getProjectShareScope(ctx, invite.projectId).catch(() => null)
        if (!scope?.isPersonalProject) {
          return null
        }
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
    if (!scope?.isPersonalProject) {
      return null
    }

    return await enrichInvite(ctx, invite)
  },
})

export const getInviteEmailDeliveryPayload = internalQuery({
  args: { inviteId: v.id("projectInvites") },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite || invite.status !== "pending") {
      return null
    }

    const scope = await getProjectShareScope(ctx, invite.projectId).catch(() => null)
    if (!scope?.isPersonalProject) {
      return null
    }

    const inviter = await ctx.db.get(invite.invitedBy)
    if (!inviter) {
      return null
    }

    return {
      inviteId: invite._id,
      inviteEmail: invite.email,
      inviteRole: invite.role,
      organizationId: scope.organization._id,
      organizationName: scope.organization.name,
      projectName: scope.project.name,
      projectSlug: scope.project.slug,
      inviter: {
        email: inviter.email,
        firstName: inviter.firstName,
        lastName: inviter.lastName,
      },
    }
  },
})

// ============================================
// INVITE MUTATIONS
// ============================================

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

    const { organization } = await getPersonalProjectShareScopeOrThrow(
      ctx,
      args.projectId
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

    const emailDelivery = await scheduleInviteEmailIfConfigured(
      ctx,
      inviteId,
      organization._id
    )

    return {
      inviteId,
      emailDelivery,
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

    await getPersonalProjectShareScopeOrThrow(
      ctx,
      invite.projectId,
      "Workspace projects do not support project invites. Ask a workspace admin to invite you to the workspace first."
    )

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
      await ctx.db.patch(args.inviteId, { status: "accepted" })
      return {
        membershipId: existingMembership._id,
        projectId: invite.projectId,
        alreadyMember: true,
      }
    }

    const membershipId = await ctx.db.insert("projectMembers", {
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

    await ctx.db.patch(args.inviteId, { status: "accepted" })

    return {
      membershipId,
      projectId: invite.projectId,
      alreadyMember: false,
    }
  },
})

export const declineInvite = mutation({
  args: {
    inviteId: v.id("projectInvites"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) throw new Error("Invite not found")

    await ctx.db.delete(args.inviteId)
  },
})

export const cancelInvite = mutation({
  args: {
    inviteId: v.id("projectInvites"),
    cancelledBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId)
    if (!invite) throw new Error("Invite not found")

    await requireProjectManagerMembership(
      ctx,
      invite.projectId,
      args.cancelledBy,
      "Only project managers can cancel invites"
    )

    await ctx.db.delete(args.inviteId)
  },
})

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

    await requireProjectManagerMembership(
      ctx,
      invite.projectId,
      args.resentBy,
      "Only project managers can resend invites"
    )

    const { organization } = await getPersonalProjectShareScopeOrThrow(
      ctx,
      invite.projectId
    )
    const invitedAt = Date.now()

    await ctx.db.patch(args.inviteId, {
      invitedAt,
    })

    const emailDelivery = await scheduleInviteEmailIfConfigured(
      ctx,
      args.inviteId,
      organization._id
    )

    return { success: true, emailDelivery }
  },
})

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

    await requireProjectManagerMembership(
      ctx,
      invite.projectId,
      args.updatedBy,
      "Only project managers can update invites"
    )

    await getPersonalProjectShareScopeOrThrow(ctx, invite.projectId)

    await ctx.db.patch(args.inviteId, {
      role: args.newRole,
    })
  },
})

export const cleanupWorkspaceProjectInvites = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const organization = await ctx.db.get(args.organizationId)
    if (!organization) {
      throw new Error("Workspace not found")
    }

    if (organization.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)) {
      throw new Error("Personal workspaces do not have workspace project invites to clean up")
    }

    const membership = await getCanonicalOrgMembership(
      ctx,
      args.organizationId,
      args.userId
    )
    const allowed = await hasOrganizationPermission(
      ctx,
      membership,
      "invitations:revoke"
    )
    if (!membership || !allowed) {
      throw new Error("Unauthorized to clean up workspace project invites")
    }

    const dryRun = args.dryRun ?? true
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .collect()

    const cleanupCandidates: Array<{
      inviteId: Id<"projectInvites">
      projectId: Id<"projects">
      status: ProjectInviteDoc["status"]
    }> = []

    for (const project of projects) {
      const invites = await ctx.db
        .query("projectInvites")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect()

      for (const invite of invites) {
        cleanupCandidates.push({
          inviteId: invite._id,
          projectId: invite.projectId,
          status: invite.status,
        })
      }
    }

    const countsByStatus = cleanupCandidates.reduce<Record<ProjectInviteDoc["status"], number>>(
      (accumulator, invite) => {
        accumulator[invite.status] += 1
        return accumulator
      },
      {
        pending: 0,
        accepted: 0,
        expired: 0,
      }
    )

    if (!dryRun) {
      for (const invite of cleanupCandidates) {
        await ctx.db.delete(invite.inviteId)
      }
    }

    return {
      organizationId: args.organizationId,
      dryRun,
      projectCount: projects.length,
      inviteCount: cleanupCandidates.length,
      deletedCount: dryRun ? 0 : cleanupCandidates.length,
      countsByStatus,
      sampleInviteIds: cleanupCandidates.slice(0, 20).map((invite) => invite.inviteId),
    }
  },
})

export const sendInviteEmail = internalAction({
  args: {
    inviteId: v.id("projectInvites"),
  },
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(
      internal.projectInvites.getInviteEmailDeliveryPayload,
      { inviteId: args.inviteId }
    )

    if (!payload) {
      return { delivered: false, reason: "invite_not_deliverable" as const }
    }

    const integration = await ctx.runQuery(api.integrations.getEncryptedCredentials, {
      organizationId: payload.organizationId,
      provider: "resend",
    })

    if (!integration?.encryptedCredentials) {
      return { delivered: false, reason: "provider_not_configured" as const }
    }

    let parsedCredentials: { apiKey?: string }
    try {
      const decryptedCredentials = await decrypt(integration.encryptedCredentials)
      parsedCredentials = JSON.parse(decryptedCredentials) as {
        apiKey?: string
      }
    } catch (error) {
      console.error("[ProjectInvites] Failed to read Resend integration credentials", {
        inviteId: payload.inviteId,
        organizationId: payload.organizationId,
        error,
      })
      return { delivered: false, reason: "provider_not_configured" as const }
    }
    const apiKey = parsedCredentials.apiKey?.trim()

    if (!apiKey) {
      console.warn("[ProjectInvites] Resend integration is missing apiKey", {
        organizationId: payload.organizationId,
      })
      return { delivered: false, reason: "provider_not_configured" as const }
    }

    const inviterName = formatUserName(payload.inviter)
    const inviteUrl = buildProjectInviteUrl(
      getProjectShareSiteBaseUrl(),
      String(payload.inviteId)
    )
    const inviteDeepLink = buildProjectInviteDeepLink(String(payload.inviteId))
    const roleLabel = getInviteRoleLabel(payload.inviteRole)
    const escapedProjectName = escapeHtml(payload.projectName)
    const escapedInviterName = escapeHtml(inviterName)
    const escapedWorkspaceName = escapeHtml(payload.organizationName)
    const escapedRoleLabel = escapeHtml(roleLabel)
    const escapedInviteUrl = escapeHtml(inviteUrl)
    const escapedDeepLink = escapeHtml(inviteDeepLink)

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: getInviteSenderAddress(),
        to: [payload.inviteEmail],
        subject: `${payload.projectName} — project invite from ${inviterName}`,
        html: `
          <div style="font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #111111; color: #f5f5f5; padding: 32px 20px;">
            <div style="max-width: 560px; margin: 0 auto; background: #181818; border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 32px;">
              <p style="margin: 0 0 8px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #a1a1aa;">
                Cozea project invite
              </p>
              <h1 style="margin: 0 0 16px; font-size: 28px; line-height: 1.15;">${escapedInviterName} invited you to ${escapedProjectName}</h1>
              <p style="margin: 0 0 18px; font-size: 15px; line-height: 1.6; color: #d4d4d8;">
                Workspace: ${escapedWorkspaceName}<br />
                Role: ${escapedRoleLabel}
              </p>
              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #d4d4d8;">
                Open the invite preview, sign in with <strong>${escapeHtml(payload.inviteEmail)}</strong>, then accept the access request.
              </p>
              <a href="${escapedInviteUrl}" style="display: inline-block; padding: 12px 18px; border-radius: 999px; background: #ffffff; color: #111111; text-decoration: none; font-weight: 600;">
                Review invite
              </a>
              <p style="margin: 24px 0 0; font-size: 13px; line-height: 1.6; color: #a1a1aa;">
                If Cozea is installed locally, you can also open the desktop app directly:
                <br />
                <a href="${escapedDeepLink}" style="color: #fafafa;">${escapedDeepLink}</a>
              </p>
              <p style="margin: 16px 0 0; font-size: 13px; line-height: 1.6; color: #71717a;">
                If the button does not work, copy and paste this URL into your browser:
                <br />
                <a href="${escapedInviteUrl}" style="color: #fafafa;">${escapedInviteUrl}</a>
              </p>
            </div>
          </div>
        `,
        text: [
          `${inviterName} invited you to ${payload.projectName} on Cozea.`,
          `Workspace: ${payload.organizationName}`,
          `Role: ${roleLabel}`,
          "",
          `Sign in with ${payload.inviteEmail} and review the invite here:`,
          inviteUrl,
          "",
          `Desktop app link: ${inviteDeepLink}`,
        ].join("\n"),
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error("[ProjectInvites] Failed to send invite email", {
        inviteId: payload.inviteId,
        organizationId: payload.organizationId,
        status: response.status,
        errorBody,
      })
      throw new Error(`Failed to send invite email (${response.status})`)
    }

    return { delivered: true }
  },
})
