import { mutation, query } from "./_generated/server"
import type { DatabaseWriter } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import { checkProjectLimit } from "./lib/workspaceLimits"

// Helper to generate URL-safe slug from project name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50)
}

// Helper to ensure unique slug within organization
async function ensureUniqueSlug(
  ctx: { db: DatabaseWriter },
  organizationId: Id<"organizations">,
  baseSlug: string,
  excludeProjectId?: Id<"projects">
): Promise<string> {
  let slug = baseSlug
  let counter = 1

  while (true) {
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_organization_and_slug", (q) =>
        q.eq("organizationId", organizationId).eq("slug", slug)
      )
      .first()

    if (!existing || (excludeProjectId && existing._id === excludeProjectId)) {
      return slug
    }

    slug = `${baseSlug}-${counter}`
    counter++
  }
}

// ============================================
// CORE CRUD OPERATIONS
// ============================================

// Create a new project (draft status)
export const create = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    name: v.string(),
    creationPath: v.union(v.literal("fresh"), v.literal("repo"), v.literal("prompt")),

    // Intent
    description: v.optional(v.string()),
    audience: v.optional(v.string()),
    targetLaunchDate: v.optional(v.number()),

    // Template
    template: v.optional(v.string()),
    // Current release supports web only.
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

    // Stack - all fields optional to match schema
    stack: v.optional(
      v.object({
        backend: v.optional(v.string()),
        hosting: v.optional(v.string()),
        aiProvider: v.optional(v.string()),
      })
    ),

    // Source Control - all fields optional to match schema
    sourceControl: v.optional(
      v.object({
        provider: v.optional(v.string()),
        repoUrl: v.optional(v.string()),
        visibility: v.optional(v.string()),
        mergeStrategy: v.optional(v.string()),
        mergeQueue: v.optional(v.string()),
      })
    ),

    // Visuals - all fields optional to match schema
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

    // Prompt-specific
    originalPrompt: v.optional(v.string()),
    promptSettings: v.optional(
      v.object({
        model: v.string(),
        agentType: v.union(v.literal("agent"), v.literal("assistant")),
        reasoningDepth: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
        toolsEnabled: v.boolean(),
        webSearchEnabled: v.boolean(),
        thinkingEffort: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
        providerOptions: v.optional(v.any()),
      })
    ),

    // Repo-specific
    repoSource: v.optional(
      v.object({
        provider: v.string(),
        repoUrl: v.string(),
        branch: v.string(),
        detectedStack: v.optional(v.any()),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Check project limit before creating
    const limitStatus = await checkProjectLimit(ctx, args.organizationId)

    if (!limitStatus.allowed) {
      throw new Error(
        limitStatus.message ||
          "Project limit reached. Upgrade your plan to create more projects."
      )
    }

    const now = Date.now()

    // Generate unique slug
    const baseSlug = generateSlug(args.name)
    const slug = await ensureUniqueSlug(ctx, args.organizationId, baseSlug)

    // For repo imports, code already exists - set to active
    // For prompt/fresh, start as draft until AI generates/builds
    const initialStatus = args.creationPath === 'repo' ? 'active' : 'draft'

    // Create project with all fields
    const projectId = await ctx.db.insert("projects", {
      organizationId: args.organizationId,
      name: args.name,
      slug,
      description: args.description,
      audience: args.audience,
      targetLaunchDate: args.targetLaunchDate,
      template: args.template,
      targetPlatform: args.targetPlatform ?? "web",
      buildContract: args.buildContract ?? {
        previewMode: "web",
        frameworkClass: "web-framework",
      },
      stack: args.stack,
      sourceControl: args.sourceControl,
      visuals: args.visuals,
      creationPath: args.creationPath,
      status: initialStatus,
      wizardStep: 0,
      originalPrompt: args.originalPrompt,
      promptSettings: args.promptSettings,
      importedFrom: args.repoSource ? {
        provider: args.repoSource.provider,
        repoFullName: args.repoSource.repoUrl,
        branch: args.repoSource.branch,
        detectedStack: args.repoSource.detectedStack,
      } : undefined,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now,
    })

    // Add creator as project manager
    // For local folder imports, also set the localPath so sync knows where files are
    const memberLocalPath = args.repoSource?.provider === 'local' ? args.repoSource.repoUrl : undefined
    await ctx.db.insert("projectMembers", {
      projectId,
      userId: args.userId,
      role: "project_manager",
      addedAt: now,
      addedBy: args.userId,
      localPath: memberLocalPath,
    })

    return { projectId, slug }
  },
})

// Get project by ID
export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectId)
  },
})

// Get project by slug within organization
export const getBySlug = query({
  args: {
    organizationId: v.id("organizations"),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_organization_and_slug", (q) =>
        q.eq("organizationId", args.organizationId).eq("slug", args.slug)
      )
      .first()
  },
})

