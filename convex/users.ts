import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
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
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .first()

    if (!user) return null

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { byokAnthropicKey, byokOpenaiKey, byokGoogleKey, ...safeUser } = user
    return safeUser
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

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .first()

    if (!user) return null

    const decryptOrPass = async (value?: string) => {
      if (!value) return undefined
      const decrypted = await safeDecrypt(value)
      if (decrypted !== null) return decrypted
      return isEncrypted(value) ? undefined : value
    }

    return {
      ...user,
      byokAnthropicKey: await decryptOrPass(user.byokAnthropicKey),
      byokOpenaiKey: await decryptOrPass(user.byokOpenaiKey),
      byokGoogleKey: await decryptOrPass(user.byokGoogleKey),
    }
  },
})

// Get user by email
export const getByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first()

    if (!user) return null

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { byokAnthropicKey, byokOpenaiKey, byokGoogleKey, ...safeUser } = user
    return safeUser
  },
})

// Get user by ID (for account settings)
export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) return null

    // Strip sensitive BYOK keys
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { byokAnthropicKey, byokOpenaiKey, byokGoogleKey, ...safeUser } = user
    return safeUser
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

// Update BYOK keys
export const updateByokKeys = mutation({
  args: {
    userId: v.id("users"),
    byokAnthropicKey: v.optional(v.string()),
    byokOpenaiKey: v.optional(v.string()),
    byokGoogleKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, ...keys } = args
    const updates: Record<string, string | undefined> = {}

    if (keys.byokAnthropicKey !== undefined) {
      if (keys.byokAnthropicKey && !validateKeyFormat("anthropic", keys.byokAnthropicKey)) {
        throw new Error("Invalid Anthropic API key format")
      }
      updates.byokAnthropicKey = keys.byokAnthropicKey ? await ensureEncrypted(keys.byokAnthropicKey) : undefined
    }
    if (keys.byokOpenaiKey !== undefined) {
      if (keys.byokOpenaiKey && !validateKeyFormat("openai", keys.byokOpenaiKey)) {
        throw new Error("Invalid OpenAI API key format")
      }
      updates.byokOpenaiKey = keys.byokOpenaiKey ? await ensureEncrypted(keys.byokOpenaiKey) : undefined
    }
    if (keys.byokGoogleKey !== undefined) {
      if (keys.byokGoogleKey && !validateKeyFormat("google", keys.byokGoogleKey)) {
        throw new Error("Invalid Google API key format")
      }
      updates.byokGoogleKey = keys.byokGoogleKey ? await ensureEncrypted(keys.byokGoogleKey) : undefined
    }

    await ctx.db.patch(userId, {
      ...updates,
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { byokAnthropicKey, byokOpenaiKey, byokGoogleKey, ...safeUser } = user

    return {
      ...safeUser,
      organizations: organizations
        .filter((org): org is NonNullable<typeof org> => org !== null)
        .map((org) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { aiCredentials, ...safeOrg } = org
          return safeOrg
        }),
    }
  },
})
