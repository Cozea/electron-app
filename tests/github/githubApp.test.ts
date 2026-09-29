import { createHmac, generateKeyPairSync } from "node:crypto"
import { getFunctionName } from "convex/server"
import { describe, expect, it } from "vitest"

import { linkRepositoryFor, verifyWebhookSignature, type GitHubLinkDeps } from "../../convex/githubApp"
import { describeCallbackResult } from "../../convex/githubCallbackPage"

/**
 * Linking a project's repository trusts only GitHub's answers: where the app is
 * installed, the repository's id, and whether the person's verified login can push.
 */

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString()
const REPOSITORY = { owner: "Team", name: "App", url: "https://github.com/Team/App.git", key: "team/app" }

function setup(options: {
  context?: Partial<{ canEdit: boolean; repository: typeof REPOSITORY | null; accountLogin: string | null }>
  github?: Record<string, { status: number; body?: unknown }>
} = {}) {
  const mutations: { name: string; args: Record<string, unknown> }[] = []
  const requests: { url: string; authorization: string | null; body: unknown }[] = []
  const routes: Record<string, { status: number; body?: unknown }> = {
    "GET /repos/Team/App/installation": { status: 200, body: { id: 7, account: { id: 1, login: "Team", type: "Organization" }, repository_selection: "selected" } },
    "POST /app/installations/7/access_tokens": { status: 201, body: { token: "installation-token" } },
    "GET /repos/Team/App": { status: 200, body: { id: 99, name: "App", owner: { login: "Team" } } },
    "GET /repos/Team/App/collaborators/kel/permission": { status: 200, body: { permission: "write" } },
    ...options.github,
  }
  const fetchFn = (async (input, init) => {
    const url = new URL(String(input))
    const key = `${init?.method ?? "GET"} ${url.pathname}`
    requests.push({ url: key, authorization: new Headers(init?.headers).get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null })
    const route = routes[key]
    if (!route) return new Response("not found", { status: 404 })
    return Response.json(route.body ?? {}, { status: route.status })
  }) as typeof fetch
  const deps: GitHubLinkDeps = {
    runQuery: (async (reference: unknown) => {
      expect(getFunctionName(reference as never)).toBe("githubLinks:linkContext")
      return { canEdit: true, repository: REPOSITORY, accountLogin: "kel", ...options.context }
    }) as never,
    runMutation: (async (reference: unknown, args: Record<string, unknown>) => {
      mutations.push({ name: getFunctionName(reference as never), args })
      return null
    }) as never,
    credentials: { appId: "3150202", privateKey },
    fetchFn,
  }
  return { deps, mutations, requests }
}

const PRINCIPAL = "devicePrincipals|1" as never
const PROJECT = "projects|2" as never

describe("linking a project's repository", () => {
  it("records what GitHub confirmed, with a token scoped to reading that one repository", async () => {
    const { deps, mutations, requests } = setup()
    expect(await linkRepositoryFor(deps, PRINCIPAL, PROJECT)).toEqual({ status: "linked", owner: "Team", name: "App" })

    const tokenRequest = requests.find((request) => request.url === "POST /app/installations/7/access_tokens")
    expect(tokenRequest?.body).toEqual({ repositories: ["App"], permissions: { metadata: "read" } })
    expect(requests.find((request) => request.url === "GET /repos/Team/App")?.authorization).toBe("Bearer installation-token")
    expect(mutations.map((mutation) => mutation.name)).toEqual(["githubLinks:upsertInstallation", "githubLinks:saveGrant"])
    expect(mutations[1]!.args).toMatchObject({ projectId: PROJECT, repositoryId: 99, installationId: 7, linkedByPrincipalId: PRINCIPAL })
  })

  it("says what's missing instead of linking", async () => {
    expect(await linkRepositoryFor(setup({ context: { canEdit: false } }).deps, PRINCIPAL, PROJECT)).toEqual({ status: "not_allowed" })
    expect(await linkRepositoryFor(setup({ context: { repository: null } }).deps, PRINCIPAL, PROJECT)).toEqual({ status: "not_github" })
    expect(await linkRepositoryFor(setup({ context: { accountLogin: null } }).deps, PRINCIPAL, PROJECT)).toEqual({ status: "needs_github_account" })

    const notInstalled = setup({ github: { "GET /repos/Team/App/installation": { status: 404 } } })
    expect(await linkRepositoryFor(notInstalled.deps, PRINCIPAL, PROJECT)).toEqual({ status: "not_installed", owner: "Team", name: "App" })
    expect(notInstalled.mutations).toEqual([])

    for (const answer of [{ status: 200, body: { permission: "read" } }, { status: 404 }]) {
      const readOnly = setup({ github: { "GET /repos/Team/App/collaborators/kel/permission": answer } })
      expect(await linkRepositoryFor(readOnly.deps, PRINCIPAL, PROJECT)).toMatchObject({ status: "no_push_access", login: "kel" })
      expect(readOnly.mutations.map((mutation) => mutation.name)).not.toContain("githubLinks:saveGrant")
    }
  })

  it("doesn't mistake GitHub failing for a missing installation", async () => {
    const { deps } = setup({ github: { "GET /repos/Team/App/installation": { status: 502 } } })
    await expect(linkRepositoryFor(deps, PRINCIPAL, PROJECT)).rejects.toThrow("GitHub answered 502")
  })
})

describe("GitHub's webhook signature", () => {
  it("accepts only the body GitHub signed with the shared secret", () => {
    const body = JSON.stringify({ action: "deleted", installation: { id: 7 } })
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`
    expect(verifyWebhookSignature(body, signature, "secret")).toBe(true)
    expect(verifyWebhookSignature(body, signature, "other")).toBe(false)
    expect(verifyWebhookSignature(`${body} `, signature, "secret")).toBe(false)
    expect(verifyWebhookSignature(body, "sha256=short", "secret")).toBe(false)
  })
})

describe("the page GitHub sends people back to", () => {
  it("says what happened without echoing markup", () => {
    expect(describeCallbackResult({ ok: true, login: "kel", link: { status: "linked", owner: "Team", name: "App" } }))
      .toContain("Team/App is linked")
    expect(describeCallbackResult({ ok: true, login: "<b>x</b>", link: null })).not.toContain("<b>")
    expect(describeCallbackResult({ ok: false, reason: "expired" })).toContain("This link has expired")
  })
})
