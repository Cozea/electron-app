import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import { hasPermission, mapWorkOSRole, type Role } from "./lib/permissions"
import { ensureEncrypted, safeDecrypt, validateKeyFormat, isEncrypted } from "./lib/encryption"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET

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

    // Check if org already exists
    const existingOrg = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .first()

    if (existingOrg) {
      // Ensure new schema fields exist while preserving existing data
      const updates: Record<string, unknown> = {
        name: args.name,
        updatedAt: now,
      }

      if (!existingOrg.aiSettings) {
        updates.aiSettings = {
          allowedProviders: ["anthropic", "openai", "google"],
          byokPolicy: "required",
          allowProviderTools: false,
          allowWebSearch: false,
          maxReasoningDepth: "high",
          defaultModelTier: "standard",
          overageEnabled: false,
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

      const existingCredits: any = existingOrg.credits || {}
      if (
        existingCredits.subscriptionCreditsRemaining === undefined ||
        existingCredits.subscriptionCreditsTotal === undefined
      ) {
        const fallbackBalance = existingCredits.balance ?? 0
        updates.credits = {
          subscriptionCreditsRemaining: fallbackBalance,
          subscriptionCreditsTotal: fallbackBalance,
          overageCreditsUsed: existingCredits.overageCreditsUsed ?? 0,
          overageAmountCents: existingCredits.overageAmountCents ?? 0,
          currentPeriodStart: existingCredits.currentPeriodStart ?? now,
          currentPeriodEnd: existingCredits.currentPeriodEnd ?? new Date(now + 30 * 24 * 60 * 60 * 1000).getTime(),
          balance: existingCredits.balance,
          monthlyAllocation: existingCredits.monthlyAllocation,
          lastResetAt: existingCredits.lastResetAt,
        }
      }

      await ctx.db.patch(existingOrg._id, updates)
      return existingOrg._id
    }

    // Create new org with slug derived from name
    const slug = args.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

    const periodStart = now
    const periodEnd = new Date(now + 30 * 24 * 60 * 60 * 1000).getTime()

    const orgId = await ctx.db.insert("organizations", {
      workosId: args.workosId,
      name: args.name,
      slug,
      settings: {
        allowByok: true,
        defaultModel: "claude-sonnet-4-20250514",
      },
      aiSettings: {
        allowedProviders: ["anthropic", "openai", "google"],
        byokPolicy: "required",
        allowProviderTools: false,
        allowWebSearch: false,
        maxReasoningDepth: "high",
        defaultModelTier: "standard",
        overageEnabled: false,
      },
      subscription: {
        plan: "free",
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      credits: {
        subscriptionCreditsRemaining: 0,
        subscriptionCreditsTotal: 0,
        overageCreditsUsed: 0,
        overageAmountCents: 0,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        balance: 0,
        monthlyAllocation: 0,
        lastResetAt: now,
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
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosOrgId))
      .first()

    if (!org) {
      throw new Error(`Organization not found for WorkOS ID: ${args.workosOrgId}`)
    }

    // Find user by WorkOS ID
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosUserId))
      .first()

    if (!user) {
      throw new Error(`User not found for WorkOS ID: ${args.workosUserId}`)
    }

    // Check if membership exists
    const existingMembership = await ctx.db
      .query("members")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .first()

    // Map WorkOS role to our internal role
    const role = mapWorkOSRole(args.role)

    if (existingMembership) {
      await ctx.db.patch(existingMembership._id, {
        role,
        updatedAt: now,
      })
      return existingMembership._id
    }

    // Create new membership
    const membershipId = await ctx.db.insert("members", {
      workosId: args.workosId,
      organizationId: org._id,
      userId: user._id,
      role,
      joinedAt: now,
      updatedAt: now,
    })

    // Mark any pending invitation for this user's email as accepted
    const pendingInvitation = await ctx.db
      .query("invitations")
      .withIndex("by_email", (q) => q.eq("email", user.email))
      .filter((q) =>
        q.and(
          q.eq(q.field("organizationId"), org._id),
          q.eq(q.field("status"), "pending")
        )
      )
      .first()

    if (pendingInvitation) {
      await ctx.db.patch(pendingInvitation._id, { status: "accepted" })
    }

    return membershipId
  },
})

// Get organization by WorkOS ID
export const getByWorkosId = query({
  args: { workosId: v.string() },
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .first()

    if (!org) return null

    const { aiCredentials, ...safeOrg } = org as any
    return safeOrg
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

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .first()

    if (!org) return null

    const encrypted = org.aiCredentials || {}
    const decryptOrPass = async (value?: string) => {
      if (!value) return undefined
      const decrypted = await safeDecrypt(value)
      if (decrypted !== null) return decrypted
      return isEncrypted(value) ? undefined : value
    }

    return {
      ...org,
      aiCredentials: {
        anthropicKey: await decryptOrPass(encrypted.anthropicKey),
        openaiKey: await decryptOrPass(encrypted.openaiKey),
        googleKey: await decryptOrPass(encrypted.googleKey),
      },
    }
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

    const membership = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.userId)
      )
      .first()

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

    const membership = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.userId)
      )
      .first()

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

    // Check if slug is available
    const existingOrg = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first()

    if (existingOrg) {
      throw new Error("Organization slug already taken")
    }

    // Create organization
    const periodStart = now
    const periodEnd = new Date(now + 30 * 24 * 60 * 60 * 1000).getTime()

    const orgId = await ctx.db.insert("organizations", {
      workosId: args.workosId,
      name: args.name,
      slug: args.slug,
      settings: {
        allowByok: true,
        defaultModel: "claude-sonnet-4-20250514",
      },
      aiSettings: {
        allowedProviders: ["anthropic", "openai", "google"],
        byokPolicy: "required",
        allowProviderTools: false,
        allowWebSearch: false,
        maxReasoningDepth: "high",
        defaultModelTier: "standard",
        overageEnabled: false,
      },
      subscription: {
        plan: "free",
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      credits: {
        subscriptionCreditsRemaining: 0,
        subscriptionCreditsTotal: 0,
        overageCreditsUsed: 0,
        overageAmountCents: 0,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        balance: 0,
        monthlyAllocation: 0,
        lastResetAt: now,
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

    const { aiCredentials, ...safeOrg } = org as any
    return safeOrg
  },
})

// Get organization by slug
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first()

    if (!org) return null

    const { aiCredentials, ...safeOrg } = org as any
    return safeOrg
  },
})

