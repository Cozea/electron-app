import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { ConvexError, v } from "convex/values"

import {
  isDeviceIdentityKey,
  normalizeDeviceIdentityKey,
} from "../shared/deviceIdentity"
import {
  isRegisteredDevicePrincipal,
  requireAuthenticatedDevice,
} from "./lib/deviceAuth"

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function requireServerSecret(serverSecret: string): void {
  const expectedServerSecret = process.env.AI_GATEWAY_SECRET
  if (!expectedServerSecret || serverSecret !== expectedServerSecret) {
    throw new ConvexError("Unauthorized")
  }
}

function normalizeDeviceDisplayName(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new ConvexError("Device name cannot be blank")
  if (normalized.length > 80) throw new ConvexError("Device name cannot exceed 80 characters")
  return normalized
}

function normalizeAvatarUrl(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new ConvexError("Avatar URL cannot be blank")
  if (normalized.length > 200_000) throw new ConvexError("Avatar data is too large")
  return normalized
}

const CHALLENGE_WINDOW_MS = 10 * 60 * 1_000
const MAX_IDENTITY_CHALLENGES_PER_WINDOW = 12
const MAX_FINGERPRINT_CHALLENGES_PER_WINDOW = 30

export const createDeviceAuthChallengeFromServer = mutation({
  args: {
    serverSecret: v.string(), nonce: v.string(), identityKey: v.string(),
    requestFingerprint: v.optional(v.string()), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    const identityKey = normalizeDeviceIdentityKey(args.identityKey)
    if (!isDeviceIdentityKey(identityKey) || args.expiresAt <= now || args.expiresAt > now + 5 * 60_000) {
      throw new ConvexError("Invalid device challenge")
    }
    const existing = await ctx.db.query("deviceAuthChallenges")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce)).unique()
    if (existing) throw new ConvexError("Challenge nonce already exists")
    const identityAttempts = await ctx.db.query("deviceAuthChallenges")
      .withIndex("by_identity_and_created_at", (q) =>
        q.eq("identityKey", identityKey).gte("createdAt", now - CHALLENGE_WINDOW_MS))
      .take(MAX_IDENTITY_CHALLENGES_PER_WINDOW)
    if (identityAttempts.length >= MAX_IDENTITY_CHALLENGES_PER_WINDOW) {
      throw new ConvexError("Too many device authentication attempts")
    }
    if (args.requestFingerprint) {
      const attempts = await ctx.db.query("deviceAuthChallenges")
        .withIndex("by_fingerprint_and_created_at", (q) =>
          q.eq("requestFingerprint", args.requestFingerprint!)
            .gte("createdAt", now - CHALLENGE_WINDOW_MS))
        .take(MAX_FINGERPRINT_CHALLENGES_PER_WINDOW)
      if (attempts.length >= MAX_FINGERPRINT_CHALLENGES_PER_WINDOW) {
        throw new ConvexError("Too many device authentication attempts")
      }
    }
    await ctx.db.insert("deviceAuthChallenges", {
      nonce: args.nonce, identityKey, requestFingerprint: args.requestFingerprint,
      createdAt: now, expiresAt: args.expiresAt,
    })
    return { created: true }
  },
})

export const consumeDeviceAuthChallengeFromServer = mutation({
  args: { serverSecret: v.string(), nonce: v.string(), identityKey: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const identityKey = normalizeDeviceIdentityKey(args.identityKey)
    const challenge = await ctx.db.query("deviceAuthChallenges")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce)).unique()
    if (!challenge || challenge.identityKey !== identityKey || challenge.consumedAt !== undefined || challenge.expiresAt <= Date.now()) {
      throw new ConvexError("Device challenge is expired, consumed, or invalid")
    }
    const now = Date.now()
    await ctx.db.patch(challenge._id, { consumedAt: now })
    await ctx.db.insert("identitySecurityEvents", {
      identityKey, actorIdentityKey: identityKey,
      eventType: "device.challenge_consumed", createdAt: now,
    })
    return { consumed: true }
  },
})

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

