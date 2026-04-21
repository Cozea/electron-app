import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import {
  buildPendingProjectInviteRecord,
  findPendingProjectInviteByEmail,
  findUserByNormalizedEmail,
  normalizeProjectInviteEmail,
} from "./lib/projectSharing"
import {
  canAccessProject,
  canArchiveProject,
  canEditProject,
  canManageProject,
  getProjectMembership,
} from "./lib/projectAccess"
import {
  buildGitRepositoryMetadata,
  type GitSyncStateMetadata,
  generateSlug,
} from "./lib/projectGitMetadata"
import {
  buildProjectsPageResult,
  normalizeProjectsPageSize,
  type ProjectsPageResult,
} from "./lib/projectPagination"

type ProjectTeamSeedMember = {
  email: string
  name?: string
  role: Doc<"projectMembers">["role"]
  isCurrentUser?: boolean
  profileImageUrl?: string | null
}

type RepoSourceInput = {
  provider: string
  repoUrl: string
  branch?: string | null
}

async function listCollaboratorProjectsForUser(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  userId: Id<"users">,
): Promise<
  Array<
    Doc<"projects"> & {
      localPath?: string
      role: Doc<"projectMembers">["role"]
    }
  >
> {
  const memberships = await ctx.db
    .query("projectMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()

  const rows = await Promise.all(
    memberships.map(async (membership) => {
      const project = await ctx.db.get(membership.projectId)
      if (!project || project.status === "deleted") {
        return null
      }

      return {
        ...project,
        localPath: membership.localPath ?? undefined,
        role: membership.role,
      }
    }),
  )

  const dedupedProjects = new Map<
    string,
    Doc<"projects"> & {
      localPath?: string
      role: Doc<"projectMembers">["role"]
    }
  >()

  for (const row of rows) {
    if (!row) continue
    const existing = dedupedProjects.get(String(row._id))
    if (!existing || row.updatedAt > existing.updatedAt) {
      dedupedProjects.set(String(row._id), row)
    }
  }

  return Array.from(dedupedProjects.values())
}

async function ensureUniqueSlug(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  baseSlug: string,
  excludeProjectId?: Id<"projects">,
): Promise<string> {
  let slug = baseSlug
  let counter = 1

  while (true) {
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first()

    if (!existing || (excludeProjectId && existing._id === excludeProjectId)) {
      return slug
    }

    slug = `${baseSlug}-${counter}`
    counter += 1
  }
}

async function seedProjectTeamAccess(
  ctx: Pick<MutationCtx, "db">,
  args: {
    projectId: Id<"projects">
    actorUserId: Id<"users">
    team?: ProjectTeamSeedMember[]
    now: number
  },
): Promise<void> {
  const teamMembers = args.team ?? []
  if (teamMembers.length === 0) {
    return
  }

  const actor = await ctx.db.get(args.actorUserId)
  if (!actor) {
    throw new Error("Actor not found")
  }

  const seenEmails = new Set<string>([normalizeProjectInviteEmail(actor.email)])

  const existingMembers = await ctx.db
    .query("projectMembers")
    .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
    .collect()
  const existingMemberUserIds = new Set(existingMembers.map((member) => String(member.userId)))

  const pendingInvites = await ctx.db
    .query("projectInvites")
    .withIndex("by_project_and_status", (q) =>
      q.eq("projectId", args.projectId).eq("status", "pending"),
    )
    .collect()
  const pendingInviteEmails = new Set(
    pendingInvites.map((invite) => normalizeProjectInviteEmail(invite.email)),
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

    if (existingUser) {
      if (existingMemberUserIds.has(String(existingUser._id))) {
        continue
      }

      await ctx.db.insert("projectMembers", {
        projectId: args.projectId,
        userId: existingUser._id,
        contactEmail: normalizedEmail,
        role: member.role,
        addedAt: args.now,
        addedBy: args.actorUserId,
      })
      existingMemberUserIds.add(String(existingUser._id))
      continue
    }

    if (pendingInviteEmails.has(normalizedEmail)) {
      continue
    }

    const existingInvite = await findPendingProjectInviteByEmail(
      ctx,
      args.projectId,
      normalizedEmail,
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
      }),
    )
    pendingInviteEmails.add(normalizedEmail)
  }
}

