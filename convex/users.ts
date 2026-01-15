import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

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

    // Check if user already exists by WorkOS ID
    let existingUser = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .first()

    // If not found by WorkOS ID, check by email (handles WorkOS user recreation)
    if (!existingUser) {
      existingUser = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .first()
    }

    if (existingUser) {
      // Update existing user (including workosId in case it changed)
      await ctx.db.patch(existingUser._id, {
        workosId: args.workosId,
        email: args.email,
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
    return await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .first()
  },
})

// Get user by email
export const getByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first()
  },
})

// Update user profile (name, profile image)
export const updateProfile = mutation({
  args: {
    userId: v.id("users"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    profileImageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, ...updates } = args

    // Filter out undefined values
    const filteredUpdates: Record<string, string | number> = {}
    if (updates.firstName !== undefined) filteredUpdates.firstName = updates.firstName
    if (updates.lastName !== undefined) filteredUpdates.lastName = updates.lastName
    if (updates.profileImageUrl !== undefined) filteredUpdates.profileImageUrl = updates.profileImageUrl

    await ctx.db.patch(userId, {
      ...filteredUpdates,
      updatedAt: Date.now(),
    })
  },
})

// Update user preferences
export const updatePreferences = mutation({
  args: {
    userId: v.id("users"),
    preferences: v.object({
      theme: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("system"))),
      defaultModel: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      preferences: args.preferences,
      updatedAt: Date.now(),
    })
  },
})

// Update BYOK keys
export const updateByokKeys = mutation({
  args: {
    userId: v.id("users"),
    byokAnthropicKey: v.optional(v.string()),
    byokOpenaiKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, ...keys } = args
    await ctx.db.patch(userId, {
      ...keys,
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

    return {
      ...user,
      organizations: organizations.filter(Boolean),
    }
  },
})
