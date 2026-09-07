import type { Env, SessionDescriptor } from '../types'
import { signSessionToken, verifyDeviceAccessToken } from '../lib/jwt'
import { COLLAB_PROTOCOL_VERSION, jsonResponse } from '../lib/protocol'
import { parseJsonRequest } from '../lib/validation'
import { createExplicitCollaborationContext } from '../lib/collaborationV2Convex'
import { getCollabCapabilities } from './collabCapabilities'

function requiredString(value: unknown, label: string, maxLength = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(`${label} is invalid`)
  return value.trim()
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
  if (!authorization?.startsWith('Bearer ')) throw new Error('Device authentication is required')
  const auth = await verifyDeviceAccessToken(env, authorization.slice('Bearer '.length).trim())
  const raw = await parseJsonRequest(request)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Collaboration request must be an object')
  const body = raw as Record<string, unknown>
  const clientType = body.clientType === 'web' ? 'web' : body.clientType === 'electron' ? 'electron' : null
  if (!clientType) throw new Error('clientType is invalid')
  const projectId = requiredString(body.projectId, 'projectId', 128)
  const sessionId = requiredString(body.sessionId, 'sessionId', 128)

  const context = await createExplicitCollaborationContext(env, { projectId, sessionId }, auth)
  const protocolVersion = env.COLLAB_PROTOCOL_VERSION ?? COLLAB_PROTOCOL_VERSION
  const token = await signSessionToken(env, {
    sub: context.identityKey,
    principalId: context.principalId,
    projectId: context.projectId,
    sessionId: context.sessionId,
    roomId: context.roomId,
    clientType,
    protocolVersion,
  })

  const response: SessionDescriptor = {
    projectId: context.projectId,
    sessionId: context.sessionId,
    roomId: context.roomId,
    collabWsUrl: toWsUrl(request, context.roomId),
    token,
    protocolVersion,
    principalId: context.principalId,
    identityKey: context.identityKey,
    displayName: context.displayName,
    encryptionFingerprint: context.encryptionFingerprint,
    encryptionPublicKeyJwk: context.encryptionPublicKeyJwk,
    capabilities: getCollabCapabilities(env),
    encryption: context.encryption,
  }
  return jsonResponse(response, { headers: { 'cache-control': 'no-store' } })
}