function buildImportedFrom(repoSource?: RepoSourceInput, gitRepository?: ReturnType<typeof buildGitRepositoryMetadata>) {
  if (!repoSource || !gitRepository) {
    return undefined
  }

  return {
    provider: repoSource.provider,
    repoFullName: `${gitRepository.owner}/${gitRepository.name}`,
    branch: repoSource.branch?.trim() || gitRepository.defaultBranch,
  }
}

export const create = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    creationPath: v.union(v.literal("fresh"), v.literal("repo")),
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
      }),
    ),
    stack: v.optional(
      v.object({
        backend: v.optional(v.string()),
        hosting: v.optional(v.string()),
        aiProvider: v.optional(v.string()),
      }),
    ),
    sourceControl: v.optional(
      v.object({
        provider: v.optional(v.string()),
        repoUrl: v.optional(v.string()),
        defaultBranch: v.optional(v.string()),
        visibility: v.optional(v.string()),
        mergeStrategy: v.optional(v.string()),
        mergeQueue: v.optional(v.string()),
        workingCopyMode: v.optional(v.union(v.literal("managed"), v.literal("attached"))),
        setupMode: v.optional(v.union(v.literal("personal"), v.literal("organization"))),
      }),
    ),
    repoSource: v.optional(
      v.object({
        provider: v.string(),
        repoUrl: v.string(),
        branch: v.optional(v.string()),
      }),
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
      }),
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
          }),
        ),
        entities: v.array(
          v.object({
            id: v.string(),
            name: v.string(),
            fields: v.optional(v.array(v.string())),
          }),
        ),
      }),
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
            v.literal("viewer"),
          ),
          isCurrentUser: v.optional(v.boolean()),
          profileImageUrl: v.optional(v.union(v.string(), v.null())),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const user = await ctx.db.get(args.userId)
    if (!user) {
      throw new ConvexError("User not found")
    }

    const trimmedName = args.name.trim()
    if (!trimmedName) {
      throw new ConvexError("Project name is required")
    }

    const slug = await ensureUniqueSlug(ctx, generateSlug(trimmedName) || "project")
    const gitRepository = buildGitRepositoryMetadata({
      provider: args.sourceControl?.provider ?? args.repoSource?.provider,
      repoUrl: args.sourceControl?.repoUrl ?? args.repoSource?.repoUrl,
      defaultBranch: args.sourceControl?.defaultBranch ?? args.repoSource?.branch ?? undefined,
    })

    const projectId = await ctx.db.insert("projects", {
      name: trimmedName,
      slug,
      description: args.description?.trim() || undefined,
      audience: args.audience?.trim() || undefined,
      targetLaunchDate: args.targetLaunchDate,
      creationPath: args.creationPath,
      template: args.template?.trim() || undefined,
      targetPlatform: args.targetPlatform,
      buildContract: args.buildContract,
      stack: args.stack,
      sourceControl: args.sourceControl,
      gitRepository,
      visuals: args.visuals,
      generatedPlan: args.generatedPlan,
      importedFrom: buildImportedFrom(args.repoSource, gitRepository),
      syncStatus: "local_only",
      status: "draft",
      sharedFilesVersion: 0,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.insert("projectMembers", {
      projectId,
      userId: args.userId,
      contactEmail: user.email,
      role: "project_manager",
      addedAt: now,
      addedBy: args.userId,
    })

    await seedProjectTeamAccess(ctx, {
      projectId,
      actorUserId: args.userId,
      team: args.team,
      now,
    })

    return {
      projectId,
      slug,
    }
  },
})

