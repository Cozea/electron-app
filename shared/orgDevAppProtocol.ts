export const ORG_DEVAPP_SCHEME = "cozea-devapp"
export const ORG_DEVAPP_PROTOCOL = `${ORG_DEVAPP_SCHEME}:`
export const ORG_DEVAPP_RELEASE_HOST_SUFFIX = ".release"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"])

export interface OrgDevAppArtifactLocator {
  contentHash: string
  entryPath?: string
}

export function normalizeContentHash(value: string): string {
  return value.trim().toLowerCase()
}

export function isContentHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(normalizeContentHash(value))
}

export function normalizeEntryPath(value: string | undefined): string {
  const trimmed = (value ?? "index.html").trim().replace(/^\/+/, "")
  if (!trimmed || trimmed.includes("..") || pathLooksAbsolute(trimmed)) {
    return "index.html"
  }
  return trimmed
}

function pathLooksAbsolute(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value)
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "")
  if (LOOPBACK_HOSTS.has(hostname.trim().toLowerCase()) || LOOPBACK_HOSTS.has(normalized)) {
    return true
  }
  return normalized.startsWith("127.")
}

export function isLocalhostUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return isLoopbackHostname(parsed.hostname)
  } catch {
    return /\blocalhost\b|\b127\.0\.0\.1\b|\b\[::1\]\b/i.test(value)
  }
}

export function isOrgDevAppUrl(value: string): boolean {
  try {
    return new URL(value).protocol === ORG_DEVAPP_PROTOCOL
  } catch {
    return value.startsWith(`${ORG_DEVAPP_PROTOCOL}//`)
  }
}

export function buildOrgDevAppUrl(locator: OrgDevAppArtifactLocator): string {
  const contentHash = normalizeContentHash(locator.contentHash)
  const entryPath = normalizeEntryPath(locator.entryPath)
  if (!isContentHash(contentHash)) {
    throw new Error("The DevApp artifact hash is invalid.")
  }
  // A release hash is the host, not a path segment, so every immutable release
  // receives a distinct browser origin. This prevents two independently
  // published apps from sharing DOM storage, service workers, or origin trust.
  return `${ORG_DEVAPP_PROTOCOL}//${contentHash}${ORG_DEVAPP_RELEASE_HOST_SUFFIX}/${entryPath}`
}

export function parseOrgDevAppUrl(value: string): {
  contentHash: string
  assetPath: string
} | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== ORG_DEVAPP_PROTOCOL) {
    return null
  }
  const hostname = parsed.hostname.toLowerCase()
  if (!hostname.endsWith(ORG_DEVAPP_RELEASE_HOST_SUFFIX)) {
    return null
  }
  const contentHash = normalizeContentHash(hostname.slice(0, -ORG_DEVAPP_RELEASE_HOST_SUFFIX.length))
  if (!isContentHash(contentHash)) {
    return null
  }
  const assetPath = normalizeEntryPath(parsed.pathname.replace(/^\/+/, "") || "index.html")
  return { contentHash, assetPath }
}

export type OrgDevAppNavigationDecision =
  | { allowed: true; kind: "org-devapp" }
  | { allowed: false; reason: "localhost" | "external-https" | "blocked-scheme" | "invalid" }

export function evaluateOrgDevAppNavigation(url: string): OrgDevAppNavigationDecision {
  const trimmed = url.trim()
  if (!trimmed) {
    return { allowed: false, reason: "invalid" }
  }

  if (isLocalhostUrl(trimmed)) {
    return { allowed: false, reason: "localhost" }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { allowed: false, reason: "invalid" }
  }

  if (isLoopbackHostname(parsed.hostname)) {
    return { allowed: false, reason: "localhost" }
  }

  if (parsed.protocol === ORG_DEVAPP_PROTOCOL) {
    return parseOrgDevAppUrl(trimmed)
      ? { allowed: true, kind: "org-devapp" }
      : { allowed: false, reason: "invalid" }
  }

  if (parsed.protocol === "https:") {
    return { allowed: false, reason: "external-https" }
  }

  return { allowed: false, reason: "blocked-scheme" }
}

export function isAllowedOrgDevAppNavigation(url: string): boolean {
  return evaluateOrgDevAppNavigation(url).allowed
}
