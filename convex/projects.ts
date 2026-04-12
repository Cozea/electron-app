import { mutation, query } from "./_generated/server"
import type { DatabaseWriter, MutationCtx, QueryCtx } from "./_generated/server"
import { ConvexError, v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import {
  buildPendingProjectInviteRecord,
  findPendingProjectInviteByEmail,
  findUserByNormalizedEmail,
  normalizeProjectInviteEmail,
  PERSONAL_WORKSPACE_PREFIX,
} from "./lib/projectSharing"
import { getDefaultVersionControlSetupMode } from "../shared/versionControl"
import {
  canAccessProjectByWorkspaceOrMembership,
  canArchiveProjectByWorkspaceOrMembership,
  canEditProjectByWorkspaceOrMembership,
  getWorkspaceProjectAccess,
  hasWorkspaceProjectPermission,
} from "./lib/workspaceProjectAccess"
import { applyProjectStorageDeltas, ensureProjectStorageUsage } from "./lib/workspaceLimits"
import {
  buildProjectRepositoryBindingRecord,
  findWorkspaceConnectionByProvider,
  upsertProjectRepositoryBindingDocument,
} from "./sourceControl"
import {
  type GitAccessState,
  type GitSyncStateMetadata,
  type ProjectSyncMode,
  type ProjectTeamSeedMember,
  buildGitRepositoryMetadata,
  generateSlug,
} from "./lib/projectGitMetadata"
import {
  type ProjectsPageResult,
  buildProjectsPageResult,
  normalizeProjectsPageSize,
} from "./lib/projectPagination"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

async function getMemberProjectLocalPath(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  projectId: Id<"projects">,
  userId: Id<"users">,
): Promise<string | null> {
  const membership = await ctx.db
    .query("projectMembers")
    .withIndex("by_project_and_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
    .unique()

  return membership?.localPath ?? null
}


async function seedProjectTeamAccess(
  ctx: { db: DatabaseWriter },
  args: {
    projectId: Id<"projects">
    organizationId: Id<"organizations">
    actorUserId: Id<"users">
    team?: ProjectTeamSeedMember[]
    now: number
  }
): Promise<void> {
  const teamMembers = args.team ?? []
  if (teamMembers.length === 0) {
    return
  }

  const organization = await ctx.db.get(args.organizationId)
  if (!organization) {
    throw new Error("Organization not found")
  }

  const actor = await ctx.db.get(args.actorUserId)
  if (!actor) {
    throw new Error("Actor not found")
  }

  const isPersonalWorkspace = organization.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)
  const seenEmails = new Set<string>([normalizeProjectInviteEmail(actor.email)])

  const existingMembers = await ctx.db
    .query("projectMembers")
    .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
    .collect()
  const existingMemberUserIds = new Set(existingMembers.map((member) => String(member.userId)))

  const pendingInvites = await ctx.db
    .query("projectInvites")
    .withIndex("by_project_and_status", (q) =>
      q.eq("projectId", args.projectId).eq("status", "pending")
    )
    .collect()
  const pendingInviteEmails = new Set(
    pendingInvites.map((invite) => normalizeProjectInviteEmail(invite.email))
  )

  for (const member of teamMembers) {
    const normalizedEmail = normalizeProjectInviteEmail(member.email)
    if (!normalizedEmail || seenEmails.has(normalizedEmail)) {
      continue
    }
    seenEmails.add(normalizedEmail)

    const existingUser = await findUserByNormalizedEmail(ctx, normalizedEmail)

    if (existingUser && String(existingUser._id) === String(args.actorUserId)) {
      continue
    }

    if (!isPersonalWorkspace && existingUser) {
      const orgMembership = await ctx.db
        .query("members")
        .withIndex("by_organization_and_user", (q) =>
          q.eq("organizationId", args.organizationId).eq("userId", existingUser._id)
        )
        .first()

      if (orgMembership) {
        if (existingMemberUserIds.has(String(existingUser._id))) {
          continue
        }

        await ctx.db.insert("projectMembers", {
          projectId: args.projectId,
          userId: existingUser._id,
          role: member.role,
          addedAt: args.now,
          addedBy: args.actorUserId,
        })
        existingMemberUserIds.add(String(existingUser._id))
        continue
      }
    }

    if (!isPersonalWorkspace) {
      continue
    }

    if (pendingInviteEmails.has(normalizedEmail)) {
      continue
    }

    const existingInvite = await findPendingProjectInviteByEmail(
      ctx,
      args.projectId,
      normalizedEmail
    )
    if (existingInvite) {
      pendingInviteEmails.add(normalizedEmail)
      continue
    }

    await ctx.db.insert(
      "projectInvites",
      buildPendingProjectInviteRecord({
        projectId: args.projectId,
        email: normalizedEmail,
        role: member.role,
        invitedBy: args.actorUserId,
        invitedAt: args.now,
      })
    )
    pendingInviteEmails.add(normalizedEmail)
  }
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
    creationPath: v.union(v.literal("fresh"), v.literal("repo")),

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
        activeCollabBranch: v.optional(v.string()),
        defaultBranch: v.optional(v.string()),
        visibility: v.optional(v.string()),
        mergeStrategy: v.optional(v.string()),
        mergeQueue: v.optional(v.string()),
        syncPolicy: v.optional(
          v.union(v.literal("auto"), v.literal("manual"))
        ),
        workingCopyMode: v.optional(
          v.union(v.literal("managed"), v.literal("attached"))
        ),
        setupMode: v.optional(
          v.union(v.literal("personal"), v.literal("organization"))
        ),
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

    // Repo-specific
    repoSource: v.optional(
      v.object({
        provider: v.string(),
        repoUrl: v.string(),
        branch: v.string(),
        detectedStack: v.optional(v.any()),
      })
    ),
    team: v.optional(
      v.array(
        v.object({
          email: v.string(),
          name: v.optional(v.string()),
          role: v.union(
            v.literal("project_manager"),
            v.literal("developer"),
            v.literal("designer"),
            v.literal("viewer")
          ),
          isCurrentUser: v.optional(v.boolean()),
          profileImageUrl: v.optional(v.union(v.string(), v.null())),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const creator = await ctx.db.get(args.userId)
    if (!creator) {
      throw new Error("Creator not found")
    }

    const workspaceAccess = await getWorkspaceProjectAccess(
      ctx,
      args.organizationId,
      args.userId
    )
    const requiredPermission =
      args.creationPath === "repo" ? "projects:import" : "projects:create"

    if (!hasWorkspaceProjectPermission(workspaceAccess, requiredPermission)) {
      throw new Error("Unauthorized to create project in this workspace")
    }

    // Generate unique slug
    const baseSlug = generateSlug(args.name)
    const slug = await ensureUniqueSlug(ctx, args.organizationId, baseSlug)

    // For repo imports, code already exists - set to active
    // For fresh projects, start as draft until the workspace is ready
    const initialStatus = args.creationPath === 'repo' ? 'active' : 'draft'

    const organization = await ctx.db.get(args.organizationId)
    if (!organization) {
      throw new Error("Organization not found")
    }

    const defaultSetupMode = getDefaultVersionControlSetupMode(
      organization.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)
    )

    const normalizedSourceControl = args.sourceControl
      ? {
          ...args.sourceControl,
          activeCollabBranch:
            args.sourceControl.activeCollabBranch?.trim() ||
            args.sourceControl.defaultBranch?.trim() ||
            args.repoSource?.branch?.trim() ||
            "main",
          defaultBranch:
            args.sourceControl.defaultBranch?.trim() ||
            args.sourceControl.activeCollabBranch?.trim() ||
            args.repoSource?.branch?.trim() ||
            "main",
          setupMode: args.sourceControl.setupMode ?? defaultSetupMode,
        }
      : undefined

    // Create project with all fields
    const gitRepository = buildGitRepositoryMetadata({
      provider: args.repoSource?.provider ?? normalizedSourceControl?.provider,
      repoUrl: args.repoSource?.repoUrl ?? normalizedSourceControl?.repoUrl,
      defaultBranch:
        args.repoSource?.branch ??
        normalizedSourceControl?.defaultBranch ??
        normalizedSourceControl?.activeCollabBranch,
    })

    const syncMode: ProjectSyncMode = "git"

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
      sourceControl: normalizedSourceControl,
      syncMode,
      gitRepository,
      gitSyncState: {
        accessState: "granted",
      },
      visuals: args.visuals,
      creationPath: args.creationPath,
      status: initialStatus,
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

    const automatedProvider =
      gitRepository?.provider === "github" || gitRepository?.provider === "gitlab"
        ? gitRepository.provider
        : normalizedSourceControl?.provider === "github" ||
            normalizedSourceControl?.provider === "gitlab"
          ? normalizedSourceControl.provider
          : undefined
      const workspaceConnection =
        automatedProvider
          ? await findWorkspaceConnectionByProvider(
              ctx,
              args.organizationId,
              automatedProvider,
              args.userId
            )
          : null

      await upsertProjectRepositoryBindingDocument({
        ctx,
      binding: buildProjectRepositoryBindingRecord({
        projectId,
        organizationId: args.organizationId,
          sourceControl: normalizedSourceControl,
          gitRepository,
          defaultSetupMode,
          workspaceConnectionId:
            workspaceConnection?.scopeType === "workspace"
              ? workspaceConnection._id
              : undefined,
          now,
        }),
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

    if (args.creationPath !== "repo") {
      await seedProjectTeamAccess(ctx, {
        projectId,
        organizationId: args.organizationId,
        actorUserId: args.userId,
        team: (args.team ?? []) as ProjectTeamSeedMember[],
        now,
      })
    }

    await ensureProjectStorageUsage(ctx, args.organizationId, projectId)

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

export const applyInitialTeamSetup = mutation({
  args: {
    projectId: v.id("projects"),
    actorUserId: v.id("users"),
    team: v.array(
      v.object({
        email: v.string(),
        name: v.optional(v.string()),
        role: v.union(
          v.literal("project_manager"),
          v.literal("developer"),
          v.literal("designer"),
          v.literal("viewer")
        ),
        isCurrentUser: v.optional(v.boolean()),
        profileImageUrl: v.optional(v.union(v.string(), v.null())),
      })
    ),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) {
      throw new Error("Project not found")
    }

    const actorMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.actorUserId)
      )
      .first()

    if (!actorMembership || actorMembership.role !== "project_manager") {
      throw new Error("Only project managers can set up the initial team")
    }

    await seedProjectTeamAccess(ctx, {
      projectId: args.projectId,
      organizationId: project.organizationId,
      actorUserId: args.actorUserId,
      team: args.team as ProjectTeamSeedMember[],
      now: Date.now(),
    })

    return { success: true }
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
    userId: v.id("users"),
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
    const workspaceAccess = await getWorkspaceProjectAccess(
      ctx,
      args.organizationId,
      args.userId
    )
    if (!hasWorkspaceProjectPermission(workspaceAccess, "projects:view")) {
      return []
    }

    const query = ctx.db
      .query("projects")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))

    const projects = await query.collect()
    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    const memberPathMap = new Map(
      memberships.map((membership) => [membership.projectId.toString(), membership.localPath ?? null])
    )

    // Filter by status if provided, and exclude deleted projects by default
    return projects
      .filter((p) => {
        if (args.status) {
          return p.status === args.status
        }
        return p.status !== "deleted"
      })
      .map((project) => ({
        ...project,
        localPath: memberPathMap.get(project._id.toString()) ?? null,
      }))
  },
})

export const listPageForOrganization = query({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    statusFilter: v.union(
      v.literal("all"),
      v.literal("active"),
      v.literal("draft"),
      v.literal("building"),
      v.literal("archived")
    ),
    sortBy: v.union(
      v.literal("last_modified"),
      v.literal("name"),
      v.literal("created")
    ),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ProjectsPageResult> => {
    const workspaceAccess = await getWorkspaceProjectAccess(
      ctx,
      args.organizationId,
      args.userId
    )
    if (!hasWorkspaceProjectPermission(workspaceAccess, "projects:view")) {
      return {
        items: [],
        total: 0,
        totalPages: 1,
        page: 1,
        pageSize: normalizeProjectsPageSize(args.pageSize),
        hasArchivedProjects: false,
      }
    }

    let projects: Doc<"projects">[]
    if (args.statusFilter === "active") {
      projects = await ctx.db
        .query("projects")
        .withIndex("by_organization_and_status", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", "active")
        )
        .collect()
    } else if (args.statusFilter === "draft") {
      projects = await ctx.db
        .query("projects")
        .withIndex("by_organization_and_status", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", "draft")
        )
        .collect()
    } else if (args.statusFilter === "archived") {
      projects = await ctx.db
        .query("projects")
        .withIndex("by_organization_and_status", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", "archived")
        )
        .collect()
    } else if (args.statusFilter === "building") {
      const [buildingProjects, generatingProjects] = await Promise.all([
        ctx.db
          .query("projects")
          .withIndex("by_organization_and_status", (q) =>
            q.eq("organizationId", args.organizationId).eq("status", "building")
          )
          .collect(),
        ctx.db
          .query("projects")
          .withIndex("by_organization_and_status", (q) =>
            q.eq("organizationId", args.organizationId).eq("status", "generating")
          )
          .collect(),
      ])
      projects = [...buildingProjects, ...generatingProjects]
    } else {
      projects = await ctx.db
        .query("projects")
        .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
        .collect()
    }

    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()
    const memberPathMap = new Map(
      memberships.map((membership) => [
        membership.projectId.toString(),
        membership.localPath ?? null,
      ])
    )

    return await buildProjectsPageResult(ctx, {
      projects,
      memberPathMap,
      statusFilter: args.statusFilter,
      sortBy: args.sortBy,
      page: args.page,
      pageSize: args.pageSize,
    })
  },
})

// List projects visible in personal workspace context:
// all personal-owned projects where the user is a project member.
export const listForPersonalWorkspaceMemberView = query({
  args: {
    userId: v.id("users"),
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
    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    const rows = await Promise.all(
      memberships.map(async (membership) => {
        const project = await ctx.db.get(membership.projectId)
        if (!project) return null
        if (args.status ? project.status !== args.status : project.status === "deleted") {
          return null
        }

        const ownerWorkspace = await ctx.db.get(project.organizationId)
        if (
          !ownerWorkspace ||
          !ownerWorkspace.workosId ||
          !ownerWorkspace.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)
        ) {
          return null
        }

        return {
          ...project,
          role: membership.role,
          localPath: membership.localPath ?? null,
          ownerWorkspace: {
            organizationId: ownerWorkspace._id,
            workosId: ownerWorkspace.workosId,
            name: ownerWorkspace.name,
          },
        }
      })
    )

    const byProject = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
      if (!row) continue
      const key = String(row._id)
      const existing = byProject.get(key)
      if (!existing || row.updatedAt > existing.updatedAt) {
        byProject.set(key, row)
      }
    }

    return Array.from(byProject.values())
  },
})

