import type { Env, SessionClaims } from '../types'
import { verifySessionToken } from '../lib/jwt'
import { validateSessionRoomPrincipalInConvex } from '../lib/convex'
import { protocolError } from '../lib/protocol'
import { PUBLIC_SESSION_ID_PATTERN } from './sessionRoom'

const MAX_ENCRYPTED_CHUNK_BYTES = 4 * 1024 * 1024 + 28
const BINARY_REF_PATTERN = /^v1\/\d{1,9}\/[a-f0-9]{64}\/\d{1,8}\/[a-f0-9]{64}$/

function objectKey(publicSessionId: string, ref: string): string {
  return `${publicSessionId}/${ref}`
}

async function readChunk(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return null
  const reader = request.body.getReader()
  const parts: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_ENCRYPTED_CHUNK_BYTES) {
        await reader.cancel()
        return null
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const part of parts) { body.set(part, offset); offset += part.length }
  return body
}

async function authorize(request: Request, env: Env, publicSessionId: string): Promise<SessionClaims> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('Session authentication is required')
  }
  const claims = await verifySessionToken(env, authorization.slice('Bearer '.length).trim())
  if (claims.roomId !== `session:${publicSessionId}`) {
    throw new Error('Session token belongs to another room')
  }
  const current = await validateSessionRoomPrincipalInConvex(env, {
    publicSessionId,
    principalId: claims.principalId,
    recovery: claims.sessionAccess !== undefined,
  })
  if (current.keyVersion !== Math.max(1, Math.floor(claims.sessionKeyVersion ?? 1))) {
    throw new Error('Session key changed; reconnect before transferring binary content')
  }
  return claims
}

/**
 * Stores opaque client-encrypted binary chunks. The Worker never receives a
 * plaintext room key or plaintext file bytes.
 */
export async function handleSessionBinaryObject(
  request: Request,
  env: Env,
  publicSessionId: string,
  ref: string,
): Promise<Response> {
  const origin = request.headers.get('origin')
  try {
    if (!PUBLIC_SESSION_ID_PATTERN.test(publicSessionId) || !BINARY_REF_PATTERN.test(ref)) {
      return protocolError('BAD_REQUEST', 'Invalid session binary object path', { status: 400 }, false, origin)
    }
    const claims = await authorize(request, env, publicSessionId)
    const key = objectKey(publicSessionId, ref)

    if (request.method === 'PUT') {
      if (claims.sessionAccess !== undefined) {
        return protocolError('FORBIDDEN', 'Recovery access cannot upload content', { status: 403 }, false, origin)
      }
      if (Number(ref.split('/')[1]) !== Math.max(1, Math.floor(claims.sessionKeyVersion ?? 1))) {
        return protocolError('FORBIDDEN', 'Upload requires the current session key generation', { status: 403 }, false, origin)
      }
      if (claims.sessionRole === 'viewer') {
        return protocolError('FORBIDDEN', 'Viewers cannot upload session binary content', { status: 403 }, false, origin)
      }
      const declaredLength = Number(request.headers.get('content-length') ?? '0')
      if (Number.isFinite(declaredLength) && declaredLength > MAX_ENCRYPTED_CHUNK_BYTES) {
        return protocolError('PAYLOAD_TOO_LARGE', 'Binary chunk exceeds the session limit', { status: 413 }, false, origin)
      }
      const body = await readChunk(request)
      if (!body || body.byteLength === 0) {
        return protocolError('PAYLOAD_TOO_LARGE', 'Binary chunk exceeds the session limit', { status: 413 }, false, origin)
      }
      const stored = await env.COLLAB_BINARY_OBJECTS.put(key, body, {
        onlyIf: new Headers({ 'if-none-match': '*' }),
        httpMetadata: { contentType: 'application/octet-stream' },
        customMetadata: {
          sessionId: publicSessionId,
          principalId: claims.principalId,
        },
      })
      // A retry must verify the existing immutable ciphertext on the device.
      return new Response(null, { status: stored ? 204 : 412 })
    }

    if (request.method === 'GET') {
      const object = await env.COLLAB_BINARY_OBJECTS.get(key)
      if (!object) {
        return protocolError('NOT_FOUND', 'Binary chunk not found', { status: 404 }, false, origin)
      }
      if (object.size > MAX_ENCRYPTED_CHUNK_BYTES) {
        return protocolError('CORRUPT_OBJECT', 'Stored binary chunk exceeds the protocol limit', { status: 500 }, false, origin)
      }
      return new Response(object.body, {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'cache-control': 'private, max-age=31536000, immutable',
          'content-length': String(object.size),
        },
      })
    }

    return protocolError('METHOD_NOT_ALLOWED', 'Method not allowed', { status: 405 }, false, origin)
  } catch (error) {
    return protocolError(
      'SESSION_BINARY_REJECTED',
      error instanceof Error ? error.message : 'Session binary request rejected',
      { status: 403 },
      false,
      origin,
    )
  }
}
