import { resolveRepositoryAccessToken } from './gitAuth'

type ProjectRole = 'project_manager' | 'developer' | 'designer' | 'viewer'
type RepositoryProvider = 'github' | 'gitlab'
type RepositoryAccessAction = 'grant' | 'revoke'
type RepositoryAccessState =
  | 'pending'
  | 'granted'
  | 'needs_identity'
  | 'manual_required'
  | 'revoked'
  | 'error'

export interface SyncRepositoryAccessOptions {
  provider: RepositoryProvider
  repoUrl: string
  accessToken?: string
  encryptedCredentials?: string
  keyId?: string
  providerHost?: string
  action: RepositoryAccessAction
  role: ProjectRole
  inviteEmail?: string
  providerAccountHandle?: string
}

export interface SyncRepositoryAccessResult {
  success: boolean
  accessState: RepositoryAccessState
  error?: string
  externalInvitationId?: string
  providerAccountHandle?: string
}

interface ParsedRepositoryTarget {
  owner: string
  repo: string
}

function normalizeRepositoryUrl(repoUrl: string): string {
  return repoUrl.trim().replace(/\/+$/, '')
}

function stripDotGit(value: string): string {
  return value.endsWith('.git') ? value.slice(0, -4) : value
}

function parseRepositoryPath(repoUrl: string): string | null {
  const normalized = normalizeRepositoryUrl(repoUrl)
  const sshMatch = normalized.match(/^(?:git@|ssh:\/\/git@)[^:/]+[:/](.+?)(?:\.git)?$/i)
  if (sshMatch) {
    return stripDotGit(sshMatch[1])
  }

  try {
    const url = new URL(normalized)
    const pathname = stripDotGit(url.pathname).replace(/^\/+/, "")
    if (!pathname) {
      return null
    }
    return pathname
  } catch {
    return null
  }
}

function parseRepositoryTarget(repoUrl: string): ParsedRepositoryTarget | null {
  const repositoryPath = parseRepositoryPath(repoUrl)
  if (!repositoryPath) {
    return null
  }

  const segments = repositoryPath.split("/").filter(Boolean)
  if (segments.length < 2) {
    return null
  }

  return {
    owner: segments[segments.length - 2],
    repo: segments[segments.length - 1],
  }
}

function mapRoleToGitHubPermission(role: ProjectRole): 'pull' | 'push' {
  return role === 'viewer' ? 'pull' : 'push'
}

function mapRoleToGitLabAccessLevel(role: ProjectRole): number {
  switch (role) {
    case 'project_manager':
      return 40
    case 'viewer':
      return 20
    case 'developer':
    case 'designer':
    default:
      return 30
  }
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return await response.json()
  }

  const text = await response.text()
  return text ? { message: text } : null
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (!payload) return fallback
  if (typeof payload === 'string') return payload

  if (typeof payload === 'object') {
    const candidate = payload as Record<string, unknown>
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message
    }
    if (Array.isArray(candidate.error) && candidate.error.length > 0) {
      return String(candidate.error[0])
    }
    if (typeof candidate.error === 'string' && candidate.error.trim()) {
      return candidate.error
    }
  }

  return fallback
}

async function syncGitHubRepositoryAccess(
  options: SyncRepositoryAccessOptions,
  accessToken: string
): Promise<SyncRepositoryAccessResult> {
  const target = parseRepositoryTarget(options.repoUrl)
  if (!target) {
    return {
      success: false,
      accessState: 'error',
      error: 'Unable to parse the GitHub repository URL.',
    }
  }

  const handle = options.providerAccountHandle?.trim()
  if (!handle) {
    return {
      success: false,
      accessState: 'needs_identity',
      error: 'GitHub repo access requires the collaborator’s GitHub username.',
    }
  }

  const apiBase = (options.providerHost?.trim() || 'https://github.com').replace(
    'https://github.com',
    'https://api.github.com'
  )
  const endpoint = `${apiBase}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/collaborators/${encodeURIComponent(handle)}`
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }

  if (options.action === 'grant') {
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        permission: mapRoleToGitHubPermission(options.role),
      }),
    })

    const payload = await parseResponsePayload(response)
    if (response.status === 201 || response.status === 202) {
      const invitationId =
        typeof payload === 'object' && payload && 'id' in payload
          ? String((payload as Record<string, unknown>).id)
          : undefined
      return {
        success: true,
        accessState: 'pending',
        externalInvitationId: invitationId,
        providerAccountHandle: handle,
      }
    }

    if (response.status === 204) {
      return {
        success: true,
        accessState: 'granted',
        providerAccountHandle: handle,
      }
    }

    return {
      success: false,
      accessState: 'error',
      providerAccountHandle: handle,
      error: getErrorMessage(payload, 'Failed to grant GitHub repository access.'),
    }
  }

  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers,
  })
  const payload = await parseResponsePayload(response)

  if (response.status === 204 || response.status === 404) {
    return {
      success: true,
      accessState: 'revoked',
      providerAccountHandle: handle,
    }
  }

  return {
    success: false,
    accessState: 'error',
    providerAccountHandle: handle,
    error: getErrorMessage(payload, 'Failed to revoke GitHub repository access.'),
  }
}

