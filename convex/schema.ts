import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  // Users - local device-backed profiles with legacy identity compatibility
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
        // Legacy compatibility for existing production docs from older Radon-backed builds.
        radonToken: v.optional(v.string()),
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

  // ============================================
  // PROJECT SYSTEM TABLES
  // ============================================

  // Projects - comprehensive project configuration
  projects: defineTable({
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    audience: v.optional(v.string()),
    targetLaunchDate: v.optional(v.number()),

    // Creation path
    creationPath: v.union(v.literal("fresh"), v.literal("repo")),

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

    // Canonical repository descriptor. Written by create/setSourceControl;
    // readers prefer this and fall back to the legacy trio below.
    repo: v.optional(
      v.object({
        provider: v.string(),
        url: v.string(),
        defaultBranch: v.string(),
        owner: v.optional(v.string()),
        name: v.optional(v.string()),
        visibility: v.optional(v.string()),
        workingCopyMode: v.optional(
          v.union(v.literal("managed"), v.literal("attached"))
        ),
        setupMode: v.optional(
          v.union(v.literal("personal"), v.literal("organization"))
        ),
        importedFromBranch: v.optional(v.string()),
      })
    ),

    // Legacy repository integration metadata.
    // Collaboration should not depend on these fields on the active path.
    sourceControl: v.optional(
      v.object({
        provider: v.optional(v.string()), // github, gitlab, bitbucket, local
        repoUrl: v.optional(v.string()),
        defaultBranch: v.optional(v.string()),
        visibility: v.optional(v.string()), // public, private
        mergeStrategy: v.optional(v.string()), // squash, merge, rebase
        mergeQueue: v.optional(v.string()),
        workingCopyMode: v.optional(
          v.union(v.literal("managed"), v.literal("attached"))
        ),
        setupMode: v.optional(
          v.union(v.literal("personal"), v.literal("organization"))
        ),
      })
    ),

    // Optional attached repository metadata.
    gitRepository: v.optional(
      v.object({
        provider: v.string(), // github, gitlab, bitbucket
        owner: v.string(),
        name: v.string(),
        url: v.string(),
        defaultBranch: v.string(),
      })
    ),

    // Optional repository status metadata kept for compatibility and tooling.
    gitSyncState: v.optional(
      v.object({
        accessState: v.union(
          v.literal("unknown"),
          v.literal("pending"),
          v.literal("granted"),
          v.literal("missing"),
          v.literal("error")
        ),
        lastFetchedCommit: v.optional(v.string()),
        lastPushedCommit: v.optional(v.string()),
        lastFetchAt: v.optional(v.number()),
        lastPushAt: v.optional(v.number()),
        repoBytes: v.optional(v.number()),
        lastRepoSizeAt: v.optional(v.number()),
        errorMessage: v.optional(v.string()),
        migratedFromReplicaAt: v.optional(v.number()),
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

    // Generated project structure used by builder/tasks surfaces
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
      v.literal("draft"), // Created but not yet active
      v.literal("provisioning"), // Doc created; local effects (folder/clone/repo) still running
      v.literal("generating"), // AI generating plan
      v.literal("building"), // AI building files
      v.literal("active"), // Ready to use
      v.literal("archived"),
      v.literal("deleted")
    ),
    // Client-generated idempotency token: retries of the same creation
    // attempt resolve to the same doc instead of minting "name-1" twins.
    creationToken: v.optional(v.string()),
    // Repo import specific
    importedFrom: v.optional(
      v.object({
        provider: v.string(),
        repoFullName: v.string(),
        branch: v.string(),
        detectedStack: v.optional(v.any()),
      })
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

    // Collaborative editing state (for future traffic control)
    sharedFilesVersion: v.optional(v.number()),
    lastSharedUpdate: v.optional(v.number()),

    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    organizationId: v.optional(v.id("organizations")),
  })
    .index("by_slug", ["slug"])
    .index("by_created_by", ["createdBy"])
    .index("by_creation_token", ["creationToken"])
    .index("by_organization", ["organizationId"]),

  // Wizard/builder artifacts split out of the project doc: list queries never
  // carry them, and artifact churn never invalidates list subscriptions.
  // Legacy docs may still hold these fields inline; projects.getArtifacts
  // coalesces both sources.
  projectArtifacts: defineTable({
    projectId: v.id("projects"),
    visuals: v.optional(
      v.object({
        uiLibrary: v.optional(v.string()),
        vibeDescription: v.optional(v.string()),
        colorPreset: v.optional(v.string()),
        primaryColor: v.optional(v.string()),
        secondaryColor: v.optional(v.string()),
        accentColor: v.optional(v.string()),
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
        backend: v.optional(v.string()),
        hosting: v.optional(v.string()),
        aiProvider: v.optional(v.string()),
      })
    ),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  // Machine-written repository sync metrics, split out so background syncs
  // never touch (and re-push) the project doc itself.
  projectSyncState: defineTable({
    projectId: v.id("projects"),
    gitSyncState: v.object({
      accessState: v.union(
        v.literal("unknown"),
        v.literal("pending"),
        v.literal("granted"),
        v.literal("missing"),
        v.literal("error")
      ),
      lastFetchedCommit: v.optional(v.string()),
      lastPushedCommit: v.optional(v.string()),
      lastFetchAt: v.optional(v.number()),
      lastPushAt: v.optional(v.number()),
      repoBytes: v.optional(v.number()),
      lastRepoSizeAt: v.optional(v.number()),
      errorMessage: v.optional(v.string()),
      migratedFromReplicaAt: v.optional(v.number()),
    }),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  // Project members with expanded roles
  projectMembers: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    contactEmail: v.optional(v.string()),
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

  // Cozea-owned organizations. Members are invited like project team, not WorkOS.
  organizations: defineTable({
    name: v.string(),
    // Legacy WorkOS-backed organizations predate Cozea membership records.
    // Keep them readable until the device-identity migration assigns ownership.
    createdBy: v.optional(v.id("users")),
    workosId: v.optional(v.string()),
    slug: v.optional(v.string()),
    iconColor: v.optional(v.any()),
    iconKey: v.optional(v.any()),
    aiSettings: v.optional(v.any()),
    storageUsage: v.optional(v.any()),
    subscription: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_created_by", ["createdBy"]),

  organizationMembers: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
    addedAt: v.number(),
    addedBy: v.id("users"),
  })
    .index("by_organization", ["organizationId"])
    .index("by_user", ["userId"])
    .index("by_organization_and_user", ["organizationId", "userId"]),

  organizationInvites: defineTable({
    organizationId: v.id("organizations"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    invitedBy: v.id("users"),
    invitedAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
    ),
  })
    .index("by_organization", ["organizationId"])
    .index("by_email", ["email"])
    .index("by_organization_and_status", ["organizationId", "status"]),

  // Org-private DevApps. One publication per source project; updates point at
  // a new immutable artifact release. Legacy recipe fields remain optional so
  // empty historical docs still validate.
  devAppPublications: defineTable({
    projectId: v.id("projects"),
    organizationId: v.optional(v.id("organizations")),
    activeReleaseId: v.optional(v.id("devAppReleases")),
    visibility: v.union(v.literal("project"), v.literal("organization")),
    name: v.string(),
    description: v.optional(v.string()),
    logoDataUrl: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_organization", ["organizationId"])
    .index("by_status", ["status"])
    .index("by_status_and_updated_at", ["status", "updatedAt"]),

  // Append-only DevApp artifact releases. Consumer open path uses storage +
  // content hash, never a localhost command.
  devAppReleases: defineTable({
    publicationId: v.id("devAppPublications"),
    projectId: v.id("projects"),
    version: v.number(),
    framework: v.string(),
    artifactStorageId: v.optional(v.id("_storage")),
    entryPath: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    devCommand: v.optional(v.string()),
    devPort: v.optional(v.number()),
    sourceRevision: v.optional(v.string()),
    sourceFingerprint: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_publication", ["publicationId"])
    .index("by_publication_and_version", ["publicationId", "version"])
    .index("by_project", ["projectId"]),

  projectTrustedDevices: defineTable({
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    deviceId: v.string(),
    deviceLabel: v.string(),
    platform: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
    role: v.union(
      v.literal("project_manager"),
      v.literal("developer"),
      v.literal("designer"),
      v.literal("viewer")
    ),
    addedAt: v.number(),
    addedByUserId: v.optional(v.id("users")),
    addedByDeviceId: v.optional(v.string()),
    lastSeenAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_device", ["projectId", "deviceId"])
    .index("by_project_and_user", ["projectId", "userId"])
    .index("by_device", ["deviceId"]),

  // Per-project storage accounting aggregate used for local/cloud repair jobs.
  projectStorageUsage: defineTable({
    projectId: v.id("projects"),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"]),

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

  // Shared project tasks created from the task board UI.
  projectTasks: defineTable({
    projectId: v.id("projects"),
    taskKey: v.string(),
    title: v.string(),
    description: v.string(),
    status: v.union(
      v.literal("planned"),
      v.literal("active"),
      v.literal("done")
    ),
    deadlineDate: v.optional(v.string()),
    assignee: v.optional(
      v.object({
        userId: v.optional(v.id("users")),
        name: v.string(),
        email: v.optional(v.string()),
        avatarUrl: v.optional(v.string()),
      })
    ),
    context: v.object({
      kind: v.union(v.literal("file"), v.literal("page")),
      value: v.string(),
      label: v.string(),
      title: v.string(),
    }),
    markers: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
      })
    ),
    checkedMarkerIds: v.array(v.string()),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    completedBy: v.optional(v.id("users")),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_task_key", ["projectId", "taskKey"]),

  // Shared completion state for synthesized task-board items.
  projectTaskStates: defineTable({
    projectId: v.id("projects"),
    source: v.union(
      v.literal("page"),
      v.literal("entity"),
      v.literal("build"),
      v.literal("lock")
    ),
    storageId: v.string(),
    status: v.union(
      v.literal("planned"),
      v.literal("active"),
      v.literal("done")
    ),
    checkedMarkerIds: v.array(v.string()),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    completedBy: v.optional(v.id("users")),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_source_and_storage", ["projectId", "source", "storageId"]),

  // Inbox items for task assignment and completion events.
  projectTaskNotifications: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
    kind: v.union(v.literal("assigned"), v.literal("completed")),
    taskSource: v.union(
      v.literal("manual"),
      v.literal("page"),
      v.literal("entity"),
      v.literal("build"),
      v.literal("lock")
    ),
    taskStorageId: v.string(),
    taskTitle: v.string(),
    taskContext: v.object({
      kind: v.union(v.literal("file"), v.literal("page")),
      value: v.string(),
      label: v.string(),
      title: v.string(),
    }),
    actorUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_user_and_created", ["userId", "createdAt"])
    .index("by_project_and_created", ["projectId", "createdAt"]),

  // Project join links for personal-project collaboration sharing
  projectJoinLinks: defineTable({
    projectId: v.id("projects"),
    token: v.string(),
    role: v.union(
      v.literal("project_manager"),
      v.literal("developer"),
      v.literal("designer"),
      v.literal("viewer")
    ),
    status: v.union(v.literal("active"), v.literal("revoked")),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.id("users")),
    useCount: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_token", ["token"])
    .index("by_project_and_status", ["projectId", "status"]),

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
    .index("by_project_and_path", ["projectId", "filePath"])
    .index("by_expires_at", ["expiresAt"]),

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

  // ============================================
  // COLLABORATION ENCRYPTION TABLES
  // ============================================

  // Collaboration-capable device identities. Only public metadata is stored here.
  collabDevices: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    deviceLabel: v.string(),
    platform: v.string(),
    publicKeyJwk: v.string(),
    publicKeyAlgorithm: v.string(),
    fingerprint: v.string(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_user_and_device", ["userId", "deviceId"])
    .index("by_device", ["deviceId"])
    .index("by_user", ["userId"]),

  // One logical room-key record per encrypted collaboration room/version.
  projectCollabRoomKeys: defineTable({
    projectId: v.id("projects"),
    roomId: v.string(),
    keyVersion: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("rotating"),
      v.literal("revoked"),
    ),
    createdByUserId: v.id("users"),
    createdByDeviceId: v.string(),
    createdAt: v.number(),
    rotatedAt: v.optional(v.number()),
  })
    .index("by_project_and_room", ["projectId", "roomId"])
    .index("by_project_room_and_version", ["projectId", "roomId", "keyVersion"]),

  // Wrapped room keys, one row per recipient device.
  projectCollabWrappedKeys: defineTable({
    projectId: v.id("projects"),
    roomId: v.string(),
    keyVersion: v.number(),
    recipientUserId: v.id("users"),
    recipientDeviceId: v.string(),
    senderDeviceId: v.string(),
    senderPublicKeyJwk: v.string(),
    wrapAlgorithm: v.string(),
    wrappedKey: v.string(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_project_room_and_recipient", ["projectId", "roomId", "recipientDeviceId"])
    .index("by_project_room_and_key_version", ["projectId", "roomId", "keyVersion"]),

  // Pending room-key requests when a new collaborator device needs access
  // to an encrypted collaboration room.
  projectCollabKeyRequests: defineTable({
    projectId: v.id("projects"),
    roomId: v.string(),
    recipientUserId: v.id("users"),
    recipientDeviceId: v.string(),
    recipientPublicKeyJwk: v.string(),
    recipientFingerprint: v.string(),
    requestedAt: v.number(),
    fulfilledAt: v.optional(v.number()),
  })
    .index("by_project_and_room", ["projectId", "roomId"])
    .index("by_project_room_and_device", ["projectId", "roomId", "recipientDeviceId"]),

  // Optional recovery kits for encrypted collaboration rooms.
  // The server stores only encrypted room-key backups, never plaintext keys.
  projectCollabRecoveryKits: defineTable({
    projectId: v.id("projects"),
    roomId: v.string(),
    keyVersion: v.number(),
    wrapAlgorithm: v.string(),
    wrappedKey: v.string(),
    salt: v.string(),
    iterations: v.number(),
    createdByUserId: v.id("users"),
    createdByDeviceId: v.string(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_project_and_room", ["projectId", "roomId"])
    .index("by_project_room_and_key_version", ["projectId", "roomId", "keyVersion"]),

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
    // Deprecated legacy editor-typing flag. Keep optional until existing production records are migrated.
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
    checkpointGroupId: v.optional(v.string()),

    // File info
    filePath: v.string(),
    changeType: v.union(
      v.literal("create"),
      v.literal("modify"),
      v.literal("delete"),
      v.literal("rename")
    ),

    // For renames: the source path before the rename.
    oldPath: v.optional(v.string()),

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
    sourceOrigin: v.optional(v.string()),
    actorType: v.optional(
      v.union(
        v.literal("user"),
        v.literal("agent"),
        v.literal("system"),
      )
    ),
    actorId: v.optional(v.string()),
    terminalId: v.optional(v.string()),
    terminalTitle: v.optional(v.string()),
    terminalKind: v.optional(v.string()),
    commandId: v.optional(v.string()),
    commandText: v.optional(v.string()),
    runId: v.optional(v.string()),
    sessionKey: v.optional(v.string()),
    laneId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    gitCwd: v.optional(v.string()),
    changeTimestamp: v.optional(v.number()),

    // User display info (denormalized for fast reads)
    userName: v.optional(v.string()),
    userColor: v.optional(v.string()),

    timestamp: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_time", ["projectId", "timestamp"])
    .index("by_user", ["userId"]),

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
