/**
 * One way to call GitHub's API.
 *
 * Four places called it independently and only two did so safely. The pull
 * request provider and the Convex token minter refuse redirects, set a
 * deadline, cap what they read and cancel the body they reject. The DevApp
 * build dispatcher in the Cloudflare worker and the desktop capability catalog
 * did none of that — while both send `Authorization: Bearer <token>`. A
 * redirect would have carried that token to whatever host GitHub's reply named.
 *
 * Deliberately written against the smallest runtime surface, because this has
 * to hold in four of them: the Cloudflare worker (`lib: WebWorker`, `types: []`,
 * so no `Buffer`), Convex's Node actions, Bun in projectd, and the Electron
 * main process. `fetch`, a stream reader, `TextDecoder` and `AbortSignal` exist
 * in all four; `Buffer` does not.
 */

/** GitHub's own ceiling on a listing is far below this; it exists to bound memory, not to shape requests. */
const DEFAULT_MAX_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const API_VERSION = "2022-11-28"

export interface GitHubApiOptions {
  /** Sent as a bearer token. Never appears in an error raised here. */
  readonly token?: string
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  /** Serialised as JSON. Its presence adds the content type. */
  readonly body?: unknown
  readonly headers?: Readonly<Record<string, string>>
  readonly maxBytes?: number
  readonly timeoutMs?: number
  /** Identifies the caller to GitHub; they ask for one and rate-limit anonymous agents harder. */
  readonly userAgent?: string
  /** Injected in tests. */
  readonly fetchFn?: typeof fetch
}

/**
 * A GitHub request that did not succeed.
 *
 * Carries the status but never the token or the response body: these messages
 * reach logs and, in places, people.
 */
export class GitHubApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = "GitHubApiError"
    this.status = status
  }
}

/**
 * Calls GitHub and returns the parsed body, or null when there is none — a
 * 204, as `POST /dispatches` answers.
 *
 * Refuses redirects rather than following them: every caller addresses
 * `api.github.com` directly, so a redirect is either GitHub moving something or
 * someone else answering, and neither is worth handing a bearer token to.
 */
export async function requestGitHubJson(
  url: string,
  options: GitHubApiOptions = {},
): Promise<unknown> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const call = options.fetchFn ?? fetch

  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": API_VERSION,
    ...(options.userAgent ? { "user-agent": options.userAgent } : {}),
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    ...options.headers,
  }

  let response: Response
  try {
    response = await call(url, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    // Includes the redirect refusal and the deadline. The cause is not repeated
    // outward: it can carry the request, and the request carries the token.
    throw new GitHubApiError("The GitHub request could not be completed.")
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new GitHubApiError(`GitHub answered ${response.status}.`, response.status)
  }

  const text = await readBounded(response, maxBytes)
  if (text.trim() === "") return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new GitHubApiError("GitHub's answer was not valid JSON.", response.status)
  }
}

/**
 * Reads the body, stopping if it exceeds `maxBytes`.
 *
 * Counts bytes rather than characters, and decodes once at the end: decoding
 * each chunk alone corrupts any character a chunk boundary happens to split.
 */
async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ""

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        throw new GitHubApiError(`GitHub's answer exceeded ${maxBytes} bytes.`, response.status)
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}
