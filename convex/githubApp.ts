"use node"

/**
 * Talks to GitHub for the cozea-source-control app: connecting a person's GitHub
 * account, linking a project's repository, and keeping installations current.
 *
 * Linking trusts only what GitHub answers. The app's JWT asks where the app is
 * installed; an installation token reads the repository; and the person's own
 * verified login is checked against the repository's collaborators. The person's
 * user token is used once to learn who they are and never stored.
 *
 * Convex state lives in githubLinks.ts; http.ts routes GitHub's callback and
 * webhook here.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { ConvexError, v } from "convex/values"

import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { action, internalAction, type ActionCtx } from "./_generated/server"
import { githubAppClient, githubAppCredentials, signGitHubAppJwt, type GitHubAppCredentials } from "./lib/githubAppAuth"
import { GitHubApiError, requestGitHubJson } from "../shared/github/apiFetch"
import { parseGitHubRepository } from "../shared/git/githubRepository"
import { githubAppInstallUrl } from "../shared/github/sourceControlApp"

const USER_AGENT = "cozea-source-control"
const API = "https://api.github.com"

export type LinkResult =
  | { status: "linked"; owner: string; name: string }
  | { status: "not_allowed" }
  | { status: "not_github" }
  | { status: "needs_github_account" }
  | { status: "not_installed"; owner: string; name: string }
  | { status: "no_push_access"; login: string; owner: string; name: string }
  | { status: "not_configured" }

/** What linking needs from its surroundings; tests pass fakes. */
export interface GitHubLinkDeps {
  runQuery: ActionCtx["runQuery"]
  runMutation: ActionCtx["runMutation"]
  credentials: GitHubAppCredentials | null
  fetchFn?: typeof fetch
}

interface GitHubInstallation {
  id: number
  account: { id: number; login: string; type: string } | null
  repository_selection?: string
  suspended_at?: string | null
}

function github(path: string, token: string, fetchFn?: typeof fetch, body?: unknown) {
  return requestGitHubJson(`${API}${path}`, { token, body, userAgent: USER_AGENT, timeoutMs: 15_000, fetchFn })
}

function isStatus(error: unknown, ...statuses: number[]): boolean {
  return error instanceof GitHubApiError && error.status !== null && statuses.includes(error.status)
}

async function saveInstallation(deps: GitHubLinkDeps, installation: GitHubInstallation): Promise<void> {
  if (!installation.account) return
  await deps.runMutation(internal.githubLinks.upsertInstallation, {
    installationId: installation.id,
    accountId: installation.account.id,
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    repositorySelection: installation.repository_selection ?? "selected",
    suspended: Boolean(installation.suspended_at),
  })
}

/**
 * Links a project's repository for a principal whose identity is already settled:
 * the app must be installed on it and the principal's GitHub login must be able to push.
 */
