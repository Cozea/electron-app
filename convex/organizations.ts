// @ts-nocheck
import { mutation, query, internalMutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { mapWorkOSRole } from "./lib/permissions"
import {
  ensureSystemOrganizationRoles,
  hasOrganizationPermission,
  listOrganizationRoles,
  organizationPermissionValidator,
  resolveMemberAccess,
  resolveOrganizationRole,
  roleBaseValidator,
} from "./lib/organizationRoles"
import {
  DEFAULT_ALLOWED_PROVIDERS,
  ORGANIZATION_MEMBER_READ_PERMISSIONS,
  ORGANIZATION_ROLE_ASSIGN_PERMISSIONS,
  ORGANIZATION_ROLE_CREATE_PERMISSIONS,
  ORGANIZATION_ROLE_DELETE_PERMISSIONS,
  ORGANIZATION_ROLE_READ_PERMISSIONS,
  ORGANIZATION_ROLE_UPDATE_PERMISSIONS,
  applyAcceptedInvitationRoleToMembership,
  buildEffectiveOrganizationPermissions,
  ensureAdministrativeWorkspaceAccessAfterMembershipChange,
  ensureAdministrativeWorkspaceAccessAfterRoleUpdate,
  estimateSnapshotBytes,
  getCanonicalOrgMembership,
  getCompatibleRoleIdForBaseRole,
  normalizeEmail,
  pickCanonicalMembership,
  pickCanonicalOrganization,
  pickCanonicalUser,
  requireAnyOrganizationPermission,
  requireOrganizationPermission,
  resolveUniqueOrganizationRoleKey,
  resolveUniqueSlug,
  resolveViewerUserId,
  rolePriority,
  sanitizeAllowedProviders,
  sanitizePermissionOverrides,
} from "./lib/organizationAccess"
import { checkSeatLimit } from "./lib/seatLimits"
import { getOrganizationPlanLabel } from "./lib/planNames"
import {
  applyProjectStorageDeltas,
  checkProjectLimit,
  checkStorageUsage,
  calculateStorageTotal,
  emptyBreakdown,
  estimateAiConversationBytes,
  estimateBuilderRunBytes,
  getPlanStorageLimitGB,
  formatBytes,
  rebuildOrganizationStorageUsageFromProjectAggregates,
  syncProjectStorageUsage,
  syncProjectStorageUsageFromSource,
} from "./lib/workspaceLimits"
import { resolveOrganizationBillingSnapshot } from "./lib/accountEntitlements"
import {
  getUtcDayStartTimestamp,
  getUtcMonthStartTimestamp,
} from "./lib/usagePeriods"
import {
  sanitizeWorkspaceIdentityInput,
  sanitizeWorkspaceIdentityUpdateInput,
} from "../shared/workspaceIdentity"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET
const PERSONAL_WORKSPACE_PREFIX = "personal:"
const STORAGE_RECALC_ORG_BATCH_SIZE = 10
const STORAGE_RECALC_PROJECT_BATCH_SIZE = 5

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}


// Sync organization from WorkOS
export const syncFromWorkOS = mutation({
  args: {
    workosId: v.string(),
    name: v.string(),
    iconKey: v.optional(v.union(v.string(), v.null())),
    iconColor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const identity = sanitizeWorkspaceIdentityUpdateInput({
      iconKey: args.iconKey,
      iconColor: args.iconColor,
    })

    // Check if org already exists.
    const orgMatches = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .collect()
    const existingOrg = pickCanonicalOrganization(orgMatches)

    if (existingOrg) {
      const shouldPreserveExistingName =
        existingOrg.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX) &&
        existingOrg.name.trim().length > 0
      // Ensure new schema fields exist while preserving existing data
      const updates: Record<string, unknown> = {
        name: shouldPreserveExistingName ? existingOrg.name : args.name,
        updatedAt: now,
      }

      if (identity.iconKey !== undefined) {
        updates.iconKey = identity.iconKey
      }
      if (identity.iconColor !== undefined) {
        updates.iconColor = identity.iconColor
      }

      if (!existingOrg.aiSettings) {
        updates.aiSettings = {
          allowedProviders: [...DEFAULT_ALLOWED_PROVIDERS],
          allowProviderTools: false,
          allowWebSearch: false,
          maxReasoningDepth: "high",
          defaultModelTier: "standard",
        }
      }

      if (!existingOrg.subscription || !existingOrg.subscription.plan) {
        updates.subscription = {
          plan: "free",
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now + 30 * 24 * 60 * 60 * 1000).getTime(),
        }
      }

      await ctx.db.patch(existingOrg._id, updates)

      return existingOrg._id
    }

    // Create new org with a deterministic unique slug.
    const slug = await resolveUniqueSlug(ctx, args.name)

    const periodStart = now
    const periodEnd = new Date(now + 30 * 24 * 60 * 60 * 1000).getTime()

    const orgId = await ctx.db.insert("organizations", {
      workosId: args.workosId,
      name: args.name,
      slug,
      iconKey: identity.iconKey ?? null,
      iconColor: identity.iconColor ?? null,
      aiSettings: {
        allowedProviders: [...DEFAULT_ALLOWED_PROVIDERS],
        allowProviderTools: false,
        allowWebSearch: false,
        maxReasoningDepth: "high",
        defaultModelTier: "standard",
      },
      subscription: {
        plan: "free",
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      createdAt: now,
      updatedAt: now,
    })

    await ensureSystemOrganizationRoles(ctx, orgId)

    return orgId
  },
})

