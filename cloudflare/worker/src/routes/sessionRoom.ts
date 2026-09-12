import type { Env } from '../types'
import { signSessionToken, verifyDeviceAccessToken } from '../lib/jwt'
import { authorizeSessionRoomInConvex } from '../lib/convex'
import { jsonResponse } from '../lib/protocol'
import { parseJsonRequest } from '../lib/validation'
import { SESSION_ROOM_PROTOCOL_VERSION } from '../durableObjects/CollaborationSessionRoom'

export const PUBLIC_SESSION_ID_PATTERN = /^czs_[a-f0-9]{16}$/

/**
 * Issues a short-lived token for one collaboration session room (Section 13.1).
 * Active members receive live admission for ACTIVE sessions, or explicit
 * read-only recovery admission for PAUSED/CLOSED sessions.
 */
export async function handleSessionRoomConnect(request: Request, env: Env): Promise<Response> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('Device authentication is required')
  }
  const auth = await verifyDeviceAccessToken(env, authorization.slice('Bearer '.length).trim())

  const body = (await parseJsonRequest(request)) as { publicSessionId?: unknown; clientType?: unknown; recovery?: unknown; closePaused?: unknown }
  const publicSessionId = typeof body.publicSessionId === 'string' ? body.publicSessionId : ''
  if (!PUBLIC_SESSION_ID_PATTERN.test(publicSessionId)) {
    throw new Error('A collaboration session ID is required')
  }
  const clientType = body.clientType === 'web' ? 'web' : 'electron'

  const closePaused = body.closePaused === true
  const recovery = body.recovery === true || closePaused
  const access = await authorizeSessionRoomInConvex(env, auth, publicSessionId, recovery)
  if (closePaused && access.role !== 'project_manager') throw new Error('Only a session manager can close a paused session')
  const sessionAccess = closePaused ? 'paused_close' as const : 'recovery' as const
  const roomId = `session:${publicSessionId}`
  const token = await signSessionToken(env, {
    sub: access.identityKey,
    principalId: access.principalId,
    projectId: access.projectId,
    roomId,
    clientType,
    protocolVersion: SESSION_ROOM_PROTOCOL_VERSION,
    sessionRole: access.role,
    sessionKeyVersion: access.keyVersion,
    ...(recovery ? { sessionAccess } : {}),
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
    keyVersion: access.keyVersion,
    ...(recovery ? { sessionAccess } : {}),
  })
}
