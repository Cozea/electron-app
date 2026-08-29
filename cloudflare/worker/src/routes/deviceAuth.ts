import {
  consumeDeviceAuthChallengeInConvex,
  ensureDevicePrincipalFromConvex,
  persistDeviceAuthChallengeInConvex,
} from '../lib/convex'
import {
  createDeviceChallengeToken,
  getDeviceAuthJwks,
  signDeviceAccessToken,
  verifyDeviceChallengeSignature,
  verifyDeviceChallengeToken,
} from '../lib/jwt'
import { jsonResponse } from '../lib/protocol'
import { parseDeviceAuthChallengeRequest, parseJsonRequest } from '../lib/validation'
import type { Env } from '../types'

const CHALLENGE_TTL_SECONDS = 2 * 60

async function requestFingerprint(request: Request): Promise<string> {
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const agent = request.headers.get('user-agent') ?? 'unknown'
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${address}\n${agent}`),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function validatePublicP256Jwk(value: string, label: string): void {
  const parsed = JSON.parse(value) as JsonWebKey
  if (
    parsed.kty !== 'EC' ||
    parsed.crv !== 'P-256' ||
    typeof parsed.x !== 'string' ||
    typeof parsed.y !== 'string' ||
    parsed.d
  ) {
    throw new Error(`${label} must be a public P-256 EC JWK`)
  }
}

async function publicJwkFingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value || value.length > maxLength) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

export async function handleDeviceAuthChallenge(request: Request, env: Env): Promise<Response> {
  const identity = parseDeviceAuthChallengeRequest(await parseJsonRequest(request))
  if (
    identity.encryptionPublicKeyAlgorithm !== 'ECDH-P256' ||
    identity.signingPublicKeyAlgorithm !== 'ECDSA-P256-SHA256'
  ) {
    throw new Error('Unsupported device key algorithm')
  }
  validatePublicP256Jwk(identity.encryptionPublicKeyJwk, 'Encryption public key')
  validatePublicP256Jwk(identity.signingPublicKeyJwk, 'Signing public key')
  const [encryptionFingerprint, signingFingerprint] = await Promise.all([
    publicJwkFingerprint(identity.encryptionPublicKeyJwk),
    publicJwkFingerprint(identity.signingPublicKeyJwk),
  ])
  if (
    encryptionFingerprint !== identity.encryptionFingerprint ||
    signingFingerprint !== identity.signingFingerprint
  ) {
    throw new Error('Device key fingerprint does not match its public key')
  }

  const issuedAt = Math.floor(Date.now() / 1000)
  const nonce = crypto.randomUUID()
  await persistDeviceAuthChallengeInConvex(env, {
    nonce,
    identityKey: identity.identityKey,
    requestFingerprint: await requestFingerprint(request),
    expiresAt: (issuedAt + CHALLENGE_TTL_SECONDS) * 1_000,
  })
  const challenge = await createDeviceChallengeToken(env, {
    ...identity,
    typ: 'cozea-device-challenge',
    nonce,
    iat: issuedAt,
    exp: issuedAt + CHALLENGE_TTL_SECONDS,
  })

  return jsonResponse({ challenge, expiresAt: issuedAt + CHALLENGE_TTL_SECONDS }, { status: 201 })
}

export async function handleDeviceAuthComplete(request: Request, env: Env): Promise<Response> {
  const value = await parseJsonRequest(request)
  if (!value || typeof value !== 'object') {
    throw new Error('Request body must be an object')
  }
  const body = value as Record<string, unknown>
  const challenge = requiredString(body.challenge, 'challenge', 64_000)
  const signature = requiredString(body.signature, 'signature', 1_000)
  const claims = await verifyDeviceChallengeToken(env, challenge)
  const signatureValid = await verifyDeviceChallengeSignature({
    challenge,
    signature,
    signingPublicKeyJwk: claims.signingPublicKeyJwk,
  })
  if (!signatureValid) {
    throw new Error('Device challenge signature is invalid')
  }

  await consumeDeviceAuthChallengeInConvex(env, {
    nonce: claims.nonce,
    identityKey: claims.identityKey,
  })
  const profile = await ensureDevicePrincipalFromConvex(env, claims)
  const access = await signDeviceAccessToken(
    env,
    claims.identityKey,
    profile.authentication.signingKeyVersion,
  )
  return jsonResponse({
    accessToken: access.token,
    expiresAt: access.expiresAt,
    convexUserId: profile.userId,
    user: profile.user,
    personalWorkspace: profile.personalWorkspace,
  })
}

export function handleDeviceAuthJwks(env: Env): Response {
  return jsonResponse(getDeviceAuthJwks(env), {
    headers: {
      'cache-control': 'public, max-age=300',
    },
  })
}