// Sync membership from WorkOS
export const syncMembershipFromWorkOS = mutation({
  args: {
    workosId: v.string(), // membership ID from WorkOS
    workosOrgId: v.string(),
    workosUserId: v.string(),
    role: v.string(),
    status: v.union(v.literal("active"), v.literal("inactive"), v.literal("pending")),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    // Find org by WorkOS ID
    const orgMatches = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosOrgId))
      .collect()
    const org = pickCanonicalOrganization(orgMatches)

    if (!org) {
      throw new Error(`Organization not found for WorkOS ID: ${args.workosOrgId}`)
    }

    // Find user by WorkOS ID
    const userMatches = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosUserId))
      .collect()
    const user = pickCanonicalUser(userMatches)

    if (!user) {
      throw new Error(`User not found for WorkOS ID: ${args.workosUserId}`)
    }

    const byWorkosMemberships = await ctx.db
      .query("members")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .collect()
    const byOrgUserMemberships = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", org._id).eq("userId", user._id)
      )
      .collect()

    // Map WorkOS role to our internal role
    const combinedMemberships = new Map<string, Doc<"members">>()
    for (const membership of byWorkosMemberships) {
      combinedMemberships.set(String(membership._id), membership)
    }
    for (const membership of byOrgUserMemberships) {
      combinedMemberships.set(String(membership._id), membership)
    }

    // Active-only mirror: remove stale membership rows for non-active WorkOS states.
    if (args.status !== "active") {
      for (const membership of combinedMemberships.values()) {
        await ctx.db.delete(membership._id)
      }
      return "removed"
    }

    const canonicalMembership = pickCanonicalMembership([...combinedMemberships.values()])
    const role = mapWorkOSRole(args.role)
    const roleId = await getCompatibleRoleIdForBaseRole(
      ctx,
      org._id,
      role,
      canonicalMembership?.roleId
    )

    let membershipId: Id<"members">
    if (canonicalMembership) {
      membershipId = canonicalMembership._id
      await ctx.db.patch(canonicalMembership._id, {
        workosId: args.workosId,
        organizationId: org._id,
        userId: user._id,
        role,
          roleId: roleId ?? canonicalMembership.roleId,
          updatedAt: now,
        })
    } else {
      membershipId = await ctx.db.insert("members", {
        workosId: args.workosId,
        organizationId: org._id,
        userId: user._id,
        role,
        roleId: roleId ?? undefined,
        joinedAt: now,
        updatedAt: now,
      })
    }

    // Remove duplicates for this org-user/workos tuple.
    for (const membership of combinedMemberships.values()) {
      if (membership._id === membershipId) continue
      await ctx.db.delete(membership._id)
    }

    // Mark any pending invitations for this user's email as accepted
    await applyAcceptedInvitationRoleToMembership(ctx, org._id, user, membershipId)

    return membershipId
  },
})

// Reconcile the full active membership set for a WorkOS user.
export const reconcileMembershipSetFromWorkOS = mutation({
  args: {
    workosUserId: v.string(),
    memberships: v.array(
      v.object({
        workosId: v.string(),
        workosOrgId: v.string(),
        workosUserId: v.optional(v.string()),
        role: v.string(),
        status: v.union(v.literal("active"), v.literal("inactive"), v.literal("pending")),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const userMatches = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosUserId))
      .collect()
    const user = pickCanonicalUser(userMatches)

    if (!user) {
      throw new Error(`User not found for WorkOS ID: ${args.workosUserId}`)
    }

    const activeInputs = args.memberships.filter((membership) => membership.status === "active")
    const activeOrgIds = new Set<Id<"organizations">>()
    const activeEmailByOrg = new Map<string, Set<string>>()

    for (const input of activeInputs) {
      const orgMatches = await ctx.db
        .query("organizations")
        .withIndex("by_workos_id", (q) => q.eq("workosId", input.workosOrgId))
        .collect()
      const org = pickCanonicalOrganization(orgMatches)
      if (!org) continue

      activeOrgIds.add(org._id)

      const byWorkosMemberships = await ctx.db
        .query("members")
        .withIndex("by_workos_id", (q) => q.eq("workosId", input.workosId))
        .collect()
      const byOrgUserMemberships = await ctx.db
        .query("members")
        .withIndex("by_organization_and_user", (q) =>
          q.eq("organizationId", org._id).eq("userId", user._id)
        )
        .collect()

      const combinedMemberships = new Map<string, Doc<"members">>()
      for (const membership of byWorkosMemberships) {
        combinedMemberships.set(String(membership._id), membership)
      }
      for (const membership of byOrgUserMemberships) {
        combinedMemberships.set(String(membership._id), membership)
      }

      const canonical = pickCanonicalMembership([...combinedMemberships.values()])
      const role = mapWorkOSRole(input.role)
      const roleId = await getCompatibleRoleIdForBaseRole(
        ctx,
        org._id,
        role,
        canonical?.roleId
      )
      let canonicalId: Id<"members">
      if (canonical) {
        canonicalId = canonical._id
        await ctx.db.patch(canonical._id, {
          workosId: input.workosId,
          organizationId: org._id,
          userId: user._id,
          role,
          roleId: roleId ?? canonical.roleId,
          updatedAt: now,
        })
      } else {
        canonicalId = await ctx.db.insert("members", {
          workosId: input.workosId,
          organizationId: org._id,
          userId: user._id,
          role,
          roleId: roleId ?? undefined,
          joinedAt: now,
          updatedAt: now,
        })
      }

      for (const membership of combinedMemberships.values()) {
        if (membership._id === canonicalId) continue
        await ctx.db.delete(membership._id)
      }

      await applyAcceptedInvitationRoleToMembership(ctx, org._id, user, canonicalId)

      const emailSet = activeEmailByOrg.get(String(org._id)) ?? new Set<string>()
      emailSet.add(normalizeEmail(user.email))
      activeEmailByOrg.set(String(org._id), emailSet)
    }

    const currentMemberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()

    let removedCount = 0
    for (const membership of currentMemberships) {
      if (!activeOrgIds.has(membership.organizationId)) {
        const organization = await ctx.db.get(membership.organizationId)
        if (organization?.workosId?.startsWith(PERSONAL_WORKSPACE_PREFIX)) {
          continue
        }
        await ctx.db.delete(membership._id)
        removedCount += 1
      }
    }

    for (const [orgKey, activeEmails] of activeEmailByOrg.entries()) {
      const orgId = orgKey as Id<"organizations">
      const pendingInvitations = await ctx.db
        .query("invitations")
        .withIndex("by_organization", (q) => q.eq("organizationId", orgId))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .collect()

      for (const invitation of pendingInvitations) {
        if (activeEmails.has(normalizeEmail(invitation.email))) {
          await ctx.db.patch(invitation._id, { status: "accepted" })
        }
      }
    }

    return {
      activeCount: activeInputs.length,
      removedCount,
    }
  },
})

// Get organization by WorkOS ID
export const getByWorkosId = query({
  args: { workosId: v.string() },
  handler: async (ctx, args) => {
    const orgs = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .collect()
    const org = pickCanonicalOrganization(orgs)

    if (!org) return null
    return org
  },
})

// Server-only: return org with decrypted keys
export const getByWorkosIdForServer = query({
  args: {
    workosId: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const orgs = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .collect()
    const org = pickCanonicalOrganization(orgs)

    if (!org) return null
    return org
  },
})

// Server-only: verify membership (used by AI Gateway)
export const isUserMemberForServer = query({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const memberships = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.userId)
      )
      .collect()
    const membership = pickCanonicalMembership(memberships)

    return !!membership
  },
})