// List projects for organization
export const listForOrganization = query({
  args: {
    organizationId: v.id("organizations"),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("generating"),
        v.literal("building"),
        v.literal("active"),
        v.literal("archived"),
        v.literal("deleted")
      )
    ),
  },
  handler: async (ctx, args) => {
    const query = ctx.db
      .query("projects")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))

    const projects = await query.collect()

    // Filter by status if provided, and exclude deleted projects by default
    return projects.filter((p) => {
      if (args.status) {
        return p.status === args.status
      }
      return p.status !== "deleted"
    })
  },
})

// List projects for organization with the current user's local path from their membership
// Used for background diff checking where we need per-user local paths
export const listForOrganizationWithMemberPath = query({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .collect()

    // Get all memberships for this user in one query
    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    // Create a map of projectId -> localPath
    const memberPathMap = new Map(
      memberships.map((m) => [m.projectId.toString(), m.localPath])
    )

    // Return non-deleted projects with the user's localPath from their membership
    return projects
      .filter((p) => p.status !== "deleted")
      .map((p) => ({
        _id: p._id,
        slug: p.slug,
        name: p.name,
        lastSyncAt: p.lastSyncAt,
        // Use per-user localPath from membership, not the deprecated project.localPath
        localPath: memberPathMap.get(p._id.toString()) ?? null,
      }))
  },
})

// List projects the user is a member of
export const listForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    const projects = await Promise.all(
      memberships.map(async (m) => {
        const project = await ctx.db.get(m.projectId)
        return project && project.status !== "deleted" ? { ...project, role: m.role } : null
      })
    )

    return projects.filter(Boolean)
  },
})

// Update project data
export const update = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    audience: v.optional(v.string()),
    targetLaunchDate: v.optional(v.number()),
    template: v.optional(v.string()),
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
        backend: v.optional(v.string()),
        hosting: v.optional(v.string()),
        aiProvider: v.optional(v.string()),
      })
    ),
    sourceControl: v.optional(
      v.object({
        provider: v.optional(v.string()),
        repoUrl: v.optional(v.string()),
        visibility: v.optional(v.string()),
        mergeStrategy: v.optional(v.string()),
        mergeQueue: v.optional(v.string()),
      })
    ),
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
    originalPrompt: v.optional(v.string()),
    promptSettings: v.optional(
      v.object({
        model: v.string(),
        agentType: v.union(v.literal("agent"), v.literal("assistant")),
        reasoningDepth: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
        toolsEnabled: v.boolean(),
        webSearchEnabled: v.boolean(),
        thinkingEffort: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
        providerOptions: v.optional(v.any()),
      })
    ),
    localPath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    // Verify user has permission (is a member with edit rights)
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.userId)
      )
      .first()

    if (!membership || membership.role === "viewer") {
      throw new Error("Unauthorized to edit project")
    }

    const now = Date.now()
    const updates: Record<string, unknown> = { updatedAt: now }

    // Handle name change and slug regeneration
    if (args.name !== undefined && args.name !== project.name) {
      updates.name = args.name
      const baseSlug = generateSlug(args.name)
      updates.slug = await ensureUniqueSlug(
        ctx,
        project.organizationId,
        baseSlug,
        args.projectId
      )
    }

    // Copy other fields if provided
    if (args.description !== undefined) updates.description = args.description
    if (args.audience !== undefined) updates.audience = args.audience
    if (args.targetLaunchDate !== undefined) updates.targetLaunchDate = args.targetLaunchDate
    if (args.template !== undefined) updates.template = args.template
    if (args.targetPlatform !== undefined) updates.targetPlatform = args.targetPlatform
    if (args.buildContract !== undefined) updates.buildContract = args.buildContract
    if (args.stack !== undefined) updates.stack = { ...project.stack, ...args.stack }
    if (args.sourceControl !== undefined) updates.sourceControl = { ...project.sourceControl, ...args.sourceControl }
    if (args.visuals !== undefined) updates.visuals = { ...project.visuals, ...args.visuals }
    if (args.originalPrompt !== undefined) updates.originalPrompt = args.originalPrompt
    if (args.promptSettings !== undefined) updates.promptSettings = args.promptSettings
    if (args.localPath !== undefined) updates.localPath = args.localPath

    await ctx.db.patch(args.projectId, updates)

    return await ctx.db.get(args.projectId)
  },
})

// Update project status
export const updateStatus = mutation({
  args: {
    projectId: v.id("projects"),
    status: v.union(
      v.literal("draft"),
      v.literal("generating"),
      v.literal("building"),
      v.literal("active"),
      v.literal("archived"),
      v.literal("deleted")
    ),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    await ctx.db.patch(args.projectId, {
      status: args.status,
      updatedAt: Date.now(),
    })
  },
})

