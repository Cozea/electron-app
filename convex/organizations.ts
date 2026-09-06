import { ConvexError, v } from "convex/values"

import type { Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import {
  requireOrgAdmin,
  requireOrgMember,
} from "./lib/orgAccess"
import { canEditProject } from "./lib/projectAccess"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import {
  createGroupIdentityKey,
  isDeviceIdentityKey,
  isGroupIdentityKey,
  normalizeDeviceIdentityKey,
} from "../shared/deviceIdentity"

function requireServerSecret(serverSecret: string): void {
  const expected = process.env.AI_GATEWAY_SECRET
  if (!expected || serverSecret !== expected) throw new ConvexError("Unauthorized")
}

function normalizeOrgName(name: string): string {
  const normalized = name.trim()
  if (!normalized) {
    throw new ConvexError("Organization name cannot be blank")
  }
  return normalized
}

async function revokeOrganizationProjectKeys(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  identityKey: string,
  now: number,
): Promise<number> {
  const projects = await ctx.db.query("projects")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).collect()
  let affected = 0
  for (const project of projects) {
    const roomId = `project:${project._id}`
    const wrapped = await ctx.db.query("projectCollabWrappedKeys")
      .withIndex("by_project_room_and_recipient", (q) =>
        q.eq("projectId", project._id).eq("roomId", roomId).eq("recipientIdentityKey", identityKey)).collect()
    for (const key of wrapped) {
      if (!key.revokedAt) await ctx.db.patch(key._id, { revokedAt: now })
    }
    const pending = await ctx.db.query("projectCollabKeyRequests")
      .withIndex("by_project_room_and_device", (q) =>
        q.eq("projectId", project._id).eq("roomId", roomId).eq("recipientIdentityKey", identityKey)).collect()
    for (const request of pending) {
      if (!request.fulfilledAt) await ctx.db.patch(request._id, { fulfilledAt: now })
    }
    if (wrapped.length > 0) {
      const roomKeys = await ctx.db.query("projectCollabRoomKeys")
        .withIndex("by_project_and_room", (q) =>
          q.eq("projectId", project._id).eq("roomId", roomId)).collect()
      for (const roomKey of roomKeys) {
        if (roomKey.status === "active") await ctx.db.patch(roomKey._id, { status: "rotating" })
      }
      affected += 1
    }
  }
  return affected
}

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)

    const now = Date.now()
    const name = normalizeOrgName(args.name)
    const groupId = createGroupIdentityKey(crypto.randomUUID().replaceAll("-", ""))
    const organizationId = await ctx.db.insert("organizations", {
      groupId,
      name,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.insert("organizationMembers", {
      organizationId,
      principalId: user._id,
      role: "admin",
      addedAt: now,
      addedBy: user._id,
    })

    return { organizationId, groupId, name, role: "admin" as const }
  },
})

export const rename = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    await requireOrgAdmin(ctx, args.organizationId, user._id)
    const name = normalizeOrgName(args.name)
    await ctx.db.patch(args.organizationId, {
      name,
      updatedAt: Date.now(),
    })
    return { organizationId: args.organizationId, name }
  },
})

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuthenticatedDevice(ctx)
    const memberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_principal", (q) => q.eq("principalId", user._id))
      .collect()

    const rows = await Promise.all(
      memberships.map(async (membership) => {
        const organization = await ctx.db.get(membership.organizationId)
        if (!organization?.groupId || !isGroupIdentityKey(organization.groupId)) return null
        return {
          organizationId: organization._id,
          groupId: organization.groupId,
          name: organization.name,
          role: membership.role,
          createdAt: organization.createdAt,
          updatedAt: organization.updatedAt,
        }
      }),
    )

    return rows
      .flatMap((row) => (row ? [row] : []))
      .sort((left, right) => left.name.localeCompare(right.name))
  },
})

export const get = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const { organization, membership } = await requireOrgMember(
      ctx,
      args.organizationId,
      user._id,
    )
    return {
      organizationId: organization._id,
      groupId: organization.groupId,
      name: organization.name,
      role: membership?.role ?? "admin",
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      isCreator: organization.createdBy === user._id,
    }
  },
})

