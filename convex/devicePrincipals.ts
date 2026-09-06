import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { ConvexError, v } from "convex/values"
import { isDeviceIdentityKey, normalizeDeviceIdentityKey } from "../shared/deviceIdentity"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"

function requireServerSecret(serverSecret: string): void {
  const expected = process.env.AI_GATEWAY_SECRET
  if (!expected || serverSecret !== expected) throw new ConvexError("Unauthorized")
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new ConvexError("Device name cannot be blank")
  if (normalized.length > 80) throw new ConvexError("Device name cannot exceed 80 characters")
  return normalized
}

const CHALLENGE_WINDOW_MS = 10 * 60 * 1_000
const MAX_IDENTITY_CHALLENGES_PER_WINDOW = 12
const MAX_FINGERPRINT_CHALLENGES_PER_WINDOW = 30
const MAX_AVATAR_BYTES = 512 * 1024

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
          q.eq("requestFingerprint", args.requestFingerprint!).gte("createdAt", now - CHALLENGE_WINDOW_MS))
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

export const ensureDevicePrincipalFromServer = mutation({
  args: {
    serverSecret: v.string(),
    identityKey: v.string(),
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
    if (!isDeviceIdentityKey(identityKey)) throw new ConvexError("Invalid device identity ID")

    let principal = await ctx.db.query("devicePrincipals")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey)).unique()
    if (principal) {
      if (principal.status === "revoked") throw new ConvexError("This device identity has been revoked")
      if (principal.signingFingerprint !== args.signingFingerprint || principal.signingPublicKeyJwk !== args.signingPublicKeyJwk) {
        throw new ConvexError("This device ID is already bound to another signing key")
      }
      await ctx.db.patch(principal._id, {
        platform: args.platform.trim() || "desktop",
        encryptionPublicKeyJwk: args.encryptionPublicKeyJwk,
        encryptionPublicKeyAlgorithm: args.encryptionPublicKeyAlgorithm,
        encryptionFingerprint: args.encryptionFingerprint,
        lastAuthenticatedAt: now,
        updatedAt: now,
      })
      principal = (await ctx.db.get(principal._id))!
    } else {
      const principalId = await ctx.db.insert("devicePrincipals", {
        identityKey,
        displayName: "This Device",
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
        createdAt: now,
        updatedAt: now,
      })
      principal = (await ctx.db.get(principalId))!
    }

    const avatarUrl = principal.avatarStorageId ? await ctx.storage.getUrl(principal.avatarStorageId) : null
    const workspaceName = `${principal.displayName} Workspace`
    return {
      principalId: principal._id,
      user: {
        principalId: String(principal._id),
        identityKey: principal.identityKey,
        displayName: principal.displayName,
        avatarUrl,
        platform: principal.platform,
      },
      personalWorkspace: {
        id: `local-membership:${identityKey}`,
        workspaceId: `local:${identityKey}`,
        workspaceName,
        organizationId: `local:${identityKey}`,
        organizationName: workspaceName,
        role: "admin" as const,
        status: "active" as const,
        workspaceType: "personal" as const,
      },
      authentication: {
        status: "active" as const,
        signingKeyVersion: principal.signingKeyVersion,
        tokenValidAfter: principal.tokenValidAfter,
      },
    }
  },
})

export const getDevicePrincipalForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const identityKey = normalizeDeviceIdentityKey(args.identityKey)
    const principal = await ctx.db.query("devicePrincipals")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey)).unique()
    if (!principal || principal.status !== "active") return null
    return {
      principalId: principal._id,
      identityKey: principal.identityKey,
      displayName: principal.displayName,
      platform: principal.platform,
      encryptionPublicKeyJwk: principal.encryptionPublicKeyJwk,
      encryptionPublicKeyAlgorithm: principal.encryptionPublicKeyAlgorithm,
      encryptionFingerprint: principal.encryptionFingerprint,
      signingFingerprint: principal.signingFingerprint,
      status: "active" as const,
      signingKeyVersion: principal.signingKeyVersion,
      tokenValidAfter: principal.tokenValidAfter,
    }
  },
})

export const getById = query({
  args: { principalId: v.id("devicePrincipals") },
  handler: async (ctx, args) => {
    const current = await requireAuthenticatedDevice(ctx)
    if (current._id !== args.principalId) {
      // Project-scoped callers use dedicated enriched queries; this endpoint is
      // intentionally self-only so it never becomes a principal directory.
      throw new ConvexError("Principal lookup is self-only")
    }
    const avatarUrl = current.avatarStorageId ? await ctx.storage.getUrl(current.avatarStorageId) : null
    return { ...current, avatarUrl }
  },
})

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const avatarUrl = principal.avatarStorageId ? await ctx.storage.getUrl(principal.avatarStorageId) : null
    return {
      principalId: principal._id,
      identityKey: principal.identityKey,
      displayName: principal.displayName,
      avatarUrl,
      platform: principal.platform,
      preferences: principal.preferences,
      status: principal.status,
    }
  },
})

export const revokeCurrentDevice = mutation({
  args: { reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const now = Date.now()
    await ctx.db.patch(principal._id, {
      status: "revoked",
      signingKeyVersion: principal.signingKeyVersion + 1,
      tokenValidAfter: now,
      revokedAt: now,
      revocationReason: args.reason?.trim().slice(0, 200) || "self_revoked",
      updatedAt: now,
    })
    await ctx.db.insert("identitySecurityEvents", {
      identityKey: principal.identityKey,
      actorIdentityKey: principal.identityKey,
      eventType: "device.self_revoked",
      createdAt: now,
    })
    return { revoked: true }
  },
})

export const updateDevicePresentation = mutation({
  args: { displayName: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const displayName = normalizeDisplayName(args.displayName)
    await ctx.db.patch(principal._id, { displayName, updatedAt: Date.now() })
    return { identityKey: principal.identityKey, displayName }
  },
})

export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticatedDevice(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

export const setAvatar = mutation({
  args: { storageId: v.union(v.id("_storage"), v.null()) },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const previous = principal.avatarStorageId
    if (args.storageId) {
      const metadata = await ctx.db.system.get("_storage", args.storageId)
      if (!metadata) throw new ConvexError("Uploaded avatar is unavailable")
      if (metadata.size > MAX_AVATAR_BYTES) throw new ConvexError("Avatar is too large")
      if (!metadata.contentType?.startsWith("image/")) throw new ConvexError("Avatar must be an image")
    }
    await ctx.db.patch(principal._id, {
      avatarStorageId: args.storageId ?? undefined,
      updatedAt: Date.now(),
    })
    if (previous && previous !== args.storageId) await ctx.storage.delete(previous)
    return { avatarUrl: args.storageId ? await ctx.storage.getUrl(args.storageId) : null }
  },
})

export const updatePreferences = mutation({
  args: {
    preferences: v.object({
      theme: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("system"))),
      defaultModel: v.optional(v.string()),
      pushNotifications: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    await ctx.db.patch(principal._id, {
      preferences: { ...principal.preferences, ...args.preferences },
      updatedAt: Date.now(),
    })
  },
})
