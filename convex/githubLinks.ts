/**
 * Which GitHub repositories Cozea may write to, and how a person links one.
 *
 * A project's repository is linked once GitHub has confirmed two things: the
 * cozea-source-control app is installed on it, and the person linking can push to
 * it (see githubApp.ts, which talks to GitHub). The grant that results is what
 * sessionRepositoryCredentials issues session Git tokens against. Linking allows
 * Git writes straight away; a project manager can unlink.
 *
 * Everything here reads or writes Convex only. Functions that answer a person act
 * for the authenticated device; internal ones are called by githubApp.ts with the
 * principal it already checked.
 */

import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import { canAccessProject, canEditProject, canManageProject } from "./lib/projectAccess"
import { normalizeSessionRepositoryUrl } from "../shared/collaboration/repositoryUrl"
import { parseGitHubRepository } from "../shared/git/githubRepository"
import { githubRepositoryKey } from "../shared/github/sourceControlApp"

type ReadCtx = QueryCtx | MutationCtx

/** A single trip to GitHub and back should take minutes, not hours. */
export const LINK_REQUEST_TTL_MS = 15 * 60_000

export interface ProjectGitHubRepository {
  owner: string
  name: string
  url: string
  key: string
}

/** The project's GitHub repository, or null when it has none or it isn't on GitHub. */
export async function projectGitHubRepository(ctx: ReadCtx, projectId: Id<"projects">): Promise<ProjectGitHubRepository | null> {
  const project = await ctx.db.get(projectId)
  if (project?.repo?.provider !== "github") return null
  const url = normalizeSessionRepositoryUrl(project.repo.url)
  const parsed = url ? parseGitHubRepository(url) : null
  if (!url || !parsed) return null
  return { owner: parsed.owner, name: parsed.repository, url, key: githubRepositoryKey(parsed.owner, parsed.repository) }
}

async function activeGrant(ctx: ReadCtx, projectId: Id<"projects">, repositoryKey: string): Promise<Doc<"githubRepositoryGrants"> | null> {
  const grants = await ctx.db
    .query("githubRepositoryGrants")
    .withIndex("by_project_and_repository", (q) => q.eq("projectId", projectId).eq("repositoryKey", repositoryKey))
    .collect()
  return grants.find((grant) => grant.revokedAt === undefined) ?? null
}

async function installationById(ctx: ReadCtx, installationId: number): Promise<Doc<"githubInstallations"> | null> {
  return await ctx.db
    .query("githubInstallations")
    .withIndex("by_installation", (q) => q.eq("installationId", installationId))
    .unique()
}

/** An installation Cozea may use: not uninstalled and not suspended. */
function isUsable(installation: Doc<"githubInstallations"> | null): boolean {
  return installation !== null && installation.deletedAt === undefined && installation.suspendedAt === undefined
}

async function accountFor(ctx: ReadCtx, principalId: Id<"devicePrincipals">): Promise<Doc<"githubAccounts"> | null> {
  return await ctx.db
    .query("githubAccounts")
    .withIndex("by_principal", (q) => q.eq("principalId", principalId))
    .unique()
}

function presentInstallation(installation: Doc<"githubInstallations">) {
  return {
    installationId: installation.installationId,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    repositorySelection: installation.repositorySelection,
    suspended: installation.suspendedAt !== undefined,
  }
}

// ─── For people ───────────────────────────────────────────────────────────────

/** Whether a project's repository is linked, and what stands in the way when it isn't. */
export const projectRepositoryStatus = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    if (!(await canAccessProject(ctx, args.projectId, caller._id))) {
      throw new ConvexError("The authenticated device cannot access this project")
    }
    const account = await accountFor(ctx, caller._id)
    const repository = await projectGitHubRepository(ctx, args.projectId)
    if (!repository) {
      return { repository: null, linked: false, gitWrite: false, installation: null, account: account ? { login: account.login } : null, canLink: false }
    }
    const grant = await activeGrant(ctx, args.projectId, repository.key)
    const installations = await ctx.db
      .query("githubInstallations")
      .withIndex("by_account", (q) => q.eq("accountKey", repository.owner.toLowerCase()))
      .collect()
    const installation = installations.find((candidate) => candidate.deletedAt === undefined) ?? null
    const linked = grant !== null && isUsable(await installationById(ctx, grant.installationId))
    return {
      repository: { owner: repository.owner, name: repository.name, url: repository.url },
      linked,
      gitWrite: linked && grant!.allowGitWrite,
      installation: installation ? presentInstallation(installation) : null,
      account: account ? { login: account.login } : null,
      canLink: await canEditProject(ctx, args.projectId, caller._id),
    }
  },
})

