import type { Env, SessionClaims } from '../types'

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
  const encodedHeader = toBase64Url(new TextEncoder().encode(JSON.stringify(header)))
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const key = await importSecret(env.COLLAB_JWT_SECRET)
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`
}

export async function verifySessionToken(env: Env, token: string): Promise<SessionClaims> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error('Invalid session token format')
  }
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const key = await importSecret(env.COLLAB_JWT_SECRET)
  const signature = fromBase64Url(encodedSignature)
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    new TextEncoder().encode(signingInput),
  )
  if (!valid) {
    throw new Error('Session token verification failed')
  }
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as SessionClaims
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp <= now) {
    throw new Error('Session token expired')
  }
  return payload
}