export const listMembers = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    await requireOrgMember(ctx, args.organizationId, user._id)

    const memberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .collect()

    const rows = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db.get(membership.principalId)
        return {
          membershipId: membership._id,
          principalId: membership.principalId,
          role: membership.role,
          addedAt: membership.addedAt,
          identityKey: user?.identityKey ?? "",
          displayName: user?.displayName ?? "Unknown device",
          platform: user?.platform ?? "unknown",
          avatarUrl: user?.avatarStorageId ? await ctx.storage.getUrl(user.avatarStorageId) : null,
        }
      }),
    )

    return rows.sort((left, right) => left.displayName.localeCompare(right.displayName))
  },
})

export const createDeviceEnrollment = mutation({
  args: {
    organizationId: v.id("organizations"),
    identityKey: v.string(),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    await requireOrgAdmin(ctx, args.organizationId, user._id)

    const identityKey = normalizeDeviceIdentityKey(args.identityKey)
    if (!isDeviceIdentityKey(identityKey)) {
      throw new ConvexError("Enter a valid Cozea device ID")
    }

    const targetUser = await ctx.db
      .query("devicePrincipals")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey))
      .unique()
    if (!targetUser || targetUser.status === "revoked") {
      throw new ConvexError("That device has not initialized Cozea yet")
    }

    const existing = await ctx.db
      .query("organizationMembers")
      .withIndex("by_organization_and_principal", (q) =>
        q.eq("organizationId", args.organizationId).eq("principalId", targetUser._id),
      )
      .unique()
    if (existing) {
      throw new ConvexError("That device is already a member")
    }

    const existingEnrollment = await ctx.db
      .query("organizationDeviceEnrollments")
      .withIndex("by_target_and_status", (q) =>
        q.eq("targetIdentityKey", identityKey).eq("status", "pending"),
      )
      .filter((q) => q.eq(q.field("organizationId"), args.organizationId))
      .first()
    if (existingEnrollment && existingEnrollment.expiresAt > Date.now()) {
      return { enrollmentId: existingEnrollment._id, created: false }
    }
    const now = Date.now()
    const enrollmentId = await ctx.db.insert("organizationDeviceEnrollments", {
      organizationId: args.organizationId,
      targetIdentityKey: identityKey,
      role: args.role ?? "member",
      status: "pending",
      createdBy: user._id,
      createdAt: now,
      expiresAt: now + 7 * 24 * 60 * 60_000,
    })
    await ctx.db.insert("identitySecurityEvents", {
      identityKey,
      actorIdentityKey: user.identityKey,
      organizationId: args.organizationId,
      eventType: "organization.enrollment_created",
      createdAt: now,
    })
    return { enrollmentId, created: true }
  },
})

export const listIncomingEnrollments = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuthenticatedDevice(ctx)
    const rows = await ctx.db.query("organizationDeviceEnrollments")
      .withIndex("by_target_and_status", (q) =>
        q.eq("targetIdentityKey", user.identityKey).eq("status", "pending"),
      ).collect()
    return await Promise.all(rows.filter((row) => row.expiresAt > Date.now()).map(async (row) => {
      const organization = await ctx.db.get(row.organizationId)
      return { ...row, organizationName: organization?.name ?? "Unknown group", groupId: organization?.groupId ?? "" }
    }))
  },
})

export const listEnrollments = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    await requireOrgAdmin(ctx, args.organizationId, user._id)
    return await ctx.db.query("organizationDeviceEnrollments")
      .withIndex("by_organization_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "pending"),
      ).collect()
  },
})

export const resolveDeviceEnrollment = mutation({
  args: {
    enrollmentId: v.id("organizationDeviceEnrollments"),
    accept: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const enrollment = await ctx.db.get(args.enrollmentId)
    if (!enrollment || enrollment.status !== "pending" || enrollment.targetIdentityKey !== user.identityKey) {
      throw new ConvexError("Enrollment is not available to this device")
    }
    const now = Date.now()
    if (enrollment.expiresAt <= now) {
      await ctx.db.patch(enrollment._id, { status: "expired", resolvedAt: now })
      throw new ConvexError("Enrollment has expired")
    }
    if (!args.accept) {
      await ctx.db.patch(enrollment._id, { status: "rejected", resolvedAt: now })
      return { accepted: false }
    }
    const existing = await ctx.db.query("organizationMembers")
      .withIndex("by_organization_and_principal", (q) =>
        q.eq("organizationId", enrollment.organizationId).eq("principalId", user._id),
      ).unique()
    if (!existing) {
      await ctx.db.insert("organizationMembers", {
        organizationId: enrollment.organizationId,
        principalId: user._id,
        role: enrollment.role,
        addedAt: now,
        addedBy: enrollment.createdBy,
      })
    }
    await ctx.db.patch(enrollment._id, { status: "accepted", resolvedAt: now })
    await ctx.db.insert("identitySecurityEvents", {
      identityKey: user.identityKey, actorIdentityKey: user.identityKey,
      organizationId: enrollment.organizationId,
      eventType: "organization.enrollment_accepted", createdAt: now,
    })
    return { accepted: true, organizationId: enrollment.organizationId }
  },
})