export const listPageForPersonalWorkspaceMemberView = query({
  args: {
    userId: v.id("users"),
    statusFilter: v.union(
      v.literal("all"),
      v.literal("active"),
      v.literal("draft"),
      v.literal("building"),
      v.literal("archived")
    ),
    sortBy: v.union(
      v.literal("last_modified"),
      v.literal("name"),
      v.literal("created")
    ),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ProjectsPageResult> => {
    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    const rows = await Promise.all(
      memberships.map(async (membership) => {
        const project = await ctx.db.get(membership.projectId)
        if (!project) return null

        const ownerWorkspace = await ctx.db.get(project.organizationId)
        if (
          !ownerWorkspace ||
          !ownerWorkspace.workosId ||
          !ownerWorkspace.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)
        ) {
          return null
        }

        return {
          project,
          localPath: membership.localPath ?? null,
        }
      })
    )

    const dedupedProjects = new Map<
      string,
      {
        project: Doc<"projects">
        localPath: string | null
      }
    >()

    for (const row of rows) {
      if (!row) continue

      const key = String(row.project._id)
      const existing = dedupedProjects.get(key)
      if (!existing || row.project.updatedAt > existing.project.updatedAt) {
        dedupedProjects.set(key, row)
      }
    }

    const projects = Array.from(dedupedProjects.values()).map((row) => row.project)
    const memberPathMap = new Map(
      Array.from(dedupedProjects.values()).map((row) => [
        row.project._id.toString(),
        row.localPath,
      ])
    )

    return await buildProjectsPageResult(ctx, {
      projects,
      memberPathMap,
      statusFilter: args.statusFilter,
      sortBy: args.sortBy,
      page: args.page,
      pageSize: args.pageSize,
    })
  },
})

