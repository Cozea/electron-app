/**
 * The Git remote a live session's invitees clone from.
 *
 * Master Specification: Section 7.1, P15
 *
 * The URL is stored on the session record, shown to every invitee, and handed to
 * `git clone` on their Macs. Only network remotes are accepted; local paths, `file:`
 * and helper transports such as `ext::` are refused, as is anything Git could read
 * as an option. Credential-bearing remotes are preserved verbatim after validation so
 * the product can warn explicitly instead of silently changing the configured remote.
 */

const MAX_URL_LENGTH = 2048
/** `user@host:owner/repo.git`, the form `git clone` accepts for SSH. It has no password slot. */
const SCP_LIKE_REMOTE = /^[A-Za-z0-9._-]+@[A-Za-z0-9][A-Za-z0-9.-]*:(?!\/\/)\S+$/
const NETWORK_PROTOCOLS = new Set(["https:", "ssh:", "git:"])

/** True when the text holds whitespace or a control character, which no remote or branch needs. */
export function hasSpaceOrControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 0x20 || code === 0x7f || /\s/.test(character)) return true
  }
  return false
}

export function normalizeSessionRepositoryUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim()
  if (!value || value.length > MAX_URL_LENGTH || value.startsWith("-") || hasSpaceOrControlCharacter(value)) {
    return null
  }
  if (SCP_LIKE_REMOTE.test(value)) return value

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (!NETWORK_PROTOCOLS.has(url.protocol) || !url.hostname || url.hostname.startsWith("-")) {
    return null
  }
  return value
}

/**
 * True when a remote URL carries sign-in details, such as https://<token>@github.com/….
 * Nothing rewrites the person's remote; the Start dialog makes the exposure explicit
 * before starting the session.
 */
export function remoteCarriesCredentials(raw: string | null | undefined): boolean {
  const value = raw?.trim()
  if (!value || SCP_LIKE_REMOTE.test(value)) return false
  try {
    const url = new URL(value)
    return url.password !== "" || (url.protocol !== "ssh:" && url.username !== "")
  } catch {
    return false
  }
}

/** The remote as people read it: host and path, without the scheme or a trailing `.git`. */
export function describeSessionRepository(url: string): string {
  const scpLike = /^[^@/]+@([^:/]+):(.+)$/.exec(url)
  let host: string
  let repositoryPath: string
  if (scpLike) {
    host = scpLike[1] ?? ""
    repositoryPath = scpLike[2] ?? ""
  } else {
    try {
      const parsed = new URL(url)
      host = parsed.host
      repositoryPath = parsed.pathname.replace(/^\/+/, "")
    } catch {
      return url
    }
  }
  return `${host}/${repositoryPath}`.replace(/\/+$/, "").replace(/\.git$/, "")
}
