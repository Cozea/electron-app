import { parseGitHubNumericId, type CollaborationRepositoryCredentialOperation } from '../../../../shared/collaborationRepository'
import type { Env } from '../types'

const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function apiBaseUrl(env: Env): string {
  const url = new URL(env.GITHUB_API_BASE_URL?.trim() || DEFAULT_GITHUB_API_BASE_URL)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('GitHub API base URL must use HTTPS without credentials, query or fragment')
  }
  return url.toString().replace(/\/+$/, '')
}

function githubHeaders(token: string): HeadersInit {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': 'cozea-collaboration-gateway',
    'x-github-api-version': GITHUB_API_VERSION,
  }
}

async function parseGitHubResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as T | { message?: string } | null
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String(payload.message || '')
      : ''
    throw new Error(message || `GitHub request failed (${response.status})`)
  }
  return payload as T
}

async function createGitHubAppJwt(env: Env): Promise<string> {
  const appId = env.GITHUB_APP_ID?.trim()
  const privateJwk = env.GITHUB_APP_PRIVATE_JWK?.trim()
  if (!appId || !privateJwk) {
    throw new Error('GitHub App credentials are not configured')
  }

  const issuedAt = Math.floor(Date.now() / 1000) - 30
  const header = toBase64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({
    iat: issuedAt,
    exp: issuedAt + 9 * 60,
    iss: appId,
  })))
  const signingInput = `${header}.${payload}`
  const key = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(privateJwk) as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`
}

export interface GitHubInstallationCredential {
  token: string
  expiresAt: number
}

export async function mintGitHubInstallationCredential(
  env: Env,
  args: {
    installationId: string
    repositoryNumericId: string
    operation: CollaborationRepositoryCredentialOperation
  },
): Promise<GitHubInstallationCredential> {
  const baseUrl = apiBaseUrl(env)
  const repositoryNumericId = parseGitHubNumericId(args.repositoryNumericId)
  parseGitHubNumericId(args.installationId)
  const appJwt = await createGitHubAppJwt(env)
  const response = await fetch(
    `${baseUrl}/app/installations/${encodeURIComponent(args.installationId)}/access_tokens`,
    {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: githubHeaders(appJwt),
      body: JSON.stringify({
        repository_ids: [repositoryNumericId],
        permissions: {
          metadata: 'read',
          contents: args.operation === 'write' ? 'write' : 'read',
        },
      }),
    },
  )
  const result = await parseGitHubResponse<{ token: string; expires_at: string }>(response)
  const expiresAt = Date.parse(result.expires_at)
  if (!result.token || !Number.isFinite(expiresAt)) {
    throw new Error('GitHub returned an invalid installation credential')
  }
  return { token: result.token, expiresAt }
}

export async function verifyGitHubBranchHead(
  env: Env,
  args: {
    installationId: string
    repositoryNumericId: string
    owner: string
    name: string
    branch: string
    expectedCommitSha: string
  },
): Promise<boolean> {
  const credential = await mintGitHubInstallationCredential(env, {
    installationId: args.installationId,
    repositoryNumericId: args.repositoryNumericId,
    operation: 'read',
  })
  const encodedBranch = args.branch.split('/').map(encodeURIComponent).join('/')
  const response = await fetch(
    `${apiBaseUrl(env)}/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.name)}/git/ref/heads/${encodedBranch}`,
    { headers: githubHeaders(credential.token), redirect: 'error', cache: 'no-store' },
  )
  const result = await parseGitHubResponse<{ object?: { sha?: string } }>(response)
  return result.object?.sha?.toLowerCase() === args.expectedCommitSha.toLowerCase()
}

export async function resolveGitHubBranch(env: Env, args: {
  installationId: string; repositoryNumericId: string; owner: string; name: string; branch: string
}): Promise<{ branch: string; commitSha: string; branches: string[] }> {
  const credential = await mintGitHubInstallationCredential(env, { ...args, operation: 'read' })
  const repositoryUrl = `${apiBaseUrl(env)}/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.name)}`
  const branch = args.branch
  const encoded = branch.split('/').map(encodeURIComponent).join('/')
  const ref = await parseGitHubResponse<{ object?: { sha?: string; type?: string } }>(await fetch(`${repositoryUrl}/git/ref/heads/${encoded}`, {
    headers: githubHeaders(credential.token), redirect: 'error', cache: 'no-store',
  }))
  if (ref.object?.type !== 'commit' || !/^[a-f0-9]{40}$/i.test(ref.object.sha ?? '')) throw new Error('GitHub branch does not resolve to a commit')
  const branches = await parseGitHubResponse<Array<{ name: string }>>(await fetch(`${repositoryUrl}/branches?per_page=100`, {
    headers: githubHeaders(credential.token), redirect: 'error', cache: 'no-store',
  }))
  return { branch, commitSha: ref.object!.sha!.toLowerCase(), branches: branches.map(value => value.name) }
}
