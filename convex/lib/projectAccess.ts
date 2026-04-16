import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

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
  userId: Id<"users">
): Promise<Doc<"projectMembers"> | null> {
  return await ctx.db
    .query("projectMembers")
    .withIndex("by_project_and_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
    .first()
}

export async function getProjectAccessState(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
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
  userId: Id<"users">
): Promise<boolean> {
  const access = await getProjectAccessState(ctx, projectId, userId)
  return access.project !== null && (access.isCreator || access.membership !== null)
}

export async function canEditProject(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
): Promise<boolean> {
  const access = await getProjectAccessState(ctx, projectId, userId)
  if (!access.project) {
    return false
  }

  if (access.isCreator) {
    return true
  }

  return access.membership ? access.membership.role !== "viewer" : false
}

export async function canManageProject(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
): Promise<boolean> {
  const access = await getProjectAccessState(ctx, projectId, userId)
  if (!access.project) {
    return false
  }

  if (access.isCreator) {
    return true
  }

  return access.membership?.role === "project_manager"
}

export async function canArchiveProject(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
): Promise<boolean> {
  return await canManageProject(ctx, projectId, userId)
}
