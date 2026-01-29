/**
 * Integrations Module
 *
 * Convex mutations and queries for managing external service integrations.
 * Credentials are stored encrypted (encrypted client-side before sending).
 */

import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

// Provider type matching schema
const providerValidator = v.union(
  // Version Control
  v.literal("github"),
  v.literal("gitlab"),
  // Backend/Database
  v.literal("supabase"),
  v.literal("firebase"),
  v.literal("planetscale"),
  v.literal("neon"),
  // Deployment
  v.literal("vercel"),
  v.literal("netlify"),
  v.literal("railway"),
  v.literal("fly"),
  // Auth
  v.literal("clerk"),
  v.literal("auth0"),
  // Payments
  v.literal("stripe"),
  // Email
  v.literal("resend"),
  v.literal("sendgrid"),
  // Storage
  v.literal("aws"),
  v.literal("cloudflare"),
  // Collaboration
  v.literal("linear"),
  v.literal("slack"),
  // Work OS
  v.literal("notion"),
  v.literal("airtable"),
  v.literal("monday"),
  v.literal("asana"),
  v.literal("clickup"),
  v.literal("coda")
)

const authTypeValidator = v.union(
  v.literal("oauth"),
  v.literal("api_key"),
  v.literal("service_account")
)

const statusValidator = v.union(
  v.literal("active"),
  v.literal("expired"),
  v.literal("revoked"),
  v.literal("needs_reauth")
)

// ============================================
// Queries
// ============================================

/**
 * List all integrations for an organization
 */
export const list = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const integrations = await ctx.db
      .query("integrations")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .collect()

    // Don't return encrypted credentials to client
    return integrations.map((integration) => ({
      _id: integration._id,
      _creationTime: integration._creationTime,
      organizationId: integration.organizationId,
      provider: integration.provider,
      authType: integration.authType,
      oauthScopes: integration.oauthScopes,
      tokenExpiresAt: integration.tokenExpiresAt,
      externalId: integration.externalId,
      externalAccountName: integration.externalAccountName,
      metadata: integration.metadata,
      enabledTools: integration.enabledTools,
      status: integration.status,
      lastVerifiedAt: integration.lastVerifiedAt,
      connectedBy: integration.connectedBy,
      connectedAt: integration.connectedAt,
      updatedAt: integration.updatedAt,
      // Omit encryptedCredentials
    }))
  },
})

/**
 * Get a single integration by provider
 */
export const getByProvider = query({
  args: {
    organizationId: v.id("organizations"),
    provider: providerValidator,
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_organization_and_provider", (q) =>
        q.eq("organizationId", args.organizationId).eq("provider", args.provider)
      )
      .first()

    if (!integration) return null

    // Don't return encrypted credentials to client
    return {
      _id: integration._id,
      _creationTime: integration._creationTime,
      organizationId: integration.organizationId,
      provider: integration.provider,
      authType: integration.authType,
      oauthScopes: integration.oauthScopes,
      tokenExpiresAt: integration.tokenExpiresAt,
      externalId: integration.externalId,
      externalAccountName: integration.externalAccountName,
      metadata: integration.metadata,
      enabledTools: integration.enabledTools,
      status: integration.status,
      lastVerifiedAt: integration.lastVerifiedAt,
      connectedBy: integration.connectedBy,
      connectedAt: integration.connectedAt,
      updatedAt: integration.updatedAt,
    }
  },
})

/**
 * Get encrypted credentials for an integration (for agent tool execution)
 * This is an internal query that should only be called from trusted contexts
 */
export const getEncryptedCredentials = query({
  args: {
    organizationId: v.id("organizations"),
    provider: providerValidator,
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_organization_and_provider", (q) =>
        q.eq("organizationId", args.organizationId).eq("provider", args.provider)
      )
      .first()

    if (!integration) return null
    if (integration.status !== "active") return null

    return {
      encryptedCredentials: integration.encryptedCredentials,
      provider: integration.provider,
      authType: integration.authType,
    }
  },
})

// ============================================
// Mutations
// ============================================

