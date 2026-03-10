import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"

const PERSONAL_WORKSPACE_PREFIX = "personal:"

type JoinLinkDoc = Doc<"projectJoinLinks">

function generateJoinToken(): string {
  const uuid1 = crypto.randomUUID().replace(/-/g, "")
  const uuid2 = crypto.randomUUID().replace(/-/g, "")
  return `${uuid1}${uuid2}`
}

async function getProjectMembership(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
) {
  return await ctx.db
    .query("projectMembers")
    .withIndex("by_project_and_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
    .first()
}

async function requireProjectManager(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
) {
  const membership = await getProjectMembership(ctx, projectId, userId)
  if (!membership || membership.role !== "project_manager") {
    throw new Error("Only project managers can manage join links")
  }
  return membership
}

async function assertPersonalProjectScope(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">
) {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
    throw new Error("Project not found")
  }

  const organization = await ctx.db.get(project.organizationId)
  const isPersonalProject = Boolean(
    organization?.workosId && organization.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)
  )

  if (!isPersonalProject) {
    throw new Error("Join links are only available for personal projects")
  }

  return project
}

function toPublicLink(link: JoinLinkDoc) {
  return {
    id: link._id,
    projectId: link.projectId,
    token: link.token,
    role: link.role,
    status: link.status,
    createdBy: link.createdBy,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    revokedAt: link.revokedAt,
    revokedBy: link.revokedBy,
    useCount: link.useCount,
    lastUsedAt: link.lastUsedAt,
  }
}

function pickNewestActiveLink(links: JoinLinkDoc[]): JoinLinkDoc | null {
  if (links.length === 0) return null
  return [...links].sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

async function createUniqueToken(ctx: MutationCtx): Promise<string> {
  for (let index = 0; index < 5; index += 1) {
    const token = generateJoinToken()
    const existing = await ctx.db
      .query("projectJoinLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first()
    if (!existing) return token
  }
  throw new Error("Failed to allocate a unique join token")
}

export const getForProject = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const membership = await getProjectMembership(ctx, args.projectId, args.userId)
    if (!membership) {
      return null
    }

    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") {
      return null
    }

    const organization = await ctx.db.get(project.organizationId)
    const isPersonalProject = Boolean(
      organization?.workosId && organization.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)
    )
    const canManage = membership.role === "project_manager" && isPersonalProject
    const activeLinks = await ctx.db
      .query("projectJoinLinks")
      .withIndex("by_project_and_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "active")
      )
      .collect()

    const activeLink = pickNewestActiveLink(activeLinks)

    return {
      isPersonalProject,
      canManage,
      memberRole: membership.role,
      activeLink: canManage && activeLink ? toPublicLink(activeLink) : null,
    }
  },
})

export const createOrUpdateActiveLink = mutation({
  args: {
    projectId: v.id("projects"),
    actorUserId: v.id("users"),
    role: v.union(
      v.literal("project_manager"),
      v.literal("developer"),
      v.literal("designer"),
      v.literal("viewer")
    ),
  },
  handler: async (ctx, args) => {
    await requireProjectManager(ctx, args.projectId, args.actorUserId)
    await assertPersonalProjectScope(ctx, args.projectId)

    const now = Date.now()
    const activeLinks = await ctx.db
      .query("projectJoinLinks")
      .withIndex("by_project_and_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "active")
      )
      .collect()

    const [primary, ...rest] = [...activeLinks].sort((a, b) => b.updatedAt - a.updatedAt)

    if (!primary) {
      const linkId = await ctx.db.insert("projectJoinLinks", {
        projectId: args.projectId,
        token: await createUniqueToken(ctx),
        role: args.role,
        status: "active",
        createdBy: args.actorUserId,
        createdAt: now,
        updatedAt: now,
        useCount: 0,
      })
      const created = await ctx.db.get(linkId)
      if (!created) throw new Error("Failed to create join link")
      return toPublicLink(created)
    }

    await ctx.db.patch(primary._id, {
      role: args.role,
      updatedAt: now,
      status: "active",
    })

    for (const duplicate of rest) {
      await ctx.db.patch(duplicate._id, {
        status: "revoked",
        revokedAt: now,
        revokedBy: args.actorUserId,
        updatedAt: now,
      })
    }

    const updated = await ctx.db.get(primary._id)
    if (!updated) throw new Error("Join link not found after update")
    return toPublicLink(updated)
  },
})

