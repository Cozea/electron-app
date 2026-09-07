#!/usr/bin/env python3
from pathlib import Path
import subprocess

ARCHIVE = "origin/archive/pr141-pre-main-port"


def old(path: str) -> str:
    return subprocess.check_output(["git", "show", f"{ARCHIVE}:{path}"], text=True)


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)

# The hardened GitHub App implementation is identity-neutral and can be reused.
write("cloudflare/worker/src/lib/githubApp.ts", old("cloudflare/worker/src/lib/githubApp.ts"))

write("cloudflare/worker/src/lib/collaborationRepositoryConvex.ts", r'''import { ConvexHttpClient } from 'convex/browser'
import type { FunctionReference } from 'convex/server'

import type {
  CollaborationRepositoryCredentialOperation,
  CollaborationRepositoryDescriptor,
} from '../../../../shared/collaborationRepository'
import type { Env } from '../types'

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

export interface RepositoryAuthorization {
  allowed: true
  principalId: string
  authorizationId: string
  repository: CollaborationRepositoryDescriptor
}

export async function authorizeRepositoryOperation(
  env: Env,
  args: {
    identityKey: string
    projectId: string
    operation: CollaborationRepositoryCredentialOperation
  },
): Promise<RepositoryAuthorization | null> {
  const result = await client(env).query(
    queryReference('projectRepositoryAuthorizations:getCredentialContextForServer'),
    { serverSecret: env.AI_GATEWAY_SECRET, ...args },
  ) as { allowed: false } | RepositoryAuthorization
  return result.allowed ? result : null
}

export interface PushVerificationAuthorization extends RepositoryAuthorization {
  session: {
    id: string
    documentId: string
    sessionBranch: string
    pendingCommitSha: string
    pendingCommitThroughSequence: number
  }
}

export async function authorizePushVerification(
  env: Env,
  args: { identityKey: string; sessionId: string },
): Promise<PushVerificationAuthorization | null> {
  const result = await client(env).query(
    queryReference('projectRepositoryAuthorizations:getPushVerificationContextForServer'),
    { serverSecret: env.AI_GATEWAY_SECRET, ...args },
  ) as { allowed: false } | PushVerificationAuthorization
  return result.allowed ? result : null
}

export async function recordRepositoryAccessEvent(
  env: Env,
  args: {
    authorizationId: string
    principalId: string
    operation: CollaborationRepositoryCredentialOperation
    outcome: 'issued' | 'verified' | 'rejected'
    sessionId?: string
    tokenExpiresAt?: number
    commitSha?: string
  },
): Promise<void> {
  await client(env).mutation(
    mutationReference('projectRepositoryAuthorizations:recordAccessEventFromServer'),
    { serverSecret: env.AI_GATEWAY_SECRET, ...args },
  )
}

export async function advancePublishedBase(
  env: Env,
  args: {
    sessionId: string
    publishedByPrincipalId: string
    commitSha: string
    coveredThroughSequence: number
  },
): Promise<void> {
  await client(env).mutation(
    mutationReference('collaborationSessions:advancePublishedBaseFromServer'),
    { serverSecret: env.AI_GATEWAY_SECRET, ...args },
  )
}
''')

write("cloudflare/worker/src/routes/collaborationRepositories.ts", r'''import {
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
''')

# Extend worker env only with authorization metadata; repository source remains project.repo in Convex.
types_path = Path("cloudflare/worker/src/types.ts")
types = types_path.read_text()
anchor = "  AI_GATEWAY_SECRET: string\n"
addition = "  GITHUB_APP_ID?: string\n  GITHUB_APP_PRIVATE_JWK?: string\n  GITHUB_API_BASE_URL?: string\n"
if addition not in types:
    if anchor not in types: raise SystemExit("worker Env anchor missing")
    types = types.replace(anchor, anchor + addition, 1)
types_path.write_text(types)

# Wire the two repository endpoints without replacing current main's device-auth/session routes.
index_path = Path("cloudflare/worker/src/index.ts")
index = index_path.read_text()
import_block = "import {\n  handleCollaborationRepositoryCredential,\n  handleVerifyCollaborationPush,\n  RepositoryAuthenticationError,\n} from './routes/collaborationRepositories'\n"
if import_block not in index:
    anchor = "import { handleCreateRecoveryGrant, handleRedeemRecoveryGrant } from './routes/deviceRecovery'\n"
    if anchor not in index: raise SystemExit("worker import anchor missing")
    index = index.replace(anchor, anchor + import_block, 1)
route_anchor = "      if (request.method === 'POST' && url.pathname === '/devapps/runtime-builds') {\n"
route_block = """      if (request.method === 'POST' && url.pathname === '/collab/repository/credential') {\n        try {\n          return await handleCollaborationRepositoryCredential(request, env)\n        } catch (error) {\n          const authenticationFailure = error instanceof RepositoryAuthenticationError\n          return protocolError(\n            authenticationFailure ? 'UNAUTHORIZED' : 'REPOSITORY_ACCESS_REJECTED',\n            error instanceof Error ? error.message : 'Repository access failed',\n            { status: authenticationFailure ? 401 : 403 },\n            false,\n            origin,\n          )\n        }\n      }\n\n      if (request.method === 'POST' && url.pathname === '/collab/repository/verify-push') {\n        try {\n          return await handleVerifyCollaborationPush(request, env)\n        } catch (error) {\n          const authenticationFailure = error instanceof RepositoryAuthenticationError\n          return protocolError(\n            authenticationFailure ? 'UNAUTHORIZED' : 'PUSH_VERIFICATION_REJECTED',\n            error instanceof Error ? error.message : 'Push verification failed',\n            { status: authenticationFailure ? 401 : 409 },\n            false,\n            origin,\n          )\n        }\n      }\n\n"""
if "/collab/repository/credential" not in index:
    if route_anchor not in index: raise SystemExit("worker route anchor missing")
    index = index.replace(route_anchor, route_block + route_anchor, 1)
index_path.write_text(index)

print("PR141 phase 3 GitHub credential gateway port applied")
