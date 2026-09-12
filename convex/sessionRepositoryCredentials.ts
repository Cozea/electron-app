"use node"

import { sign } from "node:crypto"
import { ConvexError, v } from "convex/values"
import { action, type ActionCtx } from "./_generated/server"
import { internal } from "./_generated/api"

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
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: appId })}`
  const jwt = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`
  const response = await fetchFn(`https://api.github.com/app/installations/${grant.installationId}/access_tokens`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ repository_ids: [grant.repositoryId], permissions: purpose === "git_write" ? { contents: "write" } : { contents: "read", pull_requests: "write" } }),
  })
  if (!response.ok) { await response.body?.cancel(); throw new Error("GitHub authorization failed") }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("GitHub authorization failed")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 64 * 1024) throw new Error("Invalid GitHub authorization response")
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { token?: unknown; expires_at?: string }
  const expiresAt = Date.parse(result.expires_at ?? "")
  if (typeof result.token !== "string" || !result.token || result.token.length > 16000 || !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() || expiresAt > Date.now() + 65 * 60_000) throw new Error("Invalid GitHub authorization response")
  return { token: result.token, expiresAt }
}

function issueForSession(purpose: "pull_request" | "git_write") {
  return async (ctx: ActionCtx, args: { publicSessionId: string }) => {
    const before = await ctx.runQuery(internal.collaborationSessions.repositoryCredentialScope, args)
    try {
      const grant = repositoryGrant(process.env.COZEA_GITHUB_REPOSITORY_GRANTS ?? "[]", before.projectId, before.repositoryUrl)
      const appId = process.env.COZEA_GITHUB_APP_ID
      const privateKey = process.env.COZEA_GITHUB_APP_PRIVATE_KEY
      if (!appId || !privateKey) throw new Error("Not configured")
      const issued = await issueRepositoryInstallationToken(grant, appId, privateKey, fetch, purpose)
      const after = await ctx.runQuery(internal.collaborationSessions.repositoryCredentialScope, args)
      if (after.projectId !== before.projectId || after.repositoryUrl !== before.repositoryUrl) throw new Error("Repository binding changed")
      return { ...issued, repositoryUrl: before.repositoryUrl, projectId: before.projectId }
    } catch { throw new ConvexError("Background repository authorization is unavailable. Ask a project operator to verify its GitHub App binding.") }
  }
}

const tokenResult = v.object({ token: v.string(), expiresAt: v.number(), repositoryUrl: v.string(), projectId: v.id("projects") })

export const forPullRequest = action({
  args: { publicSessionId: v.string() }, returns: tokenResult,
  handler: issueForSession("pull_request"),
})

export const forGitWrite = action({
  args: { publicSessionId: v.string() }, returns: tokenResult,
  handler: issueForSession("git_write"),
})
