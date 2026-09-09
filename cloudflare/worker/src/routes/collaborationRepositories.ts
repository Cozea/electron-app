import { COLLABORATION_PROTOCOL_REVISION, CollaborationProtocolError, isCheckpointRead, parseCheckpointRequest, parseRoomAuthority, protocolRecord } from "../../../../shared/collaborationProtocol"
import { ConvexHttpClient } from "convex/browser"
import { makeFunctionReference } from "convex/server"
import {
  advancePublishedBase,
  authorizePushVerification,
  authorizeRepositoryOperation,
  recordRepositoryAccessEvent,
} from '../lib/collaborationRepositoryConvex'
import {
  mintGitHubInstallationCredential,
  resolveGitHubBranch,
  verifyGitHubBranchHead,
} from '../lib/githubApp'
import { requireActiveDeviceAccessInConvex } from '../lib/convex'
import { verifyDeviceAccessToken } from '../lib/jwt'
import { jsonResponse, protocolError } from '../lib/protocol'
import { parseJsonRequest } from '../lib/validation'
import type { DeviceAccessClaims, Env } from '../types'
import type {
  CollaborationRepositoryCredentialOperation,
  CollaborationRepositoryCredentialResponse,
  CollaborationPushVerificationResponse,
} from '../../../../shared/collaborationRepository'

export class RepositoryAuthenticationError extends Error {}

