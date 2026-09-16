"use node"

import { sign } from "node:crypto"
import { ConvexError, v } from "convex/values"
import { action, type ActionCtx } from "./_generated/server"
import { internal } from "./_generated/api"
import { requestGitHubJson } from "../shared/github/apiFetch"
import type { Id } from "./_generated/dataModel"

interface CredentialScope {
  projectId: Id<"projects">
  repositoryUrl: string
}

interface RepositoryGrant { projectId: string; repositoryUrl: string; installationId: number; repositoryId: number; allowGitWrite?: boolean }

/** Operator-provisioned bindings prevent project editors from selecting another installation repo. */
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
  const normalizedKey = privateKey.replace(/\\n/g, "\n")
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: appId })}`
  const jwt = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), normalizedKey).toString("base64url")}`
  // Shares the bounded, redirect-refusing reader with every other GitHub call.
  // An empty answer collapses to {}, which the validation below rejects for the
  // same reason a malformed one is rejected: no usable token in it.
  const result = ((await requestGitHubJson(
    `https://api.github.com/app/installations/${grant.installationId}/access_tokens`,
    {
      token: jwt,
      body: {
        repository_ids: [grant.repositoryId],
        permissions: purpose === "git_write" ? { contents: "write" } : { contents: "read", pull_requests: "write" },
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

function issueForSession(purpose: "pull_request" | "git_write") {
  return async (
    ctx: ActionCtx,
    args: { publicSessionId: string },
  ): Promise<{ token: string; expiresAt: number; repositoryUrl: string; projectId: Id<"projects"> }> => {
    const before = (await ctx.runQuery(internal.collaborationSessions.repositoryCredentialScope, args)) as CredentialScope
    try {
      const grant = repositoryGrant(process.env.COZEA_GITHUB_REPOSITORY_GRANTS ?? "[]", before.projectId, before.repositoryUrl)
      const appId = process.env.COZEA_GITHUB_APP_ID ?? process.env.GITHUB_SOURCE_CONTROL_APP_ID
      const privateKey = (process.env.COZEA_GITHUB_APP_PRIVATE_KEY ?? process.env.GITHUB_SOURCE_CONTROL_APP_PRIVATE_KEY)?.replace(/\\n/g, "\n")
      if (!appId || !privateKey) throw new Error("Not configured")
      const issued = await issueRepositoryInstallationToken(grant, appId, privateKey, fetch, purpose)
      const after = (await ctx.runQuery(internal.collaborationSessions.repositoryCredentialScope, args)) as CredentialScope
      if (after.projectId !== before.projectId || after.repositoryUrl !== before.repositoryUrl) throw new Error("Repository binding changed")
      return { ...issued, repositoryUrl: before.repositoryUrl, projectId: before.projectId }
    } catch { throw new ConvexError("Background repository authorization is unavailable. Ask a project operator to verify its GitHub App binding.") }
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
      const grant = repositoryGrant(process.env.COZEA_GITHUB_REPOSITORY_GRANTS ?? "[]", before.projectId, before.repositoryUrl)
      const appId = process.env.COZEA_GITHUB_APP_ID ?? process.env.GITHUB_SOURCE_CONTROL_APP_ID
      const privateKey = process.env.COZEA_GITHUB_APP_PRIVATE_KEY ?? process.env.GITHUB_SOURCE_CONTROL_APP_PRIVATE_KEY
      const configured = Boolean(appId && privateKey)
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