export const getAccessibleById = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const canAccess = await canAccessProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canAccess) return null

    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") return null
    const localPath = await getMemberProjectLocalPath(ctx, args.projectId, args.userId)
    return {
      ...project,
      localPath: localPath ?? undefined,
    }
  },
})

export const getAccessibleBySlug = query({
  args: {
    slug: v.string(),
    userId: v.id("users"),
    preferredOrganizationId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    if (args.preferredOrganizationId !== undefined) {
      const workspaceAccess = await getWorkspaceProjectAccess(
        ctx,
        args.preferredOrganizationId,
        args.userId
      )

      if (hasWorkspaceProjectPermission(workspaceAccess, "projects:view")) {
        const scopedProject = await ctx.db
          .query("projects")
          .withIndex("by_organization_and_slug", (q) =>
            q.eq("organizationId", args.preferredOrganizationId!).eq("slug", args.slug)
          )
          .first()

        if (scopedProject && scopedProject.status !== "deleted") {
          const localPath = await getMemberProjectLocalPath(
            ctx,
            scopedProject._id,
            args.userId,
          )
          return {
            status: "ok" as const,
            project: {
              ...scopedProject,
              localPath: localPath ?? undefined,
            },
            role: null,
          }
        }
      }
    }

    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    type Candidate = {
      project: Doc<"projects"> & { localPath?: string }
      role: Doc<"projectMembers">["role"]
    }

    const candidateRows: Array<Candidate | null> = await Promise.all(
      memberships.map(async (membership) => {
        const project = await ctx.db.get(membership.projectId)
        if (!project || project.status === "deleted") return null
        if (project.slug !== args.slug) return null

        return {
          project: {
            ...project,
            localPath: membership.localPath ?? undefined,
          },
          role: membership.role,
        } satisfies Candidate
      })
    )

    const candidates: Candidate[] = candidateRows.filter(
      (item): item is Candidate => item !== null
    )

    const scopedCandidates =
      args.preferredOrganizationId !== undefined
        ? candidates.filter(
            (candidate) => candidate.project.organizationId === args.preferredOrganizationId
          )
        : candidates

    if (scopedCandidates.length === 0) {
      return {
        status: "not_found" as const,
      }
    }

    if (scopedCandidates.length > 1) {
      const sorted = [...scopedCandidates].sort((a, b) => {
        const updatedDelta = b.project.updatedAt - a.project.updatedAt
        if (updatedDelta !== 0) return updatedDelta
        return String(a.project._id).localeCompare(String(b.project._id))
      })

      return {
        status: "ambiguous" as const,
        slug: args.slug,
        candidates: sorted.map((candidate) => ({
          projectId: candidate.project._id,
          organizationId: candidate.project.organizationId,
          name: candidate.project.name,
          role: candidate.role,
          updatedAt: candidate.project.updatedAt,
        })),
      }
    }

    return {
      status: "ok" as const,
      project: scopedCandidates[0].project,
      role: scopedCandidates[0].role,
    }
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
    const workspaceAccess = await getWorkspaceProjectAccess(
      ctx,
      args.organizationId,
      args.userId
    )
    if (!hasWorkspaceProjectPermission(workspaceAccess, "projects:view")) {
      return []
    }

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
        activeCollabBranch: v.optional(v.string()),
        defaultBranch: v.optional(v.string()),
        visibility: v.optional(v.string()),
        mergeStrategy: v.optional(v.string()),
        mergeQueue: v.optional(v.string()),
        syncPolicy: v.optional(
          v.union(v.literal("auto"), v.literal("manual"))
        ),
        workingCopyMode: v.optional(
          v.union(v.literal("managed"), v.literal("attached"))
        ),
        setupMode: v.optional(
          v.union(v.literal("personal"), v.literal("organization"))
        ),
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
    localPath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const canEdit = await canEditProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canEdit) {
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
    if (args.sourceControl !== undefined) {
      const nextSourceControl = {
        ...project.sourceControl,
        ...args.sourceControl,
        activeCollabBranch:
          args.sourceControl.activeCollabBranch ??
          args.sourceControl.defaultBranch ??
          project.sourceControl?.activeCollabBranch ??
          project.sourceControl?.defaultBranch ??
          project.gitRepository?.defaultBranch ??
          "main",
        defaultBranch:
          args.sourceControl.defaultBranch ??
          args.sourceControl.activeCollabBranch ??
          project.sourceControl?.defaultBranch ??
          project.sourceControl?.activeCollabBranch ??
          project.gitRepository?.defaultBranch ??
          "main",
      }
      const nextGitRepository =
        buildGitRepositoryMetadata({
          provider: nextSourceControl.provider,
          repoUrl: nextSourceControl.repoUrl,
          defaultBranch:
            project.gitRepository?.defaultBranch ??
            nextSourceControl.defaultBranch ??
            nextSourceControl.activeCollabBranch ??
            "main",
        }) ?? undefined
      updates.sourceControl = nextSourceControl
      updates.gitRepository = nextGitRepository

      const organization = await ctx.db.get(project.organizationId)
      const defaultSetupMode = getDefaultVersionControlSetupMode(
        Boolean(organization?.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX))
      )
      const automatedProvider =
        nextGitRepository?.provider === "github" || nextGitRepository?.provider === "gitlab"
          ? nextGitRepository.provider
          : nextSourceControl.provider === "github" || nextSourceControl.provider === "gitlab"
            ? nextSourceControl.provider
            : undefined
      const workspaceConnection =
        automatedProvider
          ? await findWorkspaceConnectionByProvider(
              ctx,
              project.organizationId,
              automatedProvider,
              args.userId
            )
          : null

      await upsertProjectRepositoryBindingDocument({
        ctx,
        binding: buildProjectRepositoryBindingRecord({
          projectId: project._id,
          organizationId: project.organizationId,
          sourceControl: nextSourceControl,
          gitRepository: nextGitRepository,
          defaultSetupMode,
          workspaceConnectionId:
            workspaceConnection?.scopeType === "workspace"
              ? workspaceConnection._id
              : undefined,
          now,
        }),
      })
    }
    if (args.visuals !== undefined) updates.visuals = { ...project.visuals, ...args.visuals }
    if (args.localPath !== undefined) updates.localPath = args.localPath

    await ctx.db.patch(args.projectId, updates)

    return await ctx.db.get(args.projectId)
  },
})

