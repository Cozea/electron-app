import {
  advancePublishedBase,
  authorizePushVerification,
  authorizeRepositoryOperation,
  recordRepositoryAccessEvent,
} from '../lib/collaborationRepositoryConvex'
import {
  mintGitHubInstallationCredential,
  verifyGitHubBranchHead,
} from '../lib/githubApp'
import { requireActiveDeviceAccessInConvex } from '../lib/convex'
import { verifyDeviceAccessToken } from '../lib/jwt'
import { jsonResponse } from '../lib/protocol'
import { parseJsonRequest } from '../lib/validation'
import type { DeviceAccessClaims, Env } from '../types'
import type {
  CollaborationRepositoryCredentialOperation,
  CollaborationRepositoryCredentialResponse,
  CollaborationPushVerificationResponse,
} from '../../../../shared/collaborationRepository'

function requiredString(value: unknown, label: string, maxLength = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} is invalid`)
  }
  return value.trim()
}

async function authenticate(request: Request, env: Env): Promise<DeviceAccessClaims> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) throw new Error('Device authentication is required')
  const auth = await verifyDeviceAccessToken(env, authorization.slice(7).trim())
  await requireActiveDeviceAccessInConvex(env, auth)
  return auth
}

function parseOperation(value: unknown): CollaborationRepositoryCredentialOperation {
  if (value !== 'read' && value !== 'write') {
    throw new Error('operation must be read or write')
  }
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
        const push = await authorizePushVerification(env, { identityKey: auth.sub, sessionId })
        if (!push || String(push.session.projectId) !== projectId) return null
        return push
      })()
    : await authorizeRepositoryOperation(env, {
        identityKey: auth.sub,
        projectId,
        operation,
      })

  if (!authorization) throw new Error('Repository access is not authorized')

  const credential = await mintGitHubInstallationCredential(env, {
    installationId: authorization.binding.installationId,
    repositoryNumericId: authorization.binding.repositoryNumericId,
    operation,
  })
  await recordRepositoryAccessEvent(env, {
    bindingId: authorization.bindingId,
    userId: authorization.userId,
    operation,
    outcome: 'issued',
    tokenExpiresAt: credential.expiresAt,
  })

  const result: CollaborationRepositoryCredentialResponse = {
    provider: 'github',
    repositoryId: authorization.binding.repositoryId,
    repositoryNumericId: authorization.binding.repositoryNumericId,
    fullName: authorization.binding.fullName,
    cloneUrl: authorization.binding.cloneUrl,
    defaultBranch: authorization.binding.defaultBranch,
    operation,
    username: 'x-access-token',
    token: credential.token,
    expiresAt: credential.expiresAt,
  }
  return jsonResponse(result)
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

  const authorization = await authorizePushVerification(env, {
    identityKey: auth.sub,
    sessionId,
  })
  if (!authorization) throw new Error('Push verification is not authorized')
  if (authorization.session.pendingCommitSha !== commitSha) {
    throw new Error('Remote commit does not match the prepared collaboration commit')
  }

  const verified = await verifyGitHubBranchHead(env, {
    installationId: authorization.binding.installationId,
    repositoryNumericId: authorization.binding.repositoryNumericId,
    owner: authorization.binding.owner,
    name: authorization.binding.name,
    branch: authorization.session.sessionBranch,
    expectedCommitSha: commitSha,
  })
  if (!verified) throw new Error('GitHub session branch does not point at the prepared commit')

  await advancePublishedBase(env, {
    sessionId,
    publishedByUserId: authorization.userId,
    commitSha,
    coveredThroughSequence: authorization.session.pendingCommitThroughSequence,
  })
  await recordRepositoryAccessEvent(env, {
    bindingId: authorization.bindingId,
    userId: authorization.userId,
    operation: 'write',
    outcome: 'verified',
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
  return jsonResponse(result)
}