export const getMemberRoleForServer = query({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const membership = await getCanonicalOrgMembership(ctx, args.organizationId, args.userId)
    return membership?.role || null
  },
})

export const getMemberAccessForServer = query({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const membership = await getCanonicalOrgMembership(ctx, args.organizationId, args.userId)
    const access = await resolveMemberAccess(ctx, membership)
    if (!access) return null

    return {
      role: access.legacyRole,
      roleId: access.roleId,
      roleKey: access.key,
      roleName: access.name,
      baseRole: access.baseRole,
      permissions: access.permissions,
    }
  },
})

// Create a new organization (legacy - use syncFromWorkOS for WorkOS-managed orgs)
export const create = mutation({
  args: {
    workosId: v.string(),
    name: v.string(),
    slug: v.string(),
    createdBy: v.id("users"),
    memberWorkosId: v.string(), // WorkOS membership ID for the creator
    iconKey: v.optional(v.union(v.string(), v.null())),
    iconColor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const identity = sanitizeWorkspaceIdentityInput({
      iconKey: args.iconKey,
      iconColor: args.iconColor,
    })

    const existingByWorkos = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .collect()
    const existingOrg = pickCanonicalOrganization(existingByWorkos)
    if (existingOrg) {
      return existingOrg._id
    }

    const resolvedSlug = await resolveUniqueSlug(ctx, args.slug)

    // Create organization
    const periodStart = now
    const periodEnd = new Date(now + 30 * 24 * 60 * 60 * 1000).getTime()

    const orgId = await ctx.db.insert("organizations", {
      workosId: args.workosId,
      name: args.name,
      slug: resolvedSlug,
      iconKey: identity.iconKey ?? null,
      iconColor: identity.iconColor ?? null,
      aiSettings: {
        allowedProviders: [...DEFAULT_ALLOWED_PROVIDERS],
        allowProviderTools: false,
        allowWebSearch: false,
        maxReasoningDepth: "high",
        defaultModelTier: "standard",
      },
      subscription: {
        plan: "free",
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      createdAt: now,
      updatedAt: now,
    })

    await ensureSystemOrganizationRoles(ctx, orgId)
    const adminRoleId = await getCompatibleRoleIdForBaseRole(ctx, orgId, "admin")

    // Add creator as admin
    await ctx.db.insert("members", {
      workosId: args.memberWorkosId,
      organizationId: orgId,
      userId: args.createdBy,
      role: "admin",
      roleId: adminRoleId ?? undefined,
      joinedAt: now,
      updatedAt: now,
    })

    // Create audit log
    await ctx.db.insert("auditLogs", {
      organizationId: orgId,
      userId: args.createdBy,
      action: "organization.created",
      resourceType: "organization",
      resourceId: orgId,
      timestamp: now,
    })

    return orgId
  },
})

// Get organization by ID
export const get = query({
  args: { id: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.id)
    if (!org) return null
    return org
  },
})

// Get organization by slug
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const orgs = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .collect()
    const org = pickCanonicalOrganization(orgs)

    if (!org) return null
    return org
  },
})

// Update AI policy settings (admin only)
export const updateAiSettings = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    aiSettings: v.object({
      allowedProviders: v.array(
        v.union(
          v.literal("anthropic"),
          v.literal("openai"),
          v.literal("google"),
          v.literal("xai"),
          v.literal("moonshotai")
        )
      ),
      allowedModels: v.optional(v.array(v.string())),
      allowProviderTools: v.optional(v.boolean()),
      allowWebSearch: v.optional(v.boolean()),
      maxReasoningDepth: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
      monthlySpendingCapCents: v.optional(v.number()),
      defaultModelTier: v.optional(v.union(v.literal("fast"), v.literal("standard"), v.literal("powerful"))),
    }),
  },
  handler: async (ctx, args) => {
    const { allowed } = await requireOrganizationPermission(
      ctx,
      args.orgId,
      args.userId,
      "settings:update"
    )
    if (!allowed) {
      throw new Error("Unauthorized")
    }

    const org = await ctx.db.get(args.orgId)
    if (!org) throw new Error("Organization not found")

    const sanitizedAllowedProviders = sanitizeAllowedProviders(args.aiSettings.allowedProviders)

    const now = Date.now()
    await ctx.db.patch(args.orgId, {
      aiSettings: {
        ...(org.aiSettings || {}),
        ...args.aiSettings,
        allowedProviders: sanitizedAllowedProviders,
      },
      updatedAt: now,
    })

    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.userId,
      action: "ai_settings.updated",
      resourceType: "organization",
      resourceId: args.orgId,
      metadata: {
        ...args.aiSettings,
        allowedProviders: sanitizedAllowedProviders,
      },
      timestamp: now,
    })
  },
})

