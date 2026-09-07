import { ConvexHttpClient } from 'convex/browser'
import type { FunctionReference } from 'convex/server'

import type { DeviceAccessClaims, EncryptionBootstrap, Env } from '../types'
import { requireActiveDeviceAccessInConvex } from './convex'

type QueryReference = FunctionReference<'query', 'public', Record<string, unknown>, unknown>
type MutationReference = FunctionReference<'mutation', 'public', Record<string, unknown>, unknown>

function queryReference(name: string): QueryReference { return name as unknown as QueryReference }
function mutationReference(name: string): MutationReference { return name as unknown as MutationReference }
function client(env: Env): ConvexHttpClient { return new ConvexHttpClient(env.CONVEX_URL) }

export async function createExplicitCollaborationContext(
  env: Env,
  args: { projectId: string; sessionId: string },
  auth: DeviceAccessClaims,
): Promise<{
  principalId: string
  identityKey: string
  displayName: string
  projectId: string
  sessionId: string
  roomId: string
  encryptionFingerprint: string
  encryptionPublicKeyJwk: string
  encryption: EncryptionBootstrap
}> {
  const principal = await requireActiveDeviceAccessInConvex(env, auth)
  const authorization = await client(env).query(
    queryReference('collaborationRoomAuthorization:authorizeSessionForServer'),
    { serverSecret: env.AI_GATEWAY_SECRET, identityKey: auth.sub, sessionId: args.sessionId },
  ) as {
    allowed: boolean
    principalId?: string
    projectId?: string
    sessionId?: string
    roomId?: string
  }
  if (
    !authorization.allowed || !authorization.principalId || !authorization.projectId ||
    !authorization.sessionId || !authorization.roomId
  ) throw new Error('The authenticated device cannot join this collaboration session')
  if (authorization.principalId !== principal.principalId || authorization.projectId !== args.projectId) {
    throw new Error('Collaboration session authority does not match the authenticated principal/project')
  }

  const encryption = await client(env).query(queryReference('yjs:getEncryptionBootstrap'), {
    serverSecret: env.AI_GATEWAY_SECRET,
    projectId: authorization.projectId,
    roomId: authorization.roomId,
    principalId: principal.principalId,
  }) as EncryptionBootstrap

  return {
    principalId: principal.principalId,
    identityKey: principal.identityKey,
    displayName: principal.displayName,
    projectId: authorization.projectId,
    sessionId: authorization.sessionId,
    roomId: authorization.roomId,
    encryptionFingerprint: principal.encryptionFingerprint,
    encryptionPublicKeyJwk: principal.encryptionPublicKeyJwk,
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
    { serverSecret: env.AI_GATEWAY_SECRET, sessionId, roomHeadSequence },
  )
}