export const ensureDevicePrincipalFromServer = mutation({
  args: {
    serverSecret: v.string(),
    identityKey: v.string(),
    deviceLabel: v.string(),
    platform: v.string(),
    encryptionPublicKeyJwk: v.string(),
    encryptionPublicKeyAlgorithm: v.string(),
    encryptionFingerprint: v.string(),
    signingPublicKeyJwk: v.string(),
    signingPublicKeyAlgorithm: v.string(),
    signingFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    const identityKey = normalizeDeviceIdentityKey(args.identityKey)
    if (!isDeviceIdentityKey(identityKey)) {
      throw new ConvexError("Invalid device identity ID")
    }

    // The OS hostname is never product identity. A fresh principal starts with
    // an explicit unconfigured label and must be named by the user in Cozea.
    // Account-era required fields remain placeholders until the schema purge.
    const suggestedLabel = "This Device"
    const localUserWorkosId = `device:${identityKey}`
    const localEmail = `device+${identityKey}@local.cozea.app`
    const normalizedEmail = normalizeEmail(localEmail)
    const localWorkspaceMembershipId = `local-membership:${identityKey}`

    const canonicalUser = await ctx.db
      .query("users")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey))
      .unique()

    let userId = canonicalUser?._id
    let effectiveLabel = canonicalUser?.deviceLabel?.trim() || suggestedLabel
    let effectiveAvatarUrl = canonicalUser?.profileImageUrl ?? null

    if (canonicalUser) {
      if (canonicalUser.status === "revoked") {
        throw new ConvexError("This device identity has been revoked")
      }
      if (
        canonicalUser.signingFingerprint !== args.signingFingerprint ||
        canonicalUser.signingPublicKeyJwk !== args.signingPublicKeyJwk
      ) {
        throw new ConvexError("This device ID is already bound to another signing key")
      }

      // Authentication refreshes security/runtime metadata only. Never overwrite
      // user-selected device presentation with the OS-derived bootstrap label.
      await ctx.db.patch(canonicalUser._id, {
        platform: args.platform.trim() || "desktop",
        encryptionPublicKeyJwk: args.encryptionPublicKeyJwk,
        encryptionPublicKeyAlgorithm: args.encryptionPublicKeyAlgorithm,
        encryptionFingerprint: args.encryptionFingerprint,
        status: "active",
        signingKeyVersion: canonicalUser.signingKeyVersion ?? 1,
        tokenValidAfter: canonicalUser.tokenValidAfter ?? now,
        lastAuthenticatedAt: now,
        updatedAt: now,
        lastLoginAt: now,
      })
    } else {
      userId = await ctx.db.insert("users", {
        identityKey,
        deviceLabel: suggestedLabel,
        platform: args.platform.trim() || "desktop",
        encryptionPublicKeyJwk: args.encryptionPublicKeyJwk,
        encryptionPublicKeyAlgorithm: args.encryptionPublicKeyAlgorithm,
        encryptionFingerprint: args.encryptionFingerprint,
        signingPublicKeyJwk: args.signingPublicKeyJwk,
        signingPublicKeyAlgorithm: args.signingPublicKeyAlgorithm,
        signingFingerprint: args.signingFingerprint,
        status: "active",
        signingKeyVersion: 1,
        tokenValidAfter: now,
        lastAuthenticatedAt: now,
        workosId: localUserWorkosId,
        email: localEmail,
        normalizedEmail,
        firstName: suggestedLabel,
        lastName: undefined,
        profileImageUrl: undefined,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      })
      effectiveLabel = suggestedLabel
      effectiveAvatarUrl = null
    }

    const personalWorkspaceName = `${effectiveLabel} Workspace`

    return {
      userId: userId!,
      user: {
        id: identityKey,
        deviceId: identityKey,
        email: localEmail,
        // Transitional renderer contract: this value is the machine display
        // name, not a human first name.
        firstName: effectiveLabel,
        lastName: null,
        profileImageUrl: effectiveAvatarUrl,
      },
      personalWorkspace: {
        id: localWorkspaceMembershipId,
        workspaceId: `local:${identityKey}`,
        workspaceName: personalWorkspaceName,
        organizationId: `local:${identityKey}`,
        organizationName: personalWorkspaceName,
        role: "admin" as const,
        status: "active" as const,
        workspaceType: "personal" as const,
      },
      identity: {
        deviceId: identityKey,
        userId: identityKey,
        identityKey,
        deviceLabel: effectiveLabel,
        platform: args.platform.trim() || "desktop",
        encryptionFingerprint: args.encryptionFingerprint,
        signingFingerprint: args.signingFingerprint,
      },
      authentication: {
        status: "active" as const,
        signingKeyVersion: canonicalUser?.signingKeyVersion ?? 1,
        tokenValidAfter: canonicalUser?.tokenValidAfter ?? now,
      },
    }
  },
})