export const updateFrameworkInfo = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    frameworkInfo: v.object({
      framework: v.string(),
      displayName: v.optional(v.string()),
      routeConvention: v.optional(v.string()),
      devCommand: v.optional(v.string()),
      devPort: v.optional(v.number()),
      buildCommand: v.optional(v.string()),
      startCommand: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const canEdit = await canEditProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canEdit) {
      throw new Error("Unauthorized to update project framework info")
    }

    await ctx.db.patch(args.projectId, {
      frameworkInfo: {
        ...(project.frameworkInfo ?? {}),
        ...args.frameworkInfo,
      },
      updatedAt: Date.now(),
    })

    return { success: true }
  },
})

// Update project status
export const updateStatus = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
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

    const canEdit = await canEditProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canEdit) {
      throw new Error("Unauthorized to update project status")
    }

    await ctx.db.patch(args.projectId, {
      status: args.status,
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

    const canArchive = await canArchiveProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canArchive) {
      throw new Error("Only project managers or authorized workspace members can archive projects")
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

    const canArchive = await canArchiveProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canArchive) {
      throw new Error("Only project managers or authorized workspace members can restore projects")
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
    if (!project) {
      throw new ConvexError({
        code: "project_not_found",
        message: "Project not found",
      })
    }

    // Verify confirmation name matches
    if (args.confirmName !== project.name) {
      throw new ConvexError({
        code: "project_delete_name_mismatch",
        message: "Project name does not match",
      })
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

    const workspaceAccess = await getWorkspaceProjectAccess(
      ctx,
      project.organizationId,
      args.userId
    )
    const canDeleteFromWorkspace = hasWorkspaceProjectPermission(
      workspaceAccess,
      "projects:delete"
    )

    if (!isCreator && !isProjectManager && !canDeleteFromWorkspace) {
      throw new ConvexError({
        code: "project_delete_permission_required",
        message:
          "Only project creators, managers, or authorized workspace members can delete projects",
      })
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

    // Delete all project join links
    const joinLinks = await ctx.db
      .query("projectJoinLinks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()
    for (const link of joinLinks) {
      await ctx.db.delete(link._id)
    }

    // Mark project as deleted (soft delete for potential recovery)
    await ctx.db.patch(args.projectId, {
      status: "deleted",
      updatedAt: Date.now(),
    })

    return { success: true }
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

    const canEdit = await canEditProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canEdit) {
      throw new Error("Unauthorized to update sync status")
    }

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
// GIT SYNC METADATA
// ============================================

export const getGitSyncMetadata = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const canAccess = await canAccessProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canAccess) {
      return null
    }

    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") {
      return null
    }

    return {
      projectId: project._id,
      organizationId: project.organizationId,
      syncMode: (project.syncMode ?? "git") as ProjectSyncMode,
      gitRepository: project.gitRepository ?? null,
      gitSyncState: project.gitSyncState ?? null,
      sourceControl: project.sourceControl ?? null,
      updatedAt: project.updatedAt,
    }
  },
})

