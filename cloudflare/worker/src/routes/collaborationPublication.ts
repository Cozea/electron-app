import type { Env } from '../types'
import { readCollaborationRequest } from '../lib/boundedCollaborationRequest'

export async function handleCollaborationPublication(request: Request, env: Env): Promise<Response> {
  if (!env.AI_GATEWAY_SECRET || request.headers.get('authorization') !== `Bearer ${env.AI_GATEWAY_SECRET}`) return new Response('Unauthorized', { status: 403 })
  const body = JSON.parse(await readCollaborationRequest(request, 8192)) as { sessionId?: string; commitSha?: string; coveredThroughSequence?: number; publicationId?: string; publicationRevision?: number }
  if (typeof body.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.sessionId) ||
    typeof body.commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(body.commitSha) ||
    !Number.isSafeInteger(body.coveredThroughSequence) || body.coveredThroughSequence! < 0 ||
    !Number.isSafeInteger(body.publicationRevision) || body.publicationRevision! < 1 || typeof body.publicationId !== 'string' || body.publicationId.length > 128) return new Response('Invalid publication', { status: 400 })
  const roomId = `session:${body.sessionId}`
  return env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(roomId)).fetch(new Request('https://internal/internal/base-advanced', {
    method: 'POST', headers: { authorization: `Bearer ${env.AI_GATEWAY_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, roomId }),
  }))
}
