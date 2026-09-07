import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import { canAccessProject, canEditProject, canManageProject } from "./lib/projectAccess"
import { repositoryOperationValidator } from "./schema/projectRepositoryAuthorizations"
import {
  buildCollaborationRepositoryId,
  parseGitHubNumericId,
  parseGitHubRepositoryUrl,
  type CollaborationRepositoryCredentialOperation,
  type CollaborationRepositoryDescriptor,
} from "../shared/collaborationRepository"
import { assertGitCommitSha } from "../shared/collaborationSession"

const MAX_AUDIT_ITEMS = 100

type DbCtx = Pick<QueryCtx | MutationCtx, "db">

function assertGatewaySecret(secret: string): void {
  const expected = process.env.AI_GATEWAY_SECRET
  if (!expected || secret !== expected) throw new ConvexError("Unauthorized")
}

function required(value: string, label: string, maxLength = 512): string {
  const normalized = value.trim()
  if (!normalized) throw new ConvexError(`${label} is required`)
  if (normalized.length > maxLength) throw new ConvexError(`${label} exceeds ${maxLength} characters`)
  return normalized
}

function numericId(value: string, label: string): string {
  const normalized = required(value, label, 64)
  parseGitHubNumericId(normalized)
  return normalized
}

async function getAuthorization(ctx: DbCtx, projectId: Id<"projects">) {
  return await ctx.db
    .query("projectRepositoryAuthorizations")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique()
}

async function getPrincipalByIdentityKey(ctx: DbCtx, identityKey: string) {
  return await ctx.db
    .query("devicePrincipals")
    .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey))
    .unique()
}

function repositoryDescriptor(
  project: Doc<"projects">,
  authorization: Doc<"projectRepositoryAuthorizations">,
): CollaborationRepositoryDescriptor {
  const repo = project.repo
  if (!repo || repo.provider.trim().toLowerCase() !== "github" || !repo.url.trim()) {
    throw new ConvexError("Project has no canonical GitHub repository")
  }
  const parsed = parseGitHubRepositoryUrl(repo.url)
  const repositoryNumericId = numericId(authorization.repositoryNumericId, "Repository ID")
  const installationId = numericId(authorization.installationId, "GitHub App installation ID")
  return {
    provider: "github",
    repositoryId: buildCollaborationRepositoryId(repositoryNumericId),
    repositoryNumericId,
    installationId,
    owner: parsed.owner,
    name: parsed.name,
    fullName: parsed.fullName,
    cloneUrl: parsed.cloneUrl,
    defaultBranch: repo.defaultBranch.trim() || "main",
  }
}

async function canUse(
  ctx: DbCtx,
  projectId: Id<"projects">,
  principalId: Id<"devicePrincipals">,
  operation: CollaborationRepositoryCredentialOperation,
): Promise<boolean> {
  if (!(await canAccessProject(ctx, projectId, principalId))) return false
  return operation === "read" || await canEditProject(ctx, projectId, principalId)
}

export const upsert = mutation({
  args: {
    projectId: v.id("projects"),
    repositoryNumericId: v.string(),
    installationId: v.string(),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, principal._id))) {
      throw new ConvexError("Only project management authority may configure repository access")
    }
    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") throw new ConvexError("Project not found")
    if (!project.repo || project.repo.provider.trim().toLowerCase() !== "github") {
      throw new ConvexError("Configure the project's canonical GitHub repository first")
    }
    parseGitHubRepositoryUrl(project.repo.url)
    const repositoryNumericId = numericId(args.repositoryNumericId, "Repository ID")
    const installationId = numericId(args.installationId, "GitHub App installation ID")
    const now = Date.now()
    const existing = await getAuthorization(ctx, args.projectId)
    if (existing) {
      await ctx.db.patch(existing._id, {
        repositoryNumericId,
        installationId,
        enabled: args.enabled ?? true,
        configuredByPrincipalId: principal._id,
        updatedAt: now,
      })
      return {
        authorizationId: existing._id,
        repository: repositoryDescriptor(project, {
          ...existing,
          repositoryNumericId,
          installationId,
          enabled: args.enabled ?? true,
          configuredByPrincipalId: principal._id,
          updatedAt: now,
        }),
      }
    }
    const authorizationId = await ctx.db.insert("projectRepositoryAuthorizations", {
      projectId: args.projectId,
      provider: "github",
      repositoryNumericId,
      installationId,
      enabled: args.enabled ?? true,
      configuredByPrincipalId: principal._id,
      createdAt: now,
      updatedAt: now,
    })
    const created = await ctx.db.get(authorizationId)
    if (!created) throw new ConvexError("Failed to create repository authorization")
    return { authorizationId, repository: repositoryDescriptor(project, created) }
  },
})

