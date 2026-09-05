import { verifiedInstallationIsCurrent } from "./lib/collaborationInstallationAccess"
import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import { requireOrgAdmin } from "./lib/orgAccess"
import { verifiedRepositoryValidator } from "./schema/collaborationRepositories"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import {
  canAccessProject,
  canEditProject,
  canManageProject,
  getProjectAccessState,
} from "./lib/projectAccess"
import { assertGitCommitSha } from "../shared/collaborationSession"
import {
  buildCollaborationRepositoryId,
  parseGitHubNumericId,
  normalizeGitHubCloneUrl,
  type CollaborationRepositoryBindingDescriptor,
  type CollaborationRepositoryCredentialOperation,
} from "../shared/collaborationRepository"
import { collaborationRepositoryOperationValidator } from "./schema/collaborationRepositories"

const MAX_AUDIT_ITEMS = 100

function assertGatewaySecret(secret: string): void {
  const expected = process.env.AI_GATEWAY_SECRET
  if (!expected || secret !== expected) throw new ConvexError("Unauthorized")
}

function required(value: string, label: string, maxLength = 512): string {
  const normalized = value.trim()
  if (!normalized) throw new ConvexError(`${label} is required`)
  if (normalized.length > maxLength) {
    throw new ConvexError(`${label} exceeds ${maxLength} characters`)
  }
  return normalized
}

function numericId(value: string, label: string): string {
  const normalized = required(value, label, 64)
  parseGitHubNumericId(normalized)
  return normalized
}

function gitBranch(value: string, label: string): string {
  const branch = required(value, label, 255)
  if (
    branch.startsWith("-") ||
    branch.startsWith(".") ||
    branch.endsWith(".") ||
    branch.endsWith("/") ||
    branch.endsWith(".lock") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("//") ||
    /[~^:?*\\[\]]/.test(branch) || [...branch].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
  ) {
    throw new ConvexError(`${label} is not a valid Git branch name`)
  }
  return branch
}

function toDescriptor(
  binding: Doc<"collaborationRepositoryBindings">,
): CollaborationRepositoryBindingDescriptor {
  return {
    id: String(binding._id),
    projectId: String(binding.projectId),
    organizationId: binding.organizationId ? String(binding.organizationId) : null,
    provider: binding.provider,
    repositoryId: binding.repositoryId,
    repositoryNumericId: binding.repositoryNumericId,
    installationId: binding.installationId,
    owner: binding.owner,
    name: binding.name,
    fullName: binding.fullName,
    cloneUrl: binding.cloneUrl,
    htmlUrl: binding.htmlUrl,
    defaultBranch: binding.defaultBranch,
    accessPolicy: binding.accessPolicy,
    enabled: binding.enabled,
    createdByUserId: String(binding.createdByUserId),
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  }
}

async function getBindingByProject(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
): Promise<Doc<"collaborationRepositoryBindings"> | null> {
  return await ctx.db
    .query("collaborationRepositoryBindings")
    .withIndex("by_project", (index) => index.eq("projectId", projectId))
    .unique()
}

async function getUserByIdentityKey(
  ctx: QueryCtx | MutationCtx,
  identityKey: string,
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_identity_key", (index) => index.eq("identityKey", identityKey))
    .unique()
}

async function canReadBinding(
  ctx: QueryCtx | MutationCtx,
  binding: Doc<"collaborationRepositoryBindings">,
  userId: Id<"users">,
): Promise<boolean> {
  if (!binding.enabled || !binding.organizationId) return false
  const verified = await ctx.db.query("collaborationVerifiedRepositories")
    .withIndex("by_organization_and_repository", (q) =>
      q.eq("organizationId", binding.organizationId!).eq("repositoryNumericId", binding.repositoryNumericId))
    .unique()
  if (!verified || verified.revokedAt !== undefined || verified.installationId !== binding.installationId ||
      verified.owner !== binding.owner || verified.name !== binding.name || !await verifiedInstallationIsCurrent(ctx, verified)) return false
  if (binding.accessPolicy === "organization") {
    return await canAccessProject(ctx, binding.projectId, userId)
  }
  const access = await getProjectAccessState(ctx, binding.projectId, userId)
  return Boolean(access.project && (access.isCreator || access.membership))
}

