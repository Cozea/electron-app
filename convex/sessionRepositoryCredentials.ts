"use node"

import { ConvexError, v } from "convex/values"
import { action, type ActionCtx } from "./_generated/server"
import { internal } from "./_generated/api"
import { GitHubApiError, requestGitHubJson } from "../shared/github/apiFetch"
import type { Id } from "./_generated/dataModel"
import { githubAppCredentials, signGitHubAppJwt } from "./lib/githubAppAuth"

interface CredentialScope {
  projectId: Id<"projects">
  repositoryUrl: string
}

interface RepositoryGrant { projectId: string; repositoryUrl: string; installationId: number; repositoryId: number; allowGitWrite?: boolean }

/**
 * Operator-provisioned bindings, from before repositories were linked through GitHub
 * (githubLinks.ts). Still honoured for projects that haven't been linked.
 */
export function repositoryGrant(raw: string, projectId: string, repositoryUrl: string): RepositoryGrant {
  const grants: unknown = JSON.parse(raw)
  if (!Array.isArray(grants)) throw new Error("Invalid repository grants")
  const matches = grants.filter((item): item is RepositoryGrant => Boolean(item && typeof item === "object" && item.projectId === projectId && item.repositoryUrl === repositoryUrl))
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0]!.installationId) || matches[0]!.installationId <= 0 ||
    !Number.isSafeInteger(matches[0]!.repositoryId) || matches[0]!.repositoryId <= 0) throw new Error("Repository is not provisioned")
  return matches[0]!
}

export async function issueRepositoryInstallationToken(grant: RepositoryGrant, appId: string, privateKey: string, fetchFn: typeof fetch = fetch, purpose: "pull_request" | "git_write" = "pull_request") {
  if (purpose === "git_write" && grant.allowGitWrite !== true) throw new Error("Git write access is not provisioned")
  const jwt = signGitHubAppJwt({ appId, privateKey: privateKey.replace(/\\n/g, "\n") })
  // Shares the bounded, redirect-refusing reader with every other GitHub call.
  // An empty answer collapses to {}, which the validation below rejects for the
  // same reason a malformed one is rejected: no usable token in it.
  const result = ((await requestGitHubJson(
    `https://api.github.com/app/installations/${grant.installationId}/access_tokens`,
    {
      token: jwt,
      body: {
        repository_ids: [grant.repositoryId],
        // A push that changes .github/workflows is refused without workflows access.
        permissions: purpose === "git_write" ? { contents: "write", workflows: "write" } : { contents: "read", pull_requests: "write" },
      },
      maxBytes: 64 * 1024,
      timeoutMs: 15_000,
      fetchFn,
    },
  )) ?? {}) as { token?: unknown; expires_at?: string }
  const expiresAt = Date.parse(result.expires_at ?? "")
  if (typeof result.token !== "string" || !result.token || result.token.length > 16000 || !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() || expiresAt > Date.now() + 65 * 60_000) throw new Error("Invalid GitHub authorization response")
  return { token: result.token, expiresAt }
}

// Refusals this module raises itself; their wording carries no ids, keys or tokens.
const KNOWN_REFUSALS = new Set([
  "Invalid repository grants", "Repository is not provisioned", "Not configured",
  "Git write access is not provisioned", "Invalid GitHub authorization response", "Repository binding changed",
])

/** Which step refused, for the operator's logs; the caller only ever sees one generic message. */
export function describeRefusal(error: unknown): string {
  if (error instanceof GitHubApiError) return error.status === null ? "GitHub request failed" : `GitHub answered ${error.status}`
  if (error instanceof SyntaxError) return "Invalid repository grants"
  return error instanceof Error && KNOWN_REFUSALS.has(error.message) ? error.message : "Unexpected failure"
}

/** A repository linked through GitHub, or else one the operator listed in COZEA_GITHUB_REPOSITORY_GRANTS. */
async function grantForScope(ctx: ActionCtx, scope: CredentialScope): Promise<RepositoryGrant> {
  const linked = await ctx.runQuery(internal.githubLinks.grantFor, scope)
  return linked ?? repositoryGrant(process.env.COZEA_GITHUB_REPOSITORY_GRANTS ?? "[]", scope.projectId, scope.repositoryUrl)
}

function issueForSession(purpose: "pull_request" | "git_write") {
  return async (
    ctx: ActionCtx,
    args: { publicSessionId: string },
  ): Promise<{ token: string; expiresAt: number; repositoryUrl: string; projectId: Id<"projects"> }> => {
    const before = (await ctx.runQuery(internal.collaborationSessions.repositoryCredentialScope, args)) as CredentialScope
    try {
      const grant = await grantForScope(ctx, before)
      const credentials = githubAppCredentials()
      if (!credentials) throw new Error("Not configured")
      const issued = await issueRepositoryInstallationToken(grant, credentials.appId, credentials.privateKey, fetch, purpose)
      const after = (await ctx.runQuery(internal.collaborationSessions.repositoryCredentialScope, args)) as CredentialScope
      if (after.projectId !== before.projectId || after.repositoryUrl !== before.repositoryUrl) throw new Error("Repository binding changed")
      return { ...issued, repositoryUrl: before.repositoryUrl, projectId: before.projectId }
    } catch (error) {
      console.warn(`[sessionRepositoryCredentials] ${purpose} token refused for ${args.publicSessionId}: ${describeRefusal(error)}`)
      throw new ConvexError("Background repository authorization is unavailable. Ask a project operator to verify its GitHub App binding.")
    }
  }
}

const tokenResult = v.object({ token: v.string(), expiresAt: v.number(), repositoryUrl: v.string(), projectId: v.id("projects") })
const capabilityResult = v.object({
  repositoryUrl: v.string(),
  projectId: v.id("projects"),
  pullRequest: v.boolean(),
  gitWrite: v.boolean(),
})

/**
 * Authenticated capability discovery for the canonical session repository. This does
 * not contact GitHub or mint an installation token; it only reports whether the
 * operator provisioned the exact binding and app credentials needed for each action.
 */
export const capabilities = action({
  args: { publicSessionId: v.string() },
  returns: capabilityResult,
  handler: async (
    ctx,
    args,
  ): Promise<{ repositoryUrl: string; projectId: Id<"projects">; pullRequest: boolean; gitWrite: boolean }> => {
    const before = (await ctx.runQuery(internal.collaborationSessions.repositoryCredentialScope, args)) as CredentialScope
    let pullRequest = false
    let gitWrite = false
    try {
      const grant = await grantForScope(ctx, before)
      const configured = githubAppCredentials() !== null
      pullRequest = configured
      gitWrite = configured && grant.allowGitWrite === true
    } catch {
      // An authorized session may learn only that this exact canonical repository is
      // not provisioned. Installation ids, repository ids and app secrets stay server-side.
    }
    const after = (await ctx.runQuery(internal.collaborationSessions.repositoryCredentialScope, args)) as CredentialScope
    if (after.projectId !== before.projectId || after.repositoryUrl !== before.repositoryUrl) {
      throw new ConvexError("Repository binding changed while checking capabilities.")
    }
    return { repositoryUrl: before.repositoryUrl, projectId: before.projectId, pullRequest, gitWrite }
  },
})

export const forPullRequest = action({
  args: { publicSessionId: v.string() }, returns: tokenResult,
  handler: issueForSession("pull_request"),
})

export const forGitWrite = action({
  args: { publicSessionId: v.string() }, returns: tokenResult,
  handler: issueForSession("git_write"),
})
