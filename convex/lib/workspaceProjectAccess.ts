import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import {
  resolveMemberAccess,
  type ResolvedOrganizationAccess,
} from "./organizationRoles"
import { getProjectMembership, PERSONAL_WORKSPACE_PREFIX } from "./projectSharing"

type ReadDatabaseCtx = Pick<QueryCtx | MutationCtx, "db">

type OrganizationRole = "admin" | "member" | "viewer"

export type WorkspaceProjectPermission =
  | "projects:view"
  | "projects:create"
  | "projects:import"
  | "projects:archive"
  | "projects:share"
  | "projects:delete"
  | "projects:manage"

export interface WorkspaceProjectAccess {
  organization: Doc<"organizations"> | null
  membership: Doc<"members"> | null
  access: ResolvedOrganizationAccess | null
  isPersonalOwner: boolean
}

function organizationRolePriority(role: OrganizationRole): number {
  switch (role) {
    case "admin":
      return 3
    case "member":
      return 2
    default:
      return 1
  }
}

function pickCanonicalOrganizationMembership<
  T extends { role: OrganizationRole; updatedAt?: number; joinedAt?: number; _id: unknown },
>(memberships: T[]): T | null {
  if (memberships.length === 0) return null
  return [...memberships].sort((a, b) => {
    const roleDelta = organizationRolePriority(b.role) - organizationRolePriority(a.role)
    if (roleDelta !== 0) return roleDelta
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    const joinedDelta = (b.joinedAt || 0) - (a.joinedAt || 0)
    if (joinedDelta !== 0) return joinedDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

export async function getCanonicalOrganizationMembership(
  ctx: ReadDatabaseCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">
): Promise<Doc<"members"> | null> {
  const memberships = await ctx.db
    .query("members")
    .withIndex("by_organization_and_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId)
    )
    .collect()

  return pickCanonicalOrganizationMembership(memberships)
}

export async function getWorkspaceProjectAccess(
  ctx: ReadDatabaseCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">
): Promise<WorkspaceProjectAccess> {
  const organization = await ctx.db.get(organizationId)
  if (!organization) {
    return {
      organization: null,
      membership: null,
      access: null,
      isPersonalOwner: false,
    }
  }

  if (organization.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)) {
    const user = await ctx.db.get(userId)
    const isPersonalOwner =
      !!user && organization.workosId === `${PERSONAL_WORKSPACE_PREFIX}${user.workosId}`

    return {
      organization,
      membership: null,
      access: null,
      isPersonalOwner,
    }
  }

  const membership = await getCanonicalOrganizationMembership(ctx, organizationId, userId)
  const access = await resolveMemberAccess(ctx, membership)

  return {
    organization,
    membership,
    access,
    isPersonalOwner: false,
  }
}

export function hasWorkspaceProjectPermission(
  workspaceAccess: WorkspaceProjectAccess,
  permission: WorkspaceProjectPermission
): boolean {
  if (workspaceAccess.isPersonalOwner || hasWorkspaceProjectPermission(workspaceAccess, "projects:manage")) {
    return true
  }

  return workspaceAccess.access?.permissions.includes(permission) ?? false
}

function canUseProjectMembershipFallback(
  workspaceAccess: WorkspaceProjectAccess
): boolean {
  if (!workspaceAccess.organization) {
    return false
  }

  if (workspaceAccess.organization.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)) {
    return true
  }

  return workspaceAccess.membership !== null
}

export async function canAccessProjectByWorkspaceOrMembership(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
): Promise<boolean> {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
    return false
  }

  const workspaceAccess = await getWorkspaceProjectAccess(
    ctx,
    project.organizationId,
    userId
  )

  if (hasWorkspaceProjectPermission(workspaceAccess, "projects:view")) {
    return true
  }

  if (!canUseProjectMembershipFallback(workspaceAccess)) {
    return false
  }

  const membership = await getProjectMembership(ctx, projectId, userId)
  return !!membership
}

export async function canEditProjectByWorkspaceOrMembership(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
): Promise<boolean> {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
    return false
  }

  const workspaceAccess = await getWorkspaceProjectAccess(
    ctx,
    project.organizationId,
    userId
  )

  if (workspaceAccess.isPersonalOwner || hasWorkspaceProjectPermission(workspaceAccess, "projects:manage")) {
    return true
  }

  if (!canUseProjectMembershipFallback(workspaceAccess)) {
    return false
  }

  const membership = await getProjectMembership(ctx, projectId, userId)
  return membership ? membership.role !== "viewer" : false
}

export async function canManageProjectByWorkspaceOrMembership(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
): Promise<boolean> {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
    return false
  }

  const workspaceAccess = await getWorkspaceProjectAccess(
    ctx,
    project.organizationId,
    userId
  )

  if (workspaceAccess.isPersonalOwner || hasWorkspaceProjectPermission(workspaceAccess, "projects:manage")) {
    return true
  }

  if (!canUseProjectMembershipFallback(workspaceAccess)) {
    return false
  }

  const membership = await getProjectMembership(ctx, projectId, userId)
  return membership?.role === "project_manager"
}

export async function canArchiveProjectByWorkspaceOrMembership(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
): Promise<boolean> {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
    return false
  }

  const workspaceAccess = await getWorkspaceProjectAccess(
    ctx,
    project.organizationId,
    userId
  )

  if (hasWorkspaceProjectPermission(workspaceAccess, "projects:archive")) {
    return true
  }

  if (!canUseProjectMembershipFallback(workspaceAccess)) {
    return false
  }

  const membership = await getProjectMembership(ctx, projectId, userId)
  return membership?.role === "project_manager"
}
