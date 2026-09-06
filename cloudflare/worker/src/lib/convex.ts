import type {
  ConvexPersistedUpdate,
  ConvexSessionContext,
  DeviceAuthChallengeClaims,
  DeviceAccessClaims,
  Env,
  SessionRequestBody,
} from '../types'
import { ConvexHttpClient } from 'convex/browser'
import type { FunctionReference } from 'convex/server'
import { isTokenIssuedAfterRevocationBoundary } from '../../../../shared/deviceIdentity'
import type { DevAppRuntimeReleaseImage } from '../../../../shared/devAppContainedRuntime'
import type { DevAppParts } from '../../../../shared/devAppParts'

type AnyQueryReference = FunctionReference<'query', 'public', Record<string, unknown>, unknown>
type AnyMutationReference = FunctionReference<'mutation', 'public', Record<string, unknown>, unknown>

interface LocalDeviceProfileInfo {
  principalId: string
  user: {
    principalId: string
    identityKey: string
    displayName: string
    avatarUrl: string | null
    platform: string
  }
  personalWorkspace: {
    id: string
    workspaceId: string
    workspaceName: string
    organizationId: string
    organizationName: string
    role: 'admin'
    status: 'active'
    workspaceType: 'personal'
  }
  authentication: {
    status: 'active'
    signingKeyVersion: number
    tokenValidAfter: number
  }
}

export async function persistDeviceAuthChallengeInConvex(
  env: Env,
  args: { nonce: string; identityKey: string; requestFingerprint?: string; expiresAt: number },
): Promise<void> {
  await runMutation(env, 'devicePrincipals:createDeviceAuthChallengeFromServer', {
    serverSecret: env.AI_GATEWAY_SECRET,
    ...args,
  })
}

export async function consumeDeviceAuthChallengeInConvex(
  env: Env,
  args: { nonce: string; identityKey: string },
): Promise<void> {
  await runMutation(env, 'devicePrincipals:consumeDeviceAuthChallengeFromServer', {
    serverSecret: env.AI_GATEWAY_SECRET,
    ...args,
  })
}

export async function createOrganizationRecoveryGrantInConvex(
  env: Env,
  args: { organizationId: string; actorIdentityKey: string; verifierHash: string; expiresAt: number },
): Promise<void> {
  await runMutation(env, 'organizations:createRecoveryGrantFromServer', {
    serverSecret: env.AI_GATEWAY_SECRET,
    ...args,
  })
}

export async function redeemOrganizationRecoveryGrantInConvex(
  env: Env,
  args: { targetIdentityKey: string; verifierHash: string },
): Promise<{ organizationId: string; recovered: true }> {
  return await runMutation(env, 'organizations:redeemRecoveryGrantFromServer', {
    serverSecret: env.AI_GATEWAY_SECRET,
    ...args,
  })
}

export async function ensureDevicePrincipalFromConvex(
  env: Env,
  identity: DeviceAuthChallengeClaims,
): Promise<LocalDeviceProfileInfo> {
  return runMutation<LocalDeviceProfileInfo>(env, 'devicePrincipals:ensureDevicePrincipalFromServer', {
    serverSecret: env.AI_GATEWAY_SECRET,
    identityKey: identity.identityKey,
    platform: identity.platform,
    encryptionPublicKeyJwk: identity.encryptionPublicKeyJwk,
    encryptionPublicKeyAlgorithm: identity.encryptionPublicKeyAlgorithm,
    encryptionFingerprint: identity.encryptionFingerprint,
    signingPublicKeyJwk: identity.signingPublicKeyJwk,
    signingPublicKeyAlgorithm: identity.signingPublicKeyAlgorithm,
    signingFingerprint: identity.signingFingerprint,
  })
}

interface ProjectAccessResult {
  canAccess: boolean
  canEdit: boolean
}

interface DevicePrincipalInfo {
  principalId: string
  identityKey: string
  displayName: string
  platform: string
  encryptionPublicKeyJwk: string
  encryptionPublicKeyAlgorithm: string
  encryptionFingerprint: string
  signingFingerprint: string
  status: 'active'
  signingKeyVersion: number
  tokenValidAfter: number
}

