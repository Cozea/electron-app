import { mutation, query, internalMutation } from "./_generated/server"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { hasPermission, mapWorkOSRole, type Role } from "./lib/permissions"
import { checkSeatLimit } from "./lib/seatLimits"
import { getWorkspacePlanLabel } from "./lib/planNames"
import {
  checkProjectLimit,
  checkStorageUsage,
  getPlanStorageLimitGB,
  formatBytes,
  estimateStorageBreakdown,
} from "./lib/workspaceLimits"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return base || "workspace"
}

function pickCanonicalOrganization(items: Doc<"organizations">[]): Doc<"organizations"> | null {
  if (items.length === 0) return null
  return [...items].sort((a, b) => {
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    const createdDelta = b.createdAt - a.createdAt
    if (createdDelta !== 0) return createdDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

function pickCanonicalUser(items: Doc<"users">[]): Doc<"users"> | null {
  if (items.length === 0) return null
  return [...items].sort((a, b) => {
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    const createdDelta = b.createdAt - a.createdAt
    if (createdDelta !== 0) return createdDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

function rolePriority(role: Doc<"members">["role"]): number {
  switch (role) {
    case "admin":
      return 3
    case "member":
      return 2
    default:
      return 1
  }
}

function pickCanonicalMembership(items: Doc<"members">[]): Doc<"members"> | null {
  if (items.length === 0) return null
  return [...items].sort((a, b) => {
    const roleDelta = rolePriority(b.role) - rolePriority(a.role)
    if (roleDelta !== 0) return roleDelta
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    const joinedDelta = (b.joinedAt || 0) - (a.joinedAt || 0)
    if (joinedDelta !== 0) return joinedDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

async function resolveUniqueSlug(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  desired: string,
  excludeOrgId?: Id<"organizations">
): Promise<string> {
  const base = slugify(desired)
  let attempt = 1
  let candidate = base
  while (attempt <= 1000) {
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .first()
    if (!existing || (excludeOrgId && existing._id === excludeOrgId)) {
      return candidate
    }
    attempt += 1
    candidate = `${base}-${attempt}`
  }
  return `${base}-${Date.now()}`
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
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    // Check if org already exists.
    const orgMatches = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .collect()
    const existingOrg = pickCanonicalOrganization(orgMatches)

    if (existingOrg) {
      // Ensure new schema fields exist while preserving existing data
      const updates: Record<string, unknown> = {
        name: args.name,
        updatedAt: now,
      }

      if (!existingOrg.aiSettings) {
        updates.aiSettings = {
          allowedProviders: ["anthropic", "openai", "google", "xai"],
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
      aiSettings: {
        allowedProviders: ["anthropic", "openai", "google", "xai"],
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
    const role = mapWorkOSRole(args.role)

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

    let membershipId: Id<"members">
    if (canonicalMembership) {
      membershipId = canonicalMembership._id
      await ctx.db.patch(canonicalMembership._id, {
        workosId: args.workosId,
        organizationId: org._id,
        userId: user._id,
        role,
        updatedAt: now,
      })
    } else {
      membershipId = await ctx.db.insert("members", {
        workosId: args.workosId,
        organizationId: org._id,
        userId: user._id,
        role,
        joinedAt: now,
        updatedAt: now,
      })
    }

    // Remove duplicates for this org-user/workos tuple.
    for (const membership of combinedMemberships.values()) {
      if (membership._id === membershipId) continue
      await ctx.db.delete(membership._id)
    }

    // Mark any pending invitation for this user's email as accepted
    const normalizedEmail = normalizeEmail(user.email)
    const pendingInvitations = await ctx.db
      .query("invitations")
      .withIndex("by_organization", (q) => q.eq("organizationId", org._id))
      .filter((q) =>
        q.eq(q.field("status"), "pending")
      )
      .collect()
    const pendingInvitation = pendingInvitations.find(
      (invitation) => normalizeEmail(invitation.email) === normalizedEmail
    )

    if (pendingInvitation) {
      await ctx.db.patch(pendingInvitation._id, { status: "accepted" })
    }

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

    for (const input of activeInputs) {
      const orgMatches = await ctx.db
        .query("organizations")
        .withIndex("by_workos_id", (q) => q.eq("workosId", input.workosOrgId))
        .collect()
      const org = pickCanonicalOrganization(orgMatches)
      if (!org) continue

      activeOrgIds.add(org._id)

      const role = mapWorkOSRole(input.role)
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
      let canonicalId: Id<"members">
      if (canonical) {
        canonicalId = canonical._id
        await ctx.db.patch(canonical._id, {
          workosId: input.workosId,
          organizationId: org._id,
          userId: user._id,
          role,
          updatedAt: now,
        })
      } else {
        canonicalId = await ctx.db.insert("members", {
          workosId: input.workosId,
          organizationId: org._id,
          userId: user._id,
          role,
          joinedAt: now,
          updatedAt: now,
        })
      }

      for (const membership of combinedMemberships.values()) {
        if (membership._id === canonicalId) continue
        await ctx.db.delete(membership._id)
      }
    }

    const currentMemberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()

    let removedCount = 0
    for (const membership of currentMemberships) {
      if (!activeOrgIds.has(membership.organizationId)) {
        await ctx.db.delete(membership._id)
        removedCount += 1
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

    const memberships = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.userId)
      )
      .collect()
    const membership = pickCanonicalMembership(memberships)

    return membership?.role || null
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
  },
  handler: async (ctx, args) => {
    const now = Date.now()

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
      aiSettings: {
        allowedProviders: ["anthropic", "openai", "google", "xai"],
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

    // Add creator as admin
    await ctx.db.insert("members", {
      workosId: args.memberWorkosId,
      organizationId: orgId,
      userId: args.createdBy,
      role: "admin",
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
          v.literal("xai")
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
    const membership = await getCanonicalOrgMembership(ctx, args.orgId, args.userId)

    if (!membership || !hasPermission(membership.role as Role, "settings:update")) {
      throw new Error("Unauthorized")
    }

    const org = await ctx.db.get(args.orgId)
    if (!org) throw new Error("Organization not found")

    const now = Date.now()
    await ctx.db.patch(args.orgId, {
      aiSettings: {
        ...(org.aiSettings || {}),
        ...args.aiSettings,
      },
      updatedAt: now,
    })

    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.userId,
      action: "ai_settings.updated",
      resourceType: "organization",
      resourceId: args.orgId,
      metadata: args.aiSettings,
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
  },
  handler: async (ctx, args) => {
    // Verify user is admin
    const membership = await getCanonicalOrgMembership(ctx, args.orgId, args.userId)

    if (!membership || !hasPermission(membership.role as Role, "settings:update")) {
      throw new Error("Unauthorized")
    }

    const org = await ctx.db.get(args.orgId)
    if (!org) throw new Error("Organization not found")

    const now = Date.now()
    const updates: Record<string, unknown> = { updatedAt: now }

    if (args.name !== undefined) updates.name = args.name
    if (args.slug !== undefined) {
      updates.slug =
        args.slug === org.slug ? org.slug : await resolveUniqueSlug(ctx, args.slug, args.orgId)
    }
    if (args.description !== undefined) updates.description = args.description

    await ctx.db.patch(args.orgId, updates)

    // Audit log
    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.userId,
      action: "organization.updated",
      resourceType: "organization",
      resourceId: args.orgId,
      metadata: { name: args.name, slug: args.slug, description: args.description },
      timestamp: now,
    })
  },
})

// Get organization members
export const getMembers = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
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
        return {
          ...m,
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
    memberId: v.id("members"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.memberId)

    if (!membership || membership.organizationId !== args.orgId) {
      return null
    }

    const user = await ctx.db.get(membership.userId)

    return {
      ...membership,
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

    if (!removerMembership || !hasPermission(removerMembership.role as Role, "members:remove")) {
      throw new Error("Unauthorized to remove members")
    }

    // Get the membership to be removed
    const targetMembership = await ctx.db.get(args.memberId)
    if (!targetMembership) {
      throw new Error("Member not found")
    }

    // Prevent self-removal
    if (targetMembership.userId === args.removedBy) {
      throw new Error("Cannot remove yourself from the organization")
    }

    // If removing an admin, check there's at least one other admin
    if (targetMembership.role === "admin") {
      const adminCount = await ctx.db
        .query("members")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
        .filter((q) => q.eq(q.field("role"), "admin"))
        .collect()

      if (adminCount.length <= 1) {
        throw new Error("Cannot remove the last admin. Promote another member first.")
      }
    }

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
    updatedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Verify updater has permission
    const updaterMembership = await getCanonicalOrgMembership(ctx, args.orgId, args.updatedBy)

    if (!updaterMembership || !hasPermission(updaterMembership.role as Role, "members:update_role")) {
      throw new Error("Unauthorized to change member roles")
    }

    // Get the target membership
    const targetMembership = await ctx.db.get(args.memberId)
    if (!targetMembership) {
      throw new Error("Member not found")
    }

    // Prevent changing own role (admins shouldn't demote themselves)
    if (targetMembership.userId === args.updatedBy) {
      throw new Error("Cannot change your own role")
    }

    // If demoting an admin, ensure there's at least one other admin
    if (targetMembership.role === "admin" && args.newRole !== "admin") {
      const adminCount = await ctx.db
        .query("members")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
        .filter((q) => q.eq(q.field("role"), "admin"))
        .collect()

      if (adminCount.length <= 1) {
        throw new Error("Cannot demote the last admin. Promote another member first.")
      }
    }

    const now = Date.now()
    const oldRole = targetMembership.role

    // Update the role
    await ctx.db.patch(args.memberId, {
      role: args.newRole,
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
      metadata: { email: targetUser?.email, oldRole, newRole: args.newRole },
      timestamp: now,
    })
  },
})

// Get usage summary for organization
export const getUsageSummary = query({
  args: {
    orgId: v.id("organizations"),
    period: v.union(v.literal("daily"), v.literal("monthly")),
  },
  handler: async (ctx, args) => {
    const periodStart =
      args.period === "daily"
        ? new Date().setHours(0, 0, 0, 0)
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()

    const aggregate = await ctx.db
      .query("aiUsageAggregates")
      .withIndex("by_organization_and_period", (q) =>
        q
          .eq("organizationId", args.orgId)
          .eq("period", args.period)
          .eq("periodStart", periodStart)
      )
      .first()

    const org = await ctx.db.get(args.orgId)
    const aggregateWithTrackedUnits = aggregate
      ? {
          ...aggregate,
          totalTrackedUnits: aggregate.totalTrackedUnits,
        }
      : null

    return {
      aggregate: aggregateWithTrackedUnits,
      trackedUsage: {
        totalTrackedUnits: aggregate?.totalTrackedUnits ?? 0,
      },
      subscription: org?.subscription,
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
    // Verify user is admin
    const membership = await getCanonicalOrgMembership(ctx, args.orgId, args.userId)

    if (!membership || membership.role !== "admin") {
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

    // 4. Delete all AI usage records
    const aiUsage = await ctx.db
      .query("aiUsage")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .collect()
    for (const usage of aiUsage) {
      await ctx.db.delete(usage._id)
    }

    // 5. Delete all AI usage aggregates
    const aggregates = await ctx.db
      .query("aiUsageAggregates")
      .withIndex("by_organization_and_period", (q) => q.eq("organizationId", args.orgId))
      .collect()
    for (const aggregate of aggregates) {
      await ctx.db.delete(aggregate._id)
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

    const plan = org.subscription.plan
    const planDisplayName = getWorkspacePlanLabel(plan)

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
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.organizationId)
    if (!org) return { success: false, reason: "Organization not found" }

    const breakdown = await estimateStorageBreakdown(ctx, args.organizationId)
    const totalBytes = Object.values(breakdown).reduce((sum, val) => sum + val, 0)

    await ctx.db.patch(args.organizationId, {
      storageUsage: {
        totalBytes,
        lastCalculatedAt: Date.now(),
        breakdown,
      },
      updatedAt: Date.now(),
    })

    return { success: true, totalBytes, breakdown }
  },
})

// Recalculate storage for all organizations
// Called by weekly cron job
export const recalculateStorageUsageAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const organizations = await ctx.db.query("organizations").collect()

    let processed = 0
    for (const org of organizations) {
      const breakdown = await estimateStorageBreakdown(ctx, org._id)
      const totalBytes = Object.values(breakdown).reduce((sum, val) => sum + val, 0)

      await ctx.db.patch(org._id, {
        storageUsage: {
          totalBytes,
          lastCalculatedAt: Date.now(),
          breakdown,
        },
        updatedAt: Date.now(),
      })
      processed++
    }

    return { processed }
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
    // Verify user is admin
    const membership = await getCanonicalOrgMembership(ctx, args.orgId, args.userId)

    if (!membership || !hasPermission(membership.role as Role, "settings:update")) {
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
      switch (args.category) {
        case "collaborationData": {
          // Clear yjsUpdates
          const updates = await ctx.db
            .query("yjsUpdates")
            .withIndex("by_project_and_time", (q) => q.eq("projectId", projectId))
            .collect()
          for (const update of updates) {
            await ctx.db.delete(update._id)
            deletedCount++
          }
          break
        }
        case "aiHistory": {
          // Clear aiConversations
          const conversations = await ctx.db
            .query("aiConversations")
            .filter((q) => q.eq(q.field("projectId"), projectId))
            .collect()
          for (const conv of conversations) {
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
    }

    // Recalculate storage usage after clearing
    const breakdown = await estimateStorageBreakdown(ctx, args.orgId)
    const totalBytes = Object.values(breakdown).reduce((sum, val) => sum + val, 0)

    await ctx.db.patch(args.orgId, {
      storageUsage: {
        totalBytes,
        lastCalculatedAt: Date.now(),
        breakdown,
      },
      updatedAt: Date.now(),
    })

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
