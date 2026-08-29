import type { Env, SessionDescriptor } from '../types'
import { signSessionToken, verifyDeviceAccessToken } from '../lib/jwt'
import { COLLAB_PROTOCOL_VERSION, jsonResponse } from '../lib/protocol'
import { createCollabSessionFromConvex } from '../lib/convex'
import { getRoomIdForProject, parseJsonRequest, parseSessionRequestBody } from '../lib/validation'
import { getCollabCapabilities } from './collabCapabilities'

function toWsUrl(request: Request, roomId: string): string {
  const url = new URL(request.url)
  url.pathname = '/collab/ws'
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.search = new URLSearchParams({ roomId }).toString()
  return url.toString()
}

export async function handleCollabSession(request: Request, env: Env): Promise<Response> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('Device authentication is required')
  }
  const auth = await verifyDeviceAccessToken(env, authorization.slice('Bearer '.length).trim())
  const body = parseSessionRequestBody(await parseJsonRequest(request))
  const sessionContext = await createCollabSessionFromConvex(env, body, auth)
  const roomId = getRoomIdForProject(body.projectId)
  const protocolVersion = env.COLLAB_PROTOCOL_VERSION ?? COLLAB_PROTOCOL_VERSION
  const token = await signSessionToken(env, {
    sub: sessionContext.userId,
    userId: sessionContext.userId,
    projectId: sessionContext.projectId,
    roomId,
    deviceId: sessionContext.deviceId,
    clientType: body.clientType,
    protocolVersion,
  })

  const response: SessionDescriptor = {
    projectId: sessionContext.projectId,
    roomId,
    collabWsUrl: toWsUrl(request, roomId),
    token,
    protocolVersion,
    deviceId: sessionContext.deviceId,
    deviceLabel: sessionContext.deviceLabel,
    deviceFingerprint: sessionContext.deviceFingerprint,
    devicePublicKeyJwk: sessionContext.devicePublicKeyJwk,
    capabilities: getCollabCapabilities(env),
    encryption: sessionContext.encryption,
  }

  return jsonResponse(response)
}
