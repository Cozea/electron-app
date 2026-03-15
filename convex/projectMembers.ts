import { mutation, query, type MutationCtx } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import {
  canAccessProjectByWorkspaceOrMembership,
  getCanonicalOrganizationMembership,
  getWorkspaceProjectAccess,
  hasWorkspaceProjectPermission,
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
  actorUserId: Id<"users">
) {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
    throw new Error("Project not found")
  }

  const workspaceAccess = await getWorkspaceProjectAccess(
    ctx,
    project.organizationId,
    actorUserId
  )
  const actorMembership = await ctx.db
    .query("projectMembers")
    .withIndex("by_project_and_user", (q) =>
      q.eq("projectId", projectId).eq("userId", actorUserId)
    )
    .first()

  const isPersonalProject = Boolean(
    workspaceAccess.organization?.workosId.startsWith("personal:")
  )
  const canManageTeam = isPersonalProject
    ? Boolean(actorMembership && hasPermission(actorMembership.role as ProjectRole, "manage_members"))
    : hasWorkspaceProjectPermission(workspaceAccess, "projects:share")

  return {
    project,
    actorMembership,
    isPersonalProject,
    canManageTeam,
  }
}

// ============================================
// MEMBER QUERIES
// ============================================

// List all members of a project
export const listMembers = query({
  args: {
    projectId: v.id("projects"),
    viewerUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const canAccess = await canAccessProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.viewerUserId
    )
    if (!canAccess) {
      return []
    }

    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()

    return await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId)
        return {
          ...m,
          user: user
            ? {
                id: user._id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                profileImageUrl: user.profileImageUrl,
              }
            : null,
        }
      })
    )
  },
})

// Get member's role in a project
export const getMemberRole = query({
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

    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.userId)
      )
      .first()

    return membership?.role ?? null
  },
})

// Check if user is a member of the project
export const isMember = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.userId)
      )
      .first()

    return !!membership
  },
})

// Server-only membership check for authenticated gateway routes.
export const isProjectMemberForServer = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.userId)
      )
      .first()
    return !!membership
  },
})

// ============================================
// MEMBER MUTATIONS
// ============================================

// Add a member to a project
export const addMember = mutation({
  args: {
    projectId: v.id("projects"),
    actorUserId: v.id("users"), // User performing the action
    memberUserId: v.id("users"), // User being added
    role: v.union(
      v.literal("project_manager"),
      v.literal("developer"),
      v.literal("designer"),
      v.literal("viewer")
    ),
  },
  handler: async (ctx, args) => {
    const { project, canManageTeam, isPersonalProject } = await getTeamManagementContext(
      ctx,
      args.projectId,
      args.actorUserId
    )
    if (!canManageTeam) {
      throw new Error("Unauthorized to add members")
    }

    if (!isPersonalProject) {
      const workspaceMembership = await getCanonicalOrganizationMembership(
        ctx,
        project.organizationId,
        args.memberUserId
      )
      if (!workspaceMembership) {
        throw new Error("User must already be a member of this workspace")
      }
    }

    // Check if user is already a member
    const existingMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.memberUserId)
      )
      .first()

    if (existingMembership) {
      throw new Error("User is already a member of this project")
    }

    // Verify the user exists
    const user = await ctx.db.get(args.memberUserId)
    if (!user) {
      throw new Error("User not found")
    }

    const now = Date.now()
    const membershipId = await ctx.db.insert("projectMembers", {
      projectId: args.projectId,
      userId: args.memberUserId,
      role: args.role,
      addedAt: now,
      addedBy: args.actorUserId,
    })

    return membershipId
  },
})

// Update a member's role
export const updateRole = mutation({
  args: {
    projectId: v.id("projects"),
    actorUserId: v.id("users"),
    memberUserId: v.id("users"),
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
      args.actorUserId
    )
    if (!canManageTeam) {
      throw new Error("Unauthorized to change member roles")
    }

    // Get target membership
    const targetMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.memberUserId)
      )
      .first()

    if (!targetMembership) {
      throw new Error("Member not found")
    }

    // Prevent changing own role
    if (args.actorUserId === args.memberUserId) {
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
    actorUserId: v.id("users"),
    memberUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { canManageTeam } = await getTeamManagementContext(
      ctx,
      args.projectId,
      args.actorUserId
    )
    if (!canManageTeam) {
      throw new Error("Unauthorized to remove members")
    }

    // Get target membership
    const targetMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.memberUserId)
      )
      .first()

    if (!targetMembership) {
      throw new Error("Member not found")
    }

    // Prevent self-removal
    if (args.actorUserId === args.memberUserId) {
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
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.userId)
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
    actorUserId: v.id("users"),
    newOwnerId: v.id("users"),
    demoteSelf: v.optional(v.boolean()),
    newRoleForSelf: v.optional(
      v.union(v.literal("developer"), v.literal("designer"), v.literal("viewer"))
    ),
  },
  handler: async (ctx, args) => {
    // Verify actor is a project manager
    const actorMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.actorUserId)
      )
      .first()

    if (!actorMembership || actorMembership.role !== "project_manager") {
      throw new Error("Only project managers can transfer ownership")
    }

    // Get new owner's membership
    const newOwnerMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.newOwnerId)
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

    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.userId)
      )
      .first()

    return membership?.localPath ?? null
  },
})

// Update the current user's local path for a project
export const updateMemberLocalPath = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    localPath: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) {
      throw new Error("Project not found")
    }

    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.userId)
      )
      .first()

    if (!membership) {
      const workspaceAccess = await getWorkspaceProjectAccess(
        ctx,
        project.organizationId,
        args.userId
      )

      if (!hasWorkspaceProjectPermission(workspaceAccess, "projects:view")) {
        throw new Error("Unauthorized to access this project")
      }

      // If the user is part of the project's organization, create a default
      // membership so we can store per-user/machine localPath without requiring
      // explicit project invites.
      const orgMembership = await ctx.db
        .query("members")
        .withIndex("by_organization_and_user", (q) =>
          q.eq("organizationId", project.organizationId).eq("userId", args.userId)
        )
        .collect()
      const canonicalOrgMembership = [...orgMembership].sort((a, b) => {
        const roleScore = (role: "admin" | "member" | "viewer") =>
          role === "admin" ? 3 : role === "member" ? 2 : 1
        const roleDelta = roleScore(b.role) - roleScore(a.role)
        if (roleDelta !== 0) return roleDelta
        const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
        if (updatedDelta !== 0) return updatedDelta
        return String(a._id).localeCompare(String(b._id))
      })[0]

      if (!canonicalOrgMembership) {
        throw new Error("User is not a member of this organization")
      }

      const role =
        canonicalOrgMembership.role === "admin"
          ? "project_manager"
          : canonicalOrgMembership.role === "member"
            ? "developer"
            : "viewer"

      const now = Date.now()
      await ctx.db.insert("projectMembers", {
        projectId: args.projectId,
        userId: args.userId,
        role,
        addedAt: now,
        addedBy: args.userId,
        localPath: args.localPath,
      })

      return { success: true }
    }

    await ctx.db.patch(membership._id, {
      localPath: args.localPath,
    })

    return { success: true }
  },
})
