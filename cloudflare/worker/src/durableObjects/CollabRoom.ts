import type { Env } from '../types'
import {
  fetchActiveAwarenessFromConvex,
  fetchYjsDeltasFromConvex,
  persistYjsUpdateToConvex,
  upsertAwarenessInConvex,
} from '../lib/convex'
import type {
  HelloMessage,
  IncomingClientMessage,
  PresencePushMessage,
  PresenceSnapshotMessage,
  ReadyMessage,
  SyncRequestMessage,
  UpdatePushMessage,
} from '../lib/protocol'
import {
  COLLAB_PROTOCOL_VERSION,
  protocolError,
  stringifyMessage,
} from '../lib/protocol'
import { verifySessionToken } from '../lib/jwt'

interface ClientConnection {
  socket: WebSocket
  clientId: string
  projectId: string
  roomId: string
  userId: string
  knownSeq: number
}

interface PresenceEntry {
  clientId: string
  awarenessBinary: string
  expiresAt: number
}

function parseMessage(data: string | ArrayBuffer): IncomingClientMessage {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
  return JSON.parse(text) as IncomingClientMessage
}

function isHelloLikeMessage(value: unknown): value is HelloMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as {
    type?: unknown
    payload?: {
      sessionToken?: unknown
      projectId?: unknown
      roomId?: unknown
      clientId?: unknown
      protocolVersion?: unknown
      knownSeq?: unknown
      clientType?: unknown
    }
  }

  if (!candidate.payload || typeof candidate.payload !== 'object') {
    return false
  }

  return (
    (candidate.type === 'hello' || typeof candidate.type !== 'string') &&
    typeof candidate.payload.sessionToken === 'string' &&
    typeof candidate.payload.projectId === 'string' &&
    typeof candidate.payload.roomId === 'string' &&
    typeof candidate.payload.clientId === 'string'
  )
}

export class CollabRoom implements DurableObject {
  private readonly state: DurableObjectState
  private readonly env: Env
  private readonly clients = new Map<WebSocket, ClientConnection>()
  private readonly presence = new Map<string, PresenceEntry>()
  private readonly handshakingSockets = new Set<WebSocket>()
  private readonly queuedMessages = new Map<WebSocket, IncomingClientMessage[]>()

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') {
      return protocolError('BAD_REQUEST', 'Expected websocket upgrade', { status: 400 })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.state.acceptWebSocket(server)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let parsed: IncomingClientMessage
    try {
      parsed = parseMessage(message)
    } catch {
      console.error('[CollabRoom] Failed to parse websocket message', {
        messageType: typeof message,
      })
      socket.send(
        JSON.stringify({
          type: 'error',
          payload: {
            code: 'BAD_REQUEST',
            message: 'Malformed websocket message',
            recoverable: false,
          },
        }),
      )
      socket.close(1008, 'Malformed websocket message')
      return
    }

