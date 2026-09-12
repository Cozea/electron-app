import type { ProjectdPullRequestResult } from "@cozea/projectd-protocol"

interface RepositoryScope { owner: string; repository: string }

export interface SessionPullRequestInput {
  remoteUrl: string
  branch: string
  targetBranch: string
  checkpointOid: string
  targetOid: string
}

export type SessionPullRequestResult = ProjectdPullRequestResult

interface GitHubSessionPullRequestOptions {
  /** Must authorize this exact repository independently of renderer credentials. */
  getRepositoryToken: (scope: RepositoryScope) => Promise<string>
  fetchFn?: typeof fetch
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid GitHub response")
  return value as Record<string, unknown>
}

/** GitHub.com implementation. Other providers need their own trusted API binding. */
export class GitHubSessionPullRequest {
  private readonly options: GitHubSessionPullRequestOptions

  constructor(options: GitHubSessionPullRequestOptions) { this.options = options }

  async ensure(input: SessionPullRequestInput): Promise<SessionPullRequestResult> {
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(input.remoteUrl)
    if (!match || !/^[a-f0-9]{40,64}$/.test(input.checkpointOid) || !/^[a-f0-9]{40,64}$/.test(input.targetOid) ||
      !input.branch || !input.targetBranch || input.branch === input.targetBranch) throw new Error("Unsupported repository or invalid PR review")
    const scope = { owner: match[1]!, repository: match[2]! }
    const repository = `${scope.owner}/${scope.repository}`
    let token: string
    try { token = await this.options.getRepositoryToken(scope) }
    catch { throw new Error("Repository authorization is unavailable") }
    if (!token) throw new Error("Repository authorization is unavailable")
    const root = `https://api.github.com/repos/${repository}`
    const request = async (suffix: string, body?: unknown): Promise<unknown> => {
      try {
        const response = await (this.options.fetchFn ?? fetch)(root + suffix, {
          method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        if (!response.ok) { await response.body?.cancel(); throw new Error("Request failed") }
        const reader = response.body?.getReader()
        if (!reader) throw new Error("Missing response")
        const chunks: Uint8Array[] = []
        let size = 0
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.length
            if (size > 1024 * 1024) throw new Error("Response too large")
            chunks.push(value)
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
      } catch { throw new Error("GitHub PR request failed. Check repository access and retry.") }
    }
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
      return { number: Number(pr.number), url: String(pr.html_url), state: "open", created }
    }
    const find = async (): Promise<SessionPullRequestResult | null> => {
      const params = new URLSearchParams({ state: "open", head: `${scope.owner}:${input.branch}`, base: input.targetBranch, per_page: "2" })
      const result = await request(`/pulls?${params}`)
      if (!Array.isArray(result) || result.length > 1) throw new Error("Ambiguous pull request review")
      return result.length ? validate(result[0], false) : null
    }
    for (const [branch, expected] of [[input.branch, input.checkpointOid], [input.targetBranch, input.targetOid]]) {
      const ref = object(await request(`/git/ref/heads/${encodeURIComponent(branch!)}`))
      if (object(ref.object).sha !== expected) throw new Error("A remote branch moved. Refresh the PR review.")
    }
    const existing = await find()
    if (existing) return existing
    let created: unknown
    try {
      created = await request("/pulls", { head: input.branch, base: input.targetBranch,
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
}
