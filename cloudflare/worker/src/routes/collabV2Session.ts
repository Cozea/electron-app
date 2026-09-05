import type { Env, SessionDescriptor, SessionRequestBody } from '../types'
import { signSessionToken, verifyDeviceAccessToken } from '../lib/jwt'
import { COLLAB_PROTOCOL_VERSION, jsonResponse } from '../lib/protocol'
import { parseJsonRequest } from '../lib/validation'
import { createExplicitCollaborationContext } from '../lib/collaborationV2Convex'
import { getCollabCapabilities } from './collabCapabilities'

function requiredString(value: unknown, label: string, maxLength = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} is invalid`)
  }
  return value.trim()
}

function parseBody(value: unknown): SessionRequestBody & { sessionId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Collaboration session request must be a JSON object')
  }
  const body = value as Record<string, unknown>
  const clientType = body.clientType === 'web' ? 'web' : body.clientType === 'electron' ? 'electron' : null
  if (!clientType) throw new Error('clientType is invalid')
  return {
    projectId: requiredString(body.projectId, 'projectId', 128),
    sessionId: requiredString(body.sessionId, 'sessionId', 128),
    clientType,
    deviceId: requiredString(body.deviceId, 'deviceId', 256),
    deviceLabel: requiredString(body.deviceLabel, 'deviceLabel', 256),
    platform: requiredString(body.platform, 'platform', 64),
    publicKeyJwk: requiredString(body.publicKeyJwk, 'publicKeyJwk', 8192),
    publicKeyAlgorithm: requiredString(body.publicKeyAlgorithm, 'publicKeyAlgorithm', 128),
    fingerprint: requiredString(body.fingerprint, 'fingerprint', 256),
  }
}

function toWsUrl(request: Request, roomId: string): string {
  const url = new URL(request.url)
  url.pathname = '/collab/ws'
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.search = new URLSearchParams({ roomId }).toString()
  return url.toString()
}

export async function handleCollabV2Session(request: Request, env: Env): Promise<Response> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('Device authentication is required')
  }
  const auth = await verifyDeviceAccessToken(env, authorization.slice('Bearer '.length).trim())
  const body = parseBody(await parseJsonRequest(request))
  const sessionContext = await createExplicitCollaborationContext(env, body, auth)
  const protocolVersion = env.COLLAB_PROTOCOL_VERSION ?? COLLAB_PROTOCOL_VERSION
  const token = await signSessionToken(env, {
    sub: sessionContext.userId,
    userId: sessionContext.userId,
    projectId: sessionContext.projectId,
    sessionId: sessionContext.sessionId,
    roomId: sessionContext.roomId,
    deviceId: sessionContext.deviceId,
    clientType: body.clientType,
    protocolVersion,
  })

  const response: SessionDescriptor = {
    projectId: sessionContext.projectId,
    sessionId: sessionContext.sessionId,
    roomId: sessionContext.roomId,
    collabWsUrl: toWsUrl(request, sessionContext.roomId),
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