function requiredString(value: unknown, label: string, maxLength = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} is invalid`)
  }
  return value.trim()
}

async function authenticate(request: Request, env: Env): Promise<DeviceAccessClaims> {
  try {
    const authorization = request.headers.get('authorization')
    if (!authorization?.startsWith('Bearer ')) throw new Error('Missing bearer token')
    const auth = await verifyDeviceAccessToken(env, authorization.slice(7).trim())
    await requireActiveDeviceAccessInConvex(env, auth)
    return auth
  } catch {
    throw new RepositoryAuthenticationError('Device authentication is required or expired')
  }
}

function parseOperation(value: unknown): CollaborationRepositoryCredentialOperation {
  if (value !== 'read' && value !== 'write') throw new Error('operation must be read or write')
  return value
}

export async function handleCollaborationRepositoryCredential(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const projectId = requiredString(body.projectId, 'projectId', 128)
  const operation = parseOperation(body.operation)

  const authorization = operation === 'write'
    ? await (async () => {
        const sessionId = requiredString(body.sessionId, 'sessionId', 128)
        return await authorizePushVerification(env, { identityKey: auth.sub, sessionId })
      })()
    : await authorizeRepositoryOperation(env, { identityKey: auth.sub, projectId, operation })

  if (!authorization) throw new Error('Repository access is not authorized')

  const credential = await mintGitHubInstallationCredential(env, {
    installationId: authorization.repository.installationId,
    repositoryNumericId: authorization.repository.repositoryNumericId,
    operation,
  })
  await recordRepositoryAccessEvent(env, {
    authorizationId: authorization.authorizationId,
    principalId: authorization.principalId,
    operation,
    outcome: 'issued',
    tokenExpiresAt: credential.expiresAt,
  })

  const result: CollaborationRepositoryCredentialResponse = {
    repository: authorization.repository,
    operation,
    username: 'x-access-token',
    token: credential.token,
    expiresAt: credential.expiresAt,
  }
  return jsonResponse(result, { headers: { 'cache-control': 'no-store' } })
}

export async function handleVerifyCollaborationPush(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const sessionId = requiredString(body.sessionId, 'sessionId', 128)
  const commitSha = requiredString(body.commitSha, 'commitSha', 40).toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error('commitSha is invalid')

  const client = new ConvexHttpClient(env.CONVEX_URL)
  const existing = await client.query(makeFunctionReference<"query">("collaborationSessions:publicationReceiptForServer"),
    { serverSecret: env.AI_GATEWAY_SECRET, identityKey: auth.sub, sessionId, commitSha }) as CollaborationPushVerificationResponse | null
  if (existing) {
    const roomReceipt = await env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(`session:${sessionId}`)).fetch(new Request("https://internal/internal/base-advanced", {
      method: "POST", headers: { authorization: `Bearer ${env.AI_GATEWAY_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ commitSha: existing.commitSha, coveredThroughSequence: existing.coveredThroughSequence }),
    }))
    if (!roomReceipt.ok) throw new Error("Publication is verified but the room did not acknowledge it; retry Push")
    return jsonResponse(existing, { headers: { "cache-control": "no-store" } })
  }
  const authorization = await authorizePushVerification(env, { identityKey: auth.sub, sessionId })
  if (!authorization) throw new Error('Push verification is not authorized')
  if (authorization.session.pendingCommitSha !== commitSha) {
    throw new Error('Remote commit does not match the prepared collaboration commit')
  }

  const verified = await verifyGitHubBranchHead(env, {
    installationId: authorization.repository.installationId,
    repositoryNumericId: authorization.repository.repositoryNumericId,
    owner: authorization.repository.owner,
    name: authorization.repository.name,
    branch: authorization.session.sessionBranch,
    expectedCommitSha: commitSha,
  })
  if (!verified) throw new Error('GitHub session branch does not point at the prepared commit')

  await advancePublishedBase(env, {
    sessionId,
    publishedByPrincipalId: authorization.principalId,
    commitSha,
    coveredThroughSequence: authorization.session.pendingCommitThroughSequence,
  })
  const roomAck = await env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(`session:${sessionId}`)).fetch(new Request("https://internal/internal/base-advanced", {
    method: "POST", headers: { authorization: `Bearer ${env.AI_GATEWAY_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ commitSha, coveredThroughSequence: authorization.session.pendingCommitThroughSequence }),
  }))
  if (!roomAck.ok) throw new Error("Published base was verified but live-room acknowledgement failed; retry Push")
  await recordRepositoryAccessEvent(env, {
    authorizationId: authorization.authorizationId,
    principalId: authorization.principalId,
    operation: 'write',
    outcome: 'verified',
    sessionId: authorization.session.documentId,
    commitSha,
  })

  const result: CollaborationPushVerificationResponse = {
    verified: true,
    sessionId,
    sessionBranch: authorization.session.sessionBranch,
    commitSha,
    coveredThroughSequence: authorization.session.pendingCommitThroughSequence,
    baseAdvanced: true,
  }
  return jsonResponse(result, { headers: { 'cache-control': 'no-store' } })
}


export async function handleCollaborationWorkspaceContext(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const sessionId = requiredString(body.sessionId, "sessionId", 128)
  const client = new ConvexHttpClient(env.CONVEX_URL)
  const context = await client.query(makeFunctionReference<"query">("collaborationRoomAuthorization:workspaceContextForServer"),
    { serverSecret: env.AI_GATEWAY_SECRET, identityKey: auth.sub, sessionId }) as any
  const authorization = await authorizeRepositoryOperation(env, { identityKey: auth.sub, projectId: context.session.projectId, operation: "read" })
  if (!authorization || authorization.repository.repositoryId !== context.session.repositoryId) throw new Error("Session repository authorization changed")
  return jsonResponse({ ...context, cloneUrl: authorization.repository.cloneUrl }, { headers: { "cache-control": "no-store" } })
}

export async function handleResolveCollaborationBranch(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const projectId = requiredString(body.projectId, "projectId", 128)
  const authorization = await authorizeRepositoryOperation(env, { identityKey: auth.sub, projectId, operation: "read" })
  if (!authorization) throw new Error("Repository access denied")
  const branch = body.branch === undefined ? authorization.repository.defaultBranch : requiredString(body.branch, "branch", 255)
  const resolved = await resolveGitHubBranch(env, { installationId: authorization.repository.installationId,
    repositoryNumericId: authorization.repository.repositoryNumericId, owner: authorization.repository.owner,
    name: authorization.repository.name, branch })
  return jsonResponse({ ...resolved, resolutionId: crypto.randomUUID(), repositoryId: authorization.repository.repositoryId,
    fullName: authorization.repository.fullName }, { headers: { "cache-control": "no-store" } })
}

export async function handleCollaborationCheckpoint(request: Request, env: Env): Promise<Response> {
  try {
    const auth = await authenticate(request, env)
    const body = protocolRecord(await parseJsonRequest(request), "Checkpoint request")
    const sessionId = requiredString(body.sessionId, "sessionId", 128)
    const command = parseCheckpointRequest(body)
    const client = new ConvexHttpClient(env.CONVEX_URL)
    let raw = protocolRecord(await client.query(makeFunctionReference<"query">("collaborationRoomAuthorization:authorizeSessionForServer"),
      { serverSecret: env.AI_GATEWAY_SECRET, identityKey: auth.sub, sessionId }), "Session authority")
    if (raw.allowed !== true) throw new CollaborationProtocolError("DEVICE_REVOKED", "Session membership is unavailable", 403)
    if (body.rotation === true && raw.pendingKeyVersion) {
      if (raw.role !== "editor") throw new CollaborationProtocolError("READ_ONLY", "Observers cannot rotate room keys", 403)
      raw = protocolRecord(await client.query(makeFunctionReference<"query">("collaborationEncryption:rotationCheckpointAuthorityForServer"),
        { serverSecret: env.AI_GATEWAY_SECRET, principalId: raw.principalId, sessionId }), "Rotation authority")
    }
    const authority = parseRoomAuthority({ ...raw, sessionId })
    if (!isCheckpointRead(command) && authority.role !== "editor") throw new CollaborationProtocolError("READ_ONLY", "Observers can read but cannot publish checkpoints", 403)
    const response = await env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(authority.roomId)).fetch(new Request("https://internal/internal/checkpoint", {
      method: "POST", headers: { authorization: `Bearer ${env.AI_GATEWAY_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ authority, request: { ...command, protocolRevision: COLLABORATION_PROTOCOL_REVISION } }),
    }))
    if (!response.ok) return response
    const result = protocolRecord(await response.json(), "Checkpoint response")
    if (result.checkpoint && body.rotation === true && authority.previousKeyVersion) {
      const checkpoint = protocolRecord(result.checkpoint, "Rotation checkpoint")
      if (checkpoint.keyVersion === authority.keyVersion) await client.mutation(makeFunctionReference<"mutation">("collaborationEncryption:activateRotationFromServer"),
        { serverSecret: env.AI_GATEWAY_SECRET, sessionId, keyVersion: authority.keyVersion, sequence: checkpoint.sequence })
    }
    return jsonResponse(result, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    if (error instanceof CollaborationProtocolError) return protocolError(error.code, error.message, { status: error.status }, error.recoverable)
    throw error
  }
}