export const cancelDeviceEnrollment = mutation({
  args: { enrollmentId: v.id("organizationDeviceEnrollments") },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const enrollment = await ctx.db.get(args.enrollmentId)
    if (!enrollment || enrollment.status !== "pending") throw new ConvexError("Enrollment not found")
    await requireOrgAdmin(ctx, enrollment.organizationId, user._id)
    await ctx.db.patch(enrollment._id, { status: "cancelled", resolvedAt: Date.now() })
    return { cancelled: true }
  },
})

export const updateMemberRole = mutation({
  args: {
    organizationId: v.id("organizations"), memberPrincipalId: v.id("devicePrincipals"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const { organization } = await requireOrgAdmin(ctx, args.organizationId, user._id)
    const membership = await ctx.db.query("organizationMembers")
      .withIndex("by_organization_and_principal", (q) =>
        q.eq("organizationId", args.organizationId).eq("principalId", args.memberPrincipalId),
      ).unique()
    if (!membership) throw new ConvexError("Organization member not found")
    if (membership.role === "admin" && args.role === "member") {
      const admins = await ctx.db.query("organizationMembers")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
        .filter((q) => q.eq(q.field("role"), "admin")).collect()
      if (admins.length <= 1 || organization.createdBy === args.memberPrincipalId) {
        throw new ConvexError("Transfer ownership before demoting the last or owning admin")
      }
    }
    await ctx.db.patch(membership._id, { role: args.role })
    return { updated: true }
  },
})

export const transferAdministration = mutation({
  args: { organizationId: v.id("organizations"), memberPrincipalId: v.id("devicePrincipals") },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const { organization } = await requireOrgAdmin(ctx, args.organizationId, user._id)
    if (organization.createdBy !== user._id) throw new ConvexError("Only the owning admin can transfer ownership")
    const membership = await ctx.db.query("organizationMembers")
      .withIndex("by_organization_and_principal", (q) =>
        q.eq("organizationId", args.organizationId).eq("principalId", args.memberPrincipalId),
      ).unique()
    if (!membership) throw new ConvexError("Organization member not found")
    await ctx.db.patch(membership._id, { role: "admin" })
    await ctx.db.patch(args.organizationId, { createdBy: args.memberPrincipalId, updatedAt: Date.now() })
    return { transferred: true }
  },
})

export const createRecoveryGrantFromServer = mutation({
  args: {
    serverSecret: v.string(), organizationId: v.id("organizations"),
    actorIdentityKey: v.string(), verifierHash: v.string(), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const actor = await ctx.db.query("devicePrincipals").withIndex("by_identity_key", (q) =>
      q.eq("identityKey", normalizeDeviceIdentityKey(args.actorIdentityKey))).unique()
    if (!actor || actor.status === "revoked") throw new ConvexError("Active device not found")
    await requireOrgAdmin(ctx, args.organizationId, actor._id)
    const now = Date.now()
    const prior = await ctx.db.query("organizationRecoveryGrants")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId)).collect()
    await Promise.all(prior.filter((grant) => !grant.consumedAt && !grant.revokedAt)
      .map((grant) => ctx.db.patch(grant._id, { revokedAt: now })))
    const recoveryGrantId = await ctx.db.insert("organizationRecoveryGrants", {
      organizationId: args.organizationId, verifierHash: args.verifierHash,
      createdBy: actor._id, createdAt: now, expiresAt: args.expiresAt,
    })
    await ctx.db.insert("identitySecurityEvents", {
      actorIdentityKey: actor.identityKey, organizationId: args.organizationId,
      eventType: "organization.recovery_grant_created", createdAt: now,
    })
    return { recoveryGrantId }
  },
})

