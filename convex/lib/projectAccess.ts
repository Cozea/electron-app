import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { getOrganizationAccessState } from "./orgAccess"

type ReadDatabaseCtx = Pick<QueryCtx | MutationCtx, "db">

export type ProjectMemberRole = Doc<"projectMembers">["role"]

export interface ProjectAccessState {
  project: Doc<"projects"> | null
  membership: Doc<"projectMembers"> | null
  isCreator: boolean
}

export async function getProjectMembership(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"devicePrincipals">
): Promise<Doc<"projectMembers"> | null> {
  return await ctx.db
    .query("projectMembers")
    .withIndex("by_project_and_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
    .first()
}

export async function getProjectAccessState(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"devicePrincipals">
): Promise<ProjectAccessState> {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
    return {
      project: null,
      membership: null,
      isCreator: false,
    }
  }

  const membership = await getProjectMembership(ctx, projectId, userId)

  return {
    project,
    membership,
    isCreator: project.createdBy === userId,
  }
}

export async function canAccessProject(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"devicePrincipals">
): Promise<boolean> {
  const access = await getProjectAccessState(ctx, projectId, userId)
  if (!access.project) return false
  if (access.isCreator || access.membership) return true
  if (!access.project.organizationId) return false
  const org = await getOrganizationAccessState(ctx, access.project.organizationId, userId)
  return org.organization !== null && (org.isCreator || org.membership !== null)
}

export async function canEditProject(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"devicePrincipals">
): Promise<boolean> {
  const access = await getProjectAccessState(ctx, projectId, userId)
  if (!access.project) {
    return false
  }

  if (access.isCreator) {
    return true
  }
  if (access.membership) return access.membership.role !== "viewer"
  if (!access.project.organizationId) return false
  const org = await getOrganizationAccessState(ctx, access.project.organizationId, userId)
  return org.organization !== null && (org.isCreator || org.membership !== null)
}

export async function canManageProject(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"devicePrincipals">
): Promise<boolean> {
  const access = await getProjectAccessState(ctx, projectId, userId)
  if (!access.project) {
    return false
  }

  if (access.isCreator) {
    return true
  }

  if (access.membership?.role === "project_manager") return true
  if (!access.project.organizationId) return false
  const org = await getOrganizationAccessState(ctx, access.project.organizationId, userId)
  return org.isCreator || org.membership?.role === "admin"
}

export async function canArchiveProject(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"devicePrincipals">
): Promise<boolean> {
  return await canManageProject(ctx, projectId, userId)
}