async function resolveGitLabMemberUserId(args: {
  projectPath: string
  email: string
  accessToken: string
  providerHost?: string
}): Promise<number | null> {
  const providerHost = args.providerHost?.trim() || 'https://gitlab.com'
  const endpoint = `${providerHost}/api/v4/projects/${encodeURIComponent(args.projectPath)}/members/all?query=${encodeURIComponent(args.email)}`
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
    },
  })

  if (!response.ok) {
    return null
  }

  const payload = await parseResponsePayload(response)
  if (!Array.isArray(payload)) {
    return null
  }

  const matched = payload.find((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const candidate = entry as Record<string, unknown>
    return typeof candidate.email === 'string' && candidate.email.trim().toLowerCase() === args.email.trim().toLowerCase()
  })

  if (!matched || typeof matched !== 'object') {
    return null
  }

  const candidate = matched as Record<string, unknown>
  return typeof candidate.id === 'number' ? candidate.id : null
}

async function syncGitLabRepositoryAccess(
  options: SyncRepositoryAccessOptions,
  accessToken: string
): Promise<SyncRepositoryAccessResult> {
  const projectPath = parseRepositoryPath(options.repoUrl)
  if (!projectPath) {
    return {
      success: false,
      accessState: 'error',
      error: 'Unable to parse the GitLab repository URL.',
    }
  }

  const email = options.inviteEmail?.trim().toLowerCase()
  if (!email) {
    return {
      success: false,
      accessState: 'needs_identity',
      error: 'GitLab repo access requires an invite email.',
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  }
  const apiBase = `${options.providerHost?.trim() || 'https://gitlab.com'}/api/v4`

  if (options.action === 'grant') {
    const body = new URLSearchParams({
      email,
      access_level: String(mapRoleToGitLabAccessLevel(options.role)),
    })
    const response = await fetch(`${apiBase}/projects/${encodeURIComponent(projectPath)}/invitations`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })
    const payload = await parseResponsePayload(response)

    if (response.ok) {
      const invitationId =
        typeof payload === 'object' && payload && 'id' in payload
          ? String((payload as Record<string, unknown>).id)
          : email
      return {
        success: true,
        accessState: 'pending',
        externalInvitationId: invitationId,
      }
    }

    if (response.status === 409) {
      const errorMessage = getErrorMessage(payload, '')
      if (/already.*member|already.*invited|has already been taken/i.test(errorMessage)) {
        return {
          success: true,
          accessState: /already.*member/i.test(errorMessage) ? 'granted' : 'pending',
        }
      }
    }

    return {
      success: false,
      accessState: 'error',
      error: getErrorMessage(payload, 'Failed to grant GitLab repository access.'),
    }
  }

  const revokeInviteResponse = await fetch(
    `${apiBase}/projects/${encodeURIComponent(projectPath)}/invitations/${encodeURIComponent(email)}`,
    {
      method: 'DELETE',
      headers,
    }
  )

  if (revokeInviteResponse.status === 204 || revokeInviteResponse.status === 404) {
    return {
      success: true,
      accessState: 'revoked',
    }
  }

  const memberUserId = await resolveGitLabMemberUserId({
    projectPath,
    email,
    accessToken,
    providerHost: options.providerHost,
  })

  if (memberUserId) {
    const removeMemberResponse = await fetch(
      `${apiBase}/projects/${encodeURIComponent(projectPath)}/members/${memberUserId}`,
      {
        method: 'DELETE',
        headers,
      }
    )

    if (removeMemberResponse.status === 204 || removeMemberResponse.status === 404) {
      return {
        success: true,
        accessState: 'revoked',
      }
    }

    const payload = await parseResponsePayload(removeMemberResponse)
    return {
      success: false,
      accessState: 'error',
      error: getErrorMessage(payload, 'Failed to revoke GitLab repository access.'),
    }
  }

  const payload = await parseResponsePayload(revokeInviteResponse)
  return {
    success: false,
    accessState: 'error',
    error: getErrorMessage(payload, 'Failed to revoke GitLab repository access.'),
  }
}

export async function syncRepositoryAccess(
  options: SyncRepositoryAccessOptions
): Promise<SyncRepositoryAccessResult> {
  const tokenResult = resolveRepositoryAccessToken({
    provider: options.provider,
    accessToken: options.accessToken,
    encryptedCredentials: options.encryptedCredentials,
    keyId: options.keyId,
  })

  if (!tokenResult.accessToken) {
    return {
      success: false,
      accessState: 'manual_required',
      providerAccountHandle: options.providerAccountHandle?.trim() || undefined,
      error: tokenResult.error || 'No provider token is available for repository access automation.',
    }
  }

  if (options.provider === 'github') {
    return await syncGitHubRepositoryAccess(options, tokenResult.accessToken)
  }

  return await syncGitLabRepositoryAccess(options, tokenResult.accessToken)
}