/** What the GitHub settings page shows: this device's GitHub account, its installations and links. */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const account = await accountFor(ctx, caller._id)
    const grants = (await ctx.db
      .query("githubRepositoryGrants")
      .withIndex("by_linked_by", (q) => q.eq("linkedByPrincipalId", caller._id))
      .collect()).filter((grant) => grant.revokedAt === undefined)

    const installationIds = new Set(grants.map((grant) => grant.installationId))
    const installations: Doc<"githubInstallations">[] = []
    if (account) {
      const own = await ctx.db
        .query("githubInstallations")
        .withIndex("by_account", (q) => q.eq("accountKey", account.login.toLowerCase()))
        .collect()
      installations.push(...own.filter((installation) => installation.deletedAt === undefined))
    }
    for (const installationId of installationIds) {
      if (installations.some((installation) => installation.installationId === installationId)) continue
      const installation = await installationById(ctx, installationId)
      if (installation && installation.deletedAt === undefined) installations.push(installation)
    }

    const repositories = []
    for (const grant of grants) {
      // Links to projects this device can no longer open aren't its to show.
      if (!(await canAccessProject(ctx, grant.projectId, caller._id))) continue
      const project = await ctx.db.get(grant.projectId)
      repositories.push({
        projectId: grant.projectId,
        projectName: project?.name ?? "Project",
        owner: grant.owner,
        name: grant.name,
        gitWrite: grant.allowGitWrite,
        linkedAt: grant.linkedAt,
        usable: isUsable(await installationById(ctx, grant.installationId)),
      })
    }

    return {
      account: account ? { login: account.login, verifiedAt: account.verifiedAt } : null,
      installations: installations.map(presentInstallation),
      repositories,
    }
  },
})

/** Forgets which GitHub account this device signed in as. Links it made stay. */
export const disconnectAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const caller = await requireAuthenticatedDevice(ctx)
    const account = await accountFor(ctx, caller._id)
    if (account) await ctx.db.delete(account._id)
    return null
  },
})

/** Stops Cozea writing to the project's repository until someone links it again. */
export const unlinkRepository = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    if (!(await canManageProject(ctx, args.projectId, caller._id))) {
      throw new ConvexError("Only a project manager can unlink the project's repository")
    }
    const grants = await ctx.db
      .query("githubRepositoryGrants")
      .withIndex("by_project_and_repository", (q) => q.eq("projectId", args.projectId))
      .collect()
    const now = Date.now()
    for (const grant of grants) {
      if (grant.revokedAt === undefined) await ctx.db.patch(grant._id, { revokedAt: now })
    }
    return null
  },
})

// ─── For githubApp.ts ─────────────────────────────────────────────────────────

/** The authenticated device, for actions that must act for it. */
export const viewer = internalQuery({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, args) => {
    const caller = await requireAuthenticatedDevice(ctx)
    if (args.projectId && !(await canAccessProject(ctx, args.projectId, caller._id))) {
      throw new ConvexError("The authenticated device cannot access this project")
    }
    return { principalId: caller._id }
  },
})

/** Everything linking needs to know from Convex, for a principal already identified. */
export const linkContext = internalQuery({
  args: { principalId: v.id("devicePrincipals"), projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const account = await accountFor(ctx, args.principalId)
    return {
      canEdit: await canEditProject(ctx, args.projectId, args.principalId),
      repository: await projectGitHubRepository(ctx, args.projectId),
      accountLogin: account?.login ?? null,
    }
  },
})

export const createLinkRequest = internalMutation({
  args: { state: v.string(), principalId: v.id("devicePrincipals"), projectId: v.optional(v.id("projects")) },
  handler: async (ctx, args) => {
    const now = Date.now()
    await ctx.db.insert("githubLinkRequests", { ...args, createdAt: now, expiresAt: now + LINK_REQUEST_TTL_MS })
    return null
  },
})

/** Uses up a state GitHub sent back; null when it's unknown, used or expired. */
export const consumeLinkRequest = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("githubLinkRequests")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique()
    if (!request || request.consumedAt !== undefined) return null
    const now = Date.now()
    await ctx.db.patch(request._id, { consumedAt: now })
    if (request.expiresAt <= now) return null
    return { principalId: request.principalId, projectId: request.projectId ?? null }
  },
})

