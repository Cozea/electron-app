import { authorizeDevAppRuntimePullInConvex, requireActiveDeviceAccessInConvex } from '../lib/convex'
import { verifyDeviceAccessToken } from '../lib/jwt'
import type { Env } from '../types'

const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/

function bearer(request: Request): string {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) throw new Error('Device authentication is required')
  return authorization.slice(7).trim()
}

function value(body: Record<string, unknown>, key: string, pattern: RegExp): string {
  const candidate = body[key]
  if (typeof candidate !== 'string' || !pattern.test(candidate)) {
    throw new Error(`The DevApp runtime ${key} is invalid`)
  }
  return candidate
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

/** Exchanges Cozea device authority for a repository-scoped, short-lived GHCR bearer token. */
export async function handleCreateDevAppRuntimePull(
  request: Request,
  env: Env,
): Promise<Response> {
  let auth: Awaited<ReturnType<typeof verifyDeviceAccessToken>>
  try {
    auth = await verifyDeviceAccessToken(env, bearer(request))
    await requireActiveDeviceAccessInConvex(env, auth)
  } catch {
    return errorResponse('Device authentication is required', 401)
  }
  let authorization: {
    organizationId: string
    publicationId: string
    releaseId: string
    manifestDigest: string
  }
  try {
    const body = await request.json() as Record<string, unknown>
    authorization = {
      organizationId: value(body, 'organizationId', SEGMENT),
      publicationId: value(body, 'publicationId', SEGMENT),
      releaseId: value(body, 'releaseId', SEGMENT),
      manifestDigest: value(body, 'manifestDigest', SHA256_DIGEST),
    }
  } catch {
    return errorResponse('The DevApp runtime pull request is invalid', 400)
  }
  try {
    await authorizeDevAppRuntimePullInConvex(env, auth, authorization)
  } catch {
    return errorResponse('The DevApp runtime image pull is not authorized', 403)
  }
  if (!env.DEVAPP_IMAGE_REGISTRY_USERNAME || !env.DEVAPP_IMAGE_REGISTRY_TOKEN) {
    return errorResponse('The private DevApp image registry is unavailable', 503)
  }
  const credentials = btoa(
    `${env.DEVAPP_IMAGE_REGISTRY_USERNAME}:${env.DEVAPP_IMAGE_REGISTRY_TOKEN}`,
  )
  const response = await fetch(
    'https://ghcr.io/token?service=ghcr.io&scope=repository%3Acozea%2Fdevapps%3Apull',
    { headers: { authorization: `Basic ${credentials}`, 'user-agent': 'Cozea-DevApp-Pull/1' } },
  )
  if (!response.ok) {
    return errorResponse(`The private image registry rejected access (${response.status})`, 502)
  }
  const token = await response.json() as { token?: unknown; expires_in?: unknown }
  if (typeof token.token !== 'string' || token.token.length > 16_384) {
    return errorResponse('The private image registry returned an invalid token', 502)
  }
  const lifetimeSeconds = typeof token.expires_in === 'number'
    ? Math.max(1, Math.min(token.expires_in, 600))
    : 300
  const usableLifetimeSeconds = Math.max(1, lifetimeSeconds - 15)
  return Response.json({
    scheme: 'bearer',
    token: token.token,
    expiresAt: Date.now() + usableLifetimeSeconds * 1_000,
  }, {
    headers: { 'cache-control': 'no-store' },
  })
}
