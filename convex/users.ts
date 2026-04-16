import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

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


export const ensureLocalDeviceProfile = mutation({
  args: {
    deviceId: v.string(),
    deviceLabel: v.string(),
    platform: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const normalizedDeviceId = args.deviceId.trim()
    const normalizedLabel = args.deviceLabel.trim() || "This Device"
    const localUserWorkosId = `device:${normalizedDeviceId}`
    const localEmail = `device+${normalizedDeviceId}@local.cozea.app`
    const normalizedEmail = normalizeEmail(localEmail)
    const personalWorkspaceName = `${normalizedLabel} Workspace`
    const localWorkspaceMembershipId = `local-membership:${normalizedDeviceId}`

    const existingUsers = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", localUserWorkosId))
      .collect()
    const canonicalUser = pickCanonicalUser(existingUsers)

    let userId = canonicalUser?._id
    if (canonicalUser) {
      await ctx.db.patch(canonicalUser._id, {
        email: localEmail,
        normalizedEmail,
        firstName: normalizedLabel,
        lastName: undefined,
        profileImageUrl: undefined,
        updatedAt: now,
        lastLoginAt: now,
      })
    } else {
      userId = await ctx.db.insert("users", {
        workosId: localUserWorkosId,
        email: localEmail,
        normalizedEmail,
        firstName: normalizedLabel,
        lastName: undefined,
        profileImageUrl: undefined,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      })
    }

    return {
      userId: userId!,
      user: {
        id: localUserWorkosId,
        email: localEmail,
        firstName: normalizedLabel,
        lastName: null,
        profileImageUrl: null,
      },
      personalWorkspace: {
        id: localWorkspaceMembershipId,
        workspaceId: `local:${normalizedDeviceId}`,
        workspaceName: personalWorkspaceName,
        organizationId: `local:${normalizedDeviceId}`,
        organizationName: personalWorkspaceName,
        role: "admin" as const,
        status: "active" as const,
        workspaceType: "personal" as const,
      },
      identity: {
        workosId: localUserWorkosId,
        organizationWorkosId: `local:${normalizedDeviceId}`,
        deviceId: normalizedDeviceId,
        deviceLabel: normalizedLabel,
        platform: args.platform?.trim() || "desktop",
        fingerprint: args.fingerprint?.trim() || null,
      },
    }
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

// Resolve multiple users by email (for invite UI enrichment)
export const getByEmails = query({
  args: { emails: v.array(v.string()) },
  handler: async (ctx, args) => {
    const normalizedEmails = Array.from(
      new Set(args.emails.map((email) => normalizeEmail(email)).filter((email) => email.length > 0))
    ).slice(0, 100)

    const resolved = await Promise.all(
      normalizedEmails.map(async (normalizedEmail) => {
        const byNormalizedEmail = await ctx.db
          .query("users")
          .withIndex("by_normalized_email", (q) => q.eq("normalizedEmail", normalizedEmail))
          .collect()
        let user = pickCanonicalUser(byNormalizedEmail)

        if (!user) {
          const byEmail = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
            .collect()
          user = pickCanonicalUser(byEmail)
        }

        if (!user) return null

        return {
          email: normalizedEmail,
          user: {
            id: user._id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            profileImageUrl: user.profileImageUrl,
          },
        }
      })
    )

    return resolved.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
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
    const nextPreferences: NonNullable<typeof user.preferences> = {
      ...(user.preferences || {}),
    }
    if (args.preferences.theme !== undefined) nextPreferences.theme = args.preferences.theme
    if (args.preferences.defaultModel !== undefined) {
      nextPreferences.defaultModel = args.preferences.defaultModel
    }
    if (args.preferences.emailNotifications !== undefined) {
      nextPreferences.emailNotifications = args.preferences.emailNotifications
    }
    if (args.preferences.pushNotifications !== undefined) {
      nextPreferences.pushNotifications = args.preferences.pushNotifications
    }

    await ctx.db.patch(args.userId, {
      preferences: nextPreferences,
      updatedAt: Date.now(),
    })
  },
})
