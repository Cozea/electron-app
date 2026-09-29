import type { ProjectdPullRequestResult } from "@cozea/projectd-protocol"
import { parseGitHubRepository } from "@shared/git/githubRepository"
import { requestGitHubJson } from "@shared/github/apiFetch"
import type { SessionPullRequestRecord, SessionPullRequestStore } from "./SessionPullRequestStore"

interface RepositoryScope { owner: string; repository: string }

export interface SessionPullRequestInput {
  remoteUrl: string
  branch: string
  targetBranch: string
  checkpointOid: string
  targetOid: string
}

export interface SessionPullRequestIdentity {
  remoteUrl: string
  branch: string
  targetBranch: string
}

export type SessionPullRequestResult = ProjectdPullRequestResult

interface GitHubSessionPullRequestOptions {
  /** Must authorize this exact repository independently of renderer credentials. */
  getRepositoryToken: (scope: RepositoryScope) => Promise<string>
  /** Capability discovery must not mint a repository token just to render a button. */
  getRepositoryCapabilities?: (scope: RepositoryScope) => Promise<{ pullRequest: boolean; gitWrite?: boolean }>
  store?: SessionPullRequestStore
  publicSessionId?: string
  fetchFn?: typeof fetch
  now?: () => number
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid GitHub response")
  return value as Record<string, unknown>
}

function parseRepository(remoteUrl: string): { scope: RepositoryScope; repository: string } | null {
  // Shared with the scoped network Git layer and background authorization, so
  // a remote that one of them will act on is one the others recognise. This
  // pattern used to refuse `ssh://git@github.com/`, which the network layer
  // accepted -- a session on such a remote could push but never open a PR.
  const parsed = parseGitHubRepository(remoteUrl)
  if (!parsed) return null
  return {
    scope: { owner: parsed.owner, repository: parsed.repository },
    repository: parsed.full,
  }
}

function isOid(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)
}

/** GitHub.com implementation. Other providers need their own trusted API binding. */
export class GitHubSessionPullRequest {
  private readonly options: GitHubSessionPullRequestOptions

  constructor(options: GitHubSessionPullRequestOptions) { this.options = options }

  /** Whether the configured operator grant can create PRs for this exact repository. */
  async canCreate(remoteUrl: string): Promise<boolean> {
    // Test/custom providers that do not opt into capability discovery retain the
    // historical provider-presence behavior. Production supplies the callback below.
    if (!this.options.getRepositoryCapabilities) return true
    const parsed = parseRepository(remoteUrl)
    if (!parsed) return false
    try {
      return (await this.options.getRepositoryCapabilities(parsed.scope)).pullRequest === true
    } catch {
      return false
    }
  }

  /** Last durable observation, available even while GitHub is temporarily unreachable. */
  persisted(identity: SessionPullRequestIdentity): SessionPullRequestRecord | null {
    const parsed = parseRepository(identity.remoteUrl)
    const sessionId = this.options.publicSessionId
    if (!parsed || !sessionId || !this.options.store) return null
    return this.options.store.get(sessionId, parsed.repository, identity.branch, identity.targetBranch)
  }

  /** Refreshes a known PR by number and persists its current GitHub state. */
  async refresh(identity: SessionPullRequestIdentity): Promise<SessionPullRequestRecord | null> {
    const parsed = parseRepository(identity.remoteUrl)
    const sessionId = this.options.publicSessionId
    const store = this.options.store
    if (!parsed || !sessionId || !store) return null
    const existing = store.get(sessionId, parsed.repository, identity.branch, identity.targetBranch)
    if (!existing) return null
    let token: string
    try { token = await this.options.getRepositoryToken(parsed.scope) }
    catch { throw new Error("Repository authorization is unavailable") }
    if (!token) throw new Error("Repository authorization is unavailable")
    const value = object(await this.request(parsed.repository, token, `/pulls/${existing.number}`))
    const head = object(value.head)
    const base = object(value.base)
    const state = value.merged_at ? "merged" : value.state === "open" ? "open" : value.state === "closed" ? "closed" : null
    if (!state || !isOid(head.sha) || !isOid(base.sha) || head.ref !== identity.branch || base.ref !== identity.targetBranch ||
      object(head.repo).full_name !== parsed.repository || object(base.repo).full_name !== parsed.repository ||
      value.html_url !== `https://github.com/${parsed.repository}/pull/${existing.number}` || Number(value.number) !== existing.number) {
      throw new Error("The persisted pull request no longer matches this collaboration branch.")
    }
    return store.save({
      publicSessionId: sessionId,
      repository: parsed.repository,
      branch: identity.branch,
      targetBranch: identity.targetBranch,
      number: existing.number,
      url: existing.url,
      state,
      headOid: head.sha,
      targetOid: base.sha,
      checkedAt: (this.options.now ?? Date.now)(),
    })
  }