export const get = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => ctx.db.get(args.projectId),
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
          v.literal("viewer"),
        ),
        isCurrentUser: v.optional(v.boolean()),
        profileImageUrl: v.optional(v.union(v.string(), v.null())),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const canManage = await canManageProject(ctx, args.projectId, args.actorUserId)
    if (!canManage) {
      throw new ConvexError("Only project managers can update the project team")
    }

    await seedProjectTeamAccess(ctx, {
      projectId: args.projectId,
      actorUserId: args.actorUserId,
      team: args.team,
      now: Date.now(),
    })

    return { ok: true }
  },
})

export const listForCurrentUser = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return listCollaboratorProjectsForUser(ctx, args.userId)
  },
})

export const listPageForCurrentUser = query({
  args: {
    userId: v.id("users"),
    statusFilter: v.union(
      v.literal("all"),
      v.literal("active"),
      v.literal("draft"),
      v.literal("building"),
      v.literal("archived"),
    ),
    sortBy: v.union(v.literal("last_modified"), v.literal("name"), v.literal("created")),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ProjectsPageResult> => {
    const projects = await listCollaboratorProjectsForUser(ctx, args.userId)
    const memberPathMap = new Map(
      projects.map((project) => [String(project._id), project.localPath ?? null]),
    )

    return buildProjectsPageResult(ctx, {
      projects,
      memberPathMap,
      statusFilter: args.statusFilter,
      sortBy: args.sortBy,
      page: args.page,
      pageSize: normalizeProjectsPageSize(args.pageSize),
    })
  },
})

export const getAccessibleById = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const canAccess = await canAccessProject(ctx, args.projectId, args.userId)
    if (!canAccess) {
      return null
    }

    return ctx.db.get(args.projectId)
  },
})

export const getAccessibleBySlug = query({
  args: {
    slug: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const slug = args.slug.trim()
    if (!slug) {
      return { status: "not_found" as const }
    }

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .collect()

    const accessible = (
      await Promise.all(
        projects.map(async (project) => {
          if (project.status === "deleted") {
            return null
          }
          const membership = await getProjectMembership(ctx, project._id, args.userId)
          if (!membership) {
            return null
          }
          return {
            project,
            membership,
          }
        }),
      )
    ).filter((row): row is NonNullable<typeof row> => Boolean(row))

    if (accessible.length === 0) {
      return { status: "not_found" as const }
    }

    if (accessible.length > 1) {
      return {
        status: "ambiguous" as const,
        slug,
        candidates: accessible
          .sort((left, right) => right.project.updatedAt - left.project.updatedAt)
          .map((entry) => ({
            projectId: entry.project._id,
            name: entry.project.name,
            role: entry.membership.role,
            updatedAt: entry.project.updatedAt,
          })),
      }
    }

    return {
      status: "ok" as const,
      slug,
      role: accessible[0].membership.role,
      project: accessible[0].project,
    }
  },
})

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    audience: v.optional(v.string()),
    targetLaunchDate: v.optional(v.union(v.number(), v.null())),
    template: v.optional(v.union(v.string(), v.null())),
    visuals: v.optional(v.any()),
    generatedPlan: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") {
      throw new ConvexError("Project not found")
    }

    const canEdit = await canEditProject(ctx, args.projectId, args.userId)
    if (!canEdit) {
      throw new ConvexError("You do not have permission to edit this project")
    }

    const patch: Partial<Doc<"projects">> = {
      updatedAt: Date.now(),
    }

    if (typeof args.name === "string") {
      const trimmedName = args.name.trim()
      if (!trimmedName) {
        throw new ConvexError("Project name is required")
      }
      patch.name = trimmedName
      patch.slug = await ensureUniqueSlug(
        ctx,
        generateSlug(trimmedName) || "project",
        args.projectId,
      )
    }

    if (args.description !== undefined) {
      patch.description = args.description.trim() || undefined
    }
    if (args.audience !== undefined) {
      patch.audience = args.audience.trim() || undefined
    }
    if (args.targetLaunchDate !== undefined) {
      patch.targetLaunchDate = args.targetLaunchDate ?? undefined
    }
    if (args.template !== undefined) {
      patch.template = args.template?.trim() || undefined
    }
    if (args.visuals !== undefined) {
      patch.visuals = args.visuals as Doc<"projects">["visuals"]
    }
    if (args.generatedPlan !== undefined) {
      patch.generatedPlan = args.generatedPlan as Doc<"projects">["generatedPlan"]
    }

    await ctx.db.patch(args.projectId, patch)
    return { ok: true }
  },
})

