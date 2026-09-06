import { ConvexError, v } from "convex/values"

import { internal } from "./_generated/api"
import type { Doc, Id, TableNames } from "./_generated/dataModel"
import {
  internalMutation,
  query as baseQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
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
import { isOrgMember } from "./lib/orgAccess"

type RepoSourceInput = {
  provider: string
  repoUrl: string
  branch?: string | null
}

const visualsValidator = v.object({
  uiLibrary: v.optional(v.string()),
  vibeDescription: v.optional(v.string()),
  colorPreset: v.optional(v.string()),
  primaryColor: v.optional(v.string()),
  secondaryColor: v.optional(v.string()),
  accentColor: v.optional(v.string()),
  logoUrl: v.optional(v.string()),
})

const generatedPlanValidator = v.object({
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
})

async function listCollaboratorProjectsForUser(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  userId: Id<"devicePrincipals">,
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

/** The one repo descriptor readers should prefer; legacy trio kept as fallback. */
function buildCanonicalRepo(args: {
  provider?: string | null
  repoUrl?: string | null
  defaultBranch?: string | null
  visibility?: string | null
  workingCopyMode?: "managed" | "attached" | null
  setupMode?: "personal" | "organization" | null
  importedFromBranch?: string | null
}): Doc<"projects">["repo"] | undefined {
  const provider = args.provider?.trim()
  const url = args.repoUrl?.trim()
  if (!provider || !url) {
    return undefined
  }

  const metadata = buildGitRepositoryMetadata({
    provider,
    repoUrl: url,
    defaultBranch: args.defaultBranch ?? undefined,
  })

  return {
    provider,
    url,
    defaultBranch: args.defaultBranch?.trim() || metadata?.defaultBranch || "main",
    owner: metadata?.owner,
    name: metadata?.name,
    visibility: args.visibility ?? undefined,
    workingCopyMode: args.workingCopyMode ?? undefined,
    setupMode: args.setupMode ?? undefined,
    importedFromBranch: args.importedFromBranch ?? undefined,
  }
}

async function upsertProjectArtifacts(
  ctx: Pick<MutationCtx, "db">,
  projectId: Id<"projects">,
  patch: Partial<Pick<Doc<"projectArtifacts">, "visuals" | "generatedPlan" | "buildContract" | "stack">>,
): Promise<void> {
  // Only the explicitly-provided keys. Convex `patch` REMOVES any field set
  // to `undefined`, so spreading the raw patch (which always carries every
  // optional key, most of them undefined) would wipe the artifacts the caller
  // didn't mean to touch — e.g. updating `visuals` would delete `generatedPlan`.
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  )
  if (Object.keys(definedPatch).length === 0) {
    return
  }

  const existing = await ctx.db
    .query("projectArtifacts")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first()

  if (existing) {
    await ctx.db.patch(existing._id, { ...definedPatch, updatedAt: Date.now() })
    return
  }

  await ctx.db.insert("projectArtifacts", {
    projectId,
    ...definedPatch,
    updatedAt: Date.now(),
  })
}

export const create = mutation({
  args: {
    userId: v.id("devicePrincipals"),
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
    visuals: v.optional(visualsValidator),
    generatedPlan: v.optional(generatedPlanValidator),
    // Final status for single-shot creation flows (dialog/import). The wizard
    // keeps the default "draft"; saga flows create as "provisioning" and
    // finalize to "active" once local effects succeed.
    status: v.optional(
      v.union(v.literal("draft"), v.literal("provisioning"), v.literal("active")),
    ),
    // Idempotency: a retry carrying the same token returns the existing doc
    // instead of creating a twin.
    creationToken: v.optional(v.string()),
    organizationId: v.optional(v.id("organizations")),
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

    if (args.creationToken) {
      // Idempotent resume: match the LIVE doc for this token, not just the
      // oldest. A compensated/deleted doc keeps its token, so `.first()`
      // alone would resurrect a tombstone and shadow the real project,
      // letting a retry mint a "name-1" twin — the exact failure the token
      // exists to prevent.
      const tokenDocs = await ctx.db
        .query("projects")
        .withIndex("by_creation_token", (q) => q.eq("creationToken", args.creationToken))
        .collect()
      const existing = tokenDocs.find(
        (doc) =>
          doc.status !== "deleted" && String(doc.createdBy) === String(args.userId),
      )
      if (existing) {
        return { projectId: existing._id, slug: existing.slug, resumed: true }
      }
    }

    if (args.organizationId) {
      if (!(await isOrgMember(ctx, args.organizationId, args.userId))) {
        throw new ConvexError("You are not a member of this organization")
      }
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
      sourceControl: args.sourceControl,
      gitRepository,
      repo: buildCanonicalRepo({
        provider: args.sourceControl?.provider ?? args.repoSource?.provider,
        repoUrl: args.sourceControl?.repoUrl ?? args.repoSource?.repoUrl,
        defaultBranch: args.sourceControl?.defaultBranch ?? args.repoSource?.branch,
        visibility: args.sourceControl?.visibility,
        workingCopyMode: args.sourceControl?.workingCopyMode,
        setupMode: args.sourceControl?.setupMode,
        importedFromBranch: args.repoSource?.branch,
      }),
      importedFrom: buildImportedFrom(args.repoSource, gitRepository),
      syncStatus: "local_only",
      status: args.status ?? "draft",
      creationToken: args.creationToken,
      sharedFilesVersion: 0,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now,
      ...(args.organizationId ? { organizationId: args.organizationId } : {}),
    })

    // Wizard artifacts live in their own table; the doc stays list-sized.
    await upsertProjectArtifacts(ctx, projectId, {
      visuals: args.visuals,
      generatedPlan: args.generatedPlan,
      buildContract: args.buildContract,
      stack: args.stack,
    })

    await ctx.db.insert("projectMembers", {
      projectId,
      userId: args.userId,
      role: "project_manager",
      addedAt: now,
      addedBy: args.userId,
    })

    return {
      projectId,
      slug,
      resumed: false,
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
    actorUserId: v.id("devicePrincipals"),
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

    return { ok: true }
  },
})

export const listForCurrentUser = query({
  args: {
    userId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    return listCollaboratorProjectsForUser(ctx, args.userId)
  },
})

/**
 * Sidebar projection: only the fields the project tree renders. The full
 * docs carry wizard artifacts (generatedPlan, buildContract, visuals) that
 * the sidebar never reads but would re-sync to every client on any change.
 */
export const listSummariesForCurrentUser = query({
  args: {
    userId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    const projects = await listCollaboratorProjectsForUser(ctx, args.userId)
    return projects.map((project) => ({
      _id: project._id,
      name: project.name,
      slug: project.slug,
      status: project.status,
      template: project.template ?? null,
      updatedAt: project.updatedAt,
      createdBy: project.createdBy ?? null,
      localPath: project.localPath ?? null,
      repo: project.repo ?? null,
      sourceControl: project.sourceControl ?? null,
      gitRepository: project.gitRepository ?? null,
      importedFrom: project.importedFrom ?? null,
      organizationId: project.organizationId ?? null,
    }))
  },
})

export const listPageForCurrentUser = query({
  args: {
    userId: v.id("devicePrincipals"),
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

// Unlike most project-scoped queries, this lookup is intentionally nullable.
// Folder reopening and stale-route recovery need to distinguish "this device
// cannot access that old binding" from a transport/authentication failure.
// Keep authentication explicit here rather than weakening the shared wrapper's
// project guard for every other endpoint.
export const getAccessibleById = baseQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const device = await requireAuthenticatedDevice(ctx)
    const canAccess = await canAccessProject(ctx, args.projectId, device._id)
    if (!canAccess) {
      return null
    }

    return ctx.db.get(args.projectId)
  },
})

export const getAccessibleBySlug = query({
  args: {
    slug: v.string(),
    userId: v.id("devicePrincipals"),
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
    userId: v.id("devicePrincipals"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    audience: v.optional(v.string()),
    targetLaunchDate: v.optional(v.union(v.number(), v.null())),
    template: v.optional(v.union(v.string(), v.null())),
    visuals: v.optional(visualsValidator),
    generatedPlan: v.optional(generatedPlanValidator),
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
      // The slug stays stable on rename: it is an identifier (legacy routes,
      // local workspace candidate scans, last-route persistence), not a label.
      patch.name = trimmedName
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
    await ctx.db.patch(args.projectId, patch)

    // Artifacts route to their own table (legacy inline fields stay frozen).
    await upsertProjectArtifacts(ctx, args.projectId, {
      visuals: args.visuals,
      generatedPlan: args.generatedPlan,
    })

    return { ok: true }
  },
})

/**
 * Wizard/builder artifacts for a project, coalescing the split table with
 * legacy inline doc fields (older projects predate projectArtifacts).
 */
export const getArtifacts = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    const canAccess = await canAccessProject(ctx, args.projectId, args.userId)
    if (!canAccess) {
      return null
    }

    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") {
      return null
    }

    const artifacts = await ctx.db
      .query("projectArtifacts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()

    return {
      visuals: artifacts?.visuals ?? project.visuals ?? null,
      generatedPlan: artifacts?.generatedPlan ?? project.generatedPlan ?? null,
      buildContract: artifacts?.buildContract ?? project.buildContract ?? null,
      stack: artifacts?.stack ?? project.stack ?? null,
    }
  },
})

