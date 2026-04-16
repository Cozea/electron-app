import { v } from "convex/values"

import type { Doc } from "./_generated/dataModel"
import { mutation, query, type MutationCtx } from "./_generated/server"
import {
  getProjectMembership,
  getProjectShareScope,
  requireProjectManagerMembership,
  trustProjectDevice,
} from "./lib/projectSharing"

type JoinLinkDoc = Doc<"projectJoinLinks">

function generateJoinToken(): string {
  const uuid1 = crypto.randomUUID().replace(/-/g, "")
  const uuid2 = crypto.randomUUID().replace(/-/g, "")
  return `${uuid1}${uuid2}`
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

    await getProjectShareScope(ctx, args.projectId)
    const canManage = membership.role === "project_manager"
    const activeLinks = await ctx.db
      .query("projectJoinLinks")
      .withIndex("by_project_and_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "active")
      )
      .collect()

    const activeLink = pickNewestActiveLink(activeLinks)

    return {
      canManage,
      memberRole: membership.role,
      activeLink: canManage && activeLink ? toPublicLink(activeLink) : null,
    }
  },
})

export const previewByToken = query({
  args: {
    token: v.string(),
    viewerUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const normalizedToken = args.token.trim()
    if (!normalizedToken) {
      return null
    }

    const link = await ctx.db
      .query("projectJoinLinks")
      .withIndex("by_token", (q) => q.eq("token", normalizedToken))
      .first()

    if (!link) {
      return null
    }

    const scope = await getProjectShareScope(ctx, link.projectId).catch(() => null)
    if (!scope) {
      return null
    }

    const inviter = await ctx.db.get(link.createdBy)
    const existingMembership = args.viewerUserId
      ? await getProjectMembership(ctx, scope.project._id, args.viewerUserId)
      : null

    return {
      status: link.status,
      role: link.role,
      project: {
        id: scope.project._id,
        name: scope.project.name,
        slug: scope.project.slug,
      },
      inviter: inviter
        ? {
            id: inviter._id,
            email: inviter.email,
            firstName: inviter.firstName,
            lastName: inviter.lastName,
            profileImageUrl: inviter.profileImageUrl,
          }
        : null,
      alreadyMember: Boolean(existingMembership),
      existingRole: existingMembership?.role ?? null,
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
    await requireProjectManagerMembership(
      ctx,
      args.projectId,
      args.actorUserId,
      "Only project managers can manage join links"
    )

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
    await requireProjectManagerMembership(
      ctx,
      args.projectId,
      args.actorUserId,
      "Only project managers can manage join links"
    )

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
    await requireProjectManagerMembership(
      ctx,
      args.projectId,
      args.actorUserId,
      "Only project managers can manage join links"
    )

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
    deviceId: v.string(),
    deviceLabel: v.string(),
    platform: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
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

    const { project } = await getProjectShareScope(ctx, link.projectId)

    const existingMembership = await getProjectMembership(ctx, project._id, args.userId)
    const now = Date.now()
    if (existingMembership) {
      await trustProjectDevice(ctx, {
        projectId: project._id,
        userId: args.userId,
        deviceId: args.deviceId,
        deviceLabel: args.deviceLabel,
        platform: args.platform,
        fingerprint: args.fingerprint,
        role: existingMembership.role,
        addedByUserId: link.createdBy,
      })
      await ctx.db.patch(link._id, {
        useCount: link.useCount + 1,
        lastUsedAt: now,
        updatedAt: now,
      })
      return {
        projectId: project._id,
        alreadyMember: true,
        role: existingMembership.role,
      }
    }

    await ctx.db.insert("projectMembers", {
      projectId: project._id,
      userId: args.userId,
      role: link.role,
      addedAt: now,
      addedBy: link.createdBy,
    })
    await trustProjectDevice(ctx, {
      projectId: project._id,
      userId: args.userId,
      deviceId: args.deviceId,
      deviceLabel: args.deviceLabel,
      platform: args.platform,
      fingerprint: args.fingerprint,
      role: link.role,
      addedByUserId: link.createdBy,
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
