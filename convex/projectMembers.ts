import { type MutationCtx } from "./_generated/server"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import {
  canAccessProjectByWorkspaceOrMembership,
} from "./lib/workspaceProjectAccess"

// Project roles and their permissions
const ROLE_PERMISSIONS = {
  project_manager: ["manage_members", "edit", "view", "delete"],
  developer: ["edit", "view"],
  designer: ["edit_assets", "view"],
  viewer: ["view"],
} as const

type ProjectRole = keyof typeof ROLE_PERMISSIONS
type Permission = (typeof ROLE_PERMISSIONS)[ProjectRole][number]

function hasPermission(role: ProjectRole, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role] as readonly string[]
  return permissions?.includes(permission) ?? false
}

async function getTeamManagementContext(
  ctx: Pick<MutationCtx, "db">,
  projectId: Id<"projects">,
  actorPrincipalId: Id<"devicePrincipals">
) {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
    throw new Error("Project not found")
  }

  const actorMembership = await ctx.db
    .query("projectMembers")
    .withIndex("by_project_and_principal", (q) =>
      q.eq("projectId", projectId).eq("principalId", actorPrincipalId)
    )
    .first()

  const canManageTeam = Boolean(
    actorMembership && hasPermission(actorMembership.role as ProjectRole, "manage_members")
  )

  return {
    project,
    actorMembership,
    canManageTeam,
  }
}

// ============================================
// MEMBER QUERIES
// ============================================

// List all members of a project
export const listMembers = query({
  args: { projectId: v.id("projects"), viewerPrincipalId: v.id("devicePrincipals") },
  handler: async (ctx, args) => {
    const canAccess = await canAccessProjectByWorkspaceOrMembership(ctx, args.projectId, args.viewerPrincipalId)
    if (!canAccess) return []
    const memberships = await ctx.db.query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect()
    return await Promise.all(memberships.map(async (membership) => {
      const principal = await ctx.db.get(membership.principalId)
      return {
        ...membership,
        displayName: principal?.displayName ?? "Unknown device",
        identityKey: principal?.identityKey ?? "",
        platform: principal?.platform ?? "unknown",
        avatarUrl: principal?.avatarStorageId ? await ctx.storage.getUrl(principal.avatarStorageId) : null,
      }
    }))
  },
})

// Get member's role in a project
export const getMemberRole = query({
  args: {
    projectId: v.id("projects"),
    principalId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    const canAccess = await canAccessProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.principalId
    )
    if (!canAccess) {
      return null
    }

    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_principal", (q) =>
        q.eq("projectId", args.projectId).eq("principalId", args.principalId)
      )
      .first()

    return membership?.role ?? null
  },
})

// Check if user is a member of the project
export const isMember = query({
  args: {
    projectId: v.id("projects"),
    principalId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_principal", (q) =>
        q.eq("projectId", args.projectId).eq("principalId", args.principalId)
      )
      .first()

    return !!membership
  },
})

// ============================================
// MEMBER MUTATIONS
// ============================================

// Update a member's role
export const updateRole = mutation({
  args: {
    projectId: v.id("projects"),
    actorPrincipalId: v.id("devicePrincipals"),
    memberPrincipalId: v.id("devicePrincipals"),
    newRole: v.union(
      v.literal("project_manager"),
      v.literal("developer"),
      v.literal("designer"),
      v.literal("viewer")
    ),
  },
  handler: async (ctx, args) => {
    const { canManageTeam } = await getTeamManagementContext(
      ctx,
      args.projectId,
      args.actorPrincipalId
    )
    if (!canManageTeam) {
      throw new Error("Unauthorized to change member roles")
    }

    // Get target membership
    const targetMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_principal", (q) =>
        q.eq("projectId", args.projectId).eq("principalId", args.memberPrincipalId)
      )
      .first()

    if (!targetMembership) {
      throw new Error("Member not found")
    }

    // Prevent changing own role
    if (args.actorPrincipalId === args.memberPrincipalId) {
      throw new Error("Cannot change your own role")
    }

    // If demoting a project manager, ensure there's at least one other PM
    if (targetMembership.role === "project_manager" && args.newRole !== "project_manager") {
      const pmCount = await ctx.db
        .query("projectMembers")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .filter((q) => q.eq(q.field("role"), "project_manager"))
        .collect()

      if (pmCount.length <= 1) {
        throw new Error("Cannot demote the last project manager")
      }
    }

    await ctx.db.patch(targetMembership._id, {
      role: args.newRole,
    })
  },
})

// Remove a member from a project
export const removeMember = mutation({
  args: {
    projectId: v.id("projects"),
    actorPrincipalId: v.id("devicePrincipals"),
    memberPrincipalId: v.id("devicePrincipals"),
  },
  handler: async (ctx, args) => {
    const { canManageTeam } = await getTeamManagementContext(
      ctx,
      args.projectId,
      args.actorPrincipalId
    )
    if (!canManageTeam) {
      throw new Error("Unauthorized to remove members")
    }

    // Get target membership
    const targetMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_principal", (q) =>
        q.eq("projectId", args.projectId).eq("principalId", args.memberPrincipalId)
      )
      .first()

    if (!targetMembership) {
      throw new Error("Member not found")
    }

    // Prevent self-removal
    if (args.actorPrincipalId === args.memberPrincipalId) {
      throw new Error("Cannot remove yourself from the project")
    }

    // If removing a project manager, ensure there's at least one other PM
    if (targetMembership.role === "project_manager") {
      const pmCount = await ctx.db
        .query("projectMembers")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .filter((q) => q.eq(q.field("role"), "project_manager"))
        .collect()

      if (pmCount.length <= 1) {
        throw new Error("Cannot remove the last project manager")
      }
    }

    await ctx.db.delete(targetMembership._id)
  },
})
