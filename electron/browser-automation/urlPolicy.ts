/**
 * URL safety policy for agent browser automation.
 *
 * MVP policy (Track C):
 * - Agents may only drive tiles the user already opened (enforced by the adapter).
 * - Navigate targets must be project-scoped loopback preview URLs
 *   (`localhost` / `127.0.0.1` / `::1` over http or https).
 * - Unrestricted cross-origin browsing is explicitly out of scope.
 */

export interface UrlPolicyDecision {
  readonly allowed: boolean
  readonly reason?: string
  readonly normalizedUrl?: string
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (LOOPBACK_HOSTS.has(normalized)) return true
  // IPv6 without brackets sometimes appears as ::1 already covered; also 0.0.0.0 is not loopback for policy.
  return false
}

/**
 * Normalize schemeless `localhost:port` / `127.0.0.1:port` into http URLs.
 * Does not accept search queries or public hosts.
 */
export function normalizeAutomationUrlInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ""

  if (/^localhost(:|\/|$)/i.test(trimmed) || /^127\.0\.0\.1(:|\/|$)/.test(trimmed)) {
    return `http://${trimmed}`
  }
  if (/^\[::1\](:|\/|$)/i.test(trimmed) || /^::1(:|\/|$)/.test(trimmed)) {
    const withBrackets = trimmed.startsWith("[") ? trimmed : `[::1]${trimmed.slice(3)}`
    return `http://${withBrackets}`
  }

  return trimmed
}

export function evaluateAutomationNavigateUrl(rawUrl: string): UrlPolicyDecision {
  const normalized = normalizeAutomationUrlInput(rawUrl)
  if (!normalized) {
    return { allowed: false, reason: "URL is empty." }
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    return { allowed: false, reason: "URL is not absolute or could not be parsed." }
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      allowed: false,
      reason: `Protocol ${parsed.protocol} is not allowed; only http(s) loopback is permitted.`,
    }
  }

  if (!isLoopbackHostname(parsed.hostname)) {
    return {
      allowed: false,
      reason:
        "Only project-scoped loopback URLs (localhost / 127.0.0.1 / ::1) are allowed for agent navigation.",
    }
  }

  return { allowed: true, normalizedUrl: parsed.toString() }
}