    try {
      if (isHelloLikeMessage(parsed)) {
        console.log('[CollabRoom] Received hello', {
          roomId: parsed.payload.roomId,
          projectId: parsed.payload.projectId,
          clientId: parsed.payload.clientId,
        })
        this.handshakingSockets.add(socket)
        await this.handleHello(socket, parsed)
        return
      }

      const connection = this.clients.get(socket)
      if (!connection) {
        if (this.handshakingSockets.has(socket)) {
          const pending = this.queuedMessages.get(socket) ?? []
          pending.push(parsed)
          this.queuedMessages.set(socket, pending)
          console.log('[CollabRoom] Queued frame during handshake', {
            type: parsed.type,
            queuedCount: pending.length,
          })
          return
        }
        console.warn('[CollabRoom] Dropping pre-handshake frame', {
          type: parsed.type,
        })
        // Be tolerant here. Some clients may emit an early frame before the
        // handshake settles; dropping it is safer than tearing down the socket.
        return
      }
      await this.routeMessage(connection, parsed)
    } catch (error) {
      console.error('[CollabRoom] Unhandled websocket message failure', {
        type: parsed.type,
        error: error instanceof Error ? error.message : String(error),
      })
      socket.send(
        stringifyMessage({
          type: 'error',
          payload: {
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : 'Unhandled websocket room error',
            recoverable: false,
          },
        }),
      )
      socket.close(1011, 'internal room error')
    }
  }

  webSocketClose(socket: WebSocket): void {
    this.handshakingSockets.delete(socket)
    this.queuedMessages.delete(socket)
    const connection = this.clients.get(socket)
    if (!connection) return
    this.clients.delete(socket)
    this.presence.delete(connection.clientId)
    this.broadcast({
      type: 'presence.remove',
      payload: {
        roomId: connection.roomId,
        clientIds: [connection.clientId],
      },
    })
  }

  webSocketError(socket: WebSocket): void {
    this.webSocketClose(socket)
  }

  private async handleHello(socket: WebSocket, message: HelloMessage): Promise<void> {
    try {
      const claims = await verifySessionToken(this.env, message.payload.sessionToken)
      const protocolVersion = this.env.COLLAB_PROTOCOL_VERSION ?? COLLAB_PROTOCOL_VERSION
      if (message.payload.protocolVersion !== protocolVersion) {
        socket.send(
          stringifyMessage({
            type: 'error',
            payload: {
              code: 'INVALID_PROTOCOL_VERSION',
              message: `Expected protocol version ${protocolVersion}`,
              recoverable: false,
            },
          }),
        )
        socket.close(1008, 'Invalid protocol version')
        return
      }
      if (claims.roomId !== message.payload.roomId || claims.projectId !== message.payload.projectId) {
        socket.send(
          stringifyMessage({
            type: 'error',
            payload: {
              code: 'ROOM_MISMATCH',
              message: 'Session token room does not match hello payload',
              recoverable: false,
            },
          }),
        )
        socket.close(1008, 'Room mismatch')
        return
      }

      this.clients.set(socket, {
        socket,
        clientId: message.payload.clientId,
        projectId: claims.projectId,
        roomId: claims.roomId,
        userId: claims.userId,
        knownSeq: message.payload.knownSeq,
      })

      const readyMessage: ReadyMessage = {
        type: 'ready',
        payload: {
          roomId: claims.roomId,
          serverTime: Date.now(),
          headSeq: message.payload.knownSeq,
          resyncRequired: true,
        },
      }
      socket.send(stringifyMessage(readyMessage))

      await this.hydratePresenceFromConvex(claims.projectId)
      this.sendPresenceSnapshot(socket, claims.roomId)
      this.handshakingSockets.delete(socket)
      await this.drainQueuedMessages(socket)
    } catch (error) {
      this.handshakingSockets.delete(socket)
      this.queuedMessages.delete(socket)
      console.error('[CollabRoom] Hello failed', {
        roomId: message.payload.roomId,
        projectId: message.payload.projectId,
        clientId: message.payload.clientId,
        error: error instanceof Error ? error.message : String(error),
      })
      socket.send(
        stringifyMessage({
          type: 'error',
          payload: {
            code: 'INVALID_SESSION_TOKEN',
            message: error instanceof Error ? error.message : 'Session token verification failed',
            recoverable: false,
          },
        }),
      )
      socket.close(1008, 'Invalid session token')
    }
  }

  private async drainQueuedMessages(socket: WebSocket): Promise<void> {
    const connection = this.clients.get(socket)
    const pending = this.queuedMessages.get(socket) ?? []
    this.queuedMessages.delete(socket)
    if (!connection || pending.length === 0) {
      return
    }

    for (const message of pending) {
      await this.routeMessage(connection, message)
    }
  }

  private async routeMessage(
    connection: ClientConnection,
    parsed: IncomingClientMessage,
  ): Promise<void> {
    switch (parsed.type) {
      case 'sync.request':
        console.log('[CollabRoom] Handling sync request', {
          roomId: connection.roomId,
          projectId: connection.projectId,
          clientId: connection.clientId,
          knownSeq: parsed.payload.knownSeq,
        })
        await this.handleSyncRequest(connection, parsed)
        return
      case 'update.push':
        console.log('[CollabRoom] Handling update push', {
          roomId: connection.roomId,
          projectId: connection.projectId,
          clientId: connection.clientId,
          idempotencyKey: parsed.payload.idempotencyKey,
        })
        await this.handleUpdatePush(connection, parsed)
        return
      case 'presence.push':
        console.log('[CollabRoom] Handling presence push', {
          roomId: connection.roomId,
          projectId: connection.projectId,
          clientId: connection.clientId,
        })
        this.handlePresencePush(connection, parsed)
        return
    }
  }

  private async handleSyncRequest(
    connection: ClientConnection,
    message: SyncRequestMessage,
  ): Promise<void> {
    try {
      const updates = await fetchYjsDeltasFromConvex(
        this.env,
        connection.projectId,
        connection.roomId,
        message.payload.knownSeq,
      )

      connection.socket.send(
        stringifyMessage({
          type: 'sync.delta',
          payload: {
            roomId: connection.roomId,
            fromSeq: message.payload.knownSeq,
            toSeq: updates.length > 0 ? updates[updates.length - 1]!.seq : message.payload.knownSeq,
            updatesBinary: updates.map((update) => update.updateBinary),
          },
        }),
      )
    } catch (error) {
      console.error('[CollabRoom] Sync request failed', {
        roomId: connection.roomId,
        projectId: connection.projectId,
        clientId: connection.clientId,
        knownSeq: message.payload.knownSeq,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private async handleUpdatePush(
    connection: ClientConnection,
    message: UpdatePushMessage,
  ): Promise<void> {
    try {
      const result = await persistYjsUpdateToConvex(this.env, {
        projectId: connection.projectId,
        roomId: connection.roomId,
        clientId: connection.clientId,
        idempotencyKey: message.payload.idempotencyKey,
        updateBinary: message.payload.updateBinary,
        authorType: message.payload.authorType,
        authorId: message.payload.authorId,
        timestamp: message.payload.timestamp,
      })

      connection.knownSeq = result.seq
      this.broadcast({
        type: 'update.ack',
        payload: {
          roomId: connection.roomId,
          seq: result.seq,
          idempotencyKey: message.payload.idempotencyKey,
          persisted: true,
        },
      })
      this.broadcast({
        type: 'sync.delta',
        payload: {
          roomId: connection.roomId,
          fromSeq: result.seq - 1,
          toSeq: result.seq,
          updatesBinary: [message.payload.updateBinary],
        },
      })
    } catch (error) {
      console.error('[CollabRoom] Update push failed', {
        roomId: connection.roomId,
        projectId: connection.projectId,
        clientId: connection.clientId,
        idempotencyKey: message.payload.idempotencyKey,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private handlePresencePush(connection: ClientConnection, message: PresencePushMessage): void {
    const expiresAt = Date.now() + message.payload.ttlMs
    this.presence.set(message.payload.clientId, {
      clientId: message.payload.clientId,
      awarenessBinary: message.payload.awarenessBinary,
      expiresAt,
    })
    void upsertAwarenessInConvex(this.env, {
      projectId: connection.projectId,
      clientId: message.payload.clientId,
      awarenessBinary: message.payload.awarenessBinary,
      ttlMs: message.payload.ttlMs,
    }).catch((error) => {
      console.warn('[CollabRoom] Failed to persist awareness to Convex', error)
    })
    this.broadcast({
      type: 'presence.snapshot',
      payload: {
        roomId: connection.roomId,
        entries: this.getActivePresenceEntries(),
      },
    })
  }

  private sendPresenceSnapshot(socket: WebSocket, roomId: string): void {
    const message: PresenceSnapshotMessage = {
      type: 'presence.snapshot',
      payload: {
        roomId,
        entries: this.getActivePresenceEntries(),
      },
    }
    socket.send(stringifyMessage(message))
  }

  private getActivePresenceEntries(): PresenceEntry[] {
    const now = Date.now()
    const activeEntries: PresenceEntry[] = []
    for (const [clientId, entry] of this.presence.entries()) {
      if (entry.expiresAt <= now) {
        this.presence.delete(clientId)
        continue
      }
      activeEntries.push(entry)
    }
    return activeEntries
  }

  private broadcast(message: Parameters<typeof stringifyMessage>[0]): void {
    const serialized = stringifyMessage(message)
    for (const connection of this.clients.values()) {
      connection.socket.send(serialized)
    }
  }

  private async hydratePresenceFromConvex(projectId: string): Promise<void> {
    try {
      const entries = await fetchActiveAwarenessFromConvex(this.env, projectId)
      const now = Date.now()
      for (const entry of entries) {
        if (entry.expiresAt <= now) {
          continue
        }
        this.presence.set(entry.clientId, {
          clientId: entry.clientId,
          awarenessBinary: entry.awarenessBinary,
          expiresAt: entry.expiresAt,
        })
      }
    } catch (error) {
      console.error('[CollabRoom] Presence hydration failed', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}
