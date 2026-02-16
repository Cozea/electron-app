import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function pickCanonicalUser<T extends { updatedAt?: number; createdAt: number; _id: unknown }>(
  users: T[]
): T | null {
  if (users.length === 0) return null
  return [...users].sort((a, b) => {
    const updateDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updateDelta !== 0) return updateDelta
    const createdDelta = b.createdAt - a.createdAt
    if (createdDelta !== 0) return createdDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

// Sync user from WorkOS - called after authentication
export const syncFromWorkOS = mutation({
  args: {
    workosId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    profileImageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const normalizedEmail = normalizeEmail(args.email)

    // Check if user already exists by WorkOS ID.
    const existingByWorkosId = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .collect()
    let existingUser = pickCanonicalUser(existingByWorkosId)

    // If not found by WorkOS ID, check by normalized email (handles WorkOS user recreation).
    if (!existingUser) {
      const existingByNormalizedEmail = await ctx.db
        .query("users")
        .withIndex("by_normalized_email", (q) => q.eq("normalizedEmail", normalizedEmail))
        .collect()
      existingUser = pickCanonicalUser(existingByNormalizedEmail)
    }

    // Safety fallback for pre-normalized rows.
    if (!existingUser) {
      const existingByEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .collect()
      existingUser = pickCanonicalUser(existingByEmail)
    }

    if (existingUser) {
      // Update existing user (including workosId in case it changed)
      await ctx.db.patch(existingUser._id, {
        workosId: args.workosId,
        email: args.email,
        normalizedEmail,
        firstName: args.firstName,
        lastName: args.lastName,
        profileImageUrl: args.profileImageUrl,
        updatedAt: now,
        lastLoginAt: now,
      })
      return existingUser._id
    }

    // Create new user
    const userId = await ctx.db.insert("users", {
      workosId: args.workosId,
      email: args.email,
      normalizedEmail,
      firstName: args.firstName,
      lastName: args.lastName,
      profileImageUrl: args.profileImageUrl,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    })

    return userId
  },
})

// Get user by WorkOS ID
export const getByWorkosId = query({
  args: { workosId: v.string() },
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .collect()
    const user = pickCanonicalUser(users)

    if (!user) return null
    return user
  },
})

// Server-only: return user with decrypted BYOK keys
export const getByWorkosIdForServer = query({
  args: {
    workosId: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const users = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .collect()
    const user = pickCanonicalUser(users)

    if (!user) return null
    return user
  },
})

// Get user by email
export const getByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const normalizedEmail = normalizeEmail(args.email)
    const byNormalizedEmail = await ctx.db
      .query("users")
      .withIndex("by_normalized_email", (q) => q.eq("normalizedEmail", normalizedEmail))
      .collect()
    const user = pickCanonicalUser(byNormalizedEmail)

    if (user) return user

    const byEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect()
    const fallback = pickCanonicalUser(byEmail)

    if (!fallback) return null
    return fallback
  },
})

// Get user by ID (for account settings)
export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) return null
    return user
  },
})

// Update user profile (name, profile image, job title)
export const updateProfile = mutation({
  args: {
    userId: v.id("users"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    profileImageUrl: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, ...updates } = args

    // Filter out undefined values
    const filteredUpdates: Record<string, string | number> = {}
    if (updates.firstName !== undefined) filteredUpdates.firstName = updates.firstName
    if (updates.lastName !== undefined) filteredUpdates.lastName = updates.lastName
    if (updates.profileImageUrl !== undefined) filteredUpdates.profileImageUrl = updates.profileImageUrl
    if (updates.jobTitle !== undefined) filteredUpdates.jobTitle = updates.jobTitle

    await ctx.db.patch(userId, {
      ...filteredUpdates,
      updatedAt: Date.now(),
    })
  },
})

// Update user preferences (theme, model, notifications)
export const updatePreferences = mutation({
  args: {
    userId: v.id("users"),
    preferences: v.object({
      theme: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("system"))),
      defaultModel: v.optional(v.string()),
      emailNotifications: v.optional(v.boolean()),
      pushNotifications: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) throw new Error("User not found")

    // Merge with existing preferences to allow partial updates
    await ctx.db.patch(args.userId, {
      preferences: { ...user.preferences, ...args.preferences },
      updatedAt: Date.now(),
    })
  },
})

// Get user with their organizations
export const getWithOrganizations = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) return null

    const memberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    const organizations = await Promise.all(
      memberships.map(async (membership) => {
        const org = await ctx.db.get(membership.organizationId)
        return org ? { ...org, role: membership.role } : null
      })
    )

    const dedupedByOrg = new Map<string, NonNullable<(typeof organizations)[number]>>()
    for (const org of organizations) {
      if (!org) continue
      const existing = dedupedByOrg.get(String(org._id))
      if (!existing || (org.updatedAt || 0) >= (existing.updatedAt || 0)) {
        dedupedByOrg.set(String(org._id), org)
      }
    }

    return {
      ...user,
      organizations: [...dedupedByOrg.values()],
    }
  },
})