export const redeemRecoveryGrantFromServer = mutation({
  args: {
    serverSecret: v.string(), targetIdentityKey: v.string(), verifierHash: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const targetIdentityKey = normalizeDeviceIdentityKey(args.targetIdentityKey)
    const target = await ctx.db.query("devicePrincipals").withIndex("by_identity_key", (q) =>
      q.eq("identityKey", targetIdentityKey)).unique()
    if (!target || target.status === "revoked") throw new ConvexError("Active replacement device not found")
    const grant = await ctx.db.query("organizationRecoveryGrants")
      .withIndex("by_verifier_hash", (q) => q.eq("verifierHash", args.verifierHash)).unique()
    const now = Date.now()
    if (!grant || grant.consumedAt || grant.revokedAt || grant.expiresAt <= now) {
      throw new ConvexError("Recovery grant is expired, used, or invalid")
    }
    const existing = await ctx.db.query("organizationMembers")
      .withIndex("by_organization_and_principal", (q) =>
        q.eq("organizationId", grant.organizationId).eq("principalId", target._id)).unique()
    if (!existing) {
      await ctx.db.insert("organizationMembers", {
        organizationId: grant.organizationId, principalId: target._id, role: "admin",
        addedAt: now, addedBy: grant.createdBy,
      })
    }
    await ctx.db.patch(grant._id, { consumedAt: now, consumedBy: target._id })
    await ctx.db.insert("identitySecurityEvents", {
      identityKey: targetIdentityKey, actorIdentityKey: targetIdentityKey,
      organizationId: grant.organizationId,
      eventType: "organization.recovery_grant_redeemed", createdAt: now,
    })
    return { organizationId: grant.organizationId, recovered: true }
  },
})

export const removeMember = mutation({
  args: {
    organizationId: v.id("organizations"),
    memberPrincipalId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const { organization } = await requireOrgAdmin(ctx, args.organizationId, user._id)
    if (args.memberPrincipalId === organization.createdBy) {
      throw new ConvexError("The organization creator cannot be removed")
    }
    if (args.memberPrincipalId === user._id) {
      throw new ConvexError("Admins cannot remove themselves")
    }

    const membership = await ctx.db
      .query("organizationMembers")
      .withIndex("by_organization_and_principal", (q) =>
        q.eq("organizationId", args.organizationId).eq("principalId", args.memberPrincipalId),
      )
      .first()
    if (!membership) {
      throw new ConvexError("That person is not in this organization")
    }
    if (membership.role === "admin") {
      const admins = await ctx.db.query("organizationMembers")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
        .filter((q) => q.eq(q.field("role"), "admin")).collect()
      if (admins.length <= 1) throw new ConvexError("An organization must retain at least one admin")
    }

    const removed = await ctx.db.get(args.memberPrincipalId)
    await ctx.db.delete(membership._id)
    const projectsNeedingRotation = removed?.identityKey
      ? await revokeOrganizationProjectKeys(ctx, args.organizationId, removed.identityKey, Date.now())
      : 0
    await ctx.db.insert("identitySecurityEvents", {
      identityKey: removed?.identityKey,
      actorIdentityKey: user.identityKey,
      organizationId: args.organizationId,
      eventType: "organization.member_revoked",
      createdAt: Date.now(),
    })
    return { removed: true, projectsNeedingRotation }
  },
})

export const attachProject = mutation({
  args: {
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    await requireOrgMember(ctx, args.organizationId, user._id)
    if (!(await canEditProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("You do not have permission to attach this project")
    }

    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") {
      throw new ConvexError("Project not found")
    }
    if (project.organizationId && project.organizationId !== args.organizationId) {
      throw new ConvexError("This project already belongs to another organization")
    }

    await ctx.db.patch(args.projectId, {
      organizationId: args.organizationId,
      updatedAt: Date.now(),
    })

    return { projectId: args.projectId, organizationId: args.organizationId }
  },
})

export const createAndAttachProject = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canEditProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("You do not have permission to attach this project")
    }

    const groupId = createGroupIdentityKey(crypto.randomUUID().replaceAll("-", ""))
    const created = await ctx.db.insert("organizations", {
      groupId,
      name: normalizeOrgName(args.name),
      createdBy: user._id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    await ctx.db.insert("organizationMembers", {
      organizationId: created,
      principalId: user._id,
      role: "admin",
      addedAt: Date.now(),
      addedBy: user._id,
    })

    await ctx.db.patch(args.projectId, {
      organizationId: created,
      updatedAt: Date.now(),
    })

    return {
      organizationId: created as Id<"organizations">,
      groupId,
      projectId: args.projectId,
    }
  },
})
