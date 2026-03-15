const DEFAULT_PROJECT_SHARE_BASE_URL = "https://cozea.app"

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value.trim())
}

function toProtocolPath(pathname: string): string {
  return pathname.replace(/^\/+/, "")
}

export function normalizeProjectShareBaseUrl(baseUrl?: string | null): string {
  const candidate = baseUrl?.trim() || DEFAULT_PROJECT_SHARE_BASE_URL
  return trimTrailingSlash(candidate)
}

export function buildProjectJoinPath(token: string): string {
  return `/projects/join/${encodePathSegment(token)}`
}

export function buildLegacyProjectJoinPath(token: string): string {
  return `/join/project/${encodePathSegment(token)}`
}

export function buildProjectInvitePath(inviteId: string): string {
  return `/projects/invite/${encodePathSegment(inviteId)}`
}

export function buildProjectJoinUrl(baseUrl: string | null | undefined, token: string): string {
  return `${normalizeProjectShareBaseUrl(baseUrl)}${buildProjectJoinPath(token)}`
}

export function buildProjectInviteUrl(
  baseUrl: string | null | undefined,
  inviteId: string
): string {
  return `${normalizeProjectShareBaseUrl(baseUrl)}${buildProjectInvitePath(inviteId)}`
}

export function buildProjectJoinDeepLink(token: string): string {
  return `cozea://${toProtocolPath(buildProjectJoinPath(token))}`
}

export function buildProjectInviteDeepLink(inviteId: string): string {
  return `cozea://${toProtocolPath(buildProjectInvitePath(inviteId))}`
}
