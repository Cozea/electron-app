import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

export const PERSONAL_WORKSPACE_PREFIX = "personal:"

type ProjectSharingCtx = Pick<QueryCtx | MutationCtx, "db">

export function normalizeProjectInviteEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function findUserByNormalizedEmail(
  ctx: ProjectSharingCtx,
  normalizedEmail: string
) {
  return (
    (await ctx.db
      .query("users")
      .withIndex("by_normalized_email", (q) => q.eq("normalizedEmail", normalizedEmail))
      .first()) ??
    (await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first())
  )
}

export async function getProjectMembership(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
) {
  return await ctx.db
    .query("projectMembers")
    .withIndex("by_project_and_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
    .first()
}

export async function requireProjectManagerMembership(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  userId: Id<"users">,
  errorMessage = "Only project managers can manage project sharing"
) {
  const membership = await getProjectMembership(ctx, projectId, userId)
  if (!membership || membership.role !== "project_manager") {
    throw new Error(errorMessage)
  }
  return membership
}

export async function getProjectShareScope(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">
): Promise<{
  project: Doc<"projects">
  organization: Doc<"organizations">
  isPersonalProject: boolean
}> {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
    throw new Error("Project not found")
  }

  const organization = await ctx.db.get(project.organizationId)
  if (!organization) {
    throw new Error("Workspace not found")
  }

  return {
    project,
    organization,
    isPersonalProject: Boolean(
      organization.workosId && organization.workosId.startsWith(PERSONAL_WORKSPACE_PREFIX)
    ),
  }
}

export async function assertPersonalProjectShareScope(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">
) {
  const scope = await getProjectShareScope(ctx, projectId)
  if (!scope.isPersonalProject) {
    throw new Error("Shareable invite links are only available for personal projects")
  }
  return scope
}

export async function findPendingProjectInviteByEmail(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">,
  normalizedEmail: string
) {
  return await ctx.db
    .query("projectInvites")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .filter((q) =>
      q.and(
        q.eq(q.field("email"), normalizedEmail),
        q.eq(q.field("status"), "pending")
      )
    )
    .first()
}

export function buildPendingProjectInviteRecord(args: {
  projectId: Id<"projects">
  email: string
  role: Doc<"projectInvites">["role"]
  invitedBy: Id<"users">
  invitedAt: number
}) {
  return {
    projectId: args.projectId,
    email: args.email,
    role: args.role,
    invitedBy: args.invitedBy,
    invitedAt: args.invitedAt,
    status: "pending" as const,
  }
}
