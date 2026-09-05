import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { verifyDeviceAccessToken } from '../lib/jwt'
import { requireActiveDeviceAccessInConvex } from '../lib/convex'
import { jsonResponse } from '../lib/protocol'
import { readCollaborationRequest } from '../lib/boundedCollaborationRequest'
import type { Env } from '../types'

const queries = new Set(['getSession', 'listForProject', 'listParticipants'])
const mutations = new Set(['createSession', 'activateSession', 'joinSession', 'heartbeatParticipant', 'leaveSession', 'closeSession', 'acquireCommitLease', 'renewCommitLease', 'recoverPreparedLease', 'markLocalCommitReady', 'beginPush', 'releaseCommitLease'])
const repositoryQueries = new Set(['repository.getBinding', 'repository.listVerifiedRepositories'])

/** Narrow device-authenticated bridge; callers cannot select arbitrary functions. */
export async function handleCollaborationControl(request: Request, env: Env): Promise<Response> {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) throw new Error('Device authentication required')
  const token = header.slice(7)
  const auth = await verifyDeviceAccessToken(env, token)
  await requireActiveDeviceAccessInConvex(env, auth)
  const body = JSON.parse(await readCollaborationRequest(request, 32 * 1024)) as { operation?: unknown; args?: unknown }
  if (typeof body.operation !== 'string' || (!queries.has(body.operation) && !mutations.has(body.operation) && !repositoryQueries.has(body.operation) && body.operation !== 'repository.upsertBinding') || !body.args || typeof body.args !== 'object' || Array.isArray(body.args)) throw new Error('Invalid collaboration control operation')
  const args = body.args as Record<string, unknown>
  const client = new ConvexHttpClient(env.CONVEX_URL)
  client.setAuth(token)
  const name = body.operation.startsWith('repository.') ? `collaborationRepositories:${body.operation.slice('repository.'.length)}` : `collaborationSessions:${body.operation}`
  const result = queries.has(body.operation) || repositoryQueries.has(body.operation)
    ? await client.query(makeFunctionReference<'query'>(name), args)
    : await client.mutation(makeFunctionReference<'mutation'>(name), args)
  return jsonResponse(result, { headers: { 'cache-control': 'no-store' } })
}
