import type { Env } from './types'
import { handleHealth } from './routes/health'
import { handleCollabCapabilities } from './routes/collabCapabilities'
import { handleCollabSession } from './routes/collabSession'
import { preflightResponse, protocolError } from './lib/protocol'
import { CollabRoom } from './durableObjects/CollabRoom'

function getRoomStub(env: Env, roomId: string): DurableObjectStub {
  const id = env.COLLAB_ROOM.idFromName(roomId)
  return env.COLLAB_ROOM.get(id)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('origin')
    try {
      const url = new URL(request.url)

      if (request.method === 'OPTIONS') {
        return preflightResponse(origin)
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        return handleHealth(origin)
      }

      if (request.method === 'GET' && url.pathname === '/collab/capabilities') {
        return handleCollabCapabilities(env)
      }

      if (request.method === 'POST' && url.pathname === '/collab/session') {
        try {
          return await handleCollabSession(request, env)
        } catch (error) {
          return protocolError(
            'BAD_REQUEST',
            error instanceof Error ? error.message : 'Invalid collaboration session request',
            { status: 400 },
            false,
            origin,
          )
        }
      }

      if (url.pathname === '/collab/ws') {
        const roomId = url.searchParams.get('roomId')
        if (!roomId) {
          return protocolError('BAD_REQUEST', 'roomId query parameter is required', { status: 400 }, false, origin)
        }
        const stub = getRoomStub(env, roomId)
        return stub.fetch(request)
      }

      return protocolError('NOT_FOUND', 'Route not found', { status: 404 }, false, origin)
    } catch (error) {
      return protocolError(
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Unexpected worker error',
        { status: 500 },
        false,
        origin,
      )
    }
  },
} satisfies ExportedHandler<Env>

export { CollabRoom }