/**
 * Records the remote repository a local flow attached to the project (e.g.
 * "create GitHub repo" during project creation). Builds the canonical
 * gitRepository metadata from the same URL so the two descriptors agree.
 */
export const setSourceControl = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("devicePrincipals"),
    provider: v.string(),
    repoUrl: v.string(),
    defaultBranch: v.optional(v.string()),
    visibility: v.optional(v.string()),
    workingCopyMode: v.optional(v.union(v.literal("managed"), v.literal("attached"))),
    setupMode: v.optional(v.union(v.literal("personal"), v.literal("organization"))),
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

    const repoUrl = args.repoUrl.trim()
    if (!repoUrl) {
      throw new ConvexError("Repository URL is required")
    }

    const gitRepository = buildGitRepositoryMetadata({
      provider: args.provider,
      repoUrl,
      defaultBranch: args.defaultBranch,
    })

    await ctx.db.patch(args.projectId, {
      sourceControl: {
        ...project.sourceControl,
        provider: args.provider,
        repoUrl,
        defaultBranch: args.defaultBranch ?? project.sourceControl?.defaultBranch,
        visibility: args.visibility ?? project.sourceControl?.visibility,
        workingCopyMode: args.workingCopyMode ?? project.sourceControl?.workingCopyMode,
        setupMode: args.setupMode ?? project.sourceControl?.setupMode,
      },
      gitRepository,
      repo: buildCanonicalRepo({
        provider: args.provider,
        repoUrl,
        defaultBranch: args.defaultBranch ?? project.sourceControl?.defaultBranch,
        visibility: args.visibility ?? project.sourceControl?.visibility,
        workingCopyMode: args.workingCopyMode ?? project.sourceControl?.workingCopyMode,
        setupMode: args.setupMode ?? project.sourceControl?.setupMode,
      }),
      updatedAt: Date.now(),
    })

    return { ok: true }
  },
})