export const saveAccount = internalMutation({
  args: { principalId: v.id("devicePrincipals"), githubUserId: v.number(), login: v.string() },
  handler: async (ctx, args) => {
    const existing = await accountFor(ctx, args.principalId)
    const fields = { githubUserId: args.githubUserId, login: args.login, verifiedAt: Date.now() }
    if (existing) await ctx.db.patch(existing._id, fields)
    else await ctx.db.insert("githubAccounts", { principalId: args.principalId, ...fields })
    return null
  },
})

export const upsertInstallation = internalMutation({
  args: {
    installationId: v.number(),
    accountId: v.number(),
    accountLogin: v.string(),
    accountType: v.string(),
    repositorySelection: v.string(),
    suspended: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await installationById(ctx, args.installationId)
    const now = Date.now()
    const fields = {
      accountId: args.accountId,
      accountLogin: args.accountLogin,
      accountKey: args.accountLogin.toLowerCase(),
      accountType: args.accountType,
      repositorySelection: args.repositorySelection,
      suspendedAt: args.suspended ? (existing?.suspendedAt ?? now) : undefined,
      deletedAt: undefined,
      updatedAt: now,
    }
    if (existing) await ctx.db.patch(existing._id, fields)
    else await ctx.db.insert("githubInstallations", { installationId: args.installationId, ...fields })
    return null
  },
})

/** The app was uninstalled: nothing may be written through that installation again. */
export const removeInstallation = internalMutation({
  args: { installationId: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now()
    const installation = await installationById(ctx, args.installationId)
    if (installation) await ctx.db.patch(installation._id, { deletedAt: now, updatedAt: now })
    const grants = await ctx.db
      .query("githubRepositoryGrants")
      .withIndex("by_installation", (q) => q.eq("installationId", args.installationId))
      .collect()
    for (const grant of grants) {
      if (grant.revokedAt === undefined) await ctx.db.patch(grant._id, { revokedAt: now })
    }
    return null
  },
})

export const setInstallationSuspended = internalMutation({
  args: { installationId: v.number(), suspended: v.boolean() },
  handler: async (ctx, args) => {
    const installation = await installationById(ctx, args.installationId)
    if (!installation) return null
    const now = Date.now()
    await ctx.db.patch(installation._id, { suspendedAt: args.suspended ? now : undefined, updatedAt: now })
    return null
  },
})

/** The owner took these repositories out of the installation. */
export const revokeRepositories = internalMutation({
  args: { installationId: v.number(), repositoryIds: v.array(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now()
    for (const repositoryId of args.repositoryIds) {
      const grants = await ctx.db
        .query("githubRepositoryGrants")
        .withIndex("by_repository_id", (q) => q.eq("repositoryId", repositoryId))
        .collect()
      for (const grant of grants) {
        if (grant.installationId === args.installationId && grant.revokedAt === undefined) {
          await ctx.db.patch(grant._id, { revokedAt: now })
        }
      }
    }
    return null
  },
})

export const saveGrant = internalMutation({
  args: {
    projectId: v.id("projects"),
    owner: v.string(),
    name: v.string(),
    repositoryUrl: v.string(),
    repositoryId: v.number(),
    installationId: v.number(),
    linkedByPrincipalId: v.optional(v.id("devicePrincipals")),
    /** Linking through GitHub always allows writes; imported operator grants keep their own setting. */
    allowGitWrite: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const repositoryKey = githubRepositoryKey(args.owner, args.name)
    const fields = {
      repositoryUrl: args.repositoryUrl,
      owner: args.owner,
      name: args.name,
      repositoryId: args.repositoryId,
      installationId: args.installationId,
      allowGitWrite: args.allowGitWrite ?? true,
      linkedByPrincipalId: args.linkedByPrincipalId,
      linkedAt: Date.now(),
    }
    const existing = await activeGrant(ctx, args.projectId, repositoryKey)
    if (existing) await ctx.db.patch(existing._id, fields)
    else await ctx.db.insert("githubRepositoryGrants", { projectId: args.projectId, repositoryKey, ...fields })
    return null
  },
})

/** The grant a session token is issued against, when the project's repository is linked and usable. */
export const grantFor = internalQuery({
  args: { projectId: v.id("projects"), repositoryUrl: v.string() },
  handler: async (ctx, args) => {
    const parsed = parseGitHubRepository(args.repositoryUrl)
    if (!parsed) return null
    const grant = await activeGrant(ctx, args.projectId, githubRepositoryKey(parsed.owner, parsed.repository))
    if (!grant || !isUsable(await installationById(ctx, grant.installationId))) return null
    return {
      projectId: grant.projectId as string,
      repositoryUrl: grant.repositoryUrl,
      installationId: grant.installationId,
      repositoryId: grant.repositoryId,
      allowGitWrite: grant.allowGitWrite,
    }
  },
})
