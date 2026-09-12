import { expect, it, vi } from "vitest"
import { GitHubSessionPullRequest } from "../../apps/projectd/src/autogit/GitHubSessionPullRequest"

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