export async function linkRepositoryFor(
  deps: GitHubLinkDeps,
  principalId: Id<"devicePrincipals">,
  projectId: Id<"projects">,
): Promise<LinkResult> {
  const context = await deps.runQuery(internal.githubLinks.linkContext, { principalId, projectId })
  if (!context.canEdit) return { status: "not_allowed" }
  if (!context.repository) return { status: "not_github" }
  if (!context.accountLogin) return { status: "needs_github_account" }
  if (!deps.credentials) return { status: "not_configured" }
  const { owner, name } = context.repository
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`

  let installation: GitHubInstallation
  try {
    installation = (await github(`${repoPath}/installation`, signGitHubAppJwt(deps.credentials), deps.fetchFn)) as GitHubInstallation
  } catch (error) {
    // GitHub answers 404 both when the app isn't installed on the owner and when
    // the installation doesn't include this repository.
    if (isStatus(error, 404)) return { status: "not_installed", owner, name }
    throw error
  }
  await saveInstallation(deps, installation)

  const access = (await github(
    `/app/installations/${installation.id}/access_tokens`,
    signGitHubAppJwt(deps.credentials),
    deps.fetchFn,
    { repositories: [name], permissions: { metadata: "read" } },
  )) as { token?: unknown }
  if (typeof access.token !== "string" || !access.token) throw new Error("Invalid GitHub authorization response")

  const repository = (await github(repoPath, access.token, deps.fetchFn)) as { id?: unknown; name?: unknown; owner?: { login?: unknown } }
  if (typeof repository.id !== "number" || typeof repository.name !== "string" || typeof repository.owner?.login !== "string") {
    throw new Error("Invalid GitHub repository response")
  }

  let permission: string | null = null
  try {
    const answer = (await github(
      `${repoPath}/collaborators/${encodeURIComponent(context.accountLogin)}/permission`,
      access.token,
      deps.fetchFn,
    )) as { permission?: unknown }
    permission = typeof answer.permission === "string" ? answer.permission : null
  } catch (error) {
    // Someone GitHub doesn't count as a collaborator at all.
    if (!isStatus(error, 403, 404)) throw error
  }
  if (permission !== "admin" && permission !== "write") {
    return { status: "no_push_access", login: context.accountLogin, owner, name }
  }

  await deps.runMutation(internal.githubLinks.saveGrant, {
    projectId,
    owner: repository.owner.login,
    name: repository.name,
    repositoryUrl: context.repository.url,
    repositoryId: repository.id,
    installationId: installation.id,
    linkedByPrincipalId: principalId,
  })
  return { status: "linked", owner: repository.owner.login, name: repository.name }
}

/** GitHub's signature over a webhook body, compared in constant time. */
export function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`
  const given = Buffer.from(signature, "utf8")
  const wanted = Buffer.from(expected, "utf8")
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

// ─── For people ───────────────────────────────────────────────────────────────

/**
 * Where to send the person on GitHub: installing the app, or only signing in when it
 * is installed already. GitHub returns to the callback with the state made here.
 */
export const startConnect = action({
  args: {
    mode: v.union(v.literal("install"), v.literal("sign_in")),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const { principalId } = await ctx.runQuery(internal.githubLinks.viewer, { projectId: args.projectId })
    const state = randomBytes(24).toString("base64url")
    await ctx.runMutation(internal.githubLinks.createLinkRequest, { state, principalId, projectId: args.projectId })
    if (args.mode === "install") return { url: githubAppInstallUrl(state) }
    const client = githubAppClient()
    if (!client) throw new ConvexError("GitHub sign-in isn't configured on this deployment.")
    const url = new URL("https://github.com/login/oauth/authorize")
    url.searchParams.set("client_id", client.clientId)
    url.searchParams.set("state", state)
    return { url: url.toString() }
  },
})

/** Links the project's repository now, for someone whose GitHub account Cozea already knows. */
export const linkProjectRepository = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<LinkResult> => {
    const { principalId } = await ctx.runQuery(internal.githubLinks.viewer, { projectId: args.projectId })
    return await linkRepositoryFor(
      { runQuery: ctx.runQuery, runMutation: ctx.runMutation, credentials: githubAppCredentials() },
      principalId,
      args.projectId,
    )
  },
})

/** Reads every installation of the app from GitHub, for installations made before the webhook knew. */
export const syncInstallations = action({
  args: {},
  handler: async (ctx): Promise<{ installations: number }> => {
    await ctx.runQuery(internal.githubLinks.viewer, {})
    const credentials = githubAppCredentials()
    if (!credentials) return { installations: 0 }
    const deps = { runQuery: ctx.runQuery, runMutation: ctx.runMutation, credentials }
    let count = 0
    for (let page = 1; page <= 10; page += 1) {
      const installations = (await github(`/app/installations?per_page=100&page=${page}`, signGitHubAppJwt(credentials))) as GitHubInstallation[]
      if (!Array.isArray(installations)) break
      for (const installation of installations) await saveInstallation(deps, installation)
      count += installations.length
      if (installations.length < 100) break
    }
    return { installations: count }
  },
})

// ─── For http.ts ──────────────────────────────────────────────────────────────

export type CallbackResult =
  | { ok: true; login: string | null; link: LinkResult | null }
  | { ok: false; reason: "expired" | "not_configured" | "github_refused" }

