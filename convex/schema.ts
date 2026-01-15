import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  // Users - synced from WorkOS
  users: defineTable({
    // WorkOS identifiers
    workosId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    profileImageUrl: v.optional(v.string()),

    // BYOK (Bring Your Own Keys) - encrypted in production
    byokAnthropicKey: v.optional(v.string()),
    byokOpenaiKey: v.optional(v.string()),

    // User preferences
    preferences: v.optional(
      v.object({
        theme: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("system"))),
        defaultModel: v.optional(v.string()),
      })
    ),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  })
    .index("by_workos_id", ["workosId"])
    .index("by_email", ["email"]),

  // Organizations - synced from WorkOS
  organizations: defineTable({
    workosId: v.string(), // WorkOS organization ID
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    logoUrl: v.optional(v.string()),

    // Org-level AI credentials (encrypted in production)
    aiCredentials: v.optional(
      v.object({
        anthropicKey: v.optional(v.string()),
        openaiKey: v.optional(v.string()),
      })
    ),

    // Settings
    settings: v.object({
      allowByok: v.boolean(), // Allow members to use their own keys
      defaultModel: v.optional(v.string()),
      monthlyCreditsLimit: v.optional(v.number()),
    }),

    // Subscription & billing
    subscription: v.object({
      plan: v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise")),
      status: v.union(v.literal("active"), v.literal("canceled"), v.literal("past_due")),
      stripeCustomerId: v.optional(v.string()),
      stripeSubscriptionId: v.optional(v.string()),
      currentPeriodStart: v.optional(v.number()),
      currentPeriodEnd: v.optional(v.number()),
    }),

    // Credits system
    credits: v.object({
      balance: v.number(), // Current credits balance
      monthlyAllocation: v.number(), // Credits allocated per billing period
      lastResetAt: v.number(),
    }),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workos_id", ["workosId"])
    .index("by_slug", ["slug"]),

  // Organization members - synced from WorkOS
  members: defineTable({
    workosId: v.string(), // WorkOS membership ID
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: v.union(
      v.literal("admin"),
      v.literal("member"),
      v.literal("viewer")
    ),

    // Member-specific settings
    settings: v.optional(
      v.object({
        useByok: v.boolean(), // Use personal keys instead of org keys
      })
    ),

    // Timestamps
    joinedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workos_id", ["workosId"])
    .index("by_organization", ["organizationId"])
    .index("by_user", ["userId"])
    .index("by_organization_and_user", ["organizationId", "userId"]),

  // Pending invitations
  invitations: defineTable({
    organizationId: v.id("organizations"),
    email: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("member"),
      v.literal("viewer")
    ),
    invitedBy: v.id("users"),
    token: v.string(), // Unique invite token (legacy, kept for backwards compat)
    workosInvitationId: v.optional(v.string()), // WorkOS invitation ID for revocation
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired")),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_email", ["email"])
    .index("by_token", ["token"]),

  // Connected integrations (GitHub, Vercel, etc.)
  integrations: defineTable({
    organizationId: v.id("organizations"),
    provider: v.union(
      v.literal("github"),
      v.literal("vercel"),
      v.literal("linear"),
      v.literal("slack")
    ),
    // Encrypted credentials
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    // Provider-specific data
    externalId: v.optional(v.string()), // e.g., GitHub installation ID
    metadata: v.optional(v.any()),
    // Status
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("revoked")),
    connectedBy: v.id("users"),
    connectedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_provider", ["organizationId", "provider"]),

  // AI usage tracking - individual requests
  aiUsage: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),

    // Request details
    model: v.string(), // e.g., "claude-3-opus-20240229"
    provider: v.union(v.literal("anthropic"), v.literal("openai")),

    // Token counts from AI SDK response.usage
    promptTokens: v.number(),
    completionTokens: v.number(),
    totalTokens: v.number(),

    // Cost tracking
    creditsUsed: v.number(), // Normalized cost in credits

    // Context
    feature: v.optional(v.string()), // e.g., "code-generation", "chat", "review"
    projectId: v.optional(v.string()), // For future project tracking

    // Key source
    keySource: v.union(v.literal("organization"), v.literal("byok")),

    timestamp: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_timestamp", ["organizationId", "timestamp"])
    .index("by_user", ["userId"])
    .index("by_user_and_timestamp", ["userId", "timestamp"]),

  // Pre-computed usage aggregates for billing/analytics
  aiUsageAggregates: defineTable({
    organizationId: v.id("organizations"),
    period: v.union(v.literal("daily"), v.literal("monthly")),
    periodStart: v.number(), // Start of day/month timestamp

    // Aggregated totals
    totalPromptTokens: v.number(),
    totalCompletionTokens: v.number(),
    totalTokens: v.number(),
    totalCreditsUsed: v.number(),
    requestCount: v.number(),

    // Breakdown by model (stored as JSON)
    byModel: v.optional(v.any()),
    // Breakdown by user (stored as JSON)
    byUser: v.optional(v.any()),

    updatedAt: v.number(),
  })
    .index("by_organization_and_period", ["organizationId", "period", "periodStart"]),

  // Audit logs for compliance
  auditLogs: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    action: v.string(), // e.g., "member.invited", "settings.updated", "integration.connected"
    resourceType: v.optional(v.string()), // e.g., "member", "integration"
    resourceId: v.optional(v.string()),
    metadata: v.optional(v.any()), // Action-specific details
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_timestamp", ["organizationId", "timestamp"])
    .index("by_user", ["userId"]),
})