export const updateSourceControlSettings = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    sourceControlSettings: v.object({
      defaultProvider: v.optional(
        v.union(v.literal("github"), v.literal("gitlab"), v.null())
      ),
    }),
  },
  handler: async (ctx, args) => {
    const { allowed } = await requireOrganizationPermission(
      ctx,
      args.orgId,
      args.userId,
      "settings:update"
    )
    if (!allowed) {
      throw new Error("Unauthorized")
    }

    const org = await ctx.db.get(args.orgId)
    if (!org) throw new Error("Organization not found")

    const now = Date.now()
    const nextSourceControlSettings: NonNullable<typeof org.sourceControlSettings> = {
      ...(org.sourceControlSettings || {}),
    }
    if (args.sourceControlSettings.defaultProvider === null) {
      delete nextSourceControlSettings.defaultProvider
    } else if (args.sourceControlSettings.defaultProvider !== undefined) {
      nextSourceControlSettings.defaultProvider = args.sourceControlSettings.defaultProvider
    }

    await ctx.db.patch(args.orgId, {
      sourceControlSettings: nextSourceControlSettings,
      updatedAt: now,
    })

    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.userId,
      action: "source_control_settings.updated",
      resourceType: "organization",
      resourceId: args.orgId,
      metadata: {
        ...args.sourceControlSettings,
      },
      timestamp: now,
    })
  },
})

// Update organization details (name, slug, description)
export const updateOrganization = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
    iconKey: v.optional(v.union(v.string(), v.null())),
    iconColor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    // Verify user is admin
    const { allowed } = await requireOrganizationPermission(
      ctx,
      args.orgId,
      args.userId,
      "settings:update"
    )
    if (!allowed) {
      throw new Error("Unauthorized")
    }

    const org = await ctx.db.get(args.orgId)
    if (!org) throw new Error("Organization not found")

    const now = Date.now()
    const updates: Record<string, unknown> = { updatedAt: now }
    const identity = sanitizeWorkspaceIdentityUpdateInput({
      iconKey: args.iconKey,
      iconColor: args.iconColor,
    })

    if (args.name !== undefined) updates.name = args.name
    if (args.slug !== undefined) {
      updates.slug =
        args.slug === org.slug ? org.slug : await resolveUniqueSlug(ctx, args.slug, args.orgId)
    }
    if (args.description !== undefined) updates.description = args.description
    if (identity.iconKey !== undefined) updates.iconKey = identity.iconKey
    if (identity.iconColor !== undefined) updates.iconColor = identity.iconColor

    await ctx.db.patch(args.orgId, updates)

    // Audit log
    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.userId,
      action: "organization.updated",
      resourceType: "organization",
      resourceId: args.orgId,
      metadata: {
        name: args.name,
        slug: args.slug,
        description: args.description,
        iconKey: identity.iconKey,
        iconColor: identity.iconColor,
      },
      timestamp: now,
    })
  },
})

// Get organization members
export const getMembers = query({
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

    const { allowed } = await requireAnyOrganizationPermission(
      ctx,
      args.orgId,
      viewerUserId,
      ORGANIZATION_MEMBER_READ_PERMISSIONS
    )
    if (!allowed) {
      throw new Error("Unauthorized to view organization members")
    }

    const memberships = await ctx.db
      .query("members")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .collect()
    const byUser = new Map<string, Doc<"members">>()
    for (const membership of memberships) {
      const key = String(membership.userId)
      const existing = byUser.get(key)
      if (!existing || rolePriority(membership.role) > rolePriority(existing.role) ||
        ((membership.updatedAt || 0) >= (existing.updatedAt || 0) &&
          rolePriority(membership.role) === rolePriority(existing.role))) {
        byUser.set(key, membership)
      }
    }

    return await Promise.all(
      [...byUser.values()].map(async (m) => {
        const user = await ctx.db.get(m.userId)
        const access = await resolveMemberAccess(ctx, m)
        return {
          ...m,
          roleId: access?.roleId ?? null,
          roleKey: access?.key ?? m.role,
          roleName: access?.name ?? m.role,
          roleBaseRole: access?.baseRole ?? m.role,
          inheritedPermissions: access?.inheritedPermissions ?? [],
          directGrants: access?.directGrants ?? [],
          directDenies: access?.directDenies ?? [],
          permissions: access?.permissions ?? [],
          user: user
            ? {
                id: user._id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                profileImageUrl: user.profileImageUrl,
              }
            : null,
        }
      })
    )
  },
})

