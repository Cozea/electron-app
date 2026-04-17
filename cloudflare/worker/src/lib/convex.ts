import type {
  ConvexPersistedUpdate,
  ConvexSessionContext,
  Env,
  SessionRequestBody,
} from '../types'
import { ConvexHttpClient } from 'convex/browser'
import type { FunctionReference } from 'convex/server'

type AnyQueryReference = FunctionReference<'query', 'public', Record<string, unknown>, unknown>
type AnyMutationReference = FunctionReference<'mutation', 'public', Record<string, unknown>, unknown>

interface LocalDeviceProfileInfo {
  userId: string
  identity: {
    deviceId: string
    deviceLabel: string
    fingerprint: string | null
  }
}

interface ProjectAccessResult {
  canAccess: boolean
  canEdit: boolean
}

interface EncryptionBootstrapResult {
  roomId: string
  encryptionRequired: boolean
  status: 'room_not_initialized' | 'ready' | 'missing_for_device' | 'device_revoked'
  activeKeyVersion: number | null
  wrappedRoomKey: string | null
  wrapAlgorithm: string | null
  senderPublicKeyJwk: string | null
}

function asQuery(name: string): AnyQueryReference {
  return name as unknown as AnyQueryReference
}

function asMutation(name: string): AnyMutationReference {
  return name as unknown as AnyMutationReference
}

function getClient(env: Env): ConvexHttpClient {
  return new ConvexHttpClient(env.CONVEX_URL)
}

async function runMutation<T>(
  env: Env,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  return (await getClient(env).mutation(asMutation(name), args)) as T
}

async function runServerQuery<T>(
  env: Env,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  return (await getClient(env).query(asQuery(name), {
    ...args,
    serverSecret: env.AI_GATEWAY_SECRET,
  })) as T
}

async function runQuery<T>(
  env: Env,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  return (await getClient(env).query(asQuery(name), args)) as T
}

export async function createCollabSessionFromConvex(env: Env, body: SessionRequestBody): Promise<ConvexSessionContext> {
  const localProfile = await runMutation<LocalDeviceProfileInfo>(env, 'users:ensureLocalDeviceProfile', {
    deviceId: body.deviceId,
    deviceLabel: body.deviceLabel,
    platform: body.platform,
    fingerprint: body.fingerprint,
  })
  const access = await runServerQuery<ProjectAccessResult>(env, 'projectMembers:getProjectAccessForServer', {
    projectId: body.projectId,
    userId: localProfile.userId,
    deviceId: body.deviceId,
  })
  // In the current desktop product, device-backed local users may open projects
  // that are not represented as traditional shared memberships yet.
  // Keep the access result for future tightening, but do not block bootstrap here.
  if (!access.canAccess || !access.canEdit) {
    console.warn('[CloudflareCollab] Proceeding without explicit shared-project membership', {
      projectId: body.projectId,
      deviceId: body.deviceId,
      canAccess: access.canAccess,
      canEdit: access.canEdit,
    })
  }

  await runMutation(env, 'yjs:registerCollabDevice', {
    userId: localProfile.userId,
    deviceId: body.deviceId,
    deviceLabel: body.deviceLabel,
    platform: body.platform,
    publicKeyJwk: body.publicKeyJwk,
    publicKeyAlgorithm: body.publicKeyAlgorithm,
    fingerprint: body.fingerprint,
  })

  const roomId = `project:${body.projectId}`
  const encryption = await runQuery<EncryptionBootstrapResult>(env, 'yjs:getEncryptionBootstrap', {
    projectId: body.projectId,
    roomId,
    userId: localProfile.userId,
    deviceId: body.deviceId,
  })

  return {
    userId: localProfile.userId,
    projectId: body.projectId,
    roomId,
    deviceId: body.deviceId,
    deviceLabel: localProfile.identity.deviceLabel,
    deviceFingerprint: body.fingerprint,
    devicePublicKeyJwk: body.publicKeyJwk,
    encryption,
  }
}

export async function fetchYjsDeltasFromConvex(
  env: Env,
  projectId: string,
  _roomId: string,
  knownSeq: number,
): Promise<ConvexPersistedUpdate[]> {
  const updates = await runQuery<Array<{ seq?: number; update?: ArrayBuffer }>>(
    env,
    'yjs:getUpdatesAfterSeq',
    {
      projectId,
      sinceSeq: knownSeq,
      limit: 128,
    },
  )

  return updates
    .filter((update) => typeof update.seq === 'number' && update.update instanceof ArrayBuffer)
    .map((update) => ({
      seq: update.seq as number,
      updateBinary: toBase64(new Uint8Array(update.update as ArrayBuffer)),
    }))
}

export async function persistYjsUpdateToConvex(
    env,
    args: {
      projectId: string
      roomId: string
      clientId: string
      idempotencyKey: string
      updateBinary: string
      authorType: 'user' | 'agent'
      authorId: string
      timestamp: number
    },
): Promise<{ seq: number }> {
  const payload = fromBase64(args.updateBinary)
  const result = await runMutation<{ seq: number }>(env, 'yjs:broadcastUpdate', {
    projectId: args.projectId,
    roomId: args.roomId,
    idempotencyKey: args.idempotencyKey,
    update: payload.buffer,
    clientId: args.clientId,
    origin: `cloudflare:${args.authorType}:${args.authorId}`,
    timestamp: args.timestamp,
  })
  return { seq: result.seq }
}

export async function upsertAwarenessInConvex(
  env: Env,
  args: {
    projectId: string
    clientId: string
    awarenessBinary: string
    ttlMs: number
  },
): Promise<void> {
  const payload = fromBase64(args.awarenessBinary)
  await runMutation(env, 'yjsAwareness:upsertAwareness', {
    projectId: args.projectId,
    clientId: args.clientId,
    update: payload.buffer,
    ttlMs: args.ttlMs,
  })
}

export async function fetchActiveAwarenessFromConvex(
  env: Env,
  projectId: string,
): Promise<Array<{ clientId: string; awarenessBinary: string; expiresAt: number }>> {
  const entries = await runQuery<Array<{
    clientId: string
    update?: ArrayBuffer
    expiresAt?: number
  }>>(env, 'yjsAwareness:getActiveAwareness', { projectId })

  return entries
    .filter((entry) => entry.update instanceof ArrayBuffer)
    .map((entry) => ({
      clientId: entry.clientId,
      awarenessBinary: toBase64(new Uint8Array(entry.update as ArrayBuffer)),
      expiresAt: typeof entry.expiresAt === 'number' ? entry.expiresAt : Date.now() + 45_000,
    }))
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]!)
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
