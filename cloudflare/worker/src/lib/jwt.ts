import type {
  DeviceAccessClaims,
  DeviceAuthChallengeClaims,
  Env,
  SessionClaims,
} from '../types'

const toBufferSource = (value: Uint8Array): BufferSource => value as unknown as BufferSource

function toBase64Url(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) {
    value += String.fromCharCode(byte)
  }
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function importSecret(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function parseObject(value: Uint8Array, label: string): Record<string, unknown> {
  const parsed = JSON.parse(new TextDecoder().decode(value)) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function parseEcPublicJwk(value: string): JsonWebKey {
  const parsed = JSON.parse(value) as JsonWebKey
  if (
    parsed.kty !== 'EC' ||
    parsed.crv !== 'P-256' ||
    typeof parsed.x !== 'string' ||
    typeof parsed.y !== 'string' ||
    parsed.d
  ) {
    throw new Error('Expected a public P-256 EC JWK')
  }
  return parsed
}

async function createHmacCompact(
  secret: string,
  header: Record<string, unknown>,
  payload: object,
): Promise<string> {
  const encodedHeader = toBase64Url(new TextEncoder().encode(JSON.stringify(header)))
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importSecret(secret),
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`
}

async function verifyHmacCompact(
  secret: string,
  token: string,
  expectedType: string,
): Promise<Record<string, unknown>> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error('Invalid signed token format')
  }
  const header = parseObject(fromBase64Url(encodedHeader), 'Token header')
  if (header.alg !== 'HS256' || header.typ !== expectedType) {
    throw new Error('Unexpected signed token header')
  }
  const valid = await crypto.subtle.verify(
    'HMAC',
    await importSecret(secret),
    toBufferSource(fromBase64Url(encodedSignature)),
    toBufferSource(new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)),
  )
  if (!valid) {
    throw new Error('Signed token verification failed')
  }
  return parseObject(fromBase64Url(encodedPayload), 'Token payload')
}

export async function signSessionToken(
  env: Env,
  claims: Omit<SessionClaims, 'iat' | 'exp'>,
  ttlSeconds = 15 * 60,
): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  }
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload: SessionClaims = {
    ...claims,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  }
  return createHmacCompact(env.COLLAB_JWT_SECRET, header, payload)
}

export async function verifySessionToken(env: Env, token: string): Promise<SessionClaims> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error('Invalid session token format')
  }
  const payload = await verifyHmacCompact(env.COLLAB_JWT_SECRET, token, 'JWT') as unknown as SessionClaims
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp <= now) {
    throw new Error('Session token expired')
  }
  return payload
}

export async function createDeviceChallengeToken(
  env: Env,
  claims: DeviceAuthChallengeClaims,
): Promise<string> {
  return createHmacCompact(
    env.DEVICE_AUTH_CHALLENGE_SECRET,
    { alg: 'HS256', typ: 'COZEA-DEVICE-CHALLENGE' },
    claims,
  )
}

export async function verifyDeviceChallengeToken(
  env: Env,
  token: string,
): Promise<DeviceAuthChallengeClaims> {
  const payload = await verifyHmacCompact(
    env.DEVICE_AUTH_CHALLENGE_SECRET,
    token,
    'COZEA-DEVICE-CHALLENGE',
  ) as unknown as DeviceAuthChallengeClaims
  if (payload.typ !== 'cozea-device-challenge' || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Device challenge expired or is invalid')
  }
  return payload
}

export async function verifyDeviceChallengeSignature(args: {
  challenge: string
  signature: string
  signingPublicKeyJwk: string
}): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'jwk',
    parseEcPublicJwk(args.signingPublicKeyJwk),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    toBufferSource(fromBase64Url(args.signature)),
    toBufferSource(new TextEncoder().encode(args.challenge)),
  )
}

export async function signDeviceAccessToken(
  env: Env,
  identityKey: string,
  keyVersion = 1,
  ttlSeconds = 15 * 60,
): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + ttlSeconds
  const claims: DeviceAccessClaims = {
    sub: identityKey,
    iss: env.DEVICE_AUTH_ISSUER,
    aud: env.DEVICE_AUTH_AUDIENCE,
    identity_kind: 'device',
    jti: crypto.randomUUID(),
    key_version: keyVersion,
    token_issued_at: now,
    iat: now,
    exp: expiresAt,
  }
  const header = {
    alg: 'ES256',
    typ: 'JWT',
    kid: env.DEVICE_AUTH_KEY_ID,
  }
  const encodedHeader = toBase64Url(new TextEncoder().encode(JSON.stringify(header)))
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(env.DEVICE_AUTH_PRIVATE_JWK) as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput),
  )
  return {
    token: `${signingInput}.${toBase64Url(new Uint8Array(signature))}`,
    expiresAt,
  }
}

export async function verifyDeviceAccessToken(env: Env, token: string): Promise<DeviceAccessClaims> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error('Invalid device access token format')
  }
  const header = parseObject(fromBase64Url(encodedHeader), 'Access token header')
  if (header.alg !== 'ES256' || header.typ !== 'JWT' || typeof header.kid !== 'string') {
    throw new Error('Unexpected device access token header')
  }
  const publicJwk = header.kid === env.DEVICE_AUTH_KEY_ID
    ? env.DEVICE_AUTH_PUBLIC_JWK
    : header.kid === env.DEVICE_AUTH_PREVIOUS_KEY_ID
      ? env.DEVICE_AUTH_PREVIOUS_PUBLIC_JWK
      : undefined
  if (!publicJwk) throw new Error('Unknown device access token signing key')
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    parseEcPublicJwk(publicJwk),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    toBufferSource(fromBase64Url(encodedSignature)),
    toBufferSource(new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)),
  )
  if (!valid) {
    throw new Error('Device access token verification failed')
  }
  const claims = parseObject(fromBase64Url(encodedPayload), 'Access token payload') as unknown as DeviceAccessClaims
  const now = Math.floor(Date.now() / 1000)
  if (
    claims.exp <= now ||
    claims.iss !== env.DEVICE_AUTH_ISSUER ||
    claims.aud !== env.DEVICE_AUTH_AUDIENCE ||
    claims.identity_kind !== 'device' ||
    typeof claims.jti !== 'string' ||
    claims.jti.length < 16 ||
    !Number.isInteger(claims.key_version) ||
    claims.key_version < 1 ||
    claims.token_issued_at !== claims.iat
  ) {
    throw new Error('Device access token claims are invalid')
  }
  return claims
}

export function getDeviceAuthJwks(env: Env): {
  keys: Array<JsonWebKey & { alg: 'ES256'; use: 'sig'; kid: string }>
} {
  const publicKey = parseEcPublicJwk(env.DEVICE_AUTH_PUBLIC_JWK)
  const keys: Array<JsonWebKey & { alg: 'ES256'; use: 'sig'; kid: string }> = [{
      ...publicKey,
      alg: 'ES256',
      use: 'sig',
      kid: env.DEVICE_AUTH_KEY_ID,
    }]
  if (env.DEVICE_AUTH_PREVIOUS_PUBLIC_JWK && env.DEVICE_AUTH_PREVIOUS_KEY_ID) {
    keys.push({
      ...parseEcPublicJwk(env.DEVICE_AUTH_PREVIOUS_PUBLIC_JWK),
      alg: 'ES256',
      use: 'sig',
      kid: env.DEVICE_AUTH_PREVIOUS_KEY_ID,
    })
  }
  return { keys }
}