// Get a single member by ID
export const getMember = query({
  args: {
    orgId: v.id("organizations"),
    viewerUserId: v.optional(v.id("users")),
    userId: v.optional(v.id("users")),
    memberId: v.id("members"),
  },
  handler: async (ctx, args) => {
    const viewerUserId = resolveViewerUserId(args)
    if (!viewerUserId) {
      return null
    }

    const { allowed } = await requireAnyOrganizationPermission(
      ctx,
      args.orgId,
      viewerUserId,
      ORGANIZATION_MEMBER_READ_PERMISSIONS
    )
    if (!allowed) {
      throw new Error("Unauthorized to view organization members")
    }

    const membership = await ctx.db.get(args.memberId)

    if (!membership || membership.organizationId !== args.orgId) {
      return null
    }

    const user = await ctx.db.get(membership.userId)
    const access = await resolveMemberAccess(ctx, membership)

    return {
      ...membership,
      roleId: access?.roleId ?? null,
      roleKey: access?.key ?? membership.role,
      roleName: access?.name ?? membership.role,
      roleBaseRole: access?.baseRole ?? membership.role,
      inheritedPermissions: access?.inheritedPermissions ?? [],
      directGrants: access?.directGrants ?? [],
      directDenies: access?.directDenies ?? [],
      permissions: access?.permissions ?? [],
      user: user
        ? {
            id: user._id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            profileImageUrl: user.profileImageUrl,
          }
        : null,
    }
  },
})

// Remove a member from organization
export const removeMember = mutation({
  args: {
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    removedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Verify remover has permission
    const removerMembership = await getCanonicalOrgMembership(ctx, args.orgId, args.removedBy)
    const allowed = await hasOrganizationPermission(ctx, removerMembership, "members:remove")
    if (!removerMembership || !allowed) {
      throw new Error("Unauthorized to remove members")
    }

    // Get the membership to be removed
    const targetMembership = await ctx.db.get(args.memberId)
    if (!targetMembership || targetMembership.organizationId !== args.orgId) {
      throw new Error("Member not found")
    }

    // Prevent self-removal
    if (targetMembership.userId === args.removedBy) {
      throw new Error("Cannot remove yourself from the organization")
    }

    const targetAccess = await resolveMemberAccess(ctx, targetMembership)
    await ensureAdministrativeWorkspaceAccessAfterMembershipChange(
      ctx,
      args.orgId,
      targetMembership,
      targetAccess?.permissions,
      []
    )

    // Get user info for audit log
    const targetUser = await ctx.db.get(targetMembership.userId)

    // Delete the membership
    await ctx.db.delete(args.memberId)

    // Audit log
    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.removedBy,
      action: "member.removed",
      resourceType: "member",
      resourceId: args.memberId,
      metadata: { email: targetUser?.email, role: targetMembership.role },
      timestamp: Date.now(),
    })
  },
})

// Update a member's role
export const updateMemberRole = mutation({
  args: {
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    newRole: v.union(v.literal("admin"), v.literal("member"), v.literal("viewer")),
    newRoleId: v.optional(v.id("organizationRoles")),
    updatedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { allowed } = await requireAnyOrganizationPermission(
      ctx,
      args.orgId,
      args.updatedBy,
      ORGANIZATION_ROLE_ASSIGN_PERMISSIONS
    )
    if (!allowed) {
      throw new Error("Unauthorized to change member roles")
    }

    // Get the target membership
    const targetMembership = await ctx.db.get(args.memberId)
    if (!targetMembership || targetMembership.organizationId !== args.orgId) {
      throw new Error("Member not found")
    }

    // Prevent changing own role (admins shouldn't demote themselves)
    if (targetMembership.userId === args.updatedBy) {
      throw new Error("Cannot change your own role")
    }

    const now = Date.now()
    const oldRole = targetMembership.role
    const currentAccess = await resolveMemberAccess(ctx, targetMembership)
    const nextRole = await resolveOrganizationRole(
      ctx,
      args.orgId,
      args.newRole,
      args.newRoleId
    )
    const nextPermissions = buildEffectiveOrganizationPermissions(
      nextRole.permissions,
      targetMembership.permissionGrants,
      targetMembership.permissionDenies
    )

    await ensureAdministrativeWorkspaceAccessAfterMembershipChange(
      ctx,
      args.orgId,
      targetMembership,
      currentAccess?.permissions,
      nextPermissions
    )

    // Update the role
    await ctx.db.patch(args.memberId, {
      role: nextRole.baseRole,
      roleId: nextRole.roleId ?? undefined,
      updatedAt: now,
    })

    // Get user info for audit log
    const targetUser = await ctx.db.get(targetMembership.userId)

    // Audit log
    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.updatedBy,
      action: "member.role_changed",
      resourceType: "member",
      resourceId: args.memberId,
      metadata: {
        email: targetUser?.email,
        oldRole,
        newRole: nextRole.baseRole,
        newRoleKey: nextRole.key,
        newRoleName: nextRole.name,
      },
      timestamp: now,
    })
  },
})

export const updateMemberPermissionOverrides = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    memberId: v.id("members"),
    permissionGrants: v.array(organizationPermissionValidator),
    permissionDenies: v.array(organizationPermissionValidator),
  },
  handler: async (ctx, args) => {
    const { allowed } = await requireAnyOrganizationPermission(
      ctx,
      args.orgId,
      args.userId,
      ORGANIZATION_ROLE_ASSIGN_PERMISSIONS
    )
    if (!allowed) {
      throw new Error("Unauthorized to manage direct permissions")
    }

    const targetMembership = await ctx.db.get(args.memberId)
    if (!targetMembership || targetMembership.organizationId !== args.orgId) {
      throw new Error("Member not found")
    }

    if (targetMembership.userId === args.userId) {
      throw new Error("Cannot change your own direct permissions")
    }

    const sanitized = sanitizePermissionOverrides(
      args.permissionGrants,
      args.permissionDenies
    )

    const currentAccess = await resolveMemberAccess(ctx, targetMembership)
    const nextRole = await resolveOrganizationRole(
      ctx,
      args.orgId,
      targetMembership.role,
      targetMembership.roleId
    )
    const nextPermissions = buildEffectiveOrganizationPermissions(
      nextRole.permissions,
      sanitized.permissionGrants,
      sanitized.permissionDenies
    )

    await ensureAdministrativeWorkspaceAccessAfterMembershipChange(
      ctx,
      args.orgId,
      targetMembership,
      currentAccess?.permissions,
      nextPermissions
    )

    await ctx.db.patch(args.memberId, {
      permissionGrants: sanitized.permissionGrants,
      permissionDenies: sanitized.permissionDenies,
      updatedAt: Date.now(),
    })

    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.userId,
      action: "member.permissions_updated",
      resourceType: "member",
      resourceId: args.memberId,
      metadata: sanitized,
      timestamp: Date.now(),
    })
  },
})

