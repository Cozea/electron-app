import { ConvexHttpClient } from 'convex/browser'
import type { FunctionReference } from 'convex/server'

import type { DeviceAccessClaims, EncryptionBootstrap, Env, SessionRequestBody } from '../types'
import { requireActiveDeviceAccessInConvex } from './convex'

type QueryReference = FunctionReference<'query', 'public', Record<string, unknown>, unknown>
type MutationReference = FunctionReference<'mutation', 'public', Record<string, unknown>, unknown>

function queryReference(name: string): QueryReference {
  return name as unknown as QueryReference
}

function mutationReference(name: string): MutationReference {
  return name as unknown as MutationReference
}

function client(env: Env): ConvexHttpClient {
  return new ConvexHttpClient(env.CONVEX_URL)
}

export async function createExplicitCollaborationContext(
  env: Env,
  body: SessionRequestBody & { sessionId: string },
  auth: DeviceAccessClaims,
): Promise<{
  role: 'editor' | 'observer'
  userId: string
  projectId: string
  sessionId: string
  roomId: string
  deviceId: string
  deviceLabel: string
  deviceFingerprint: string
  devicePublicKeyJwk: string
  encryption: EncryptionBootstrap
}> {
  if (auth.sub !== body.deviceId) {
    throw new Error('Authenticated device does not match the collaboration device')
  }
  const principal = await requireActiveDeviceAccessInConvex(env, auth)
  if (
    principal.encryptionPublicKeyJwk !== body.publicKeyJwk ||
    principal.encryptionPublicKeyAlgorithm !== body.publicKeyAlgorithm ||
    principal.encryptionFingerprint !== body.fingerprint
  ) {
    throw new Error('Collaboration encryption key does not match the authenticated device')
  }

  const authorization = await client(env).query(
    queryReference('collaborationRoomAuthorization:authorizeSessionForServer'),
    {
      serverSecret: env.AI_GATEWAY_SECRET,
      identityKey: auth.sub,
      sessionId: body.sessionId,
    },
  ) as {
    allowed: boolean
    role?: 'editor' | 'observer'
    userId?: string
    projectId?: string
    sessionId?: string
    roomId?: string
  }
  if (
    !authorization.allowed ||
    !authorization.userId ||
    !authorization.projectId ||
    !authorization.sessionId ||
    !authorization.roomId
  ) {
    throw new Error('The authenticated device cannot join this collaboration session')
  }
  if (authorization.projectId !== body.projectId) {
    throw new Error('Collaboration session does not belong to the requested project')
  }

  const encryption = await client(env).query(queryReference('collaborationEncryption:bootstrapForServer'), {
    serverSecret: env.AI_GATEWAY_SECRET,
    sessionId: body.sessionId,
    userId: authorization.userId,
  }) as EncryptionBootstrap

  return {
    role: authorization.role === 'editor' ? 'editor' : 'observer',
    userId: authorization.userId,
    projectId: authorization.projectId,
    sessionId: authorization.sessionId,
    roomId: authorization.roomId,
    deviceId: body.deviceId,
    deviceLabel: principal.deviceLabel,
    deviceFingerprint: body.fingerprint,
    devicePublicKeyJwk: body.publicKeyJwk,
    encryption,
  }
}

export async function updateAuthoritativeRoomHead(
  env: Env,
  sessionId: string,
  roomHeadSequence: number,
): Promise<void> {
  await client(env).mutation(
    mutationReference('collaborationSessions:updateRoomHeadFromServer'),
    {
      serverSecret: env.AI_GATEWAY_SECRET,
      sessionId,
      roomHeadSequence,
    },
  )
}

export interface RoomAuthority {
  rotationRequired?: boolean
  pendingKeyVersion?: number | null
  keyVersion?: number | null
  allowed: boolean
  projectId?: string
  roomId?: string
  role?: 'editor' | 'observer'
}

export async function authorizeRoomConnection(env: Env, userId: string, sessionId: string): Promise<RoomAuthority> {
  return await client(env).query(queryReference('collaborationRoomAuthorization:authorizeConnectionForServer'), {
    serverSecret: env.AI_GATEWAY_SECRET, userId, sessionId,
  }) as RoomAuthority
}
