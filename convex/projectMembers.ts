import { type MutationCtx } from "./_generated/server"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import {
  canAccessProjectByWorkspaceOrMembership,
  canEditProjectByWorkspaceOrMembership,
} from "./lib/workspaceProjectAccess"

const AI_GATEWAY_SECRET = process.env.AI_GATEWAY_SECRET

function assertGatewaySecret(secret: string | undefined) {
  if (!AI_GATEWAY_SECRET) {
    throw new Error("AI_GATEWAY_SECRET is not configured")
  }
  if (secret !== AI_GATEWAY_SECRET) {
    throw new Error("Unauthorized")
  }
}

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

// Server-only membership check for authenticated gateway routes.
export const isProjectMemberForServer = query({
  args: {
    projectId: v.id("projects"),
    principalId: v.id("devicePrincipals"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_principal", (q) =>
        q.eq("projectId", args.projectId).eq("principalId", args.principalId)
      )
      .first()
    return !!membership
  },
})

// Server-only project access check for authenticated gateway routes.
export const getProjectAccessForServer = query({
  args: {
    projectId: v.id("projects"),
    principalId: v.id("devicePrincipals"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)

    const [canAccess, canEdit] = await Promise.all([
      canAccessProjectByWorkspaceOrMembership(ctx, args.projectId, args.principalId),
      canEditProjectByWorkspaceOrMembership(ctx, args.projectId, args.principalId),
    ])

    return { canAccess, canEdit }
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

// Leave a project (self-remove)
export const leaveProject = mutation({
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

    if (!membership) {
      throw new Error("You are not a member of this project")
    }

    // If user is a project manager, ensure there's at least one other PM
    if (membership.role === "project_manager") {
      const pmCount = await ctx.db
        .query("projectMembers")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .filter((q) => q.eq(q.field("role"), "project_manager"))
        .collect()

      if (pmCount.length <= 1) {
        throw new Error("Cannot leave as the last project manager. Transfer ownership first.")
      }
    }

    await ctx.db.delete(membership._id)
  },
})

// Transfer project ownership (make someone else a PM and optionally demote self)
export const transferOwnership = mutation({
  args: {
    projectId: v.id("projects"),
    actorPrincipalId: v.id("devicePrincipals"),
    newOwnerId: v.id("devicePrincipals"),
    demoteSelf: v.optional(v.boolean()),
    newRoleForSelf: v.optional(
      v.union(v.literal("developer"), v.literal("designer"), v.literal("viewer"))
    ),
  },
  handler: async (ctx, args) => {
    // Verify actor is a project manager
    const actorMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_principal", (q) =>
        q.eq("projectId", args.projectId).eq("principalId", args.actorPrincipalId)
      )
      .first()

    if (!actorMembership || actorMembership.role !== "project_manager") {
      throw new Error("Only project managers can transfer ownership")
    }

    // Get new owner's membership
    const newOwnerMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_principal", (q) =>
        q.eq("projectId", args.projectId).eq("principalId", args.newOwnerId)
      )
      .first()

    if (!newOwnerMembership) {
      throw new Error("New owner must be an existing member of the project")
    }

    // Promote new owner to project manager
    await ctx.db.patch(newOwnerMembership._id, {
      role: "project_manager",
    })

    // Optionally demote self
    if (args.demoteSelf && args.newRoleForSelf) {
      await ctx.db.patch(actorMembership._id, {
        role: args.newRoleForSelf,
      })
    }
  },
})

// Get member count for a project
export const getMemberCount = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()

    return members.length
  },
})

// ============================================
// LOCAL PATH MANAGEMENT (per-user, per-project)
// ============================================

// Get the current user's local path for a project
export const getMemberLocalPath = query({
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

    return membership?.localPath ?? null
  },
})

// Update the current user's local path for a project
export const updateMemberLocalPath = mutation({
  args: {
    projectId: v.id("projects"),
    principalId: v.id("devicePrincipals"),
    localPath: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) {
      throw new Error("Project not found")
    }

    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_principal", (q) =>
        q.eq("projectId", args.projectId).eq("principalId", args.principalId)
      )
      .first()

    if (!membership && project.createdBy === args.principalId) {
      const now = Date.now()
      await ctx.db.insert("projectMembers", {
        projectId: args.projectId,
        principalId: args.principalId,
        role: "project_manager",
        addedAt: now,
        addedBy: args.principalId,
        localPath: args.localPath,
      })

      return { success: true }
    }

    if (!membership) {
      throw new Error("Project membership not found")
    }

    await ctx.db.patch(membership._id, {
      localPath: args.localPath,
    })

    return { success: true }
  },
})