export const listRoles = query({
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

    const { allowed } = await requireAnyOrganizationPermission(
      ctx,
      args.orgId,
      viewerUserId,
      ORGANIZATION_ROLE_READ_PERMISSIONS
    )
    if (!allowed) {
      throw new Error("Unauthorized to view organization roles")
    }

    const roles = await listOrganizationRoles(ctx, args.orgId)
    return roles.map((role) => ({
      _id: role._id,
      key: role.key,
      name: role.name,
      description: role.description,
      baseRole: role.baseRole,
      permissions: role.permissions,
      isSystem: role.isSystem,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    }))
  },
})

export const createRole = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    name: v.string(),
    description: v.string(),
    baseRole: roleBaseValidator,
    permissions: v.array(organizationPermissionValidator),
  },
  handler: async (ctx, args) => {
    const { allowed } = await requireAnyOrganizationPermission(
      ctx,
      args.orgId,
      args.userId,
      ORGANIZATION_ROLE_CREATE_PERMISSIONS
    )
    if (!allowed) {
      throw new Error("Unauthorized to manage roles")
    }

    const now = Date.now()
    const trimmedName = args.name.trim()
    if (!trimmedName) {
      throw new Error("Role name is required")
    }

    const permissions = normalizePermissionList(args.permissions)
    const key = await resolveUniqueOrganizationRoleKey(ctx, args.orgId, trimmedName)
    const roleId = await ctx.db.insert("organizationRoles", {
      organizationId: args.orgId,
      key,
      name: trimmedName,
      description: args.description.trim(),
      baseRole: args.baseRole,
      permissions,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.userId,
      action: "role.created",
      resourceType: "organizationRole",
      resourceId: roleId,
      metadata: {
        key,
        name: trimmedName,
        baseRole: args.baseRole,
      },
      timestamp: now,
    })

    return roleId
  },
})

export const updateRole = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    roleId: v.id("organizationRoles"),
    name: v.string(),
    description: v.string(),
    baseRole: roleBaseValidator,
    permissions: v.array(organizationPermissionValidator),
  },
  handler: async (ctx, args) => {
    const { allowed } = await requireAnyOrganizationPermission(
      ctx,
      args.orgId,
      args.userId,
      ORGANIZATION_ROLE_UPDATE_PERMISSIONS
    )
    if (!allowed) {
      throw new Error("Unauthorized to manage roles")
    }

    const role = await ctx.db.get(args.roleId)
    if (!role || role.organizationId !== args.orgId) {
      throw new Error("Role not found")
    }
    if (role.isSystem) {
      throw new Error("System roles cannot be edited")
    }

    const trimmedName = args.name.trim()
    if (!trimmedName) {
      throw new Error("Role name is required")
    }

    const nextPermissions = normalizePermissionList(args.permissions)
    await ensureAdministrativeWorkspaceAccessAfterRoleUpdate(
      ctx,
      args.orgId,
      args.roleId,
      nextPermissions
    )

    const now = Date.now()
    await ctx.db.patch(args.roleId, {
      name: trimmedName,
      description: args.description.trim(),
      baseRole: args.baseRole,
      permissions: nextPermissions,
      updatedAt: now,
    })

    if (role.baseRole !== args.baseRole) {
      const [membersUsingRole, invitesUsingRole] = await Promise.all([
        ctx.db
          .query("members")
          .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
          .filter((q) => q.eq(q.field("roleId"), args.roleId))
          .collect(),
        ctx.db
          .query("invitations")
          .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
          .filter((q) => q.eq(q.field("roleId"), args.roleId))
          .collect(),
      ])

      for (const membership of membersUsingRole) {
        await ctx.db.patch(membership._id, {
          role: args.baseRole,
          updatedAt: now,
        })
      }

      for (const invitation of invitesUsingRole) {
        await ctx.db.patch(invitation._id, {
          role: args.baseRole,
        })
      }
    }

    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.userId,
      action: "role.updated",
      resourceType: "organizationRole",
      resourceId: args.roleId,
      metadata: {
        key: role.key,
        name: trimmedName,
        baseRole: args.baseRole,
      },
      timestamp: now,
    })
  },
})

export const deleteRole = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    roleId: v.id("organizationRoles"),
  },
  handler: async (ctx, args) => {
    const { allowed } = await requireAnyOrganizationPermission(
      ctx,
      args.orgId,
      args.userId,
      ORGANIZATION_ROLE_DELETE_PERMISSIONS
    )
    if (!allowed) {
      throw new Error("Unauthorized to manage roles")
    }

    const role = await ctx.db.get(args.roleId)
    if (!role || role.organizationId !== args.orgId) {
      throw new Error("Role not found")
    }
    if (role.isSystem) {
      throw new Error("System roles cannot be deleted")
    }

    const memberUsingRole = await ctx.db
      .query("members")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .filter((q) => q.eq(q.field("roleId"), args.roleId))
      .first()
    if (memberUsingRole) {
      throw new Error("Reassign members using this role before deleting it")
    }

    const inviteUsingRole = await ctx.db
      .query("invitations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .filter((q) => q.eq(q.field("roleId"), args.roleId))
      .first()
    if (inviteUsingRole) {
      throw new Error("Revoke or update pending invites using this role before deleting it")
    }

    await ctx.db.delete(args.roleId)
    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.userId,
      action: "role.deleted",
      resourceType: "organizationRole",
      resourceId: args.roleId,
      metadata: {
        key: role.key,
        name: role.name,
      },
      timestamp: Date.now(),
    })
  },
})

