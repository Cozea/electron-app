import {
  createOrganizationRecoveryGrantInConvex,
  redeemOrganizationRecoveryGrantInConvex,
  requireActiveDeviceAccessInConvex,
} from '../lib/convex'
import { verifyDeviceAccessToken } from '../lib/jwt'
import { jsonResponse } from '../lib/protocol'
import { parseJsonRequest } from '../lib/validation'
import type { DeviceAccessClaims, Env } from '../types'

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} is invalid`)
  }
  return value.trim()
}

async function authenticate(request: Request, env: Env): Promise<DeviceAccessClaims> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) throw new Error('Device authentication is required')
  const auth = await verifyDeviceAccessToken(env, authorization.slice(7).trim())
  await requireActiveDeviceAccessInConvex(env, auth)
  return auth
}

function randomRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `czr_${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`
}

async function verifierHash(env: Env, code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.DEVICE_AUTH_CHALLENGE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function handleCreateRecoveryGrant(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const organizationId = requiredString(body.organizationId, 'organizationId', 128)
  const code = randomRecoveryCode()
  const expiresAt = Date.now() + 30 * 24 * 60 * 60_000
  await createOrganizationRecoveryGrantInConvex(env, {
    organizationId, actorIdentityKey: auth.sub,
    verifierHash: await verifierHash(env, code), expiresAt,
  })
  return jsonResponse({ recoveryCode: code, expiresAt }, { status: 201 })
}

export async function handleRedeemRecoveryGrant(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const recoveryCode = requiredString(body.recoveryCode, 'recoveryCode', 128)
  if (!recoveryCode.startsWith('czr_')) throw new Error('Recovery code is invalid')
  const result = await redeemOrganizationRecoveryGrantInConvex(env, {
    targetIdentityKey: auth.sub,
    verifierHash: await verifierHash(env, recoveryCode),
  })
  return jsonResponse(result)
}