/**
 * Connect a new integration
 */
export const connect = mutation({
  args: {
    organizationId: v.id("organizations"),
    provider: providerValidator,
    authType: authTypeValidator,
    encryptedCredentials: v.string(),
    oauthScopes: v.optional(v.array(v.string())),
    tokenExpiresAt: v.optional(v.number()),
    externalId: v.optional(v.string()),
    externalAccountName: v.optional(v.string()),
    metadata: v.optional(v.any()),
    enabledTools: v.optional(v.array(v.string())),
    connectedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    // Check if integration already exists
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_organization_and_provider", (q) =>
        q.eq("organizationId", args.organizationId).eq("provider", args.provider)
      )
      .first()

    if (existing) {
      // Update existing integration
      await ctx.db.patch(existing._id, {
        authType: args.authType,
        encryptedCredentials: args.encryptedCredentials,
        oauthScopes: args.oauthScopes,
        tokenExpiresAt: args.tokenExpiresAt,
        externalId: args.externalId,
        externalAccountName: args.externalAccountName,
        metadata: args.metadata,
        enabledTools: args.enabledTools,
        status: "active",
        lastVerifiedAt: now,
        updatedAt: now,
      })
      return existing._id
    }

    // Create new integration
    const integrationId = await ctx.db.insert("integrations", {
      organizationId: args.organizationId,
      provider: args.provider,
      authType: args.authType,
      encryptedCredentials: args.encryptedCredentials,
      oauthScopes: args.oauthScopes,
      tokenExpiresAt: args.tokenExpiresAt,
      externalId: args.externalId,
      externalAccountName: args.externalAccountName,
      metadata: args.metadata,
      enabledTools: args.enabledTools,
      status: "active",
      lastVerifiedAt: now,
      connectedBy: args.connectedBy,
      connectedAt: now,
      updatedAt: now,
    })

    return integrationId
  },
})

/**
 * Disconnect (remove) an integration
 */
export const disconnect = mutation({
  args: {
    integrationId: v.id("integrations"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.integrationId)
  },
})

/**
 * Update integration status
 */
export const updateStatus = mutation({
  args: {
    integrationId: v.id("integrations"),
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.integrationId, {
      status: args.status,
      updatedAt: Date.now(),
    })
  },
})

/**
 * Update integration credentials (for token refresh or re-auth)
 */
export const updateCredentials = mutation({
  args: {
    integrationId: v.id("integrations"),
    encryptedCredentials: v.string(),
    tokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    await ctx.db.patch(args.integrationId, {
      encryptedCredentials: args.encryptedCredentials,
      tokenExpiresAt: args.tokenExpiresAt,
      status: "active",
      lastVerifiedAt: now,
      updatedAt: now,
    })
  },
})

/**
 * Update enabled tools for an integration
 */
export const updateEnabledTools = mutation({
  args: {
    integrationId: v.id("integrations"),
    enabledTools: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.integrationId, {
      enabledTools: args.enabledTools,
      updatedAt: Date.now(),
    })
  },
})

// ============================================
// Integration Key Queries/Mutations
// ============================================

/**
 * Get the encryption key metadata for an organization
 */
export const getKeyMetadata = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("integrationKeys")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first()
  },
})

/**
 * Store encryption key metadata (actual key is in local keychain)
 */
export const storeKeyMetadata = mutation({
  args: {
    organizationId: v.id("organizations"),
    keyId: v.string(),
    keyVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    // Check if key metadata already exists
    const existing = await ctx.db
      .query("integrationKeys")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .first()

    if (existing) {
      // Update existing
      await ctx.db.patch(existing._id, {
        keyId: args.keyId,
        keyVersion: args.keyVersion,
        rotatedAt: now,
      })
      return existing._id
    }

    // Create new
    return ctx.db.insert("integrationKeys", {
      organizationId: args.organizationId,
      keyId: args.keyId,
      keyVersion: args.keyVersion,
      algorithm: "aes-256-gcm",
      createdAt: now,
    })
  },
})