export const getCurrentMemberAccess = query({
  args: {
    orgId: v.id("organizations"),
    viewerUserId: v.optional(v.id("users")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const viewerUserId = resolveViewerUserId(args)
    if (!viewerUserId) {
      return null
    }

    const membership = await getCanonicalOrgMembership(
      ctx,
      args.orgId,
      viewerUserId
    )
    const access = await resolveMemberAccess(ctx, membership)
    if (!membership || !access) return null

    return {
      memberId: membership._id,
      legacyRole: membership.role,
      roleId: access.roleId,
      roleKey: access.key,
      roleName: access.name,
      baseRole: access.baseRole,
      inheritedPermissions: access.inheritedPermissions,
      directGrants: access.directGrants,
      directDenies: access.directDenies,
      permissions: access.permissions,
    }
  },
})

export const getRoleForServer = query({
  args: {
    organizationId: v.id("organizations"),
    roleId: v.id("organizationRoles"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const role = await ctx.db.get(args.roleId)
    if (!role || role.organizationId !== args.organizationId) {
      return null
    }

    return {
      _id: role._id,
      key: role.key,
      name: role.name,
      baseRole: role.baseRole,
      permissions: role.permissions,
      isSystem: role.isSystem,
    }
  },
})

// Get usage summary for organization
export const getUsageSummary = query({
  args: {
    orgId: v.id("organizations"),
    period: v.union(v.literal("daily"), v.literal("monthly")),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId)
    const billingSnapshot = org
      ? await resolveOrganizationBillingSnapshot(ctx, {
          organization: org,
        })
      : null

    return {
      aggregate: null,
      trackedUsage: {
        totalTrackedUnits: 0,
      },
      billingSnapshot,
      subscription: org
        ? {
            ...org.subscription,
            plan: billingSnapshot?.plan ?? org.subscription.plan,
            status: billingSnapshot?.status ?? org.subscription.status,
            currentPeriodStart:
              billingSnapshot?.currentPeriodStart ?? org.subscription.currentPeriodStart,
            currentPeriodEnd:
              billingSnapshot?.currentPeriodEnd ?? org.subscription.currentPeriodEnd,
          }
        : null,
    }
  },
})

// Delete organization and all related data
export const deleteOrganization = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    confirmName: v.string(), // Must match org name for safety
  },
  handler: async (ctx, args) => {
    const membership = await getCanonicalOrgMembership(ctx, args.orgId, args.userId)
    const canDeleteWorkspace = await hasOrganizationPermission(ctx, membership, "org:delete")

    if (!canDeleteWorkspace) {
      throw new Error("Only admins can delete the workspace")
    }

    const org = await ctx.db.get(args.orgId)
    if (!org) throw new Error("Organization not found")

    // Verify confirmation name matches
    if (args.confirmName !== org.name) {
      throw new Error("Workspace name does not match")
    }

    // Delete all related data
    // 1. Delete all members
    const members = await ctx.db
      .query("members")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .collect()
    for (const member of members) {
      await ctx.db.delete(member._id)
    }

    // 2. Delete all invitations
    const invitations = await ctx.db
      .query("invitations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .collect()
    for (const invitation of invitations) {
      await ctx.db.delete(invitation._id)
    }

    // 3. Delete all integrations
    const integrations = await ctx.db
      .query("integrations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .collect()
    for (const integration of integrations) {
      await ctx.db.delete(integration._id)
    }

    // 6. Delete all audit logs
    const auditLogs = await ctx.db
      .query("auditLogs")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .collect()
    for (const log of auditLogs) {
      await ctx.db.delete(log._id)
    }

    // Finally, delete the organization
    await ctx.db.delete(args.orgId)

    return { success: true }
  },
})

// Get seat status for organization (used by UI to show limits)
export const getSeatStatus = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await checkSeatLimit(ctx, args.orgId)
  },
})

// Get usage limits and current usage for an organization
// Used by Settings and Sync pages to display usage information
export const getUsageLimits = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId)
    if (!org) return null

    const billingSnapshot = await resolveOrganizationBillingSnapshot(ctx, {
      organization: org,
    })
    const plan = billingSnapshot.plan
    const planDisplayName = getOrganizationPlanLabel(plan)

    // Get all limits
    const projectStatus = await checkProjectLimit(ctx, args.orgId)
    const storageStatus = await checkStorageUsage(ctx, args.orgId)
    const seatStatus = await checkSeatLimit(ctx, args.orgId)

    return {
      plan,
      planDisplayName,

      // Project limits
      projects: {
        current: projectStatus.current,
        limit: projectStatus.limit,
        isUnlimited: projectStatus.isUnlimited,
        allowed: projectStatus.allowed,
        message: projectStatus.message,
      },

      // Storage limits
      storage: {
        currentBytes: storageStatus.currentBytes,
        limitBytes: storageStatus.limitBytes,
        currentFormatted: formatBytes(storageStatus.currentBytes),
        limitFormatted: storageStatus.isUnlimited
          ? "Unlimited"
          : formatBytes(storageStatus.limitBytes),
        limitGB: getPlanStorageLimitGB(plan),
        usagePercent: storageStatus.usagePercent,
        isUnlimited: storageStatus.isUnlimited,
        allowed: storageStatus.allowed,
        breakdown: storageStatus.breakdown,
        message: storageStatus.message,
      },

      // Seat limits (existing)
      seats: {
        current: seatStatus.current,
        limit: seatStatus.limit,
        isUnlimited: seatStatus.limit === -1,
        allowed: seatStatus.allowed,
        message: seatStatus.message,
      },

      // When storage was last calculated
      storageLastCalculated: org.storageUsage?.lastCalculatedAt,
    }
  },
})

