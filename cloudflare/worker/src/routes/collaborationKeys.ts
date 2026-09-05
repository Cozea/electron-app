import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { verifyDeviceAccessToken } from '../lib/jwt'
import { requireActiveDeviceAccessInConvex } from '../lib/convex'
import { jsonResponse } from '../lib/protocol'
import { parseJsonRequest } from '../lib/validation'
import type { Env } from '../types'

/** Forward the device's verified token; Convex derives both sender and membership. */
export async function handleCollaborationKeys(request: Request, env: Env): Promise<Response> {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) throw new Error('Device authentication required')
  const token = header.slice(7)
  const auth = await verifyDeviceAccessToken(env, token)
  await requireActiveDeviceAccessInConvex(env, auth)
  const body = await parseJsonRequest(request) as Record<string, unknown>
  const { operation, ...args } = body
  if (operation !== 'initialize' && operation !== 'share' && operation !== 'waitingDevices' && operation !== 'rotationStatus' && operation !== 'beginRotation') throw new Error('Unknown session key operation')
  const client = new ConvexHttpClient(env.CONVEX_URL)
  client.setAuth(token)
  const result = operation === 'waitingDevices' || operation === 'rotationStatus'
    ? await client.query(makeFunctionReference<'query'>(`collaborationEncryption:${operation}`), args)
    : await client.mutation(makeFunctionReference<'mutation'>(`collaborationEncryption:${operation}`), args)
  return jsonResponse(result, { headers: { 'cache-control': 'no-store' } })
}
