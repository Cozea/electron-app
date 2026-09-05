import { ConvexHttpClient } from 'convex/browser'
import type { FunctionReference } from 'convex/server'

import type {
  CollaborationRepositoryBindingDescriptor,
  CollaborationRepositoryCredentialOperation,
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
  userId: string
  bindingId: string
  binding: CollaborationRepositoryBindingDescriptor
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
    queryReference('collaborationRepositories:getAuthorizationForServer'),
    { serverSecret: env.AI_GATEWAY_SECRET, ...args },
  ) as { allowed: false } | RepositoryAuthorization
  return result.allowed ? result : null
}

export interface PushVerificationAuthorization extends RepositoryAuthorization {
  session: {
    id: string
    projectId: string
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
    queryReference('collaborationRepositories:getPushVerificationContextForServer'),
    { serverSecret: env.AI_GATEWAY_SECRET, ...args },
  ) as { allowed: false } | PushVerificationAuthorization
  return result.allowed ? result : null
}

export async function recordRepositoryAccessEvent(
  env: Env,
  args: {
    bindingId: string
    userId: string
    operation: CollaborationRepositoryCredentialOperation
    outcome: 'issued' | 'verified' | 'rejected'
    sessionId?: string
    tokenExpiresAt?: number
    commitSha?: string
  },
): Promise<void> {
  await client(env).mutation(
    mutationReference('collaborationRepositories:recordAccessEventFromServer'),
    { serverSecret: env.AI_GATEWAY_SECRET, ...args },
  )
}

export async function advancePublishedBase(
  env: Env,
  args: {
    sessionId: string
    publishedByUserId: string
    commitSha: string
    coveredThroughSequence: number
  },
): Promise<void> {
  await client(env).mutation(
    mutationReference('collaborationSessions:advancePublishedBaseFromServer'),
    { serverSecret: env.AI_GATEWAY_SECRET, ...args },
  )
}
