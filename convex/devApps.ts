import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import { canEditProject } from "./lib/projectAccess"
import {
  requireOrgAdmin,
  requireOrgMember,
  toConsumerDevApp,
} from "./lib/orgAccess"

type ReadDatabaseCtx = Pick<QueryCtx | MutationCtx, "db">

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new ConvexError(`${fieldName} cannot be blank`)
  }
  return normalized
}

function normalizeOptionalText(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) return undefined
  return normalizeRequiredText(value, fieldName)
}

function normalizeContentHash(value: string): string {
  const normalized = normalizeRequiredText(value, "contentHash").toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ConvexError("contentHash must be a SHA-256 digest")
  }
  return normalized
}

async function getPublicationForProject(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
): Promise<Doc<"devAppPublications"> | null> {
  return await ctx.db
    .query("devAppPublications")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first()
}

async function getActiveRelease(
  ctx: ReadDatabaseCtx,
  publication: Doc<"devAppPublications">,
): Promise<Doc<"devAppReleases"> | null> {
  if (!publication.activeReleaseId) return null
  const release = await ctx.db.get(publication.activeReleaseId)
  if (!release || release.publicationId !== publication._id) return null
  return release
}

function toConsumerRow(
  publication: Doc<"devAppPublications">,
  release: Doc<"devAppReleases">,
  organizationName: string,
) {
  if (!release.artifactStorageId || !release.contentHash) {
    return null
  }
  if (!publication.organizationId || publication.visibility !== "organization") {
    return null
  }
  if (publication.status !== "active") {
    return null
  }
  return toConsumerDevApp({ publication, release, organizationName })
}

export const generateUploadUrl = mutation({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.organizationId, args.userId)
    return await ctx.storage.generateUploadUrl()
  },
})

export const publish = mutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    name: v.string(),
    description: v.optional(v.string()),
    logoDataUrl: v.optional(v.string()),
    framework: v.string(),
    artifactStorageId: v.id("_storage"),
    entryPath: v.string(),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    if (!(await canEditProject(ctx, args.projectId, args.userId))) {
      throw new ConvexError("You do not have permission to publish this project as a DevApp")
    }

    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") {
      throw new ConvexError("Project not found")
    }
    if (!project.organizationId) {
      throw new ConvexError("Attach this project to an organization before publishing")
    }

    await requireOrgMember(ctx, project.organizationId, args.userId)

    const name = normalizeRequiredText(args.name, "name")
    const description = normalizeOptionalText(args.description, "description")
    const framework = normalizeRequiredText(args.framework, "framework")
    const entryPath = normalizeRequiredText(args.entryPath, "entryPath")
    const contentHash = normalizeContentHash(args.contentHash)
    const now = Date.now()

    const existingPublication = await getPublicationForProject(ctx, args.projectId)
    const created = existingPublication === null
    const publicationId = existingPublication
      ? existingPublication._id
      : await ctx.db.insert("devAppPublications", {
          projectId: args.projectId,
          organizationId: project.organizationId,
          visibility: "organization",
          name,
          ...(description ? { description } : {}),
          ...(args.logoDataUrl ? { logoDataUrl: args.logoDataUrl } : {}),
          status: "active",
          createdBy: args.userId,
          updatedBy: args.userId,
          createdAt: now,
          updatedAt: now,
        })

    if (existingPublication) {
      if (
        existingPublication.organizationId &&
        existingPublication.organizationId !== project.organizationId
      ) {
        throw new ConvexError("This DevApp belongs to another organization")
      }
    }

    const latestRelease = await ctx.db
      .query("devAppReleases")
      .withIndex("by_publication_and_version", (q) => q.eq("publicationId", publicationId))
      .order("desc")
      .first()
    const version = (latestRelease?.version ?? 0) + 1

    const releaseId = await ctx.db.insert("devAppReleases", {
      publicationId,
      projectId: args.projectId,
      version,
      framework,
      artifactStorageId: args.artifactStorageId,
      entryPath,
      contentHash,
      createdBy: args.userId,
      createdAt: now,
    })

    await ctx.db.patch(publicationId, {
      activeReleaseId: releaseId,
      organizationId: project.organizationId,
      visibility: "organization",
      name,
      ...(description ? { description } : {}),
      ...(args.logoDataUrl ? { logoDataUrl: args.logoDataUrl } : {}),
      status: "active",
      updatedBy: args.userId,
      updatedAt: now,
    })

    const [publication, release] = await Promise.all([
      ctx.db.get(publicationId),
      ctx.db.get(releaseId),
    ])
    if (!publication || !release) {
      throw new ConvexError("The DevApp release could not be read after publishing")
    }

    const organization = await ctx.db.get(project.organizationId)
    return {
      created,
      consumer: toConsumerDevApp({
        publication,
        release,
        organizationName: organization?.name ?? "Organization",
      }),
    }
  },
})

