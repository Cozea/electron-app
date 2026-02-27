import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  // Users - synced from WorkOS
  users: defineTable({
    // WorkOS identifiers
    workosId: v.string(),
    email: v.string(),
    normalizedEmail: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    profileImageUrl: v.optional(v.string()),
    jobTitle: v.optional(v.string()),

    // User preferences
    preferences: v.optional(
      v.object({
        theme: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("system"))),
        defaultModel: v.optional(v.string()),
        emailNotifications: v.optional(v.boolean()),
        pushNotifications: v.optional(v.boolean()),
      })
    ),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  })
    .index("by_workos_id", ["workosId"])
    .index("by_email", ["email"])
    .index("by_normalized_email", ["normalizedEmail"]),

  // Organizations - synced from WorkOS
  organizations: defineTable({
    workosId: v.string(), // WorkOS organization ID
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    logoUrl: v.optional(v.string()),

    // AI-specific settings (new - per pricing spec)
    aiSettings: v.optional(
      v.object({
        // Providers allowed for this workspace
        allowedProviders: v.array(
          v.union(
            v.literal("anthropic"),
            v.literal("openai"),
            v.literal("google"),
            v.literal("xai")
          )
        ),
        // Optional model allowlist (if set, only these model IDs are allowed)
        allowedModels: v.optional(v.array(v.string())),
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
      })
    ),

    // Subscription & billing (workspace infrastructure tiers)
    subscription: v.object({
      plan: v.union(
        v.literal("free"),       // Free
        v.literal("pro"),        // Power Duo
        v.literal("max"),        // Winning Team
        v.literal("team"),       // Custom (legacy id)
        v.literal("enterprise")  // Custom
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

    // Storage usage tracking
    storageUsage: v.optional(
      v.object({
        totalBytes: v.number(),
        lastCalculatedAt: v.number(),
        breakdown: v.object({
          sourceAndConfig: v.number(),
          collaborationData: v.number(),
          aiHistory: v.number(),
          buildCache: v.number(),
          snapshots: v.number(),
          gitHistory: v.number(),
          databaseBackups: v.number(),
          assets: v.number(),
        }),
      })
    ),

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

  // Website + product access waitlist
  waitlistSubmissions: defineTable({
    email: v.string(),
    normalizedEmail: v.string(),
    name: v.optional(v.string()),
    roleHint: v.union(
      v.literal("nontechnical"),
      v.literal("developer"),
      v.literal("both")
    ),
    source: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected")
    ),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    approvedAt: v.optional(v.number()),
    rejectedAt: v.optional(v.number()),
  })
    .index("by_normalized_email", ["normalizedEmail"])
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"]),

  // Connected integrations (GitHub, Vercel, Supabase, etc.)
  integrations: defineTable({
    organizationId: v.id("organizations"),
    provider: v.union(
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
    ),

    // Auth type used for this integration
    authType: v.union(
      v.literal("oauth"),
      v.literal("api_key"),
      v.literal("service_account")
    ),

    // Encrypted credentials (JSON blob encrypted client-side with org-specific key)
    // Format: iv:authTag:ciphertext (hex-encoded AES-256-GCM)
    encryptedCredentials: v.string(),

    // OAuth-specific fields
    oauthScopes: v.optional(v.array(v.string())),
    tokenExpiresAt: v.optional(v.number()),

    // Provider-specific data
    externalId: v.optional(v.string()), // e.g., GitHub installation ID, account ID
    externalAccountName: v.optional(v.string()), // Display name from provider
    metadata: v.optional(v.any()), // Provider-specific config (regions, project IDs, etc.)

    // CLI tools this integration enables
    enabledTools: v.optional(v.array(v.string())), // e.g., ["supabase_query", "supabase_deploy"]

    // Status
    status: v.union(
      v.literal("active"),
      v.literal("expired"),
      v.literal("revoked"),
      v.literal("needs_reauth")
    ),
    lastVerifiedAt: v.optional(v.number()),

    connectedBy: v.id("users"),
    connectedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_provider", ["organizationId", "provider"])
    .index("by_status", ["status"]),

  // Integration encryption keys metadata (actual key stored in local OS keychain)
  integrationKeys: defineTable({
    organizationId: v.id("organizations"),
    keyId: v.string(), // UUID used to identify key in local keychain
    keyVersion: v.number(), // For key rotation support
    algorithm: v.literal("aes-256-gcm"),
    createdAt: v.number(),
    rotatedAt: v.optional(v.number()),
  })
    .index("by_organization", ["organizationId"]),

  // AI usage tracking - individual requests
  aiUsage: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),

    // Idempotency key (prevents double-charging on retries)
    requestId: v.optional(v.string()),

    // Request details
    model: v.string(), // e.g., "claude-sonnet-4-5", "gpt-5.3-codex"
    modelTier: v.optional(v.union(v.literal("fast"), v.literal("standard"), v.literal("powerful"))),
    provider: v.string(),

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

    // Cost tracking (visibility only)
    trackedUnits: v.number(),

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
    keySource: v.union(v.literal("organization"), v.literal("provider_auth")),

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
    totalTrackedUnits: v.number(),
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

  // Identity repair and duplication reconciliation audit.
  identityRepairRuns: defineTable({
    scope: v.union(v.literal("scan"), v.literal("repair")),
    dryRun: v.boolean(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    summary: v.optional(v.any()),
    error: v.optional(v.string()),
  })
    .index("by_started_at", ["startedAt"])
    .index("by_status", ["status"]),

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
    provider: v.optional(
      v.union(
        v.literal("anthropic"),
        v.literal("openai"),
        v.literal("google"),
        v.literal("xai")
      )
    ),

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
      team: v.optional(v.object({ productId: v.string(), priceId: v.string() })),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_version", ["catalogVersion"])
    .index("by_updated_at", ["updatedAt"]),

  // ============================================
  // PROJECT SYSTEM TABLES
  // ============================================

  // Projects - comprehensive project configuration
  projects: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    audience: v.optional(v.string()),
    targetLaunchDate: v.optional(v.number()),

    // Creation path
    creationPath: v.union(
      v.literal("fresh"),
      v.literal("repo"),
      v.literal("prompt")
    ),

    // Template & Stack
    template: v.optional(v.string()),
    // Current release supports web only.
    // Reserved for future use (not yet enabled): desktop, mobile.
    targetPlatform: v.optional(v.union(v.literal("web"))),
    buildContract: v.optional(
      v.object({
        previewMode: v.union(v.literal("web")),
        frameworkClass: v.union(v.literal("web-framework")),
        toolchain: v.optional(v.any()),
        commands: v.optional(v.any()),
        constraints: v.optional(v.any()),
        fallbackPolicy: v.optional(v.any()),
        successCriteria: v.optional(v.any()),
        telemetryHints: v.optional(v.any()),
      })
    ),
    stack: v.optional(
      v.object({
        backend: v.optional(v.string()), // supabase, convex, firebase, postgres
        hosting: v.optional(v.string()), // vercel, netlify, railway, aws
        aiProvider: v.optional(v.string()), // openai, anthropic, google, none
      })
    ),

    // Source Control
    sourceControl: v.optional(
      v.object({
        provider: v.optional(v.string()), // github, gitlab, bitbucket, local
        repoUrl: v.optional(v.string()),
        visibility: v.optional(v.string()), // public, private
        mergeStrategy: v.optional(v.string()), // squash, merge, rebase
        mergeQueue: v.optional(v.string()),
      })
    ),

    // Visuals
    visuals: v.optional(
      v.object({
        uiLibrary: v.optional(v.string()), // shadcn, radix, material, chakra
        vibeDescription: v.optional(v.string()),
        colorPreset: v.optional(v.string()),
        primaryColor: v.optional(v.string()),
        secondaryColor: v.optional(v.string()),
        accentColor: v.optional(v.string()),
        logoUrl: v.optional(v.string()),
      })
    ),

    // Preview image (captured from live preview)
    previewImageId: v.optional(v.id("_storage")),

    // Generated plan (from Step 8)
    generatedPlan: v.optional(
      v.object({
        pages: v.array(
          v.object({
            id: v.string(),
            name: v.string(),
            route: v.string(),
            type: v.string(),
            purpose: v.optional(v.string()),
            actions: v.optional(v.array(v.string())),
          })
        ),
        entities: v.array(
          v.object({
            id: v.string(),
            name: v.string(),
            fields: v.optional(v.array(v.string())),
          })
        ),
      })
    ),

    // Status
    status: v.union(
      v.literal("draft"), // Still in wizard
      v.literal("generating"), // AI generating plan
      v.literal("building"), // AI building files
      v.literal("active"), // Ready to use
      v.literal("archived"),
      v.literal("deleted")
    ),
    wizardStep: v.optional(v.number()),

    // Repo import specific
    importedFrom: v.optional(
      v.object({
        provider: v.string(),
        repoFullName: v.string(),
        branch: v.string(),
        detectedStack: v.optional(v.any()),
      })
    ),

    // One-shot specific
    originalPrompt: v.optional(v.string()),
    promptSettings: v.optional(
      v.object({
        model: v.string(),
        agentId: v.union(
          v.literal("plan"),
          v.literal("build"),
          v.literal("assistant_general"),
          v.literal("assistant_project"),
          v.literal("explore"),
          v.literal("review")
        ),
        surface: v.union(
          v.literal("wizard"),
          v.literal("builder"),
          v.literal("assistant_panel"),
          v.literal("assistant_project")
        ),
        variantId: v.optional(
          v.union(
            v.literal("none"),
            v.literal("minimal"),
            v.literal("low"),
            v.literal("medium"),
            v.literal("high"),
            v.literal("xhigh"),
            v.literal("max")
          )
        ),
        toolsEnabled: v.boolean(),
        webSearchEnabled: v.boolean(),
        providerOptions: v.optional(v.any()), // Provider-specific tool options
      })
    ),

    // Selected plan tier (from AI-generated plans)
    selectedPlanTier: v.optional(
      v.union(v.literal("prototype"), v.literal("beta"), v.literal("mvp"))
    ),

    // Local path where project files are stored (on creator's machine)
    localPath: v.optional(v.string()),

    // Framework metadata (set during build, used for Pages tab + dev server)
    frameworkInfo: v.optional(
      v.object({
        framework: v.string(), // nextjs, remix, vite-react, sveltekit, etc.
        displayName: v.optional(v.string()), // "Next.js", "Vite + React", etc.
        routeConvention: v.optional(v.string()), // file-based, config-based
        devCommand: v.optional(v.string()), // npm run dev
        devPort: v.optional(v.number()), // 3000, 5173, etc.
        buildCommand: v.optional(v.string()), // npm run build
        startCommand: v.optional(v.string()), // npm start
      })
    ),

    // Cloud storage for org-wide access
    cloudStorage: v.optional(
      v.object({
        provider: v.string(), // "crozcode" | "s3" | "gcs" | "azure"
        bucket: v.optional(v.string()),
        key: v.string(), // path/key within storage
        uploadedAt: v.optional(v.number()),
        uploadedBy: v.optional(v.id("users")),
        version: v.number(), // for diff checking
        checksum: v.optional(v.string()), // for integrity verification
        sizeBytes: v.optional(v.number()),
      })
    ),

    // Sync status between local and cloud
    syncStatus: v.optional(
      v.union(
        v.literal("local_only"), // Not yet uploaded to cloud
        v.literal("uploading"), // Currently uploading
        v.literal("syncing"), // Currently syncing
        v.literal("synced"), // Local matches cloud
        v.literal("local_ahead"), // Local has changes not in cloud
        v.literal("cloud_ahead"), // Cloud has changes not downloaded
        v.literal("conflict"), // Both have changes (needs resolution)
        v.literal("error") // Sync failed
      )
    ),
    syncError: v.optional(v.string()),
    lastSyncAt: v.optional(v.number()),
    lastSyncBy: v.optional(v.id("users")),

    // Project team (for role-based access within org)
    teamId: v.optional(v.id("projectTeams")),

    // Collaborative editing state (for future traffic control)
    sharedFilesVersion: v.optional(v.number()),
    lastSharedUpdate: v.optional(v.number()),

    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_slug", ["organizationId", "slug"])
    .index("by_organization_and_status", ["organizationId", "status"])
    .index("by_created_by", ["createdBy"]),

  // Project members with expanded roles
  projectMembers: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: v.union(
      v.literal("project_manager"),
      v.literal("developer"),
      v.literal("designer"),
      v.literal("viewer")
    ),
    addedAt: v.number(),
    addedBy: v.id("users"),
    // Per-user local path for this project (machine-specific)
    localPath: v.optional(v.string()),
    // Sync tracking (per-user, per-project)
    lastSyncAt: v.optional(v.number()),
    cloudPathsAtLastSync: v.optional(v.array(v.string())),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"])
    .index("by_project_and_user", ["projectId", "userId"]),

  // Project invites for pending team members
  projectInvites: defineTable({
    projectId: v.id("projects"),
    email: v.string(),
    role: v.union(
      v.literal("project_manager"),
      v.literal("developer"),
      v.literal("designer"),
      v.literal("viewer")
    ),
    invitedBy: v.id("users"),
    invitedAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired")
    ),
  })
    .index("by_project", ["projectId"])
    .index("by_email", ["email"])
    .index("by_project_and_status", ["projectId", "status"]),

  // Project teams - groups of users with shared access to projects
  projectTeams: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),

    // Team-level permissions (can be overridden per-project)
    defaultRole: v.union(
      v.literal("project_manager"),
      v.literal("developer"),
      v.literal("designer"),
      v.literal("viewer")
    ),

    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"]),

  // Project team members
  projectTeamMembers: defineTable({
    teamId: v.id("projectTeams"),
    userId: v.id("users"),
    role: v.union(
      v.literal("team_lead"),
      v.literal("member")
    ),
    addedAt: v.number(),
    addedBy: v.id("users"),
  })
    .index("by_team", ["teamId"])
    .index("by_user", ["userId"])
    .index("by_team_and_user", ["teamId", "userId"]),

  // File locks for collaborative editing (traffic control system)
  projectFileLocks: defineTable({
    projectId: v.id("projects"),
    filePath: v.string(), // relative path within project

    // Lock status
    status: v.union(
      v.literal("free"), // Available for editing (green)
      v.literal("locked"), // Currently being edited (yellow=human, red=agent)
      v.literal("merging") // Being merged by traffic control
    ),

    // Who has the lock (human)
    lockedBy: v.optional(v.id("users")),
    lockedAt: v.optional(v.number()),

    // Who has the lock (agent) - traffic light red
    agentId: v.optional(v.string()),
    agentName: v.optional(v.string()),
    taskDescription: v.optional(v.string()),
    expiresAt: v.optional(v.number()), // Auto-expire for agent locks

    // For merge tracking
    pendingMerges: v.optional(v.array(v.id("users"))), // Users with local changes waiting to merge
    lastMergedAt: v.optional(v.number()),
    lastMergedBy: v.optional(v.id("users")),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_path", ["projectId", "filePath"])
    .index("by_locked_by", ["lockedBy"]),

  // File tombstones for delete-vs-edit conflict detection
  // When a file is deleted, we create a tombstone to detect if someone
  // was editing it offline. On reconnect, we can show a conflict UI.
  fileTombstones: defineTable({
    projectId: v.id("projects"),
    filePath: v.string(),
    deletedAt: v.number(),
    deletedBy: v.optional(v.id("users")),
    deletedByAgent: v.optional(v.string()),
    // TTL: tombstones auto-expire after 7 days
    expiresAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_path", ["projectId", "filePath"]),

  // Project conversation messages (for AI planning phase)
  projectMessages: defineTable({
    projectId: v.id("projects"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),

    // For plan cards rendered in the conversation
    planOptions: v.optional(
      v.array(
        v.object({
          tier: v.union(v.literal("prototype"), v.literal("beta"), v.literal("mvp")),
          name: v.string(),
          description: v.string(),
          features: v.array(v.string()),
          estimatedScope: v.optional(v.string()),
          // Full project config for this plan tier
          config: v.object({
            name: v.optional(v.string()),
            description: v.optional(v.string()),
            audience: v.optional(v.string()),
            targetPlatform: v.optional(v.union(v.literal("web"))),
            buildContract: v.optional(
              v.object({
                previewMode: v.union(v.literal("web")),
                frameworkClass: v.union(v.literal("web-framework")),
                toolchain: v.optional(v.any()),
                commands: v.optional(v.any()),
                constraints: v.optional(v.any()),
                fallbackPolicy: v.optional(v.any()),
                successCriteria: v.optional(v.any()),
                telemetryHints: v.optional(v.any()),
              })
            ),
            template: v.optional(v.string()),
            stack: v.optional(
              v.object({
                backend: v.string(),
                hosting: v.string(),
                aiProvider: v.string(),
              })
            ),
            sourceControl: v.optional(
              v.object({
                provider: v.string(),
                repoUrl: v.optional(v.string()),
                visibility: v.string(),
                mergeStrategy: v.string(),
              })
            ),
            visuals: v.optional(
              v.object({
                uiLibrary: v.string(),
                vibeDescription: v.optional(v.string()),
                colorPreset: v.optional(v.string()),
                primaryColor: v.string(),
                secondaryColor: v.string(),
                accentColor: v.string(),
                logoUrl: v.optional(v.string()),
              })
            ),
            generatedPlan: v.optional(
              v.object({
                pages: v.array(
                  v.object({
                    id: v.string(),
                    name: v.string(),
                    route: v.string(),
                    type: v.string(),
                    purpose: v.optional(v.string()),
                    actions: v.optional(v.array(v.string())),
                  })
                ),
                entities: v.array(
                  v.object({
                    id: v.string(),
                    name: v.string(),
                    fields: v.optional(v.array(v.string())),
                  })
                ),
              })
            ),
          }),
        })
      )
    ),

    createdAt: v.number(),
    })
    .index("by_project", ["projectId"])
    .index("by_project_and_created", ["projectId", "createdAt"]),

  // Builder run lifecycle (AI build execution tracking)
  builderRuns: defineTable({
    projectId: v.id("projects"),
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    runId: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("interrupted")
    ),
    attempt: v.number(),
    conversationId: v.optional(v.string()),
    localPath: v.optional(v.string()),

    // Latest task state (from todowrite tool)
    tasks: v.optional(
      v.array(
        v.object({
          content: v.string(),
          activeForm: v.string(),
          status: v.union(
            v.literal("pending"),
            v.literal("in_progress"),
            v.literal("completed")
          ),
          files: v.optional(v.array(v.string())),
        })
      )
    ),
    progress: v.optional(v.number()),
    statusMessage: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    logs: v.optional(v.array(v.string())),

    createdAt: v.number(),
    updatedAt: v.number(),
    lastCheckpointAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_updated", ["projectId", "updatedAt"])
    .index("by_run_id", ["runId"])
    .index("by_user", ["userId"]),

  // Project templates (system-defined)
  projectTemplates: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    icon: v.string(),
    pageCount: v.number(),
    category: v.string(),
    defaultPages: v.array(
      v.object({
        name: v.string(),
        route: v.string(),
        type: v.string(),
      })
    ),
    defaultEntities: v.array(
      v.object({
        name: v.string(),
        fields: v.array(v.string()),
      })
    ),
    scaffoldPrompt: v.string(),
    isActive: v.boolean(),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_category", ["category"])
    .index("by_active_and_sort", ["isActive", "sortOrder"]),

  // Project files stored in Convex File Storage
  projectFiles: defineTable({
    projectId: v.id("projects"),

    // File identity
    fileName: v.string(), // e.g., "config.json", "src/App.tsx"
    filePath: v.string(), // Relative path within project
    fileType: v.string(), // MIME type

    // Convex storage reference
    storageId: v.id("_storage"), // Reference to stored file

    // Metadata
    sizeBytes: v.number(),
    checksum: v.optional(v.string()), // SHA-256 for integrity

    // Versioning
    version: v.number(),
    previousVersionId: v.optional(v.id("projectFiles")),

    // Upload tracking
    uploadedBy: v.id("users"),
    uploadedAt: v.number(),

    // Status
    status: v.union(
      v.literal("active"),
      v.literal("deleted"),
      v.literal("superseded") // Replaced by newer version
    ),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_path", ["projectId", "filePath"])
    .index("by_project_and_status", ["projectId", "status"])
    .index("by_storage_id", ["storageId"]),

  // Canonical Git replica metadata (secondary sync truth).
  projectReplicaGit: defineTable({
    projectId: v.id("projects"),
    canonicalRef: v.string(),
    headCommit: v.optional(v.string()),
    bundleStorageId: v.optional(v.id("_storage")),
    bundleChecksum: v.optional(v.string()),
    bundleSizeBytes: v.optional(v.number()),
    version: v.number(),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
  })
    .index("by_project", ["projectId"])
    .index("by_updated_at", ["updatedAt"]),

  // Git replica session lifecycle and diagnostics.
  projectReplicaGitSessions: defineTable({
    projectId: v.id("projects"),
    sessionId: v.string(),
    userId: v.id("users"),
    deviceId: v.optional(v.string()),
    baseCommit: v.optional(v.string()),
    localCommit: v.optional(v.string()),
    remoteCommit: v.optional(v.string()),
    resultCommit: v.optional(v.string()),
    status: v.union(
      v.literal("planned"),
      v.literal("applied"),
      v.literal("conflict"),
      v.literal("failed"),
      v.literal("queued")
    ),
    diagnostics: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_session", ["projectId", "sessionId"])
    .index("by_status", ["status"])
    .index("by_updated_at", ["updatedAt"]),

  // Optional lock observability for server-side distributed lock operations.
  projectReplicaGitLocks: defineTable({
    projectId: v.id("projects"),
    lockKey: v.string(),
    owner: v.string(),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_expires_at", ["expiresAt"]),

  // Binary/LFS-like payload objects for Git replica.
  projectReplicaLfsObjects: defineTable({
    projectId: v.id("projects"),
    oid: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
    createdAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_oid", ["projectId", "oid"])
    .index("by_storage_id", ["storageId"]),

  // ============================================
  // YJS COLLABORATIVE EDITING TABLES
  // ============================================

  // Yjs incremental updates for real-time collaboration
  yjsUpdates: defineTable({
    projectId: v.id("projects"),
    // Backward-compatible: older rows may not have roomId/seq yet.
    roomId: v.optional(v.string()),
    seq: v.optional(v.number()),
    update: v.bytes(), // Binary Yjs update
    clientId: v.string(), // Y.Doc clientID as string
    origin: v.optional(v.string()), // "user", "agent", "init", etc.
    idempotencyKey: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_project_and_time", ["projectId", "timestamp"])
    .index("by_project_and_seq", ["projectId", "seq"])
    .index("by_project_and_idempotency", ["projectId", "idempotencyKey"]),

  // Yjs document snapshots for recovery/initialization
  yjsDocuments: defineTable({
    projectId: v.id("projects"),
    snapshot: v.bytes(), // Full Y.Doc state as binary
    version: v.number(),
    snapshotBaseSeq: v.optional(v.number()),
    byteSize: v.optional(v.number()),
    createdByClientId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_version", ["projectId", "version"]),

  // Yjs awareness state for live cursors/selection (latest update per client)
  yjsAwareness: defineTable({
    projectId: v.id("projects"),
    clientId: v.string(), // Y.Doc clientID as string
    update: v.bytes(), // Awareness update bytes
    updatedAt: v.number(),
    expiresAt: v.optional(v.number()),
  })
    .index("by_project_and_client", ["projectId", "clientId"])
    .index("by_project_and_updated", ["projectId", "updatedAt"])
    .index("by_updated_at", ["updatedAt"]),

  // ============================================
  // REAL-TIME PRESENCE TABLES
  // ============================================

  // Project presence - tracks who is actively viewing/editing a project
  projectPresence: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),

    // User display info (denormalized for fast reads)
    userName: v.string(),
    userEmail: v.string(),
    userAvatarUrl: v.optional(v.string()),

    // Activity tracking
    lastHeartbeat: v.number(), // Updated every 30s by client
    lastActivityAt: v.optional(v.number()), // Last meaningful user activity timestamp
    activeTab: v.optional(v.string()), // Which tab they're viewing (editor, pages, etc.)
    activeFile: v.optional(v.string()), // Which file they're editing (if any)
    activeRoute: v.optional(v.string()), // Which preview route they're focused on (if on Pages)
    isMonacoTyping: v.optional(v.boolean()),
    isAiTyping: v.optional(v.boolean()),
    isAgentWorking: v.optional(v.boolean()),

    // Cursor position (for future live cursors feature)
    cursor: v.optional(
      v.object({
        line: v.number(),
        column: v.number(),
      })
    ),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_user", ["projectId", "userId"])
    .index("by_user", ["userId"])
    .index("by_heartbeat", ["lastHeartbeat"]),

  // ============================================
  // FILE CHANGE ACTIVITY TRACKING
  // ============================================

  // File changes - tracks individual file edits for activity feed
  fileChanges: defineTable({
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")), // Optional for agent changes

    // File info
    filePath: v.string(),
    changeType: v.union(
      v.literal("create"),
      v.literal("modify"),
      v.literal("delete"),
      v.literal("rename")
    ),

    // Content for diff viewing (stored for history)
    oldContent: v.optional(v.string()),
    newContent: v.optional(v.string()),

    // Change statistics
    additions: v.optional(v.number()),
    deletions: v.optional(v.number()),
    totalLines: v.optional(v.number()),

    // Origin tracking (matches Yjs origin)
    origin: v.union(
      v.literal("user"),
      v.literal("agent"),
      v.literal("remote"),
      v.literal("init")
    ),

    // User display info (denormalized for fast reads)
    userName: v.optional(v.string()),
    userColor: v.optional(v.string()),

    timestamp: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_time", ["projectId", "timestamp"])
    .index("by_user", ["userId"]),

  // ============================================
  // AI CONVERSATION HISTORY
  // ============================================

  // AI conversations for chat history persistence
  aiConversations: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    title: v.string(),
    messages: v.array(v.object({
      id: v.string(),
      role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
      content: v.string(),
      createdAt: v.number(),
      // Optional tool call data
      toolInvocations: v.optional(v.any()),
      // Optional attachments (screenshots, files)
      attachments: v.optional(v.array(v.object({
        url: v.string(),
        contentType: v.string(),
      }))),
    })),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project_and_user", ["projectId", "userId"])
    .index("by_user_and_status", ["userId", "status"])
    .index("by_project_user_status", ["projectId", "userId", "status"]),

  // Conversation continuation linkage for Responses-style providers.
  // Stores provider response linkage state so continuation survives server restarts.
  aiContinuationState: defineTable({
    organizationId: v.string(), // WorkOS org id from AI runtime request
    conversationId: v.string(),
    provider: v.string(),
    model: v.string(),
    previousResponseId: v.string(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_org_conversation_provider_model", [
      "organizationId",
      "conversationId",
      "provider",
      "model",
    ])
    .index("by_org_conversation", ["organizationId", "conversationId"])
    .index("by_expires_at", ["expiresAt"]),

  // Comments on file changes (for code review / collaboration)
  changeComments: defineTable({
    changeId: v.id("fileChanges"),
    projectId: v.id("projects"),
    userId: v.id("users"),

    // Comment content
    content: v.string(),

    // User display info (denormalized for fast reads)
    userName: v.string(),
    userColor: v.string(),
    userImage: v.optional(v.string()),

    // Threading support (reply chains)
    parentCommentId: v.optional(v.id("changeComments")),

    // Status
    status: v.union(
      v.literal("active"),
      v.literal("resolved"),
      v.literal("deleted")
    ),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_change", ["changeId"])
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"]),

  // Emoji reactions on change comments
  changeCommentReactions: defineTable({
    commentId: v.id("changeComments"),
    changeId: v.id("fileChanges"),
    projectId: v.id("projects"),
    userId: v.id("users"),
    emoji: v.string(),
    createdAt: v.number(),
  })
    .index("by_comment", ["commentId"])
    .index("by_change", ["changeId"])
    .index("by_comment_and_user", ["commentId", "userId"])
    .index("by_user", ["userId"]),

  // Project assets (images, videos, PDFs, etc.)
  projectAssets: defineTable({
    projectId: v.id("projects"),
    organizationId: v.id("organizations"),
    name: v.string(),
    storageId: v.optional(v.id("_storage")), // Optional for folders
    mimeType: v.string(),
    size: v.number(),
    folderPath: v.optional(v.string()),
    label: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.string(), // image, audio, video, document, other
    tags: v.optional(v.array(v.string())),
    uploadedBy: v.id("users"),
    uploadedAt: v.number(),
    aiAnalysis: v.optional(
      v.object({
        summary: v.string(),
        detectedContent: v.optional(v.array(v.string())),
        suggestedTags: v.optional(v.array(v.string())),
      })
    ),
  })
    .index("by_project", ["projectId"])
    .index("by_organization", ["organizationId"])
    .index("by_folder", ["projectId", "folderPath"])
    .index("by_category", ["projectId", "category"])
    .searchIndex("search_assets", {
      searchField: "name",
      filterFields: ["projectId"],
  }),

  // ============================================
  // DEPLOYMENT JOBS
  // ============================================
  deploymentJobs: defineTable({
    projectId: v.id("projects"),
    requestedBy: v.id("users"),
    target: v.union(v.literal("preview"), v.literal("production")),
    provider: v.union(v.literal("railway")),
    commitSha: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("canceled")
    ),
    providerDeploymentId: v.optional(v.string()),
    statusUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    logs: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_status", ["projectId", "status"])
    .index("by_requested_by", ["requestedBy"])
    .index("by_updated_at", ["updatedAt"]),
})