export const updateGitSyncMetadata = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    syncMode: v.optional(v.literal("git")),
    gitRepository: v.optional(
      v.object({
        provider: v.string(),
        owner: v.string(),
        name: v.string(),
        url: v.string(),
        defaultBranch: v.string(),
      })
    ),
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
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const canEdit = await canEditProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canEdit) {
      throw new Error("Unauthorized to update git sync metadata")
    }

    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.userId)
      )
      .first()

    if (!membership || membership.role !== "project_manager") {
      throw new Error("Only project managers can update git sync metadata")
    }

    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    }

    if (args.syncMode !== undefined) {
      updates.syncMode = args.syncMode
    }

    if (args.gitRepository !== undefined) {
      updates.gitRepository = args.gitRepository
    }

    if (args.gitSyncState !== undefined) {
      const previousState = project.gitSyncState ?? { accessState: "unknown" as GitAccessState }
      const nextState: GitSyncStateMetadata = {
        ...previousState,
        ...args.gitSyncState,
      }
      updates.gitSyncState = nextState
    }

    await ctx.db.patch(args.projectId, updates)

    return await ctx.db.get(args.projectId)
  },
})

export const setProjectGitStorageMetricsForServer = mutation({
  args: {
    projectId: v.id("projects"),
    repoBytes: v.number(),
    measuredAt: v.optional(v.number()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const project = await ctx.db.get(args.projectId)
    if (!project) {
      throw new Error("Project not found")
    }

    const measuredAt = args.measuredAt ?? Date.now()
    const previousState = project.gitSyncState ?? { accessState: "unknown" as GitAccessState }
    const previousRepoBytes = Math.max(0, previousState.repoBytes ?? 0)
    const nextRepoBytes = Math.max(0, args.repoBytes)
    await ctx.db.patch(args.projectId, {
      gitSyncState: {
        ...previousState,
        repoBytes: nextRepoBytes,
        lastRepoSizeAt: measuredAt,
      } satisfies GitSyncStateMetadata,
      updatedAt: Date.now(),
    })

    const breakdown = await applyProjectStorageDeltas(
      ctx,
      project.organizationId,
      args.projectId,
      {
        sourceAndConfig: nextRepoBytes - previousRepoBytes,
      }
    )
    return {
      success: breakdown !== null,
      projectId: args.projectId,
      repoBytes: nextRepoBytes,
      measuredAt,
      breakdown,
    }
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
    userId: v.id("users"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const canEdit = await canEditProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canEdit) {
      throw new Error("Unauthorized to update project preview image")
    }

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
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const canEdit = await canEditProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canEdit) {
      throw new Error("Unauthorized to upload project preview image")
    }

    return await ctx.storage.generateUploadUrl()
  },
})

// Get preview image URL for a project
export const getPreviewImageUrl = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const canAccess = await canAccessProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.userId
    )
    if (!canAccess) return null

    const project = await ctx.db.get(args.projectId)
    if (!project || !project.previewImageId || project.status === "deleted") return null

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