export const archive = mutation({
  args: {
    userId: v.id("users"),
    publicationId: v.id("devAppPublications"),
  },
  handler: async (ctx, args) => {
    const publication = await ctx.db.get(args.publicationId)
    if (!publication?.organizationId) {
      throw new ConvexError("DevApp not found")
    }
    await requireOrgAdmin(ctx, publication.organizationId, args.userId)
    await ctx.db.patch(args.publicationId, {
      status: "archived",
      updatedBy: args.userId,
      updatedAt: Date.now(),
    })
    return { archived: true }
  },
})

export const updateIdentity = mutation({
  args: {
    userId: v.id("users"),
    publicationId: v.id("devAppPublications"),
    name: v.optional(v.string()),
    logoDataUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const publication = await ctx.db.get(args.publicationId)
    if (!publication?.organizationId) {
      throw new ConvexError("DevApp not found")
    }
    const { membership } = await requireOrgMember(ctx, publication.organizationId, args.userId)
    const isAdmin = membership?.role === "admin"
    const canEditSource = await canEditProject(ctx, publication.projectId, args.userId)
    if (!isAdmin && !canEditSource) {
      throw new ConvexError("You do not have permission to edit this DevApp")
    }
    const patch: Partial<Doc<"devAppPublications">> = {
      updatedBy: args.userId,
      updatedAt: Date.now(),
    }
    if (args.name !== undefined) {
      patch.name = normalizeRequiredText(args.name, "name")
    }
    if (args.logoDataUrl !== undefined) {
      patch.logoDataUrl = args.logoDataUrl
    }
    await ctx.db.patch(args.publicationId, patch)
    return { updated: true }
  },
})

export const listForOrganization = query({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const { organization } = await requireOrgMember(ctx, args.organizationId, args.userId)
    const publications = await ctx.db
      .query("devAppPublications")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .collect()

    const rows = await Promise.all(
      publications.map(async (publication) => {
        const release = await getActiveRelease(ctx, publication)
        if (!release) return null
        return toConsumerRow(publication, release, organization.name)
      }),
    )

    return rows
      .flatMap((row) => (row ? [row] : []))
      .sort((left, right) => left.name.localeCompare(right.name))
  },
})

export const listMine = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    const grouped = await Promise.all(
      memberships.map(async (membership) => {
        const organization = await ctx.db.get(membership.organizationId)
        if (!organization) return []
        const publications = await ctx.db
          .query("devAppPublications")
          .withIndex("by_organization", (q) => q.eq("organizationId", membership.organizationId))
          .collect()
        const rows = await Promise.all(
          publications.map(async (publication) => {
            const release = await getActiveRelease(ctx, publication)
            if (!release) return null
            return toConsumerRow(publication, release, organization.name)
          }),
        )
        return rows.flatMap((row) => (row ? [row] : []))
      }),
    )

    return grouped.flat().sort((left, right) => left.name.localeCompare(right.name))
  },
})

export const listPublisherStatus = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    const rows = await Promise.all(
      memberships.map(async (membership) => {
        if (!(await canEditProject(ctx, membership.projectId, args.userId))) {
          return null
        }
        const publication = await getPublicationForProject(ctx, membership.projectId)
        if (!publication) return null
        const release = await getActiveRelease(ctx, publication)
        return {
          projectId: membership.projectId,
          publicationId: publication._id,
          organizationId: publication.organizationId ?? null,
          name: publication.name,
          status: publication.status,
          logoDataUrl: publication.logoDataUrl ?? null,
          hasArtifact: Boolean(release?.artifactStorageId && release.contentHash),
          version: release?.version ?? null,
        }
      }),
    )

    return rows.flatMap((row) => (row ? [row] : []))
  },
})

export const getForProject = query({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    if (!(await canEditProject(ctx, args.projectId, args.userId))) {
      return null
    }
    const publication = await getPublicationForProject(ctx, args.projectId)
    if (!publication) return null
    const release = await getActiveRelease(ctx, publication)
    return {
      publicationId: publication._id,
      organizationId: publication.organizationId ?? null,
      name: publication.name,
      status: publication.status,
      logoDataUrl: publication.logoDataUrl ?? null,
      hasArtifact: Boolean(release?.artifactStorageId && release.contentHash),
      version: release?.version ?? null,
    }
  },
})

export const getArtifactUrl = query({
  args: {
    userId: v.id("users"),
    publicationId: v.id("devAppPublications"),
  },
  handler: async (ctx, args) => {
    const publication = await ctx.db.get(args.publicationId)
    if (!publication?.organizationId || publication.status !== "active") {
      throw new ConvexError("DevApp not found")
    }
    await requireOrgMember(ctx, publication.organizationId, args.userId)
    const release = await getActiveRelease(ctx, publication)
    if (!release?.artifactStorageId || !release.contentHash) {
      throw new ConvexError("DevApp has no artifact")
    }
    const url = await ctx.storage.getUrl(release.artifactStorageId)
    if (!url) {
      throw new ConvexError("DevApp artifact is unavailable")
    }
    return {
      url,
      contentHash: release.contentHash,
      entryPath: release.entryPath ?? "index.html",
      releaseId: release._id,
      version: release.version,
    }
  },
})