export async function requireActiveDeviceAccessInConvex(
  env: Env,
  auth: DeviceAccessClaims,
): Promise<DevicePrincipalInfo> {
  const principal = await runServerQuery<DevicePrincipalInfo | null>(env, 'devicePrincipals:getDevicePrincipalForServer', {
    identityKey: auth.sub,
  })
  if (
    !principal ||
    auth.key_version !== principal.signingKeyVersion ||
    !isTokenIssuedAfterRevocationBoundary(auth.iat, principal.tokenValidAfter)
  ) {
    throw new Error('Device session has been revoked')
  }
  return principal
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

async function runMutation<T>(env: Env, name: string, args: Record<string, unknown>): Promise<T> {
  return (await getClient(env).mutation(asMutation(name), args)) as T
}

export async function authorizeDevAppRuntimeBuildInConvex(
  env: Env,
  auth: DeviceAccessClaims,
  args: { projectId: string; reservationId: string },
): Promise<{ organizationId: string }> {
  await requireActiveDeviceAccessInConvex(env, auth)
  const result = await runServerQuery<{ allowed: boolean; organizationId: string | null }>(
    env,
    'devApps:getRuntimeBuildAuthorizationForServer',
    {
      identityKey: auth.sub,
      projectId: args.projectId,
      reservationId: args.reservationId,
    },
  )
  if (!result.allowed) throw new Error('The DevApp runtime build is not authorized')
  if (!result.organizationId) throw new Error('The DevApp runtime build has no owning organization')
  return { organizationId: result.organizationId }
}

export async function authorizeDevAppRuntimePullInConvex(
  env: Env,
  auth: DeviceAccessClaims,
  args: {
    organizationId: string
    publicationId: string
    releaseId: string
    manifestDigest: string
  },
): Promise<void> {
  await requireActiveDeviceAccessInConvex(env, auth)
  const result = await runServerQuery<{ allowed: boolean }>(env, 'devApps:getRuntimePullAuthorizationForServer', {
    identityKey: auth.sub,
    ...args,
  })
  if (!result.allowed) throw new Error('The DevApp runtime image pull is not authorized')
}

export interface HostedDevAppRuntimeAuthorization {
  id: string
  version: number
  contentHash: string
  runtimeKind: 'static' | 'service'
  parts: DevAppParts
  runtimeSourceDigest: string
  packageManifestDigest: string
  runtimeImage: DevAppRuntimeReleaseImage
}

export async function authorizeHostedDevAppRuntimeInConvex(
  env: Env,
  auth: DeviceAccessClaims,
  args: {
    organizationId: string
    publicationId: string
    releaseId: string
  },
): Promise<HostedDevAppRuntimeAuthorization> {
  await requireActiveDeviceAccessInConvex(env, auth)
  const result = await runServerQuery<{
    allowed: boolean
    release?: HostedDevAppRuntimeAuthorization
  }>(env, 'devApps:getHostedRuntimeAuthorizationForServer', {
    identityKey: auth.sub,
    ...args,
  })
  if (!result.allowed || !result.release) {
    throw new Error('The hosted DevApp runtime is not authorized')
  }
  return result.release
}

export async function registerDevAppRuntimeBuildInConvex(
  env: Env,
  args: {
    identityKey: string
    projectId: string
    reservationId: string
    buildId: string
    sourceDigest: string
    packageManifestDigest: string
  },
): Promise<void> {
  await runMutation(env, 'devApps:registerRuntimeBuildFromServer', {
    serverSecret: env.AI_GATEWAY_SECRET,
    ...args,
  })
}

export async function completeDevAppRuntimeBuildInConvex(
  env: Env,
  args: {
    buildId: string
    status: 'building' | 'ready' | 'failed'
    runtimeImage?: DevAppRuntimeReleaseImage
    runtimeParts?: DevAppParts
    error?: string
  },
): Promise<void> {
  await runMutation(env, 'devApps:completeRuntimeBuildFromServer', {
    serverSecret: env.AI_GATEWAY_SECRET,
    ...args,
  })
}

async function runServerQuery<T>(env: Env, name: string, args: Record<string, unknown>): Promise<T> {
  return (await getClient(env).query(asQuery(name), {
    ...args,
    serverSecret: env.AI_GATEWAY_SECRET,
  })) as T
}

async function runQuery<T>(env: Env, name: string, args: Record<string, unknown>): Promise<T> {
  return (await getClient(env).query(asQuery(name), args)) as T
}

export async function createCollabSessionFromConvex(
  env: Env,
  body: SessionRequestBody,
  auth: DeviceAccessClaims,
): Promise<ConvexSessionContext> {
  const principal = await requireActiveDeviceAccessInConvex(env, auth)
  const access = await runServerQuery<ProjectAccessResult>(env, 'projectMembers:getProjectAccessForServer', {
    projectId: body.projectId,
    userId: principal.principalId,
  })
  if (!access.canAccess || !access.canEdit) {
    throw new Error('The authenticated device cannot access this project')
  }

  const roomId = `project:${body.projectId}`
  const encryption = await runServerQuery<EncryptionBootstrapResult>(env, 'yjs:getEncryptionBootstrap', {
    projectId: body.projectId,
    roomId,
    userId: principal.principalId,
    deviceId: principal.identityKey,
  })

  return {
    principalId: principal.principalId,
    identityKey: principal.identityKey,
    displayName: principal.displayName,
    projectId: body.projectId,
    roomId,
    encryptionFingerprint: principal.encryptionFingerprint,
    encryptionPublicKeyJwk: principal.encryptionPublicKeyJwk,
    encryption,
  }
}

export async function fetchYjsDeltasFromConvex(
  env: Env,
  projectId: string,
  _roomId: string,
  knownSeq: number,
): Promise<ConvexPersistedUpdate[]> {
  const updates = await runQuery<Array<{ seq?: number; update?: ArrayBuffer }>>(env, 'yjs:getUpdatesAfterSeq', {
    projectId,
    sinceSeq: knownSeq,
    limit: 128,
    serverSecret: env.AI_GATEWAY_SECRET,
  })

  return updates
    .filter((update) => typeof update.seq === 'number' && update.update instanceof ArrayBuffer)
    .map((update) => ({
      seq: update.seq as number,
      updateBinary: toBase64(new Uint8Array(update.update as ArrayBuffer)),
    }))
}

export async function persistYjsUpdateToConvex(
  env: Env,
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
    serverSecret: env.AI_GATEWAY_SECRET,
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
    serverSecret: env.AI_GATEWAY_SECRET,
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
  const entries = await runQuery<
    Array<{
      clientId: string
      update?: ArrayBuffer
      expiresAt?: number
    }>
  >(env, 'yjsAwareness:getActiveAwareness', { projectId, serverSecret: env.AI_GATEWAY_SECRET })

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
