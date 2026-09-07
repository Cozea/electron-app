#!/usr/bin/env python3
from pathlib import Path


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


write("shared/collaborationRepository.ts", r'''export type CollaborationRepositoryProvider = "github"
export type CollaborationRepositoryCredentialOperation = "read" | "write"

export interface CollaborationRepositoryCredentialRequest {
  projectId: string
  operation: CollaborationRepositoryCredentialOperation
  sessionId?: string
}

export interface CollaborationRepositoryDescriptor {
  provider: CollaborationRepositoryProvider
  repositoryId: string
  repositoryNumericId: string
  installationId: string
  owner: string
  name: string
  fullName: string
  cloneUrl: string
  defaultBranch: string
}

export interface CollaborationRepositoryCredentialResponse {
  repository: CollaborationRepositoryDescriptor
  operation: CollaborationRepositoryCredentialOperation
  username: "x-access-token"
  token: string
  expiresAt: number
}

export interface CollaborationPushVerificationRequest {
  sessionId: string
  commitSha: string
}

export interface CollaborationPushVerificationResponse {
  verified: true
  sessionId: string
  sessionBranch: string
  commitSha: string
  coveredThroughSequence: number
  baseAdvanced: true
}

export function parseGitHubNumericId(value: string): number {
  const normalized = value.trim()
  if (!/^[0-9]+$/.test(normalized)) throw new Error("Invalid GitHub numeric ID")
  const numeric = Number(normalized)
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error("GitHub numeric ID must be a positive safe integer")
  }
  return numeric
}

export function buildCollaborationRepositoryId(repositoryNumericId: string): string {
  const numeric = parseGitHubNumericId(repositoryNumericId)
  return `github:${numeric}`
}

export function parseGitHubRepositoryUrl(value: string): {
  owner: string
  name: string
  fullName: string
  cloneUrl: string
} {
  const url = new URL(value.trim())
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Collaboration repository must be a GitHub HTTPS URL")
  }
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("GitHub repository URL must identify owner/repository")
  }
  const owner = parts[0]
  const name = parts[1].replace(/\.git$/i, "")
  if (!name) throw new Error("GitHub repository name is required")
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    cloneUrl: `https://github.com/${owner}/${name}.git`,
  }
}
''')

write("convex/schema/projectRepositoryAuthorizations.ts", r'''import { defineTable } from "convex/server"
import { v } from "convex/values"

export const repositoryOperationValidator = v.union(v.literal("read"), v.literal("write"))

export const projectRepositoryAuthorizationTables = {
  projectRepositoryAuthorizations: defineTable({
    projectId: v.id("projects"),
    provider: v.literal("github"),
    repositoryNumericId: v.string(),
    installationId: v.string(),
    enabled: v.boolean(),
    configuredByPrincipalId: v.id("devicePrincipals"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_installation_and_repository", ["installationId", "repositoryNumericId"]),

  projectRepositoryAccessEvents: defineTable({
    projectId: v.id("projects"),
    authorizationId: v.id("projectRepositoryAuthorizations"),
    principalId: v.id("devicePrincipals"),
    operation: repositoryOperationValidator,
    sessionId: v.optional(v.id("collaborationSessions")),
    outcome: v.union(v.literal("issued"), v.literal("verified"), v.literal("rejected")),
    tokenExpiresAt: v.optional(v.number()),
    commitSha: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_project_and_created", ["projectId", "createdAt"])
    .index("by_principal_and_created", ["principalId", "createdAt"])
    .index("by_session_and_created", ["sessionId", "createdAt"]),
}
''')

write("convex/projectRepositoryAuthorizations.ts", r'''import { ConvexError, v } from "convex/values"

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
''')

schema_path = Path("convex/schema.ts")
schema = schema_path.read_text()
imp = 'import { projectRepositoryAuthorizationTables } from "./schema/projectRepositoryAuthorizations"\n'
anchor = 'import { collaborationTables } from "./schema/collaboration"\n'
if imp not in schema:
    if anchor not in schema: raise SystemExit("collaboration schema import missing")
    schema = schema.replace(anchor, anchor + imp, 1)
if "  ...projectRepositoryAuthorizationTables," not in schema:
    schema = schema.replace("  ...collaborationTables,\n", "  ...collaborationTables,\n  ...projectRepositoryAuthorizationTables,\n", 1)
schema_path.write_text(schema)

api_path = Path("convex/_generated/api.d.ts")
api = api_path.read_text()
imp = 'import type * as projectRepositoryAuthorizations from "../projectRepositoryAuthorizations.js";\n'
if imp not in api:
    api = api.replace('import type * as projectPresence from "../projectPresence.js";\n', 'import type * as projectPresence from "../projectPresence.js";\n' + imp, 1)
line = "  projectRepositoryAuthorizations: typeof projectRepositoryAuthorizations;\n"
if line not in api:
    api = api.replace("  projectPresence: typeof projectPresence;\n", "  projectPresence: typeof projectPresence;\n" + line, 1)
api_path.write_text(api)

print("PR141 phase 2 canonical repository authorization port applied")