export const getForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, principal._id))) return null
    const project = await ctx.db.get(args.projectId)
    const authorization = await getAuthorization(ctx, args.projectId)
    if (!project || !authorization) return null
    return {
      id: authorization._id,
      enabled: authorization.enabled,
      repository: repositoryDescriptor(project, authorization),
      configuredByPrincipalId: authorization.configuredByPrincipalId,
      updatedAt: authorization.updatedAt,
    }
  },
})

export const getCredentialContextForServer = query({
  args: {
    serverSecret: v.string(),
    identityKey: v.string(),
    projectId: v.id("projects"),
    operation: repositoryOperationValidator,
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const principal = await getPrincipalByIdentityKey(ctx, required(args.identityKey, "Identity key", 256))
    const project = await ctx.db.get(args.projectId)
    const authorization = await getAuthorization(ctx, args.projectId)
    if (
      !principal || principal.status === "revoked" || !project || !authorization || !authorization.enabled ||
      !(await canUse(ctx, args.projectId, principal._id, args.operation))
    ) return { allowed: false as const }
    return {
      allowed: true as const,
      principalId: principal._id,
      authorizationId: authorization._id,
      repository: repositoryDescriptor(project, authorization),
    }
  },
})

export const getPushVerificationContextForServer = query({
  args: { serverSecret: v.string(), identityKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const principal = await getPrincipalByIdentityKey(ctx, required(args.identityKey, "Identity key", 256))
    if (!principal || principal.status === "revoked") return { allowed: false as const }
    const session = await ctx.db
      .query("collaborationSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", required(args.sessionId, "Session ID", 128)))
      .unique()
    if (
      !session || session.status !== "pushing" || session.commitLeasePrincipalId !== principal._id ||
      !Number.isFinite(session.commitLeaseExpiresAt) || (session.commitLeaseExpiresAt ?? 0) <= Date.now() ||
      !session.pendingCommitSha || session.pendingCommitThroughSequence === undefined
    ) return { allowed: false as const }
    const project = await ctx.db.get(session.projectId)
    const authorization = await getAuthorization(ctx, session.projectId)
    if (
      !project || !authorization || !authorization.enabled ||
      !(await canUse(ctx, session.projectId, principal._id, "write"))
    ) return { allowed: false as const }
    const repository = repositoryDescriptor(project, authorization)
    if (repository.repositoryId !== session.repositoryId) return { allowed: false as const }
    return {
      allowed: true as const,
      principalId: principal._id,
      authorizationId: authorization._id,
      repository,
      session: {
        id: session.sessionId,
        documentId: session._id,
        sessionBranch: session.sessionBranch,
        pendingCommitSha: assertGitCommitSha(session.pendingCommitSha, "Prepared commit SHA"),
        pendingCommitThroughSequence: session.pendingCommitThroughSequence,
      },
    }
  },
})

export const recordAccessEventFromServer = mutation({
  args: {
    serverSecret: v.string(),
    authorizationId: v.id("projectRepositoryAuthorizations"),
    principalId: v.id("devicePrincipals"),
    operation: repositoryOperationValidator,
    outcome: v.union(v.literal("issued"), v.literal("verified"), v.literal("rejected")),
    sessionId: v.optional(v.id("collaborationSessions")),
    tokenExpiresAt: v.optional(v.number()),
    commitSha: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const authorization = await ctx.db.get(args.authorizationId)
    if (!authorization) throw new ConvexError("Repository authorization not found")
    await ctx.db.insert("projectRepositoryAccessEvents", {
      projectId: authorization.projectId,
      authorizationId: args.authorizationId,
      principalId: args.principalId,
      operation: args.operation,
      sessionId: args.sessionId,
      outcome: args.outcome,
      tokenExpiresAt: args.tokenExpiresAt,
      commitSha: args.commitSha,
      createdAt: Date.now(),
    })
    return { recorded: true }
  },
})

export const listAccessEvents = query({
  args: { projectId: v.id("projects"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, principal._id))) {
      throw new ConvexError("Only project management authority may view repository access events")
    }
    const limit = Number.isFinite(args.limit) ? Math.max(1, Math.min(MAX_AUDIT_ITEMS, Math.floor(args.limit!))) : 50
    return await ctx.db
      .query("projectRepositoryAccessEvents")
      .withIndex("by_project_and_created", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(limit)
  },
})