export const getDevicePrincipalForServer = query({
  args: {
    serverSecret: v.string(),
    identityKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const identityKey = normalizeDeviceIdentityKey(args.identityKey)
    const user = await ctx.db
      .query("users")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey))
      .unique()
    if (!isRegisteredDevicePrincipal(user)) return null
    return {
      userId: user._id,
      identityKey: user.identityKey,
      deviceLabel: user.deviceLabel,
      platform: user.platform,
      encryptionPublicKeyJwk: user.encryptionPublicKeyJwk,
      encryptionPublicKeyAlgorithm: user.encryptionPublicKeyAlgorithm,
      encryptionFingerprint: user.encryptionFingerprint,
      signingFingerprint: user.signingFingerprint,
      status: "active" as const,
      signingKeyVersion: user.signingKeyVersion ?? 1,
      tokenValidAfter: user.tokenValidAfter ?? 0,
    }
  },
})

// Legacy email lookup. Deleted with the breaking project-sharing cutover.
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
    return pickCanonicalUser(byEmail)
  },
})

// Legacy invite enrichment. Deleted with email-keyed project sharing.
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

// Transitional name: the value is the internal device-principal row ID.
export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) return null
    return user
  },
})

export const getCurrent = query({
  args: {},
  handler: async (ctx) => await requireAuthenticatedDevice(ctx),
})

export const revokeCurrentDevice = mutation({
  args: { reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const now = Date.now()
    await ctx.db.patch(user._id, {
      status: "revoked",
      signingKeyVersion: user.signingKeyVersion + 1,
      tokenValidAfter: now,
      revokedAt: now,
      revocationReason: args.reason?.trim().slice(0, 200) || "self_revoked",
      updatedAt: now,
    })
    await ctx.db.insert("identitySecurityEvents", {
      identityKey: user.identityKey,
      actorIdentityKey: user.identityKey,
      eventType: "device.self_revoked",
      createdAt: now,
    })
    return { revoked: true }
  },
})

// Presentation-only mutation for the machine principal. Cosmetic changes are
// deliberately isolated from authentication/authorization state.
export const updateDevicePresentation = mutation({
  args: {
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const patch: {
      deviceLabel?: string
      firstName?: string
      profileImageUrl?: string | undefined
      updatedAt: number
    } = { updatedAt: Date.now() }

    if (args.displayName !== undefined) {
      const displayName = normalizeDeviceDisplayName(args.displayName)
      patch.deviceLabel = displayName
      // Temporary mirror while account-shaped renderer contracts are removed.
      patch.firstName = displayName
    }
    if (args.avatarUrl !== undefined) {
      patch.profileImageUrl = args.avatarUrl === null ? undefined : normalizeAvatarUrl(args.avatarUrl)
    }

    await ctx.db.patch(user._id, patch)
    const next = await ctx.db.get(user._id)
    return {
      identityKey: user.identityKey,
      displayName: next?.deviceLabel ?? user.deviceLabel,
      avatarUrl: next?.profileImageUrl ?? null,
    }
  },
})

// Legacy account-profile mutation. New code must use updateDevicePresentation.
export const updateProfile = mutation({
  args: {
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    profileImageUrl: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const filteredUpdates: Record<string, string | number> = {}
    if (args.firstName !== undefined) filteredUpdates.firstName = args.firstName
    if (args.lastName !== undefined) filteredUpdates.lastName = args.lastName
    if (args.profileImageUrl !== undefined) filteredUpdates.profileImageUrl = args.profileImageUrl
    if (args.jobTitle !== undefined) filteredUpdates.jobTitle = args.jobTitle
    await ctx.db.patch(user._id, { ...filteredUpdates, updatedAt: Date.now() })
  },
})

export const updatePreferences = mutation({
  args: {
    preferences: v.object({
      theme: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("system"))),
      defaultModel: v.optional(v.string()),
      emailNotifications: v.optional(v.boolean()),
      pushNotifications: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const nextPreferences: NonNullable<typeof user.preferences> = { ...user.preferences }
    if (args.preferences.theme !== undefined) nextPreferences.theme = args.preferences.theme
    if (args.preferences.defaultModel !== undefined) nextPreferences.defaultModel = args.preferences.defaultModel
    if (args.preferences.emailNotifications !== undefined) nextPreferences.emailNotifications = args.preferences.emailNotifications
    if (args.preferences.pushNotifications !== undefined) nextPreferences.pushNotifications = args.preferences.pushNotifications
    await ctx.db.patch(user._id, { preferences: nextPreferences, updatedAt: Date.now() })
  },
})