// Update organization settings
export const updateSettings = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    settings: v.object({
      allowByok: v.optional(v.boolean()),
      defaultModel: v.optional(v.string()),
      monthlyCreditsLimit: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    // Verify user is admin or owner
    const membership = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.orgId).eq("userId", args.userId)
      )
      .first()

    if (!membership || !hasPermission(membership.role as Role, "settings:update")) {
      throw new Error("Unauthorized")
    }

    const org = await ctx.db.get(args.orgId)
    if (!org) throw new Error("Organization not found")

    const now = Date.now()
    await ctx.db.patch(args.orgId, {
      settings: { ...org.settings, ...args.settings },
      updatedAt: now,
    })

    // Audit log
    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.userId,
      action: "settings.updated",
      resourceType: "organization",
      resourceId: args.orgId,
      metadata: args.settings,
      timestamp: now,
    })
  },
})

// Update AI credentials
export const updateAiCredentials = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    anthropicKey: v.optional(v.string()),
    openaiKey: v.optional(v.string()),
    googleKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify user is admin or owner
    const membership = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.orgId).eq("userId", args.userId)
      )
      .first()

    if (!membership || !hasPermission(membership.role as Role, "settings:manage_api_keys")) {
      throw new Error("Unauthorized")
    }

    const org = await ctx.db.get(args.orgId)
    if (!org) {
      throw new Error("Organization not found")
    }

    const updates: Record<string, string | undefined> = {}
    if (args.anthropicKey !== undefined) {
      if (args.anthropicKey && !validateKeyFormat("anthropic", args.anthropicKey)) {
        throw new Error("Invalid Anthropic API key format")
      }
      updates.anthropicKey = args.anthropicKey ? await ensureEncrypted(args.anthropicKey) : undefined
    }
    if (args.openaiKey !== undefined) {
      if (args.openaiKey && !validateKeyFormat("openai", args.openaiKey)) {
        throw new Error("Invalid OpenAI API key format")
      }
      updates.openaiKey = args.openaiKey ? await ensureEncrypted(args.openaiKey) : undefined
    }
    if (args.googleKey !== undefined) {
      if (args.googleKey && !validateKeyFormat("google", args.googleKey)) {
        throw new Error("Invalid Google API key format")
      }
      updates.googleKey = args.googleKey ? await ensureEncrypted(args.googleKey) : undefined
    }

    const now = Date.now()
    await ctx.db.patch(args.orgId, {
      aiCredentials: {
        ...(org.aiCredentials || {}),
        ...updates,
      },
      updatedAt: now,
    })

    // Audit log (without exposing keys)
    await ctx.db.insert("auditLogs", {
      organizationId: args.orgId,
      userId: args.userId,
      action: "ai_credentials.updated",
      resourceType: "organization",
      resourceId: args.orgId,
      timestamp: now,
    })
  },
})

// Update AI policy settings (admin only)
export const updateAiSettings = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    aiSettings: v.object({
      allowedProviders: v.array(v.union(v.literal("anthropic"), v.literal("openai"), v.literal("google"))),
      allowedModels: v.optional(v.array(v.string())),
      byokPolicy: v.union(v.literal("required"), v.literal("optional"), v.literal("disabled")),
      allowProviderTools: v.optional(v.boolean()),
      allowWebSearch: v.optional(v.boolean()),
      maxReasoningDepth: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
      monthlySpendingCapCents: v.optional(v.number()),
      defaultModelTier: v.optional(v.union(v.literal("fast"), v.literal("standard"), v.literal("powerful"))),
      overageEnabled: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.orgId).eq("userId", args.userId)
      )
      .first()

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
    const membership = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.orgId).eq("userId", args.userId)
      )
      .first()

    if (!membership || !hasPermission(membership.role as Role, "settings:update")) {
      throw new Error("Unauthorized")
    }

    const org = await ctx.db.get(args.orgId)
    if (!org) throw new Error("Organization not found")

    // If slug is being changed, verify it's unique
    if (args.slug && args.slug !== org.slug) {
      const existingOrg = await ctx.db
        .query("organizations")
        .withIndex("by_slug", (q) => q.eq("slug", args.slug!))
        .first()

      if (existingOrg) {
        throw new Error("This workspace URL is already taken")
      }
    }

    const now = Date.now()
    const updates: Record<string, unknown> = { updatedAt: now }

    if (args.name !== undefined) updates.name = args.name
    if (args.slug !== undefined) updates.slug = args.slug
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

    return await Promise.all(
      memberships.map(async (m) => {
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
    const removerMembership = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.orgId).eq("userId", args.removedBy)
      )
      .first()

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
    const updaterMembership = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.orgId).eq("userId", args.updatedBy)
      )
      .first()

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
    const now = Date.now()
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

    return {
      aggregate,
      credits: org?.credits,
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
    const membership = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.orgId).eq("userId", args.userId)
      )
      .first()

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
