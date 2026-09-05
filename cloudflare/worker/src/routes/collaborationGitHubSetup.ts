import { readCollaborationRequest } from '../lib/boundedCollaborationRequest'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { verifyDeviceAccessToken } from '../lib/jwt'
import { requireActiveDeviceAccessInConvex } from '../lib/convex'
import { jsonResponse } from '../lib/protocol'
import type { Env } from '../types'

interface VerifiedRepository {
  installationId: string
  repositoryNumericId: string
  owner: string
  name: string
  defaultBranch: string
}
interface GitHubInstallation {
  id: number
  account: { id: number; login: string; type: string }
  suspended_at: string | null
}
interface GitHubRepository {
  id: number
  owner: { login: string }
  name: string
  default_branch: string
  permissions?: { admin?: boolean }
}

async function digest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('')
}
async function mutate<T>(env: Env, name: string, args: Record<string, unknown>): Promise<T> {
  const client = new ConvexHttpClient(env.CONVEX_URL)
  return await client.mutation(makeFunctionReference<'mutation'>(`collaborationRepositories:${name}`), {
    serverSecret: env.AI_GATEWAY_SECRET, ...args,
  }) as T
}
function oauthConfig(env: Env): { clientId: string; clientSecret: string; callback: string } {
  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET || !env.GITHUB_APP_CALLBACK_URL) {
    throw new Error('GitHub App setup is not configured')
  }
  const callback = new URL(env.GITHUB_APP_CALLBACK_URL)
  if (callback.protocol !== 'https:' || callback.username || callback.password || callback.search || callback.hash) {
    throw new Error('GitHub callback must be a configured HTTPS URL')
  }
  return { clientId: env.GITHUB_APP_CLIENT_ID, clientSecret: env.GITHUB_APP_CLIENT_SECRET, callback: callback.toString() }
}
async function github<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    redirect: 'error', cache: 'no-store', headers: {
      accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
      'user-agent': 'cozea-collaboration', 'x-github-api-version': '2022-11-28',
    },
  })
  if (!response.ok) throw new Error(`GitHub access verification failed (${response.status})`)
  return await response.json() as T
}

export async function handleGitHubSetup(request: Request, env: Env): Promise<Response> {
  const config = oauthConfig(env)
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) throw new Error('Device authentication is required')
  const auth = await verifyDeviceAccessToken(env, authorization.slice(7))
  await requireActiveDeviceAccessInConvex(env, auth)
  const body = await request.json() as { organizationId?: unknown }
  if (typeof body.organizationId !== 'string') throw new Error('Organization is required')
  const state = crypto.randomUUID() + crypto.randomUUID()
  await mutate(env, 'beginSetupFromServer', { identityKey: auth.sub, organizationId: body.organizationId, stateHash: await digest(state) })
  const url = new URL('https://github.com/login/oauth/authorize')
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.callback, state }).toString()
  return jsonResponse({ authorizationUrl: url.toString() }, { headers: { 'cache-control': 'no-store' } })
}

export async function handleGitHubCallback(request: Request, env: Env): Promise<Response> {
  const config = oauthConfig(env)
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  if (!state || state.length > 256 || !code || code.length > 512) throw new Error('Invalid GitHub callback')
  const { setupId } = await mutate<{ setupId: string }>(env, 'consumeSetupFromServer', { stateHash: await digest(state) })
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', redirect: 'error', cache: 'no-store',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.callback, code }),
  })
  const result = await response.json() as { access_token?: string }
  if (!response.ok || !result.access_token) throw new Error('GitHub authorization failed; restart setup')
  // The user credential exists only for this callback. Store verified metadata, never the token.
  const token = result.access_token
  const user = await github<{ id: number }>(token, '/user')
  const repositories: VerifiedRepository[] = []
  for (let page = 1; page <= 10; page += 1) {
    const installations = await github<{ installations: GitHubInstallation[]; total_count: number }>(token, `/user/installations?per_page=100&page=${page}`)
    if (installations.total_count > 1000) throw new Error('Too many installations; restrict GitHub App access')
    for (const installation of installations.installations) {
      if (installation.suspended_at) continue
      let ownsAccount = installation.account.type === 'User' && installation.account.id === user.id
      if (installation.account.type === 'Organization') {
        const membership = await github<{ role: string; state: string }>(token, `/user/memberships/orgs/${encodeURIComponent(installation.account.login)}`).catch(() => null)
        ownsAccount = membership?.role === 'admin' && membership.state === 'active'
      }
      if (!ownsAccount) continue
      for (let repositoryPage = 1; repositoryPage <= 10; repositoryPage += 1) {
        const available = await github<{ repositories: GitHubRepository[]; total_count: number }>(token, `/user/installations/${installation.id}/repositories?per_page=100&page=${repositoryPage}`)
        if (available.total_count > 1000) throw new Error('Restrict the GitHub App installation to at most 1,000 repositories')
        for (const repository of available.repositories) {
          repositories.push({ installationId: String(installation.id), repositoryNumericId: String(repository.id), owner: repository.owner.login, name: repository.name, defaultBranch: repository.default_branch })
          if (repositories.length > 1000) throw new Error('Restrict the GitHub App installation to at most 1,000 repositories')
        }
        if (available.repositories.length < 100) break
      }
    }
    if (installations.installations.length < 100) break
  }
  await mutate(env, 'completeSetupFromServer', { setupId, repositories })
  return new Response('GitHub access verified. Return to Cozea and select your repository.', {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'", 'referrer-policy': 'no-referrer' },
  })
}

export async function handleGitHubWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_APP_WEBHOOK_SECRET) return jsonResponse({ error: 'GitHub webhook is not configured' }, { status: 503 })
  const signature = request.headers.get('x-hub-signature-256')
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return jsonResponse({ error: 'Invalid webhook signature' }, { status: 401 })
  let body: string
  try { body = await readCollaborationRequest(request) }
  catch { return jsonResponse({ error: 'Invalid or oversized webhook body' }, { status: 400 }) }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.GITHUB_APP_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, byte => parseInt(byte, 16))
  if (!await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(body))) return jsonResponse({ error: 'Invalid webhook signature' }, { status: 401 })
  let event: { action?: string; installation?: { id?: number } }
  try {
    event = JSON.parse(body)
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Invalid event')
  } catch { return jsonResponse({ error: 'Invalid webhook event' }, { status: 400 }) }
  const type = request.headers.get('x-github-event')
  if ((type === 'installation' && ['deleted', 'suspend'].includes(event.action ?? '')) || type === 'installation_repositories') {
    const installationId = event.installation?.id
    if (typeof installationId !== 'number' || !Number.isSafeInteger(installationId) || installationId < 1) return jsonResponse({ error: 'Invalid webhook installation' }, { status: 400 })
    // Fail closed on repository-list changes until an administrator re-verifies setup.
    await mutate(env, 'revokeInstallationFromServer', { installationId: String(installationId) })
  }
  return new Response(null, { status: 204 })
}
