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
    byokGoogleKey: v.optional(v.string()),

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

    // Org-level AI credentials (encrypted with AES-256-GCM)
    aiCredentials: v.optional(
      v.object({
        anthropicKey: v.optional(v.string()),
        openaiKey: v.optional(v.string()),
        googleKey: v.optional(v.string()),
      })
    ),

    // Legacy settings (kept for backward compatibility)
    settings: v.object({
      allowByok: v.boolean(), // Allow members to use their own keys
      defaultModel: v.optional(v.string()),
      monthlyCreditsLimit: v.optional(v.number()),
    }),

    // AI-specific settings (new - per pricing spec)
    aiSettings: v.optional(
      v.object({
        // Providers allowed for this workspace
        allowedProviders: v.array(
          v.union(v.literal("anthropic"), v.literal("openai"), v.literal("google"))
        ),
        // Optional model allowlist (if set, only these model IDs are allowed)
        allowedModels: v.optional(v.array(v.string())),
        // BYOK policy: required (free), optional (pro/max), disabled (enterprise)
        byokPolicy: v.union(
          v.literal("required"),
          v.literal("optional"),
          v.literal("disabled")
        ),
        // Provider tools policy
        allowProviderTools: v.optional(v.boolean()),
        allowWebSearch: v.optional(v.boolean()),
        maxReasoningDepth: v.optional(
          v.union(v.literal("low"), v.literal("medium"), v.literal("high"))
        ),
        // Monthly spending cap in cents (null = unlimited)
        monthlySpendingCapCents: v.optional(v.number()),
        // Default model tier for new users
        defaultModelTier: v.optional(
          v.union(v.literal("fast"), v.literal("standard"), v.literal("powerful"))
        ),
        // Whether overage is enabled (paid plans only)
        overageEnabled: v.optional(v.boolean()),
      })
    ),

    // Subscription & billing (expanded for pricing spec)
    subscription: v.object({
      plan: v.union(
        v.literal("free"),       // $0, BYOK only, 0 credits
        v.literal("pro"),        // $20/mo, 5,000 credits
        v.literal("max"),        // $50/mo, 15,000 credits
        v.literal("team"),       // $40/seat/mo, 10,000/seat pooled
        v.literal("enterprise")  // Custom pricing
      ),
      status: v.union(
        v.literal("active"),
        v.literal("canceled"),
        v.literal("past_due"),
        v.literal("trialing")
      ),
      stripeCustomerId: v.optional(v.string()),
      stripeSubscriptionId: v.optional(v.string()),
      currentPeriodStart: v.optional(v.number()),
      currentPeriodEnd: v.optional(v.number()),
      // Team plan specific
      seatCount: v.optional(v.number()),
      // Billing catalog version (for migrations)
      catalogVersion: v.optional(v.string()),
    }),

    // Credits system (expanded per pricing spec)
    credits: v.object({
      // Subscription credits (expire at billing period end)
      subscriptionCreditsRemaining: v.number(),
      subscriptionCreditsTotal: v.number(),
      // Overage tracking
      overageCreditsUsed: v.number(),
      overageAmountCents: v.number(),
      // Billing period bounds
      currentPeriodStart: v.number(),
      currentPeriodEnd: v.number(),
      // Legacy fields (for backward compat during migration)
      balance: v.optional(v.number()),
      monthlyAllocation: v.optional(v.number()),
      lastResetAt: v.optional(v.number()),
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

    // Idempotency key (prevents double-charging on retries)
    requestId: v.optional(v.string()),

    // Request details
    model: v.string(), // e.g., "claude-sonnet-4-5", "gpt-5.1"
    modelTier: v.optional(v.union(v.literal("fast"), v.literal("standard"), v.literal("powerful"))),
    provider: v.union(v.literal("anthropic"), v.literal("openai"), v.literal("google")),

    // Token counts from AI SDK response.usage
    promptTokens: v.number(),
    completionTokens: v.number(),
    totalTokens: v.number(),

    // Extended usage from AI SDK v6
    extendedUsage: v.optional(
      v.object({
        reasoningTokens: v.optional(v.number()),
        cachedInputTokens: v.optional(v.number()),
        toolCallTokens: v.optional(v.number()),
      })
    ),

    // Cost tracking
    creditsUsed: v.number(), // Normalized cost in credits
    // Credit source breakdown (how credits were deducted)
    creditSourceBreakdown: v.optional(
      v.object({
        fromSubscription: v.number(),
        fromPurchased: v.number(),
        fromOverage: v.number(),
      })
    ),

    // Context
    feature: v.optional(v.string()), // e.g., "code-generation", "chat", "review"
    actionType: v.optional(v.string()), // e.g., "chat", "agent", "build"
    conversationId: v.optional(v.string()),
    projectId: v.optional(v.string()), // For future project tracking

    // Tool usage tracking
    toolCalls: v.optional(
      v.object({
        count: v.number(),
        names: v.array(v.string()),
        approvalCount: v.optional(v.number()),
      })
    ),

    // Performance metrics
    durationMs: v.optional(v.number()),
    finishReason: v.optional(v.string()), // e.g., "stop", "length", "tool_calls"
    rawFinishReason: v.optional(v.string()), // Provider-specific finish reason

    // Key source
    keySource: v.union(v.literal("organization"), v.literal("byok")),

    timestamp: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_timestamp", ["organizationId", "timestamp"])
    .index("by_user", ["userId"])
    .index("by_user_and_timestamp", ["userId", "timestamp"])
    .index("by_request_id", ["requestId"]),

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

  // ============================================
  // BILLING TABLES (per pricing spec v3)
  // ============================================

  // Purchased credit packs (12-month expiration)
  creditLots: defineTable({
    organizationId: v.id("organizations"),

    // Pack type determines credits and price
    packType: v.union(
      v.literal("starter"),  // 1,000 credits, $12
      v.literal("plus"),     // 5,000 credits, $50
      v.literal("pro"),      // 15,000 credits, $120
      v.literal("max")       // 50,000 credits, $350
    ),

    // Credit amounts
    originalCredits: v.number(),
    remainingCredits: v.number(),

    // Stripe tracking
    stripePaymentIntentId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    amountPaidCents: v.number(),

    // Lifecycle
    purchasedAt: v.number(),
    expiresAt: v.number(), // 12 months from purchase
    status: v.union(
      v.literal("active"),
      v.literal("exhausted"),
      v.literal("expired"),
      v.literal("refunded")
    ),

    // Metadata
    purchasedBy: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_status", ["organizationId", "status"])
    .index("by_expiration", ["expiresAt"])
    .index("by_stripe_payment", ["stripePaymentIntentId"]),

  // Invoices for overage billing
  invoices: defineTable({
    organizationId: v.id("organizations"),

    // Billing period
    periodStart: v.number(),
    periodEnd: v.number(),

    // Amounts breakdown (all in cents)
    subscriptionAmountCents: v.number(),
    overageAmountCents: v.number(),
    creditPackAmountCents: v.number(),
    taxAmountCents: v.optional(v.number()),
    totalAmountCents: v.number(),

    // Overage details
    overageCreditsUsed: v.optional(v.number()),
    overageRateCentsPerCredit: v.optional(v.number()),

    // Stripe tracking
    stripeInvoiceId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeHostedInvoiceUrl: v.optional(v.string()),
    stripePdfUrl: v.optional(v.string()),

    // Status
    status: v.union(
      v.literal("draft"),
      v.literal("open"),
      v.literal("paid"),
      v.literal("void"),
      v.literal("uncollectible")
    ),

    // Line items (for detailed breakdown)
    lineItems: v.optional(
      v.array(
        v.object({
          description: v.string(),
          quantity: v.number(),
          unitAmountCents: v.number(),
          totalCents: v.number(),
        })
      )
    ),

    // Timestamps
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
    dueAt: v.optional(v.number()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_status", ["organizationId", "status"])
    .index("by_stripe_invoice", ["stripeInvoiceId"])
    .index("by_period", ["periodStart", "periodEnd"]),

  // Tool registry for agent capabilities
  tools: defineTable({
    // Identity
    name: v.string(), // e.g., "file_read", "web_search"
    displayName: v.string(), // e.g., "Read File", "Web Search"
    description: v.string(),

    // Categorization
    category: v.union(
      v.literal("filesystem"),
      v.literal("web"),
      v.literal("code"),
      v.literal("data"),
      v.literal("custom")
    ),

    // Provider (for provider-supplied tools like web search)
    provider: v.optional(v.union(v.literal("anthropic"), v.literal("openai"), v.literal("google"))),

    // Tool type (function/provider/dynamic)
    toolType: v.optional(
      v.union(v.literal("function"), v.literal("provider"), v.literal("dynamic"))
    ),
    providerToolId: v.optional(v.string()),
    providerToolArgs: v.optional(v.any()),
    supportsDeferredResults: v.optional(v.boolean()),

    // JSON Schema for tool input validation
    inputSchema: v.any(),

    // Permissions & safety
    requiresApproval: v.boolean(), // Human-in-the-loop required
    allowedRoles: v.array(
      v.union(v.literal("admin"), v.literal("member"), v.literal("viewer"))
    ),
    riskLevel: v.union(
      v.literal("safe"),      // Auto-approve
      v.literal("moderate"),  // Prompt user for confirmation
      v.literal("dangerous")  // Always require explicit approval
    ),

    // Execution context
    executionEnvironment: v.union(
      v.literal("local"),   // Runs in Electron main process
      v.literal("server"),  // Runs on Railway server
      v.literal("provider") // Provider-supplied (e.g., web search)
    ),

    // Status
    isBuiltin: v.boolean(),
    isEnabled: v.boolean(),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_category", ["category"])
    .index("by_provider", ["provider"]),

  // Tool approval requests (human-in-the-loop)
  toolApprovalRequests: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),

    // Tool info
    toolName: v.string(),
    toolInput: v.any(), // The proposed arguments
    approvalId: v.optional(v.string()),

    // Context
    conversationId: v.string(),
    agentRunId: v.optional(v.string()),
    messageId: v.optional(v.string()),

    // Status
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("expired"),
      v.literal("auto_approved")
    ),

    // Response
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),

    // TTL for cleanup
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_organization_pending", ["organizationId", "status"])
    .index("by_conversation", ["conversationId"])
    .index("by_agent_run", ["agentRunId"])
    .index("by_expiration", ["expiresAt"])
    .index("by_approval_id", ["approvalId"]),

  // Stripe catalog metadata (products/prices) for workspace-wide use
  stripeCatalog: defineTable({
    catalogVersion: v.string(),
    mode: v.union(v.literal("test"), v.literal("live")),
    subscriptionPrices: v.object({
      pro: v.object({ productId: v.string(), priceId: v.string() }),
      max: v.object({ productId: v.string(), priceId: v.string() }),
      team: v.object({ productId: v.string(), priceId: v.string() }),
    }),
    creditPackPrices: v.object({
      starter: v.object({ productId: v.string(), priceId: v.string() }),
      plus: v.object({ productId: v.string(), priceId: v.string() }),
      pro: v.object({ productId: v.string(), priceId: v.string() }),
      max: v.object({ productId: v.string(), priceId: v.string() }),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_version", ["catalogVersion"])
    .index("by_updated_at", ["updatedAt"]),
})
