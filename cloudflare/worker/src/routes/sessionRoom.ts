import type { Env } from '../types'
import { signSessionToken, verifyDeviceAccessToken } from '../lib/jwt'
import { authorizeSessionRoomInConvex } from '../lib/convex'
import { jsonResponse } from '../lib/protocol'
import { parseJsonRequest } from '../lib/validation'
import { SESSION_ROOM_PROTOCOL_VERSION } from '../durableObjects/CollaborationSessionRoom'

export const PUBLIC_SESSION_ID_PATTERN = /^czs_[a-f0-9]{16}$/

/**
 * Issues a short-lived token for one collaboration session room (Section 13.1).
 * The device must be an active member of an ACTIVE session; the token carries its
 * session role so the room can keep viewers read-only.
 */
export async function handleSessionRoomConnect(request: Request, env: Env): Promise<Response> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('Device authentication is required')
  }
  const auth = await verifyDeviceAccessToken(env, authorization.slice('Bearer '.length).trim())

  const body = (await parseJsonRequest(request)) as { publicSessionId?: unknown; clientType?: unknown }
  const publicSessionId = typeof body.publicSessionId === 'string' ? body.publicSessionId : ''
  if (!PUBLIC_SESSION_ID_PATTERN.test(publicSessionId)) {
    throw new Error('A collaboration session ID is required')
  }
  const clientType = body.clientType === 'web' ? 'web' : 'electron'

  const access = await authorizeSessionRoomInConvex(env, auth, publicSessionId)
  const roomId = `session:${publicSessionId}`
  const token = await signSessionToken(env, {
    sub: access.identityKey,
    principalId: access.principalId,
    projectId: access.projectId,
    roomId,
    clientType,
    protocolVersion: SESSION_ROOM_PROTOCOL_VERSION,
    sessionRole: access.role,
  })

  const wsUrl = new URL(request.url)
  wsUrl.pathname = '/collab/sessions/ws'
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  wsUrl.search = new URLSearchParams({ sessionId: publicSessionId }).toString()

  return jsonResponse({
    roomId,
    wsUrl: wsUrl.toString(),
    token,
    protocolVersion: SESSION_ROOM_PROTOCOL_VERSION,
    role: access.role,
  })
}