// Update wizard step
export const updateWizardStep = mutation({
  args: {
    projectId: v.id("projects"),
    step: v.number(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    await ctx.db.patch(args.projectId, {
      wizardStep: args.step,
      updatedAt: Date.now(),
    })
  },
})

// Archive project (soft delete)
export const archive = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    // Verify user has permission
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.userId)
      )
      .first()

    if (!membership || membership.role !== "project_manager") {
      throw new Error("Only project managers can archive projects")
    }

    await ctx.db.patch(args.projectId, {
      status: "archived",
      updatedAt: Date.now(),
    })
  },
})

// Restore archived project
export const restore = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    if (project.status !== "archived") {
      throw new Error("Project is not archived")
    }

    // Verify user has permission
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.userId)
      )
      .first()

    if (!membership || membership.role !== "project_manager") {
      throw new Error("Only project managers can restore projects")
    }

    await ctx.db.patch(args.projectId, {
      status: "active",
      updatedAt: Date.now(),
    })
  },
})

// Hard delete project (requires name confirmation)
export const deleteProject = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    confirmName: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    // Verify confirmation name matches
    if (args.confirmName !== project.name) {
      throw new Error("Project name does not match")
    }

    // Verify user has permission (project_manager role OR project creator OR org admin/owner)
    const isCreator = project.createdBy === args.userId

    // Check project membership
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.userId)
      )
      .first()
    const isProjectManager = membership?.role === "project_manager"

    // Check org membership (admin can also delete)
    const orgMembership = await ctx.db
      .query("members")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", project.organizationId).eq("userId", args.userId)
      )
      .first()
    const isOrgAdmin = orgMembership?.role === "admin"

    if (!isCreator && !isProjectManager && !isOrgAdmin) {
      throw new Error("Only project creators, managers, or organization admins can delete projects")
    }

    // Delete all project members
    const members = await ctx.db
      .query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()
    for (const member of members) {
      await ctx.db.delete(member._id)
    }

    // Delete all project invites
    const invites = await ctx.db
      .query("projectInvites")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()
    for (const invite of invites) {
      await ctx.db.delete(invite._id)
    }

    // Mark project as deleted (soft delete for potential recovery)
    await ctx.db.patch(args.projectId, {
      status: "deleted",
      updatedAt: Date.now(),
    })

    return { success: true }
  },
})

// ============================================
// PLAN GENERATION & MANAGEMENT
// ============================================

// Save AI-generated plan
export const saveGeneratedPlan = mutation({
  args: {
    projectId: v.id("projects"),
    plan: v.object({
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
    }),
    selectedPlanTier: v.optional(
      v.union(v.literal("prototype"), v.literal("beta"), v.literal("mvp"))
    ),
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
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const updates: Record<string, unknown> = {
      generatedPlan: args.plan,
      status: "draft", // Return to draft after plan generation
      updatedAt: Date.now(),
    }

    if (args.selectedPlanTier !== undefined) {
      updates.selectedPlanTier = args.selectedPlanTier
    }
    if (args.targetPlatform !== undefined) {
      updates.targetPlatform = args.targetPlatform
    }
    if (args.buildContract !== undefined) {
      updates.buildContract = args.buildContract
    }

    await ctx.db.patch(args.projectId, updates)
  },
})

// Update a page in the plan
export const updatePlanPage = mutation({
  args: {
    projectId: v.id("projects"),
    pageId: v.string(),
    updates: v.object({
      name: v.optional(v.string()),
      route: v.optional(v.string()),
      type: v.optional(v.string()),
      purpose: v.optional(v.string()),
      actions: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project || !project.generatedPlan) {
      throw new Error("Project or plan not found")
    }

    const pages = project.generatedPlan.pages.map((page) =>
      page.id === args.pageId ? { ...page, ...args.updates } : page
    )

    await ctx.db.patch(args.projectId, {
      generatedPlan: { ...project.generatedPlan, pages },
      updatedAt: Date.now(),
    })
  },
})

// Remove a page from the plan
export const removePlanPage = mutation({
  args: {
    projectId: v.id("projects"),
    pageId: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project || !project.generatedPlan) {
      throw new Error("Project or plan not found")
    }

    const pages = project.generatedPlan.pages.filter((page) => page.id !== args.pageId)

    await ctx.db.patch(args.projectId, {
      generatedPlan: { ...project.generatedPlan, pages },
      updatedAt: Date.now(),
    })
  },
})

