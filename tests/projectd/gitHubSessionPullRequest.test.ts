import { expect, it, vi } from "vitest"
import { GitHubSessionPullRequest } from "../../apps/projectd/src/autogit/GitHubSessionPullRequest"
import { SessionPullRequestStore } from "../../apps/projectd/src/autogit/SessionPullRequestStore"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"

const input = { remoteUrl: "git@github.com:team/app.git", branch: "feat/live", targetBranch: "main",
  checkpointOid: "a".repeat(40), targetOid: "b".repeat(40) }
const pr = { number: 12, html_url: "https://github.com/team/app/pull/12", state: "open",
  head: { ref: input.branch, sha: input.checkpointOid, repo: { full_name: "team/app" } },
  base: { ref: "main", sha: input.targetOid, repo: { full_name: "team/app" } } }

it("returns the verified created PR and sanitizes provider errors", async () => {
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const pathname = new URL(String(url)).pathname
    if (pathname.includes("/git/ref/")) return Response.json({ object: { sha: pathname.endsWith("main") ? input.targetOid : input.checkpointOid } })
    return Response.json(init?.method === "POST" ? pr : [])
  }) as unknown as typeof fetch
  expect(await new GitHubSessionPullRequest({ getRepositoryToken: async () => "secret", fetchFn }).ensure(input))
    .toEqual({ number: 12, url: pr.html_url, state: "open", created: true })
  const failed = new GitHubSessionPullRequest({ getRepositoryToken: async () => "secret",
    fetchFn: (async () => { throw new Error("provider leaked secret") }) as typeof fetch })
  await expect(failed.ensure(input)).rejects.toThrow("Check repository access")
  await expect(failed.ensure(input)).rejects.not.toThrow("secret")
})

it("recovers a lost create response and reuses the same PR without overwriting metadata", async () => {
  let created = false
  const calls: string[] = []
  const getRepositoryToken = vi.fn(async () => "test-secret")
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const endpoint = new URL(String(url))
    expect(endpoint.origin).toBe("https://api.github.com")
    expect(init?.redirect).toBe("error")
    expect(String(init?.body)).not.toContain("test-secret")
    calls.push(`${init?.method} ${endpoint.pathname}`)
    if (endpoint.pathname.includes("/git/ref/")) return Response.json({ object: { sha: endpoint.pathname.endsWith("main") ? input.targetOid : input.checkpointOid } })
    if (init?.method === "POST") {
      expect(JSON.parse(String(init.body))).toMatchObject({ head: input.branch, base: input.targetBranch })
      created = true
      throw new Error("transport lost test-secret")
    }
    return Response.json(created ? [pr] : [])
  }) as unknown as typeof fetch
  const client = new GitHubSessionPullRequest({ getRepositoryToken, fetchFn })
  expect(await client.ensure(input)).toMatchObject({ number: 12, created: false })
  expect(await client.ensure(input)).toMatchObject({ number: 12, created: false })
  expect(getRepositoryToken).toHaveBeenCalledWith({ owner: "team", repository: "app" })
  expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(1)
})

it("refuses moved refs and untrusted remotes before PR mutation or credential disclosure", async () => {
  const getRepositoryToken = vi.fn(async () => "secret")
  const fetchFn = vi.fn(async () => Response.json({ object: { sha: "c".repeat(40) } })) as unknown as typeof fetch
  const client = new GitHubSessionPullRequest({ getRepositoryToken, fetchFn })
  await expect(client.ensure({ ...input, remoteUrl: "https://github.com.evil.test/team/app.git" })).rejects.toThrow("Unsupported")
  expect(getRepositoryToken).not.toHaveBeenCalled()
  await expect(client.ensure(input)).rejects.toThrow("remote branch moved")
  expect(fetchFn).toHaveBeenCalledTimes(1)
})

it("does not trust a matching PR URL with a different checkpoint", async () => {
  const fetchFn = vi.fn(async (url: string | URL | Request) => {
    const pathname = new URL(String(url)).pathname
    return pathname.includes("/git/ref/") ? Response.json({ object: { sha: pathname.endsWith("main") ? input.targetOid : input.checkpointOid } })
      : Response.json([{ ...pr, head: { ...pr.head, sha: "c".repeat(40) } }])
  }) as unknown as typeof fetch
  await expect(new GitHubSessionPullRequest({ getRepositoryToken: async () => "secret", fetchFn }).ensure(input)).rejects.toThrow("differs from the reviewed")
})

it("discovers PR capability without issuing a repository token", async () => {
  const getRepositoryToken = vi.fn(async () => "secret")
  const getRepositoryCapabilities = vi.fn(async () => ({ pullRequest: false, gitWrite: true }))
  const client = new GitHubSessionPullRequest({ getRepositoryToken, getRepositoryCapabilities })
  expect(await client.canCreate(input.remoteUrl)).toBe(false)
  expect(getRepositoryCapabilities).toHaveBeenCalledWith({ owner: "team", repository: "app" })
  expect(getRepositoryToken).not.toHaveBeenCalled()
  expect(await client.canCreate("https://github.com.evil.test/team/app.git")).toBe(false)
})

it("persists creation and refreshes closed or merged PR status by number", async () => {
  const db = new ProjectdDatabase(":memory:")
  const store = new SessionPullRequestStore(db)
  let now = 100
  let refreshed = false
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const pathname = new URL(String(url)).pathname
    if (pathname.includes("/git/ref/")) return Response.json({ object: { sha: pathname.endsWith("main") ? input.targetOid : input.checkpointOid } })
    if (pathname.endsWith("/pulls/12")) {
      refreshed = true
      return Response.json({ ...pr, state: "closed", merged_at: "2026-09-12T00:00:00Z",
        head: { ...pr.head, sha: "c".repeat(40) }, base: { ...pr.base, sha: "d".repeat(40) } })
    }
    return Response.json(init?.method === "POST" ? pr : [])
  }) as unknown as typeof fetch
  const client = new GitHubSessionPullRequest({
    getRepositoryToken: async () => "secret",
    fetchFn,
    store,
    publicSessionId: "czs_0123456789abcdef",
    now: () => now,
  })
  await client.ensure(input)
  expect(client.persisted(input)).toMatchObject({ number: 12, state: "open", headOid: input.checkpointOid, checkedAt: 100 })

  now = 200
  const status = await client.refresh(input)
  expect(refreshed).toBe(true)
  expect(status).toMatchObject({ number: 12, state: "merged", headOid: "c".repeat(40), targetOid: "d".repeat(40), checkedAt: 200 })
  expect(client.persisted(input)).toEqual(status)
  db.close()
})
