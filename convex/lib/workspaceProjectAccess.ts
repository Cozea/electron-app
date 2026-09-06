import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import {
  canAccessProject,
  canArchiveProject,
  canEditProject,
  canManageProject,
  getProjectAccessState,
} from "./projectAccess"

type ReadDatabaseCtx = Pick<QueryCtx | MutationCtx, "db">

export type WorkspaceProjectPermission =
  | "projects:view"
  | "projects:create"
  | "projects:import"
  | "projects:archive"
  | "projects:share"
  | "projects:delete"
  | "projects:manage"

export interface WorkspaceProjectAccess {
  projectExists: boolean
  isCreator: boolean
  isMember: boolean
  role: "project_manager" | "developer" | "designer" | "viewer" | null
}

export async function getWorkspaceProjectAccess(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  principalId: Id<"devicePrincipals">
): Promise<WorkspaceProjectAccess> {
  const access = await getProjectAccessState(ctx, projectId, principalId)
  return {
    projectExists: access.project !== null,
    isCreator: access.isCreator,
    isMember: access.membership !== null,
    role: access.membership?.role ?? null,
  }
}

export function hasWorkspaceProjectPermission(
  workspaceAccess: WorkspaceProjectAccess,
  permission: WorkspaceProjectPermission
): boolean {
  if (!workspaceAccess.projectExists) {
    return false
  }

  if (workspaceAccess.isCreator) {
    return true
  }

  switch (permission) {
    case "projects:view":
      return workspaceAccess.isMember
    case "projects:create":
    case "projects:import":
      return true
    case "projects:archive":
    case "projects:delete":
    case "projects:manage":
    case "projects:share":
      return workspaceAccess.role === "project_manager"
    default:
      return false
  }
}

export async function canAccessProjectByWorkspaceOrMembership(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  principalId: Id<"devicePrincipals">
): Promise<boolean> {
  return await canAccessProject(ctx, projectId, principalId)
}

export async function canEditProjectByWorkspaceOrMembership(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  principalId: Id<"devicePrincipals">
): Promise<boolean> {
  return await canEditProject(ctx, projectId, principalId)
}

export async function canManageProjectByWorkspaceOrMembership(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  principalId: Id<"devicePrincipals">
): Promise<boolean> {
  return await canManageProject(ctx, projectId, principalId)
}

export async function canArchiveProjectByWorkspaceOrMembership(
  ctx: ReadDatabaseCtx,
  projectId: Id<"projects">,
  principalId: Id<"devicePrincipals">
): Promise<boolean> {
  return await canArchiveProject(ctx, projectId, principalId)
}
