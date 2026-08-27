import { ConvexError, v } from "convex/values"

import type { Id } from "./_generated/dataModel"
import { mutation, query } from "./_generated/server"
import {
  requireOrgAdmin,
  requireOrgMember,
} from "./lib/orgAccess"
import { canEditProject } from "./lib/projectAccess"

function normalizeOrgName(name: string): string {
  const normalized = name.trim()
  if (!normalized) {
    throw new ConvexError("Organization name cannot be blank")
  }
  return normalized
}

export const create = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) {
      throw new ConvexError("User not found")
    }

    const now = Date.now()
    const name = normalizeOrgName(args.name)
    const organizationId = await ctx.db.insert("organizations", {
      name,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.insert("organizationMembers", {
      organizationId,
      userId: args.userId,
      role: "admin",
      addedAt: now,
      addedBy: args.userId,
    })

    return { organizationId, name, role: "admin" as const }
  },
})

export const rename = mutation({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId, args.userId)
    const name = normalizeOrgName(args.name)
    await ctx.db.patch(args.organizationId, {
      name,
      updatedAt: Date.now(),
    })
    return { organizationId: args.organizationId, name }
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

    const rows = await Promise.all(
      memberships.map(async (membership) => {
        const organization = await ctx.db.get(membership.organizationId)
        if (!organization) return null
        return {
          organizationId: organization._id,
          name: organization.name,
          role: membership.role,
          createdAt: organization.createdAt,
          updatedAt: organization.updatedAt,
        }
      }),
    )

    return rows
      .flatMap((row) => (row ? [row] : []))
      .sort((left, right) => left.name.localeCompare(right.name))
  },
})

export const get = query({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const { organization, membership } = await requireOrgMember(
      ctx,
      args.organizationId,
      args.userId,
    )
    return {
      organizationId: organization._id,
      name: organization.name,
      role: membership?.role ?? "admin",
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      isCreator: organization.createdBy === args.userId,
    }
  },
})

export const listMembers = query({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.organizationId, args.userId)

    const memberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
      .collect()

    const rows = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db.get(membership.userId)
        return {
          membershipId: membership._id,
          userId: membership.userId,
          role: membership.role,
          addedAt: membership.addedAt,
          email: user?.email ?? "",
          firstName: user?.firstName ?? null,
          lastName: user?.lastName ?? null,
          profileImageUrl: user?.profileImageUrl ?? null,
        }
      }),
    )

    return rows.sort((left, right) => left.email.localeCompare(right.email))
  },
})

export const removeMember = mutation({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    memberUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { organization } = await requireOrgAdmin(ctx, args.organizationId, args.userId)
    if (args.memberUserId === organization.createdBy) {
      throw new ConvexError("The organization creator cannot be removed")
    }
    if (args.memberUserId === args.userId) {
      throw new ConvexError("Admins cannot remove themselves")
    }

    const membership = await ctx.db
      .query("organizationMembers")
      .withIndex("by_organization_and_user", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.memberUserId),
      )
      .first()
    if (!membership) {
      throw new ConvexError("That person is not in this organization")
    }

    await ctx.db.delete(membership._id)
    return { removed: true }
  },
})

export const attachProject = mutation({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.organizationId, args.userId)
    if (!(await canEditProject(ctx, args.projectId, args.userId))) {
      throw new ConvexError("You do not have permission to attach this project")
    }

    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") {
      throw new ConvexError("Project not found")
    }
    if (project.organizationId && project.organizationId !== args.organizationId) {
      throw new ConvexError("This project already belongs to another organization")
    }

    await ctx.db.patch(args.projectId, {
      organizationId: args.organizationId,
      updatedAt: Date.now(),
    })

    return { projectId: args.projectId, organizationId: args.organizationId }
  },
})

export const createAndAttachProject = mutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    if (!(await canEditProject(ctx, args.projectId, args.userId))) {
      throw new ConvexError("You do not have permission to attach this project")
    }

    const created = await ctx.db.insert("organizations", {
      name: normalizeOrgName(args.name),
      createdBy: args.userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    await ctx.db.insert("organizationMembers", {
      organizationId: created,
      userId: args.userId,
      role: "admin",
      addedAt: Date.now(),
      addedBy: args.userId,
    })

    await ctx.db.patch(args.projectId, {
      organizationId: created,
      updatedAt: Date.now(),
    })

    return { organizationId: created as Id<"organizations">, projectId: args.projectId }
  },
})