export const rotateLink = mutation({
  args: {
    projectId: v.id("projects"),
    actorUserId: v.id("users"),
    role: v.union(
      v.literal("project_manager"),
      v.literal("developer"),
      v.literal("designer"),
      v.literal("viewer")
    ),
  },
  handler: async (ctx, args) => {
    await requireProjectManager(ctx, args.projectId, args.actorUserId)
    await assertPersonalProjectScope(ctx, args.projectId)

    const now = Date.now()
    const activeLinks = await ctx.db
      .query("projectJoinLinks")
      .withIndex("by_project_and_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "active")
      )
      .collect()

    for (const link of activeLinks) {
      await ctx.db.patch(link._id, {
        status: "revoked",
        revokedAt: now,
        revokedBy: args.actorUserId,
        updatedAt: now,
      })
    }

    const linkId = await ctx.db.insert("projectJoinLinks", {
      projectId: args.projectId,
      token: await createUniqueToken(ctx),
      role: args.role,
      status: "active",
      createdBy: args.actorUserId,
      createdAt: now,
      updatedAt: now,
      useCount: 0,
    })

    const created = await ctx.db.get(linkId)
    if (!created) throw new Error("Failed to rotate join link")
    return toPublicLink(created)
  },
})

export const revokeLink = mutation({
  args: {
    projectId: v.id("projects"),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireProjectManager(ctx, args.projectId, args.actorUserId)
    await assertPersonalProjectScope(ctx, args.projectId)

    const now = Date.now()
    const activeLinks = await ctx.db
      .query("projectJoinLinks")
      .withIndex("by_project_and_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "active")
      )
      .collect()

    for (const link of activeLinks) {
      await ctx.db.patch(link._id, {
        status: "revoked",
        revokedAt: now,
        revokedBy: args.actorUserId,
        updatedAt: now,
      })
    }

    return { success: true, revokedCount: activeLinks.length }
  },
})

export const joinByToken = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const normalizedToken = args.token.trim()
    if (!normalizedToken) {
      throw new Error("Invalid join link")
    }

    const link = await ctx.db
      .query("projectJoinLinks")
      .withIndex("by_token", (q) => q.eq("token", normalizedToken))
      .first()

    if (!link || link.status !== "active") {
      throw new Error("This join link is invalid or has been revoked")
    }

    const project = await ctx.db.get(link.projectId)
    if (!project || project.status === "deleted") {
      throw new Error("Project not found")
    }

    const organization = await ctx.db.get(project.organizationId)
    const isPersonalProject = Boolean(
      organization?.workosId && organization.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)
    )
    if (!isPersonalProject) {
      throw new Error("This join link is not valid for this project")
    }

    const user = await ctx.db.get(args.userId)
    if (!user) {
      throw new Error("User not found")
    }

    const existingMembership = await getProjectMembership(ctx, project._id, args.userId)
    if (existingMembership) {
      return {
        projectId: project._id,
        alreadyMember: true,
        role: existingMembership.role,
      }
    }

    const now = Date.now()
    await ctx.db.insert("projectMembers", {
      projectId: project._id,
      userId: args.userId,
      role: link.role,
      addedAt: now,
      addedBy: link.createdBy,
    })

    await ctx.db.patch(link._id, {
      useCount: link.useCount + 1,
      lastUsedAt: now,
      updatedAt: now,
    })

    return {
      projectId: project._id,
      alreadyMember: false,
      role: link.role,
    }
  },
})