export const updateStatus = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("devicePrincipals"),
    // Lifecycle statuses only. "archived"/"deleted" are intentionally excluded:
    // they must go through archive/deleteProject, which enforce
    // canArchiveProject and (for delete) name confirmation. Allowing them here
    // let any editor soft-delete a project, bypassing both guards.
    status: v.union(
      v.literal("draft"),
      v.literal("generating"),
      v.literal("building"),
      v.literal("provisioning"),
      v.literal("active"),
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
    userId: v.id("devicePrincipals"),
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
    userId: v.id("devicePrincipals"),
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
    userId: v.id("devicePrincipals"),
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

    await ctx.scheduler.runAfter(0, internal.projects.purgeDeletedProjectData, {
      projectId: args.projectId,
      pass: 0,
      stage: 0,
    })

    return { ok: true }
  },
})

const PROJECT_PURGE_BATCH_SIZE = 64
const PROJECT_PURGE_FINAL_STAGE = 29

async function deleteRows<TableName extends TableNames>(
  ctx: MutationCtx,
  rows: ReadonlyArray<{ _id: Id<TableName> }>,
): Promise<void> {
  for (const row of rows) {
    await ctx.db.delete(row._id)
  }
}

async function deleteProjectPurgeStage(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  stage: number,
): Promise<number> {
  switch (stage) {
    case 0: {
      const rows = await ctx.db
        .query("devAppReleases")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      for (const row of rows) {
        if (row.artifactStorageId) await ctx.storage.delete(row.artifactStorageId)
        await ctx.db.delete(row._id)
      }
      return rows.length
    }
    case 1: {
      const rows = await ctx.db
        .query("devAppPublications")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 2: {
      const rows = await ctx.db
        .query("projectFiles")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      for (const row of rows) {
        await ctx.storage.delete(row.storageId)
        await ctx.db.delete(row._id)
      }
      return rows.length
    }
    case 3: {
      const rows = await ctx.db
        .query("projectAssets")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      for (const row of rows) {
        if (row.storageId) await ctx.storage.delete(row.storageId)
        await ctx.db.delete(row._id)
      }
      return rows.length
    }
    case 4: {
      // This legacy table has no project-prefixed index. Keep the scan bounded;
      // a future schema migration can add one without changing purge semantics.
      const rows = await ctx.db
        .query("changeCommentReactions")
        .filter((q) => q.eq(q.field("projectId"), projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 5: {
      const rows = await ctx.db
        .query("changeComments")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 6: {
      const rows = await ctx.db
        .query("fileChanges")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 7: {
      const rows = await ctx.db
        .query("projectArtifacts")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 8: {
      const rows = await ctx.db
        .query("projectSyncState")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 9: {
      const rows = await ctx.db
        .query("projectMembers")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 10: {
      const rows = await ctx.db
        .query("projectDeviceEnrollments")
        .withIndex("by_project_and_status", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 11: {
      const rows = await ctx.db
        .query("projectStorageUsage")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 13: {
      const rows = await ctx.db
        .query("projectTasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 14: {
      const rows = await ctx.db
        .query("projectTaskStates")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 15: {
      const rows = await ctx.db
        .query("projectTaskNotifications")
        .withIndex("by_project_and_created", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 16: {
      const rows = await ctx.db
        .query("projectJoinLinks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 17: {
      const rows = await ctx.db
        .query("projectFileLocks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 18: {
      const rows = await ctx.db
        .query("fileTombstones")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 19: {
      const rows = await ctx.db
        .query("projectCollabRoomKeys")
        .withIndex("by_project_and_room", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 20: {
      const rows = await ctx.db
        .query("projectCollabWrappedKeys")
        .withIndex("by_project_room_and_recipient", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 21: {
      const rows = await ctx.db
        .query("projectCollabKeyRequests")
        .withIndex("by_project_and_room", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 22: {
      const rows = await ctx.db
        .query("projectCollabRecoveryKits")
        .withIndex("by_project_and_room", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 23: {
      const rows = await ctx.db
        .query("yjsUpdates")
        .withIndex("by_project_and_time", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 24: {
      const rows = await ctx.db
        .query("yjsDocuments")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 25: {
      const rows = await ctx.db
        .query("yjsAwareness")
        .withIndex("by_project_and_updated", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 26: {
      const rows = await ctx.db
        .query("projectPresence")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 27: {
      const rows = await ctx.db
        .query("deploymentJobs")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      await deleteRows(ctx, rows)
      return rows.length
    }
    case 28: {
      const rows = await ctx.db
        .query("devAppArtifactUploads")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(PROJECT_PURGE_BATCH_SIZE)
      for (const row of rows) {
        if (row.storageId) await ctx.storage.delete(row.storageId)
        await ctx.db.delete(row._id)
      }
      return rows.length
    }
    default:
      return 0
  }
}

/**
 * Project deletion is intentionally asynchronous: each mutation stays below
 * Convex transaction limits while still removing stored blobs and every row
 * whose lifetime is owned by the project. Two passes catch writes that were
 * already in flight when the project was first marked deleted.
 */
export const purgeDeletedProjectData = internalMutation({
  args: {
    projectId: v.id("projects"),
    pass: v.number(),
    stage: v.number(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project || project.status !== "deleted") return { done: true }

    if (args.stage >= PROJECT_PURGE_FINAL_STAGE) {
      if (args.pass < 1) {
        await ctx.scheduler.runAfter(0, internal.projects.purgeDeletedProjectData, {
          projectId: args.projectId,
          pass: args.pass + 1,
          stage: 0,
        })
        return { done: false }
      }

      if (project.previewImageId) await ctx.storage.delete(project.previewImageId)
      await ctx.db.delete(args.projectId)
      return { done: true }
    }

    const deleted = await deleteProjectPurgeStage(ctx, args.projectId, args.stage)
    await ctx.scheduler.runAfter(0, internal.projects.purgeDeletedProjectData, {
      projectId: args.projectId,
      pass: args.pass,
      stage: deleted === PROJECT_PURGE_BATCH_SIZE ? args.stage : args.stage + 1,
    })
    return { done: false }
  },
})

/** Manual, internal-only bridge for projects deleted by clients predating the purge. */
export const resumeDeletedProjectPurge = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project || project.status !== "deleted") {
      throw new ConvexError("Only a deleted project can be purged")
    }

    await ctx.scheduler.runAfter(0, internal.projects.purgeDeletedProjectData, {
      projectId: args.projectId,
      pass: 0,
      stage: 0,
    })
    return { scheduled: true }
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
      // null clears a previously recorded error; undefined leaves it as-is.
      errorMessage: v.optional(v.union(v.string(), v.null())),
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

    // Machine-written metrics live in their own table: background syncs never
    // touch the project doc, so list subscriptions stay quiet. Legacy inline
    // gitSyncState is frozen and used only as a read fallback.
    const existing = await ctx.db
      .query("projectSyncState")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()
    const previous = existing?.gitSyncState ?? project.gitSyncState

    const nextState: GitSyncStateMetadata = {
      accessState: previous?.accessState ?? "unknown",
      lastFetchedCommit: args.metrics.lastFetchedCommit ?? previous?.lastFetchedCommit,
      lastPushedCommit: args.metrics.lastPushedCommit ?? previous?.lastPushedCommit,
      lastFetchAt: args.metrics.lastFetchAt ?? previous?.lastFetchAt,
      lastPushAt: args.metrics.lastPushAt ?? previous?.lastPushAt,
      repoBytes: args.metrics.repoBytes ?? previous?.repoBytes,
      lastRepoSizeAt: args.metrics.lastRepoSizeAt ?? previous?.lastRepoSizeAt,
      errorMessage:
        args.metrics.errorMessage === null
          ? undefined
          : args.metrics.errorMessage ?? previous?.errorMessage,
      migratedFromReplicaAt: previous?.migratedFromReplicaAt,
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        gitSyncState: nextState,
        updatedAt: Date.now(),
      })
    } else {
      await ctx.db.insert("projectSyncState", {
        projectId: args.projectId,
        gitSyncState: nextState,
        updatedAt: Date.now(),
      })
    }

    return { ok: true }
  },
})
