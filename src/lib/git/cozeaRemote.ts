const DEFAULT_COZEA_GIT_BASE_URL = 'https://api.cozea.app'

function normalizeGatewayBaseUrl(raw: string | undefined): string {
  const trimmed = raw?.trim()
  if (!trimmed) return DEFAULT_COZEA_GIT_BASE_URL
  return trimmed.replace(/\/+$/, '')
}

export function resolveCozeaGitBaseUrl(): string {
  return normalizeGatewayBaseUrl(import.meta.env.VITE_AUTH_SERVER_URL)
}

export function buildCozeaGitRemoteUrl(projectId: string): string {
  return `${resolveCozeaGitBaseUrl()}/git/${encodeURIComponent(projectId)}.git`
}

export function buildCozeaGitAuthHeader(accessToken: string | null | undefined): string | undefined {
  const token = accessToken?.trim()
  if (!token) return undefined
  return `Authorization: Bearer ${token}`
}
