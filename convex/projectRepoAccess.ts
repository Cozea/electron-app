import { mutation, query, type MutationCtx } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import {
  canAccessProjectByWorkspaceOrMembership,
  canEditProjectByWorkspaceOrMembership,
} from "./lib/workspaceProjectAccess"

const providerValidator = v.union(v.literal("github"), v.literal("gitlab"))
const subjectTypeValidator = v.union(v.literal("member"), v.literal("invite"))
const roleValidator = v.union(
  v.literal("project_manager"),
  v.literal("developer"),
  v.literal("designer"),
  v.literal("viewer")
)
const accessStateValidator = v.union(
  v.literal("pending"),
  v.literal("granted"),
  v.literal("needs_identity"),
  v.literal("manual_required"),
  v.literal("revoked"),
  v.literal("error")
)

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

async function findExistingRecord(args: {
  ctx: MutationCtx
  projectId: Id<"projects">
  provider: "github" | "gitlab"
  subjectType: "member" | "invite"
  memberUserId?: Id<"users">
  inviteEmail?: string
}) {
  if (args.subjectType === "member" && args.memberUserId) {
    return await args.ctx.db
      .query("projectRepoAccess")
      .withIndex("by_project_and_member_provider", (q) =>
        q.eq("projectId", args.projectId)
          .eq("memberUserId", args.memberUserId)
          .eq("provider", args.provider)
      )
      .first()
  }

  if (args.subjectType === "invite" && args.inviteEmail) {
    const normalizedInviteEmail = normalizeEmail(args.inviteEmail)
    return await args.ctx.db
      .query("projectRepoAccess")
      .withIndex("by_project_and_email_provider", (q) =>
        q.eq("projectId", args.projectId)
          .eq("inviteEmail", normalizedInviteEmail)
          .eq("provider", args.provider)
      )
      .first()
  }

  return null
}

export const listForProject = query({
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

    return await ctx.db
      .query("projectRepoAccess")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()
  },
})

export const recordSyncResult = mutation({
  args: {
    projectId: v.id("projects"),
    actorUserId: v.id("users"),
    provider: providerValidator,
    repoUrl: v.optional(v.string()),
    subjectType: subjectTypeValidator,
    memberUserId: v.optional(v.id("users")),
    inviteEmail: v.optional(v.string()),
    role: roleValidator,
    accessState: accessStateValidator,
    providerAccountHandle: v.optional(v.string()),
    externalInvitationId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const canEdit = await canEditProjectByWorkspaceOrMembership(
      ctx,
      args.projectId,
      args.actorUserId
    )
    if (!canEdit) {
      throw new Error("Unauthorized to update repository access")
    }

    if (args.subjectType === "member" && !args.memberUserId) {
      throw new Error("memberUserId is required for member repo access")
    }

    if (args.subjectType === "invite" && !args.inviteEmail?.trim()) {
      throw new Error("inviteEmail is required for invite repo access")
    }

    const now = Date.now()
    const existing = await findExistingRecord({
      ctx,
      projectId: args.projectId,
      provider: args.provider,
      subjectType: args.subjectType,
      memberUserId: args.memberUserId,
      inviteEmail: args.inviteEmail,
    })

    const payload = {
      projectId: args.projectId,
      provider: args.provider,
      repoUrl: args.repoUrl?.trim() || undefined,
      subjectType: args.subjectType,
      memberUserId: args.subjectType === "member" ? args.memberUserId : undefined,
      inviteEmail:
        args.subjectType === "invite" && args.inviteEmail
          ? normalizeEmail(args.inviteEmail)
          : undefined,
      role: args.role,
      accessState: args.accessState,
      providerAccountHandle: args.providerAccountHandle?.trim() || undefined,
      externalInvitationId: args.externalInvitationId?.trim() || undefined,
      errorMessage: args.errorMessage?.trim() || undefined,
      lastAttemptAt: now,
      lastSyncedAt:
        args.accessState === "granted" || args.accessState === "pending"
          ? now
          : existing?.lastSyncedAt,
      lastAttemptedBy: args.actorUserId,
      updatedAt: now,
    }

    if (existing) {
      await ctx.db.patch(existing._id, payload)
      return existing._id
    }

    return await ctx.db.insert("projectRepoAccess", payload)
  },
})
