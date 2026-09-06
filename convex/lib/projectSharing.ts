import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

type ProjectSharingCtx = Pick<QueryCtx | MutationCtx, "db">

export async function getProjectMembership(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">,
  principalId: Id<"devicePrincipals">,
) {
  return await ctx.db.query("projectMembers")
    .withIndex("by_project_and_principal", (q) => q.eq("projectId", projectId).eq("principalId", principalId))
    .first()
}

export async function requireProjectManagerMembership(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  principalId: Id<"devicePrincipals">,
  errorMessage = "Only project managers can manage project sharing",
) {
  const membership = await getProjectMembership(ctx, projectId, principalId)
  if (!membership || membership.role !== "project_manager") throw new Error(errorMessage)
  return membership
}

export async function getProjectShareScope(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">,
): Promise<{ project: Doc<"projects"> }> {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") throw new Error("Project not found")
  return { project }
}

export async function assertPersonalProjectShareScope(ctx: ProjectSharingCtx, projectId: Id<"projects">) {
  return await getProjectShareScope(ctx, projectId)
}