async function canUseBinding(
  ctx: QueryCtx | MutationCtx,
  binding: Doc<"collaborationRepositoryBindings">,
  userId: Id<"users">,
  operation: CollaborationRepositoryCredentialOperation,
): Promise<boolean> {
  if (!(await canReadBinding(ctx, binding, userId))) return false
  return operation === "read" || await canEditProject(ctx, binding.projectId, userId)
}

export const upsertBinding = mutation({
  args: {
    projectId: v.id("projects"),
    repositoryNumericId: v.string(),
    installationId: v.string(),
    owner: v.string(),
    name: v.string(),
    htmlUrl: v.optional(v.string()),
    defaultBranch: v.string(),
    accessPolicy: v.union(v.literal("organization"), v.literal("restricted")),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only a project manager may configure repository access")
    }
    const project = await ctx.db.get(args.projectId)
    if (!project || project.status === "deleted") throw new ConvexError("Project not found")

    if (!project.organizationId) throw new ConvexError("Connect this project to an organization first")
    await requireOrgAdmin(ctx, project.organizationId, user._id)
    const verified = await ctx.db.query("collaborationVerifiedRepositories")
      .withIndex("by_organization_and_repository", (q) =>
        q.eq("organizationId", project.organizationId!).eq("repositoryNumericId", args.repositoryNumericId))
      .unique()
    if (!verified || verified.revokedAt !== undefined || verified.installationId !== args.installationId ||
        verified.owner !== args.owner || verified.name !== args.name || verified.defaultBranch !== args.defaultBranch || !await verifiedInstallationIsCurrent(ctx, verified)) {
      throw new ConvexError("Select a repository from a verified GitHub installation")
    }
    const repositoryNumericId = numericId(args.repositoryNumericId, "Repository ID")
    const installationId = numericId(args.installationId, "GitHub App installation ID")
    const owner = required(args.owner, "Repository owner", 128)
    const name = required(args.name, "Repository name", 128).replace(/\.git$/i, "")
    const fullName = `${owner}/${name}`
    const cloneUrl = normalizeGitHubCloneUrl(owner, name)
    const htmlUrl = args.htmlUrl?.trim() || `https://github.com/${fullName}`
    const defaultBranch = gitBranch(args.defaultBranch, "Default branch")
    const repositoryId = buildCollaborationRepositoryId("github", repositoryNumericId)
    const existing = await getBindingByProject(ctx, args.projectId)
    const now = Date.now()

    if (existing) {
      await ctx.db.patch(existing._id, {
        organizationId: project.organizationId,
        provider: "github",
        repositoryId,
        repositoryNumericId,
        installationId,
        owner,
        name,
        fullName,
        cloneUrl,
        htmlUrl,
        defaultBranch,
        accessPolicy: args.accessPolicy,
        enabled: args.enabled ?? true,
        updatedAt: now,
      })
      return toDescriptor({
        ...existing,
        organizationId: project.organizationId,
        provider: "github",
        repositoryId,
        repositoryNumericId,
        installationId,
        owner,
        name,
        fullName,
        cloneUrl,
        htmlUrl,
        defaultBranch,
        accessPolicy: args.accessPolicy,
        enabled: args.enabled ?? true,
        updatedAt: now,
      })
    }

    const bindingId = await ctx.db.insert("collaborationRepositoryBindings", {
      projectId: args.projectId,
      organizationId: project.organizationId,
      provider: "github",
      repositoryId,
      repositoryNumericId,
      installationId,
      owner,
      name,
      fullName,
      cloneUrl,
      htmlUrl,
      defaultBranch,
      accessPolicy: args.accessPolicy,
      enabled: args.enabled ?? true,
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    })
    const created = await ctx.db.get(bindingId)
    if (!created) throw new ConvexError("Failed to create repository binding")
    return toDescriptor(created)
  },
})

export const getBinding = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    const binding = await getBindingByProject(ctx, args.projectId)
    if (!binding) return null
    if (!(await canReadBinding(ctx, binding, user._id))) {
      throw new ConvexError("The authenticated user cannot access this repository")
    }
    return toDescriptor(binding)
  },
})

