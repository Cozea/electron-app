import { ConvexError } from "convex/values"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { canManageProject } from "./projectAccess"

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
  const canManage = await canManageProject(ctx, projectId, principalId)
  if (!canManage) throw new ConvexError(errorMessage)
  return await getProjectMembership(ctx, projectId, principalId)
}

export async function getProjectShareScope(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">,
): Promise<{ project: Doc<"projects"> }> {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") throw new Error("Project not found")
  return { project }
}
