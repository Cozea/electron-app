import { mutation, query, internalMutation } from "./_generated/server"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import {
  hasAnyOrganizationPermission,
  hasOrganizationPermission,
  organizationPermissionValidator,
  resolveCompatibleOrganizationRoleIdForBaseRole,
  resolveInvitationAccess,
  resolveOrganizationRole,
  roleBaseValidator,
} from "./lib/organizationRoles"
import { PERMISSION_VALUES, type Permission } from "./lib/permissions"

const ORGANIZATION_INVITATION_READ_PERMISSIONS = [
  "invitations:view",
  "invitations:send",
  "invitations:revoke",
  "members:invite",
  "roles:assign",
  "members:update_role",
] as const satisfies readonly Permission[]

const ORGANIZATION_INVITATION_CREATE_PERMISSIONS = [
  "invitations:send",
  "members:invite",
] as const satisfies readonly Permission[]

const ORGANIZATION_ROLE_ASSIGN_PERMISSIONS = [
  "roles:assign",
  "members:update_role",
] as const satisfies readonly Permission[]

// Generate a cryptographically secure random token.
function generateToken(): string {
  const uuid1 = crypto.randomUUID().replace(/-/g, "")
  const uuid2 = crypto.randomUUID().replace(/-/g, "")
  return (uuid1 + uuid2).slice(0, 48)
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function sanitizePermissionOverrides(
  grants: Permission[] | undefined,
  denies: Permission[] | undefined
) {
  const normalizedGrants = [...new Set((grants ?? []).filter((permission) => PERMISSION_VALUES.includes(permission)))]
  const normalizedDenies = [...new Set((denies ?? []).filter((permission) => PERMISSION_VALUES.includes(permission)))]

  for (const permission of normalizedGrants) {
    if (normalizedDenies.includes(permission)) {
      throw new Error(`Permission ${permission} cannot be both granted and denied`)
    }
  }

  return {
    permissionGrants: normalizedGrants,
    permissionDenies: normalizedDenies,
  }
}

function normalizeWorkOSInvitationState(
  state: string | null | undefined
): "pending" | "accepted" | "expired" {
  const normalized = state?.trim().toLowerCase()
  if (normalized === "pending") return "pending"
  if (normalized === "accepted") return "accepted"
  return "expired"
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

async function getCanonicalOrgMembership(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  organizationId: Id<"organizations">,
  userId: Id<"users">
): Promise<Doc<"members"> | null> {
  const memberships = await ctx.db
    .query("members")
    .withIndex("by_organization_and_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId)
    )
    .collect()
  return pickCanonicalMembership(memberships)
}

function resolveViewerUserId(args: {
  viewerUserId?: Id<"users">
  userId?: Id<"users">
}): Id<"users"> | null {
  return args.viewerUserId ?? args.userId ?? null
}

// Invite a user to an organization.
export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    invitedBy: v.id("users"),
    email: v.string(),
    role: roleBaseValidator,
    roleId: v.optional(v.id("organizationRoles")),
    workosInvitationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const inviterMembership = await getCanonicalOrgMembership(ctx, args.orgId, args.invitedBy)
    const allowed = await hasAnyOrganizationPermission(
      ctx,
      inviterMembership,
      ORGANIZATION_INVITATION_CREATE_PERMISSIONS
    )
    if (!inviterMembership || !allowed) {
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
    const resolvedRole = await resolveOrganizationRole(
      ctx,
      args.orgId,
      args.role,
      args.roleId
    )

    const invitationId = await ctx.db.insert("invitations", {
      organizationId: args.orgId,
      email: args.email,
      role: resolvedRole.baseRole,
      roleId: resolvedRole.roleId ?? undefined,
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
      metadata: {
        email: args.email,
        role: resolvedRole.baseRole,
        roleKey: resolvedRole.key,
        roleName: resolvedRole.name,
      },
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
  args: {
    orgId: v.id("organizations"),
    viewerUserId: v.optional(v.id("users")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const viewerUserId = resolveViewerUserId(args)
    if (!viewerUserId) {
      return []
    }

    const membership = await getCanonicalOrgMembership(ctx, args.orgId, viewerUserId)
    const allowed = await hasAnyOrganizationPermission(
      ctx,
      membership,
      ORGANIZATION_INVITATION_READ_PERMISSIONS
    )
    if (!membership || !allowed) {
      throw new Error("Unauthorized to view invitations")
    }

    const now = Date.now()
    const invitations = await ctx.db
      .query("invitations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .filter((q) =>
        q.and(q.eq(q.field("status"), "pending"), q.gt(q.field("expiresAt"), now))
      )
      .collect()

    const members = await ctx.db
      .query("members")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .collect()

    const activeMemberEmails = new Set<string>()
    for (const membership of members) {
      const user = await ctx.db.get(membership.userId)
      if (user?.email) {
        activeMemberEmails.add(normalizeEmail(user.email))
      }
    }

    const visibleInvitations = invitations.filter(
      (invitation) => !activeMemberEmails.has(normalizeEmail(invitation.email))
    )

    return Promise.all(
      visibleInvitations.map(async (invitation) => {
        const role = await resolveOrganizationRole(
          ctx,
          args.orgId,
          invitation.role,
          invitation.roleId
        )
        return {
          ...invitation,
          roleId: role.roleId,
          roleKey: role.key,
          roleName: role.name,
          roleBaseRole: role.baseRole,
          inheritedPermissions: role.permissions,
          directGrants: invitation.permissionGrants ?? [],
          directDenies: invitation.permissionDenies ?? [],
          permissions: (
            await resolveInvitationAccess(ctx, invitation)
          )?.permissions ?? role.permissions,
        }
      })
    )
  },
})

export const reconcileForOrganizationFromWorkOS = mutation({
  args: {
    orgId: v.id("organizations"),
    syncedBy: v.id("users"),
    invitations: v.array(
      v.object({
        workosInvitationId: v.string(),
        email: v.string(),
        role: v.optional(roleBaseValidator),
        state: v.string(),
        expiresAt: v.optional(v.number()),
        createdAt: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const membership = await getCanonicalOrgMembership(ctx, args.orgId, args.syncedBy)
    const allowed = await hasOrganizationPermission(ctx, membership, "invitations:revoke")
    if (!membership || !allowed) {
      throw new Error("Unauthorized")
    }

    const existingInvitations = await ctx.db
      .query("invitations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .collect()

    const byWorkosId = new Map<string, (typeof existingInvitations)[number]>()
    const byPendingEmail = new Map<string, (typeof existingInvitations)[number]>()

    for (const invitation of existingInvitations) {
      if (invitation.workosInvitationId) {
        byWorkosId.set(invitation.workosInvitationId, invitation)
      }
      if (invitation.status === "pending") {
        byPendingEmail.set(normalizeEmail(invitation.email), invitation)
      }
    }

    const now = Date.now()

    for (const workosInvitation of args.invitations) {
      const normalizedEmail = normalizeEmail(workosInvitation.email)
      const nextStatus = normalizeWorkOSInvitationState(workosInvitation.state)
      const nextBaseRole = workosInvitation.role ?? "member"
      const nextRole = await resolveOrganizationRole(
        ctx,
        args.orgId,
        nextBaseRole
      )
      const existing =
        byWorkosId.get(workosInvitation.workosInvitationId) ??
        byPendingEmail.get(normalizedEmail) ??
        null
      const nextRoleId = await resolveCompatibleOrganizationRoleIdForBaseRole(
        ctx,
        args.orgId,
        nextRole.baseRole,
        existing?.roleId
      )

      if (existing) {
        await ctx.db.patch(existing._id, {
          email: workosInvitation.email,
          role: nextRole.baseRole,
          roleId: nextRoleId ?? existing.roleId,
          workosInvitationId: workosInvitation.workosInvitationId,
          status: nextStatus,
          expiresAt: workosInvitation.expiresAt ?? existing.expiresAt,
          createdAt: workosInvitation.createdAt ?? existing.createdAt,
        })
        continue
      }

      await ctx.db.insert("invitations", {
        organizationId: args.orgId,
        email: workosInvitation.email,
        role: nextRole.baseRole,
        roleId: nextRoleId ?? undefined,
        invitedBy: args.syncedBy,
        token: generateToken(),
        workosInvitationId: workosInvitation.workosInvitationId,
        status: nextStatus,
        expiresAt: workosInvitation.expiresAt ?? now + 7 * 24 * 60 * 60 * 1000,
        createdAt: workosInvitation.createdAt ?? now,
      })
    }

    return { synced: args.invitations.length }
  },
})

export const updateRoleByWorkOSInvitationId = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    workosInvitationId: v.string(),
    role: roleBaseValidator,
    roleId: v.optional(v.id("organizationRoles")),
  },
  handler: async (ctx, args) => {
    const membership = await getCanonicalOrgMembership(ctx, args.orgId, args.userId)
    const canAssignRoles = await hasAnyOrganizationPermission(
      ctx,
      membership,
      ORGANIZATION_ROLE_ASSIGN_PERMISSIONS
    )

    if (!membership || !canAssignRoles) {
      throw new Error("Unauthorized")
    }

    const invitation = (
      await ctx.db
        .query("invitations")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
        .collect()
    ).find((entry) => entry.workosInvitationId === args.workosInvitationId)

    if (!invitation) {
      throw new Error("Invitation not found")
    }

    if (invitation.status !== "pending") {
      throw new Error("Only pending invitations can be updated")
    }

    const resolvedRole = await resolveOrganizationRole(
      ctx,
      args.orgId,
      args.role,
      args.roleId
    )

    await ctx.db.patch(invitation._id, {
      role: resolvedRole.baseRole,
      roleId: resolvedRole.roleId ?? invitation.roleId,
    })

    await ctx.db.insert("auditLogs", {
      organizationId: invitation.organizationId,
      userId: args.userId,
      action: "invitation.role_updated",
      resourceType: "invitation",
      resourceId: invitation._id,
      metadata: {
        email: invitation.email,
        role: resolvedRole.baseRole,
        roleKey: resolvedRole.key,
        roleName: resolvedRole.name,
      },
      timestamp: Date.now(),
    })

    return {
      invitationId: invitation._id,
      roleId: resolvedRole.roleId,
      roleKey: resolvedRole.key,
      roleName: resolvedRole.name,
      roleBaseRole: resolvedRole.baseRole,
      permissions: resolvedRole.permissions,
    }
  },
})

export const updatePermissionOverrides = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    invitationId: v.id("invitations"),
    permissionGrants: v.array(organizationPermissionValidator),
    permissionDenies: v.array(organizationPermissionValidator),
  },
  handler: async (ctx, args) => {
    const membership = await getCanonicalOrgMembership(ctx, args.orgId, args.userId)
    const canAssignRoles = await hasAnyOrganizationPermission(
      ctx,
      membership,
      ORGANIZATION_ROLE_ASSIGN_PERMISSIONS
    )

    if (!membership || !canAssignRoles) {
      throw new Error("Unauthorized")
    }

    const invitation = await ctx.db.get(args.invitationId)
    if (!invitation || invitation.organizationId !== args.orgId) {
      throw new Error("Invitation not found")
    }

    if (invitation.status !== "pending") {
      throw new Error("Only pending invitations can be updated")
    }

    const sanitized = sanitizePermissionOverrides(
      args.permissionGrants,
      args.permissionDenies
    )

    await ctx.db.patch(args.invitationId, {
      permissionGrants: sanitized.permissionGrants,
      permissionDenies: sanitized.permissionDenies,
    })

    await ctx.db.insert("auditLogs", {
      organizationId: invitation.organizationId,
      userId: args.userId,
      action: "invitation.permissions_updated",
      resourceType: "invitation",
      resourceId: invitation._id,
      metadata: {
        email: invitation.email,
        ...sanitized,
      },
      timestamp: Date.now(),
    })

    const access = await resolveInvitationAccess(ctx, {
      ...invitation,
      permissionGrants: sanitized.permissionGrants,
      permissionDenies: sanitized.permissionDenies,
    })

    return {
      invitationId: invitation._id,
      directGrants: sanitized.permissionGrants,
      directDenies: sanitized.permissionDenies,
      inheritedPermissions: access?.inheritedPermissions ?? [],
      permissions: access?.permissions ?? [],
    }
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

    const membership = await getCanonicalOrgMembership(ctx, invitation.organizationId, args.userId)
    const allowed = await hasOrganizationPermission(ctx, membership, "invitations:revoke")
    if (!membership || !allowed) {
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