export const getAuthorizationForServer = query({
  args: {
    serverSecret: v.string(),
    identityKey: v.string(),
    projectId: v.id("projects"),
    operation: collaborationRepositoryOperationValidator,
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const user = await getUserByIdentityKey(ctx, required(args.identityKey, "Identity key", 256))
    const binding = await getBindingByProject(ctx, args.projectId)
    if (!user || user.status === "revoked" || !binding || !(await canUseBinding(ctx, binding, user._id, args.operation))) {
      return { allowed: false as const }
    }
    return {
      allowed: true as const,
      userId: user._id,
      bindingId: binding._id,
      binding: toDescriptor(binding),
    }
  },
})

export const getPushVerificationContextForServer = query({
  args: {
    serverSecret: v.string(),
    identityKey: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const user = await getUserByIdentityKey(ctx, required(args.identityKey, "Identity key", 256))
    if (!user || user.status === "revoked") return { allowed: false as const }

    const session = await ctx.db
      .query("collaborationSessions")
      .withIndex("by_session_id", (index) =>
        index.eq("sessionId", required(args.sessionId, "Collaboration session ID", 128)),
      )
      .unique()
    if (
      !session || session.generation !== 3 || session.status !== "pushing" || session.commitLeaseUserId !== user._id ||
      !Number.isFinite(session.commitLeaseExpiresAt) || (session.commitLeaseExpiresAt ?? 0) <= Date.now()
    ) {
      return { allowed: false as const }
    }
    if (!session.pendingCommitSha || session.pendingCommitThroughSequence === undefined) {
      return { allowed: false as const }
    }
    const participant = await ctx.db.query("collaborationParticipants").withIndex("by_session_and_user", q => q.eq("sessionId", session._id).eq("userId", user._id)).unique()
    if (!participant || participant.leftAt !== undefined || participant.role !== "editor") return { allowed: false as const }

    const binding = await getBindingByProject(ctx, session.projectId)
    if (
      !binding ||
      binding.repositoryId !== session.repositoryId ||
      !(await canUseBinding(ctx, binding, user._id, "write"))
    ) {
      return { allowed: false as const }
    }

    return {
      allowed: true as const,
      userId: user._id,
      bindingId: binding._id,
      binding: toDescriptor(binding),
      session: {
        id: session.sessionId,
        projectId: session.projectId,
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
    bindingId: v.id("collaborationRepositoryBindings"),
    userId: v.id("users"),
    operation: collaborationRepositoryOperationValidator,
    outcome: v.union(v.literal("issued"), v.literal("verified"), v.literal("rejected")),
    sessionId: v.optional(v.id("collaborationSessions")),
    tokenExpiresAt: v.optional(v.number()),
    commitSha: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const binding = await ctx.db.get(args.bindingId)
    if (!binding) throw new ConvexError("Repository binding not found")
    await ctx.db.insert("collaborationRepositoryAccessEvents", {
      projectId: binding.projectId,
      bindingId: args.bindingId,
      userId: args.userId,
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
    const user = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, user._id))) {
      throw new ConvexError("Only a project manager may view repository access events")
    }
    const limit = Number.isFinite(args.limit)
      ? Math.max(1, Math.min(MAX_AUDIT_ITEMS, Math.floor(args.limit!)))
      : 50
    return await ctx.db
      .query("collaborationRepositoryAccessEvents")
      .withIndex("by_project_and_created", (index) => index.eq("projectId", args.projectId))
      .order("desc")
      .take(limit)
  },
})


export const beginSetupFromServer = mutation({
  args: { serverSecret: v.string(), identityKey: v.string(), organizationId: v.id("organizations"), stateHash: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const user = await getUserByIdentityKey(ctx, args.identityKey)
    if (!user || user.status === "revoked") throw new ConvexError("Device access revoked")
    await requireOrgAdmin(ctx, args.organizationId, user._id)
    if (!/^[a-f0-9]{64}$/.test(args.stateHash)) throw new ConvexError("Invalid setup state")
    return await ctx.db.insert("collaborationRepositorySetups", {
      organizationId: args.organizationId, userId: user._id, stateHash: args.stateHash,
      expiresAt: Date.now() + 10 * 60_000,
    })
  },
})

export const consumeSetupFromServer = mutation({
  args: { serverSecret: v.string(), stateHash: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const setup = await ctx.db.query("collaborationRepositorySetups").withIndex("by_state", q => q.eq("stateHash", args.stateHash)).unique()
    if (!setup || setup.expiresAt <= Date.now() || setup.consumedAt !== undefined) throw new ConvexError("GitHub setup expired or was already used")
    const user = await ctx.db.get(setup.userId)
    if (!user || user.status === "revoked") throw new ConvexError("Device access revoked")
    await requireOrgAdmin(ctx, setup.organizationId, user._id)
    await ctx.db.patch(setup._id, { consumedAt: Date.now() })
    return { setupId: setup._id }
  },
})

export const completeSetupFromServer = mutation({
  args: { serverSecret: v.string(), setupId: v.id("collaborationRepositorySetups"), repositories: v.array(verifiedRepositoryValidator) },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const setup = await ctx.db.get(args.setupId)
    if (!setup || setup.expiresAt <= Date.now() || setup.completedAt !== undefined || setup.consumedAt === undefined) throw new ConvexError("Invalid setup completion")
    const user = await ctx.db.get(setup.userId)
    if (!user || user.status === "revoked") throw new ConvexError("Device access revoked")
    await requireOrgAdmin(ctx, setup.organizationId, user._id)
    if (args.repositories.length > 1000) throw new ConvexError("Too many repositories; restrict the GitHub App installation")
    for (const repository of args.repositories) {
      numericId(repository.installationId, "Installation ID")
      numericId(repository.repositoryNumericId, "Repository ID")
      const previous = await ctx.db.query("collaborationVerifiedRepositories").withIndex("by_organization_and_repository", q => q.eq("organizationId", setup.organizationId).eq("repositoryNumericId", repository.repositoryNumericId)).unique()
      const value = { ...repository, organizationId: setup.organizationId, verifiedByUserId: setup.userId, verifiedAt: setup.consumedAt, revokedAt: undefined }
      if (previous) await ctx.db.patch(previous._id, value)
      else await ctx.db.insert("collaborationVerifiedRepositories", value)
    }
    await ctx.db.patch(setup._id, { completedAt: Date.now() })
    return { count: args.repositories.length }
  },
})