/** Where GitHub returns after installing the app or signing in. */
export const completeCallback = internalAction({
  args: {
    state: v.string(),
    code: v.optional(v.string()),
    installationId: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CallbackResult> => {
    const request = await ctx.runMutation(internal.githubLinks.consumeLinkRequest, { state: args.state })
    if (!request) return { ok: false, reason: "expired" }
    const credentials = githubAppCredentials()
    const deps: GitHubLinkDeps = { runQuery: ctx.runQuery, runMutation: ctx.runMutation, credentials }

    let login: string | null = null
    if (args.code) {
      const client = githubAppClient()
      if (!client) return { ok: false, reason: "not_configured" }
      try {
        const exchanged = (await requestGitHubJson("https://github.com/login/oauth/access_token", {
          body: { client_id: client.clientId, client_secret: client.clientSecret, code: args.code },
          headers: { accept: "application/json" },
          userAgent: USER_AGENT,
          timeoutMs: 15_000,
        })) as { access_token?: unknown }
        if (typeof exchanged.access_token !== "string" || !exchanged.access_token) return { ok: false, reason: "github_refused" }
        const user = (await github("/user", exchanged.access_token)) as { id?: unknown; login?: unknown }
        if (typeof user.id !== "number" || typeof user.login !== "string") return { ok: false, reason: "github_refused" }
        login = user.login
        await ctx.runMutation(internal.githubLinks.saveAccount, { principalId: request.principalId, githubUserId: user.id, login })
      } catch (error) {
        console.warn(`[githubApp] sign-in refused: ${error instanceof GitHubApiError ? error.message : "unexpected failure"}`)
        return { ok: false, reason: "github_refused" }
      }
    }

    // The installation id in the URL is only a hint; GitHub confirms it with the app's own JWT.
    if (args.installationId !== undefined && credentials) {
      try {
        await saveInstallation(deps, (await github(`/app/installations/${args.installationId}`, signGitHubAppJwt(credentials))) as GitHubInstallation)
      } catch (error) {
        if (!isStatus(error, 404)) throw error
      }
    }

    const link = request.projectId ? await linkRepositoryFor(deps, request.principalId, request.projectId) : null
    return { ok: true, login, link }
  },
})

export const handleWebhook = internalAction({
  args: { body: v.string(), signature: v.string(), event: v.string() },
  handler: async (ctx, args): Promise<{ accepted: boolean }> => {
    const secret = process.env.COZEA_GITHUB_WEBHOOK_SECRET
    if (!secret || !verifyWebhookSignature(args.body, args.signature, secret)) return { accepted: false }
    const payload = JSON.parse(args.body) as {
      action?: string
      installation?: GitHubInstallation
      repositories_removed?: { id: number }[]
    }
    const installation = payload.installation
    if (!installation || typeof installation.id !== "number") return { accepted: true }
    const deps: GitHubLinkDeps = { runQuery: ctx.runQuery, runMutation: ctx.runMutation, credentials: null }

    if (args.event === "installation") {
      if (payload.action === "deleted") {
        await ctx.runMutation(internal.githubLinks.removeInstallation, { installationId: installation.id })
      } else if (payload.action === "suspend" || payload.action === "unsuspend") {
        await ctx.runMutation(internal.githubLinks.setInstallationSuspended, {
          installationId: installation.id,
          suspended: payload.action === "suspend",
        })
      } else {
        await saveInstallation(deps, installation)
      }
    } else if (args.event === "installation_repositories") {
      await saveInstallation(deps, installation)
      const removed = (payload.repositories_removed ?? []).map((repository) => repository.id).filter(Number.isSafeInteger)
      if (removed.length > 0) {
        await ctx.runMutation(internal.githubLinks.revokeRepositories, { installationId: installation.id, repositoryIds: removed })
      }
    }
    return { accepted: true }
  },
})

/**
 * Moves the operator's COZEA_GITHUB_REPOSITORY_GRANTS into linked grants, so they show
 * as linked in Cozea. Run once: `npx convex run githubApp:importEnvironmentGrants --prod`.
 */
export const importEnvironmentGrants = internalAction({
  args: {},
  handler: async (ctx): Promise<{ imported: number }> => {
    const credentials = githubAppCredentials()
    if (!credentials) throw new Error("The GitHub App isn't configured")
    const grants = JSON.parse(process.env.COZEA_GITHUB_REPOSITORY_GRANTS ?? "[]") as {
      projectId: Id<"projects">; repositoryUrl: string; installationId: number; repositoryId: number; allowGitWrite?: boolean
    }[]
    const deps: GitHubLinkDeps = { runQuery: ctx.runQuery, runMutation: ctx.runMutation, credentials }
    let imported = 0
    for (const grant of grants) {
      const installation = (await github(`/app/installations/${grant.installationId}`, signGitHubAppJwt(credentials))) as GitHubInstallation
      await saveInstallation(deps, installation)
      const parsed = parseGitHubRepository(grant.repositoryUrl)
      if (!parsed) continue
      await ctx.runMutation(internal.githubLinks.saveGrant, {
        projectId: grant.projectId,
        owner: parsed.owner,
        name: parsed.repository,
        repositoryUrl: grant.repositoryUrl,
        repositoryId: grant.repositoryId,
        installationId: grant.installationId,
        allowGitWrite: grant.allowGitWrite === true,
      })
      imported += 1
    }
    return { imported }
  },
})