export const updateFrameworkInfo = mutation({
  args: {
    projectId: v.id("projects"),
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
    if (!project || project.status === "deleted") {
      throw new ConvexError("Project not found")
    }

    await ctx.db.patch(args.projectId, {
      frameworkInfo: args.frameworkInfo,
      updatedAt: Date.now(),
    })

    return { ok: true }
  },
})

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
      v.literal("deleted"),
    ),
  },
  handler: async (ctx, args) => {
    const canEdit = await canEditProject(ctx, args.projectId, args.userId)
    if (!canEdit) {
      throw new ConvexError("You do not have permission to update this project")
    }

    await ctx.db.patch(args.projectId, {
      status: args.status,
      updatedAt: Date.now(),
    })

    return { ok: true }
  },
})

export const archive = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const canArchive = await canArchiveProject(ctx, args.projectId, args.userId)
    if (!canArchive) {
      throw new ConvexError("Only project managers can archive this project")
    }

    await ctx.db.patch(args.projectId, {
      status: "archived",
      updatedAt: Date.now(),
    })

    return { ok: true }
  },
})

export const restore = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const canArchive = await canArchiveProject(ctx, args.projectId, args.userId)
    if (!canArchive) {
      throw new ConvexError("Only project managers can restore this project")
    }

    await ctx.db.patch(args.projectId, {
      status: "active",
      updatedAt: Date.now(),
    })

    return { ok: true }
  },
})

export const deleteProject = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    confirmName: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") {
      throw new ConvexError("Project not found")
    }

    const canManage = await canManageProject(ctx, args.projectId, args.userId)
    if (!canManage) {
      throw new ConvexError("Only project managers can delete this project")
    }

    if (args.confirmName.trim() !== project.name) {
      throw new ConvexError("Project name confirmation did not match")
    }

    const now = Date.now()
    await ctx.db.patch(args.projectId, {
      status: "deleted",
      updatedAt: now,
    })

    return { ok: true }
  },
})

export const setProjectGitStorageMetricsForServer = mutation({
  args: {
    projectId: v.id("projects"),
    serverSecret: v.string(),
    metrics: v.object({
      repoBytes: v.optional(v.number()),
      lastRepoSizeAt: v.optional(v.number()),
      lastFetchedCommit: v.optional(v.string()),
      lastPushedCommit: v.optional(v.string()),
      lastFetchAt: v.optional(v.number()),
      lastPushAt: v.optional(v.number()),
      errorMessage: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const expected = process.env.AI_GATEWAY_SECRET
    if (!expected || args.serverSecret !== expected) {
      throw new ConvexError("Unauthorized")
    }

    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") {
      throw new ConvexError("Project not found")
    }

    const nextState: GitSyncStateMetadata = {
      accessState: project.gitSyncState?.accessState ?? "unknown",
      lastFetchedCommit: args.metrics.lastFetchedCommit ?? project.gitSyncState?.lastFetchedCommit,
      lastPushedCommit: args.metrics.lastPushedCommit ?? project.gitSyncState?.lastPushedCommit,
      lastFetchAt: args.metrics.lastFetchAt ?? project.gitSyncState?.lastFetchAt,
      lastPushAt: args.metrics.lastPushAt ?? project.gitSyncState?.lastPushAt,
      repoBytes: args.metrics.repoBytes ?? project.gitSyncState?.repoBytes,
      lastRepoSizeAt: args.metrics.lastRepoSizeAt ?? project.gitSyncState?.lastRepoSizeAt,
      errorMessage: args.metrics.errorMessage ?? project.gitSyncState?.errorMessage,
      migratedFromReplicaAt: project.gitSyncState?.migratedFromReplicaAt,
    }

    await ctx.db.patch(args.projectId, {
      gitSyncState: nextState,
      updatedAt: Date.now(),
    })

    return { ok: true }
  },
})