export const listVerifiedRepositories = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedDevice(ctx)
    await requireOrgAdmin(ctx, args.organizationId, user._id)
    const repositories = await ctx.db.query("collaborationVerifiedRepositories").withIndex("by_organization", q => q.eq("organizationId", args.organizationId)).take(1000)
    const allowed = await Promise.all(repositories.map(repository => verifiedInstallationIsCurrent(ctx, repository)))
    return repositories.filter((_repository, index) => allowed[index])
  },
})

export const revokeInstallationFromServer = mutation({
  args: { serverSecret: v.string(), installationId: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    numericId(args.installationId, "Installation ID")
    const revocation = await ctx.db.query("collaborationInstallationRevocations").withIndex("by_installation", q => q.eq("installationId", args.installationId)).unique()
    const revokedAt = Date.now()
    if (revocation) await ctx.db.patch(revocation._id, { revokedAt })
    else await ctx.db.insert("collaborationInstallationRevocations", { installationId: args.installationId, revokedAt })
    return { revoked: true }

  },
})

export const recordBranchResolutionFromServer = mutation({
  args: { serverSecret: v.string(), identityKey: v.string(), projectId: v.id("projects"), bindingId: v.id("collaborationRepositoryBindings"), branch: v.string(), commitSha: v.string() },
  handler: async (ctx, args) => {
    assertGatewaySecret(args.serverSecret)
    const user = await ctx.db.query("users").withIndex("by_identity_key", q => q.eq("identityKey", args.identityKey)).unique()
    const binding = await ctx.db.get(args.bindingId)
    if (!user || user.status === "revoked" || !binding || binding.projectId !== args.projectId || !await canReadBinding(ctx, binding, user._id)) throw new ConvexError("Repository access denied")
    const branch = gitBranch(args.branch, "Branch")
    const commitSha = assertGitCommitSha(args.commitSha)
    return await ctx.db.insert("collaborationRepositoryResolutions", {
      projectId: args.projectId, userId: user._id, bindingId: binding._id,
      repositoryId: binding.repositoryId, branch, commitSha, expiresAt: Date.now() + 5 * 60_000,
    })
  },
})