  async ensure(input: SessionPullRequestInput): Promise<SessionPullRequestResult> {
    const parsed = parseRepository(input.remoteUrl)
    if (!parsed || !isOid(input.checkpointOid) || !isOid(input.targetOid) ||
      !input.branch || !input.targetBranch || input.branch === input.targetBranch) throw new Error("Unsupported repository or invalid PR review")
    const { scope, repository } = parsed
    let token: string
    try { token = await this.options.getRepositoryToken(scope) }
    catch { throw new Error("Repository authorization is unavailable") }
    if (!token) throw new Error("Repository authorization is unavailable")
    const validate = (value: unknown, created: boolean): SessionPullRequestResult => {
      const pr = object(value)
      const head = object(pr.head)
      const base = object(pr.base)
      if (pr.state !== "open" || !Number.isSafeInteger(pr.number) || Number(pr.number) < 1 ||
        head.ref !== input.branch || head.sha !== input.checkpointOid || base.ref !== input.targetBranch || base.sha !== input.targetOid ||
        object(head.repo).full_name !== repository || object(base.repo).full_name !== repository ||
        pr.html_url !== `https://github.com/${repository}/pull/${pr.number}`) {
        throw new Error("The pull request differs from the reviewed session. Refresh the review.")
      }
      const result = { number: Number(pr.number), url: String(pr.html_url), state: "open" as const, created }
      if (this.options.store && this.options.publicSessionId) {
        this.options.store.save({
          publicSessionId: this.options.publicSessionId,
          repository,
          branch: input.branch,
          targetBranch: input.targetBranch,
          number: result.number,
          url: result.url,
          state: "open",
          headOid: input.checkpointOid,
          targetOid: input.targetOid,
          checkedAt: (this.options.now ?? Date.now)(),
        })
      }
      return result
    }
    const find = async (): Promise<SessionPullRequestResult | null> => {
      const params = new URLSearchParams({ state: "open", head: `${scope.owner}:${input.branch}`, base: input.targetBranch, per_page: "2" })
      const result = await this.request(repository, token, `/pulls?${params}`)
      if (!Array.isArray(result) || result.length > 1) throw new Error("Ambiguous pull request review")
      return result.length ? validate(result[0], false) : null
    }
    for (const [branch, expected] of [[input.branch, input.checkpointOid], [input.targetBranch, input.targetOid]]) {
      const ref = object(await this.request(repository, token, `/git/ref/heads/${encodeURIComponent(branch!)}`))
      if (object(ref.object).sha !== expected) throw new Error("A remote branch moved. Refresh the PR review.")
    }
    const existing = await find()
    if (existing) return existing
    let created: unknown
    try {
      created = await this.request(repository, token, "/pulls", { head: input.branch, base: input.targetBranch,
        title: `Merge ${input.branch} into ${input.targetBranch}`,
        body: `Collaboration session checkpoint: ${input.checkpointOid}` })
    } catch (error) {
      // The POST may have succeeded even if its reply was lost. A retry looks up
      // the same repository/head/base before attempting any new creation.
      const recovered = await find()
      if (recovered) return recovered
      throw error
    }
    return validate(created, true)
  }

  private async request(repository: string, token: string, suffix: string, body?: unknown): Promise<unknown> {
    try {
      return await requestGitHubJson(`https://api.github.com/repos/${repository}${suffix}`, {
        token,
        body,
        maxBytes: 1024 * 1024,
        timeoutMs: 30_000,
        fetchFn: this.options.fetchFn,
      })
    } catch {
      // The sanitised message stays here rather than moving into the shared
      // helper: a test pins that nothing a provider says reaches the caller,
      // because whatever it says may quote the request, and the request carries
      // the token.
      throw new Error("GitHub PR request failed. Check repository access and retry.")
    }
  }
}