// Recalculate storage usage for an organization
// Called by cron job or after significant storage operations
export const recalculateStorageUsage = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    projectCursor: v.optional(v.union(v.string(), v.null())),
    projectBatchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.organizationId)
    if (!org) return { success: false, reason: "Organization not found" }

    const projectBatchSize = Math.max(
      1,
      Math.min(args.projectBatchSize ?? STORAGE_RECALC_PROJECT_BATCH_SIZE, 25)
    )
    const page = await ctx.db
      .query("projects")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .paginate({
        cursor: args.projectCursor ?? null,
        numItems: projectBatchSize,
      })

    let reconciledProjects = 0
    for (const project of page.page) {
      await syncProjectStorageUsageFromSource(ctx, project._id)
      reconciledProjects += 1
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.organizations.recalculateStorageUsage, {
        organizationId: args.organizationId,
        projectCursor: page.continueCursor,
        projectBatchSize,
      })

      return {
        success: true,
        phase: "projects",
        reconciledProjects,
        isDone: false,
        continueCursor: page.continueCursor,
      }
    }

    const breakdown =
      (await rebuildOrganizationStorageUsageFromProjectAggregates(ctx, args.organizationId)) ??
      emptyBreakdown()

    return {
      success: true,
      phase: "rollup",
      reconciledProjects,
      isDone: true,
      totalBytes: calculateStorageTotal(breakdown),
      breakdown,
    }
  },
})

export const repairProjectStorageUsage = internalMutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const breakdown = await syncProjectStorageUsage(ctx, args.projectId, emptyBreakdown())
    return {
      success: breakdown !== null,
      projectId: args.projectId,
      totalBytes: breakdown ? calculateStorageTotal(breakdown) : 0,
      breakdown,
    }
  },
})

// Recalculate storage for all organizations
// Called by weekly cron job
export const recalculateStorageUsageAll = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(args.batchSize ?? STORAGE_RECALC_ORG_BATCH_SIZE, 50))
    const page = await ctx.db.query("organizations").paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize,
    })

    let scheduled = 0
    for (const org of page.page) {
      await ctx.scheduler.runAfter(0, internal.organizations.recalculateStorageUsage, {
        organizationId: org._id,
      })
      scheduled++
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.organizations.recalculateStorageUsageAll, {
        cursor: page.continueCursor,
        batchSize,
      })
    }

    return {
      scheduled,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    }
  },
})

// Clear a specific storage category for an organization
// Deletes all data in that category across all projects
export const clearStorageCategory = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    category: v.union(
      v.literal("collaborationData"),
      v.literal("aiHistory"),
      v.literal("buildCache"),
      v.literal("snapshots"),
      v.literal("databaseBackups")
    ),
  },
  handler: async (ctx, args) => {
    const { allowed } = await requireOrganizationPermission(
      ctx,
      args.orgId,
      args.userId,
      "settings:update"
    )

    if (!allowed) {
      throw new Error("Unauthorized to clear storage")
    }

    // Get all projects for this organization
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .collect()

    const projectIds = projects.map((p) => p._id)
    let deletedCount = 0

    for (const projectId of projectIds) {
      let deletedBytes = 0
      switch (args.category) {
        case "collaborationData": {
          // Clear yjsUpdates
          const updates = await ctx.db
            .query("yjsUpdates")
            .withIndex("by_project_and_time", (q) => q.eq("projectId", projectId))
            .collect()
          for (const update of updates) {
            deletedBytes += update.update?.byteLength ?? 0
            await ctx.db.delete(update._id)
            deletedCount++
          }
          break
        }
        case "aiHistory": {
          // Clear aiConversations
          const conversations = await ctx.db
            .query("aiConversations")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .collect()
          for (const conv of conversations) {
            deletedBytes += estimateAiConversationBytes({
              title: conv.title,
              messages: conv.messages,
            })
            await ctx.db.delete(conv._id)
            deletedCount++
          }
          break
        }
        case "buildCache": {
          // Clear builderRuns
          const runs = await ctx.db
            .query("builderRuns")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .collect()
          for (const run of runs) {
            deletedBytes += estimateBuilderRunBytes(run)
            await ctx.db.delete(run._id)
            deletedCount++
          }
          break
        }
        case "snapshots": {
          // Clear yjsDocuments
          const snapshots = await ctx.db
            .query("yjsDocuments")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .collect()
          for (const snapshot of snapshots) {
            deletedBytes += estimateSnapshotBytes(snapshot)
            await ctx.db.delete(snapshot._id)
            deletedCount++
          }
          break
        }
        case "databaseBackups": {
          // Reserved - no action yet
          break
        }
      }
      if (deletedBytes > 0) {
        await applyProjectStorageDeltas(ctx, args.orgId, projectId, {
          [args.category]: -deletedBytes,
        })
      }
    }

    // Audit log
    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.userId,
      action: "storage.cleared",
      resourceType: "organization",
      resourceId: args.orgId,
      metadata: { category: args.category, deletedCount },
      timestamp: Date.now(),
    })

    return { success: true, deletedCount }
  },
})