// Add a page to the plan
export const addPlanPage = mutation({
  args: {
    projectId: v.id("projects"),
    page: v.object({
      id: v.string(),
      name: v.string(),
      route: v.string(),
      type: v.string(),
      purpose: v.optional(v.string()),
      actions: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const currentPlan = project.generatedPlan || { pages: [], entities: [] }
    const pages = [...currentPlan.pages, args.page]

    await ctx.db.patch(args.projectId, {
      generatedPlan: { ...currentPlan, pages },
      updatedAt: Date.now(),
    })
  },
})

// Update an entity in the plan
export const updatePlanEntity = mutation({
  args: {
    projectId: v.id("projects"),
    entityId: v.string(),
    updates: v.object({
      name: v.optional(v.string()),
      fields: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project || !project.generatedPlan) {
      throw new Error("Project or plan not found")
    }

    const entities = project.generatedPlan.entities.map((entity) =>
      entity.id === args.entityId ? { ...entity, ...args.updates } : entity
    )

    await ctx.db.patch(args.projectId, {
      generatedPlan: { ...project.generatedPlan, entities },
      updatedAt: Date.now(),
    })
  },
})

// Remove an entity from the plan
export const removePlanEntity = mutation({
  args: {
    projectId: v.id("projects"),
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project || !project.generatedPlan) {
      throw new Error("Project or plan not found")
    }

    const entities = project.generatedPlan.entities.filter((e) => e.id !== args.entityId)

    await ctx.db.patch(args.projectId, {
      generatedPlan: { ...project.generatedPlan, entities },
      updatedAt: Date.now(),
    })
  },
})

// Add an entity to the plan
export const addPlanEntity = mutation({
  args: {
    projectId: v.id("projects"),
    entity: v.object({
      id: v.string(),
      name: v.string(),
      fields: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const currentPlan = project.generatedPlan || { pages: [], entities: [] }
    const entities = [...currentPlan.entities, args.entity]

    await ctx.db.patch(args.projectId, {
      generatedPlan: { ...currentPlan, entities },
      updatedAt: Date.now(),
    })
  },
})

// ============================================
// LOCAL PATH MANAGEMENT
// ============================================

// Update local path for a project (used during build initialization)
export const updateLocalPath = mutation({
  args: {
    projectId: v.id("projects"),
    localPath: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    await ctx.db.patch(args.projectId, {
      localPath: args.localPath,
      updatedAt: Date.now(),
    })

    return { success: true }
  },
})

// ============================================
// SYNC STATUS MANAGEMENT
// ============================================

// Update project sync status (used during file synchronization)
export const updateSyncStatus = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    status: v.union(
      v.literal("syncing"),
      v.literal("synced"),
      v.literal("error")
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const updates: Record<string, unknown> = {
      syncStatus: args.status,
      lastSyncAt: Date.now(),
      lastSyncBy: args.userId,
      updatedAt: Date.now(),
    }

    if (args.errorMessage) {
      updates.syncError = args.errorMessage
    } else if (args.status === "synced") {
      // Clear error on successful sync
      updates.syncError = undefined
    }

    await ctx.db.patch(args.projectId, updates)

    return { success: true }
  },
})

// ============================================
// REPO IMPORT SPECIFIC
// ============================================

// Save imported repo details
export const saveImportedFrom = mutation({
  args: {
    projectId: v.id("projects"),
    importedFrom: v.object({
      provider: v.string(),
      repoFullName: v.string(),
      branch: v.string(),
      detectedStack: v.optional(v.any()),
    }),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    await ctx.db.patch(args.projectId, {
      importedFrom: args.importedFrom,
      updatedAt: Date.now(),
    })
  },
})

// ============================================
// PREVIEW IMAGE MANAGEMENT
// ============================================

// Update project preview image (captured from live preview)
export const updatePreviewImage = mutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    // Delete old preview image if exists
    if (project.previewImageId) {
      try {
        await ctx.storage.delete(project.previewImageId)
      } catch {
        // Ignore if old image doesn't exist
      }
    }

    await ctx.db.patch(args.projectId, {
      previewImageId: args.storageId,
      updatedAt: Date.now(),
    })

    return { success: true }
  },
})

// Generate upload URL for preview image
export const generatePreviewUploadUrl = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    return await ctx.storage.generateUploadUrl()
  },
})

// Get preview image URL for a project
export const getPreviewImageUrl = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project || !project.previewImageId) return null

    return await ctx.storage.getUrl(project.previewImageId)
  },
})

// ============================================
// STATISTICS
// ============================================

// Get project statistics for organization
export const getStats = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .collect()

    const nonDeleted = projects.filter((p) => p.status !== "deleted")

    return {
      total: nonDeleted.length,
      active: nonDeleted.filter((p) => p.status === "active").length,
      draft: nonDeleted.filter((p) => p.status === "draft").length,
      building: nonDeleted.filter((p) => p.status === "building" || p.status === "generating").length,
      archived: nonDeleted.filter((p) => p.status === "archived").length,
    }
  },
})
