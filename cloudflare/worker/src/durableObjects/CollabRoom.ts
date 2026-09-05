import { acceptFileInitialization } from '../lib/collaborationFileInitialization'
import { handleCheckpointOperation } from '../lib/collaborationCheckpoints'
import { collaborationDigest, splitCollaborationUpdate, validateEncryptedCollaborationEnvelope, COLLABORATION_CHUNK_CHARS } from '../../../../shared/collaborationWire'
import { acceptDurableCollaborationChunk, discardDurableCollaborationChunks } from '../lib/durableCollaborationChunks'
import type { Env } from '../types'
import { COLLAB_MAX_FRAME_BYTES, reserveUpdateBudget, validateUpdateInput, type RetainedUsage, type UpdateRate } from '../lib/collaborationLimits'
import {
  fetchActiveAwarenessFromConvex,
  fetchYjsDeltasFromConvex,
  persistYjsUpdateToConvex,
  upsertAwarenessInConvex,
} from '../lib/convex'
import { authorizeRoomConnection, updateAuthoritativeRoomHead } from '../lib/collaborationV2Convex'
import type {
  BarrierRequestMessage,
  HelloMessage,
  IncomingClientMessage,
  MediaSignalMessage,
  MediaStateMessage,
  PresencePushMessage,
  PresenceSnapshotMessage,
  SyncRequestMessage,
  UpdatePushMessage,
} from '../lib/protocol'
import {
  COLLAB_PROTOCOL_VERSION,
  COLLAB_SESSION_PROTOCOL_VERSION,
  protocolError,
  stringifyMessage,
} from '../lib/protocol'
import { verifySessionToken } from '../lib/jwt'

interface SocketAttachment {
  handshaken: true
  clientId: string
  projectId: string
  roomId: string
  sessionId?: string
  userId: string
  expiresAt: number
  role: 'editor' | 'observer'
  keyVersion?: number | null
  mediaClientId: string
  knownSeq: number
  awarenessBinary?: string
  presenceExpiresAt?: number
  audio?: boolean
  screenShare?: boolean
}

interface PresenceEntry {
  clientId: string
  awarenessBinary: string
  expiresAt: number
}

interface StoredSessionUpdate {
  seq: number
  updateBinary?: string
  chunkCount?: number
  digest?: string
  idempotencyKey: string
  clientId: string
  timestamp: number
  retainedBytes?: number
}

class RoomAccessError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

const UPDATE_PREFIX = 'update:'
const IDEMPOTENCY_PREFIX = 'idempotency:'
const HEAD_SEQUENCE_KEY = 'head-sequence'
const RETAINED_USAGE_KEY = 'retained-usage'
const SYNC_PAGE_SIZE = 128

function parseMessage(data: string | ArrayBuffer): IncomingClientMessage {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
  return JSON.parse(text) as IncomingClientMessage
}

function isHelloLikeMessage(value: unknown): value is HelloMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { type?: unknown; payload?: Record<string, unknown> }
  return (
    candidate.type === 'hello' &&
    typeof candidate.payload?.sessionToken === 'string' &&
    typeof candidate.payload?.projectId === 'string' &&
    typeof candidate.payload?.roomId === 'string' &&
    typeof candidate.payload?.clientId === 'string'
  )
}

function isV2Room(roomId: string): boolean {
  return roomId.startsWith('session:')
}

function sessionIdFromRoom(roomId: string): string | null {
  return isV2Room(roomId) ? roomId.slice('session:'.length) || null : null
}

function updateKey(sequence: number): string {
  return `${UPDATE_PREFIX}${Math.max(0, Math.floor(sequence)).toString().padStart(16, '0')}`
}

function attachmentOf(socket: WebSocket): SocketAttachment | null {
  try {
    const value = socket.deserializeAttachment() as SocketAttachment | null
    return value?.handshaken ? value : null
  } catch {
    return null
  }
}

export class CollabRoom implements DurableObject {
  private readonly state: DurableObjectState
  private readonly env: Env
  private updateQueue: Promise<void> = Promise.resolve()
  private messageQueue: Promise<void> = Promise.resolve()

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/internal/checkpoint' && request.method === 'POST') {
      if (!this.env.AI_GATEWAY_SECRET || request.headers.get('authorization') !== `Bearer ${this.env.AI_GATEWAY_SECRET}`) return new Response('Unauthorized', { status: 403 })
      const body = await request.json() as { authority: Parameters<typeof handleCheckpointOperation>[1]; request: Record<string, unknown> }
      const operation = this.messageQueue.then(async () => {
        if (await this.state.storage.get('session-closed')) throw new Error('Session is closed')
        if (body.authority.sessionId) {
          const fresh = await authorizeRoomConnection(this.env, body.authority.userId, body.authority.sessionId)
          if (!fresh.allowed || fresh.roomId !== body.authority.roomId || fresh.projectId !== body.authority.projectId ||
            (body.authority.previousKeyVersion ? fresh.pendingKeyVersion !== body.authority.keyVersion : fresh.keyVersion !== body.authority.keyVersion)) throw new Error('Checkpoint authority changed; retry after reconnecting')
          body.authority.role = fresh.role === 'editor' ? 'editor' : 'observer'
          body.authority.rotationRequired = fresh.rotationRequired
        }
        const result = await handleCheckpointOperation(this.state.storage, body.authority, body.request)
        if (body.request.operation === 'finalize') {
          const published = await this.state.storage.get<{ coveredThroughSequence: number }>('published-base')
          const checkpoint = await this.state.storage.get<{ sequence: number }>('encrypted-checkpoint')
          if (published && checkpoint && checkpoint.sequence >= published.coveredThroughSequence) await this.pruneThrough(published.coveredThroughSequence)
        }
        return result
      })
      this.messageQueue = operation.then(() => undefined, () => undefined)
      try { return Response.json(await operation) }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Checkpoint unavailable' }, { status: 409 }) }
    }
    if (url.pathname === '/internal/base-advanced' && request.method === 'POST') {
      if (!this.env.AI_GATEWAY_SECRET || request.headers.get('authorization') !== `Bearer ${this.env.AI_GATEWAY_SECRET}`) return new Response('Unauthorized', { status: 403 })
      const body = await request.json() as { commitSha: string; coveredThroughSequence: number; roomId: string; publicationId: string; publicationRevision: number }
      const sequence = body.coveredThroughSequence
      if (!Number.isSafeInteger(body.publicationRevision) || body.publicationRevision < 1 || !Number.isSafeInteger(sequence) || sequence < 0 || !/^[a-f0-9]{40}$/.test(body.commitSha) || typeof body.roomId !== 'string' || !isV2Room(body.roomId)) return new Response('Invalid base advancement', { status: 400 })
      const delivery = this.messageQueue.then(async () => {
        const previous = await this.state.storage.get<typeof body>('published-base')
        if (previous && previous.publicationRevision > body.publicationRevision) return
        if (previous && (previous.coveredThroughSequence > sequence || (previous.publicationRevision === body.publicationRevision && previous.commitSha !== body.commitSha))) throw new Error('Conflicting publication sequence')
        if (sequence > await this.getSessionHeadSequence()) throw new Error('Publication exceeds the acknowledged room head')
        await this.state.storage.put('published-base', body)
        const checkpoint = await this.state.storage.get<{ sequence: number }>('encrypted-checkpoint')
        if (checkpoint && checkpoint.sequence >= sequence) await this.pruneThrough(sequence)
        this.broadcast({ type: 'base.advanced', payload: { roomId: body.roomId, commitSha: body.commitSha, coveredThroughSequence: sequence } })
      })
      this.messageQueue = delivery.then(() => undefined, () => undefined)
      await delivery
      return new Response(null, { status: 204 })
    }

    if (url.pathname === '/internal/close' && request.method === 'POST') {
      if (!this.env.AI_GATEWAY_SECRET || request.headers.get('authorization') !== `Bearer ${this.env.AI_GATEWAY_SECRET}`) return new Response('Unauthorized', { status: 403 })
      const closing = this.messageQueue.then(async () => {
        await this.state.storage.put('session-closed', { closedAt: Date.now() })
        for (const socket of this.state.getWebSockets()) socket.close(1000, 'Session closed')
      })
      this.messageQueue = closing.then(() => undefined, () => undefined)
      await closing
      return new Response(null, { status: 204 })
    }

    if (request.headers.get('upgrade') !== 'websocket') {
      return protocolError('BAD_REQUEST', 'Expected websocket upgrade', { status: 400 })
    }

    const selectedRoomId = url.searchParams.get('roomId')
    if (!selectedRoomId || selectedRoomId.length > 256) {
      return protocolError('BAD_REQUEST', 'A valid roomId is required', { status: 400 })
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.serializeAttachment({ handshaken: false, roomId: selectedRoomId })
    this.state.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Preserve wire arrival order across awaited authorization calls. In
    // particular, a barrier cannot overtake the preceding client's edits.
    const operation = this.messageQueue.then(() => this.processSocketMessage(socket, message))
    this.messageQueue = operation.catch(() => undefined)
    return operation
  }

  private async processSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let parsed: IncomingClientMessage
    const frameBytes = typeof message === 'string' ? new TextEncoder().encode(message).byteLength : message.byteLength
    if (frameBytes > COLLAB_MAX_FRAME_BYTES) {
      socket.close(1009, 'Collaboration frame too large')
      return
    }
    try {
      parsed = parseMessage(message)
    } catch {
      socket.send(stringifyMessage({
        type: 'error',
        payload: { code: 'BAD_REQUEST', message: 'Malformed websocket message', recoverable: false },
      }))
      socket.close(1008, 'Malformed websocket message')
      return
    }

    try {
      if (isHelloLikeMessage(parsed)) {
        await this.handleHello(socket, parsed)
        return
      }
      const connection = attachmentOf(socket)
      if (!connection) return
      await this.routeMessage(socket, connection, parsed)
    } catch (error) {
      socket.send(stringifyMessage({
        type: 'error',
        payload: {
          code: error instanceof RoomAccessError ? error.code : 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unhandled websocket room error',
          recoverable: false,
        },
      }))
      socket.close(1011, 'internal room error')
    }
  }

  async alarm(): Promise<void> {
    // Hibernation-compatible revocation: an idle socket must not retain room
    // access indefinitely simply because it is not sending new messages.
    const checks = new Map<string, Awaited<ReturnType<typeof authorizeRoomConnection>>>()
    let active = false
    for (const socket of this.state.getWebSockets()) {
      const connection = attachmentOf(socket)
      if (!connection?.sessionId) continue
      try {
        if (connection.expiresAt <= Date.now()) throw new RoomAccessError('SESSION_EXPIRED', 'Session token expired')
        const key = `${connection.sessionId}:${connection.userId}`
        let authority = checks.get(key)
        if (!authority) { authority = await authorizeRoomConnection(this.env, connection.userId, connection.sessionId); checks.set(key, authority) }
        if (!authority.allowed || authority.roomId !== connection.roomId || authority.projectId !== connection.projectId) throw new RoomAccessError('DEVICE_REVOKED', 'Session access revoked or closed')
        if (connection.keyVersion && authority.keyVersion !== connection.keyVersion) throw new RoomAccessError('ENCRYPTION_KEY_STALE', 'Room key changed; reconnect to recover local edits')
        const role = authority.role === 'editor' ? 'editor' : 'observer'
        connection.role = role
        socket.serializeAttachment(connection)
        active = true
      } catch (error) {
        socket.send(stringifyMessage({ type: 'error', payload: {
          code: error instanceof RoomAccessError ? error.code : 'AUTHORITY_UNAVAILABLE',
          message: 'Session authority must be refreshed; local edits remain recoverable', recoverable: false,
        } }))
        this.webSocketClose(socket)
        socket.serializeAttachment({ handshaken: false, roomId: connection.roomId })
        socket.close(1008, 'Session authority changed')
      }
    }
    if (active) await this.state.storage.setAlarm(Date.now() + 15_000)
  }

  webSocketClose(socket: WebSocket): void {
    const connection = attachmentOf(socket)
    if (!connection) return
    this.broadcast({
      type: 'presence.remove',
      payload: { roomId: connection.roomId, clientIds: [connection.clientId] },
    }, socket)
  }

  webSocketError(socket: WebSocket): void {
    this.webSocketClose(socket)
  }

  private async handleHello(socket: WebSocket, message: HelloMessage): Promise<void> {
    try {
      if (await this.state.storage.get('session-closed')) throw new Error('Session is closed; recovery data was retained')
      const claims = await verifySessionToken(this.env, message.payload.sessionToken)
      const selected = socket.deserializeAttachment<{ handshaken: boolean; roomId: string }>()
      if (!selected || selected.roomId !== claims.roomId) {
        throw new Error('Session token does not match the selected room')
      }
      if (selected.handshaken) throw new Error('Socket is already authenticated')
      if (!claims.userId || !claims.deviceId) throw new Error('Session principal is missing')
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(message.payload.clientId)) throw new Error('Invalid document client ID')
      const protocolVersion = isV2Room(claims.roomId) ? COLLAB_SESSION_PROTOCOL_VERSION : this.env.COLLAB_PROTOCOL_VERSION ?? COLLAB_PROTOCOL_VERSION
      if (message.payload.protocolVersion !== protocolVersion) {
        throw new Error(`Expected protocol version ${protocolVersion}`)
      }
      if (claims.roomId !== message.payload.roomId || claims.projectId !== message.payload.projectId) {
        throw new Error('Session token room does not match hello payload')
      }
      const roomSessionId = sessionIdFromRoom(claims.roomId)
      if (roomSessionId && claims.sessionId !== roomSessionId) {
        throw new Error('Session token does not match the explicit collaboration room')
      }

      if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) throw new Error('Session token expired')
      let keyVersion: number | null | undefined
      if (roomSessionId) {
        const authority = await authorizeRoomConnection(this.env, claims.userId, roomSessionId)
        if (!authority.allowed || authority.roomId !== claims.roomId || authority.projectId !== claims.projectId) throw new Error('Session access revoked')
        claims.role = authority.role
        keyVersion = authority.keyVersion
      }
      const headSeq = isV2Room(claims.roomId)
        ? await this.getSessionHeadSequence()
        : Math.max(0, Math.floor(message.payload.knownSeq))
      const attachment: SocketAttachment = {
        handshaken: true,
        keyVersion,
        clientId: message.payload.clientId,
        projectId: claims.projectId,
        roomId: claims.roomId,
        sessionId: claims.sessionId,
        userId: claims.userId,
        expiresAt: claims.exp * 1000,
        role: claims.role === 'editor' ? 'editor' : 'observer',
        mediaClientId: `${claims.userId}:${crypto.randomUUID()}`,
        knownSeq: Math.max(0, Math.floor(message.payload.knownSeq)),
      }
      socket.serializeAttachment(attachment)
      if (roomSessionId) await this.state.storage.setAlarm(Date.now() + 15_000)

      socket.send(stringifyMessage({
        type: 'ready',
        payload: {
          roomId: claims.roomId,
          serverTime: Date.now(),
          headSeq,
          mediaClientId: attachment.mediaClientId,
          resyncRequired: headSeq > attachment.knownSeq,
        },
      }))

      const published = await this.state.storage.get<{ commitSha: string; coveredThroughSequence: number }>('published-base')
      if (published) socket.send(stringifyMessage({ type: 'base.advanced', payload: { roomId: claims.roomId, ...published } }))
      if (!isV2Room(claims.roomId)) await this.hydrateLegacyPresence(claims.projectId)
      this.sendPresenceSnapshot(socket, claims.roomId)
      this.broadcastMediaState(socket, attachment)
    } catch (error) {
      socket.send(stringifyMessage({
        type: 'error',
        payload: {
          code: 'INVALID_SESSION_TOKEN',
          message: error instanceof Error ? error.message : 'Session token verification failed',
          recoverable: false,
        },
      }))
      socket.close(1008, 'Invalid session token')
    }
  }

  private async routeMessage(
    socket: WebSocket,
    connection: SocketAttachment,
    message: IncomingClientMessage,
  ): Promise<void> {
    if (!message.payload || message.payload.roomId !== connection.roomId) {
      throw new Error('Message room does not match the authenticated socket')
    }
    if (connection.expiresAt <= Date.now()) throw new RoomAccessError('SESSION_EXPIRED', 'Session token expired')
    if (connection.sessionId) {
      const authority = await authorizeRoomConnection(this.env, connection.userId, connection.sessionId)
      if (!authority.allowed || authority.roomId !== connection.roomId || authority.projectId !== connection.projectId) {
        throw new RoomAccessError('DEVICE_REVOKED', 'Session access revoked or closed')
      }
      connection.role = authority.role === 'editor' ? 'editor' : 'observer'
      if (connection.keyVersion && connection.keyVersion !== authority.keyVersion) throw new RoomAccessError('ENCRYPTION_KEY_STALE', 'Room key changed; reconnect to recover local edits')
      connection.keyVersion = authority.keyVersion
      if (authority.rotationRequired && (message.type === 'update.push' || message.type === 'update.chunk' || message.type === 'barrier.request')) {
        throw new RoomAccessError('KEY_ROTATION_REQUIRED', 'Session access changed; encrypted key rotation must finish before synchronization resumes')
      }
      if ((message.type === 'update.push' || message.type === 'update.chunk' || message.type === 'barrier.request') && connection.role !== 'editor') {
        throw new Error('An active editor is required to change the shared session')
      }
    }
    switch (message.type) {
      case 'sync.request':
        await this.handleSyncRequest(socket, connection, message)
        return
      case 'update.chunk': {
        if (!connection.sessionId) throw new Error('Chunked updates require an explicit session')
        const encoded = await acceptDurableCollaborationChunk(this.state.storage, connection.userId, message.payload.chunk)
        if (encoded !== null) {
          await this.handleUpdatePush(socket, connection, {
            type: 'update.push', payload: { roomId: connection.roomId, updateBinary: encoded,
              idempotencyKey: message.payload.chunk.id, timestamp: message.payload.timestamp,
              authorType: 'user', authorId: connection.userId },
          })
          await discardDurableCollaborationChunks(this.state.storage, message.payload.chunk.id, message.payload.chunk.count)
        }
        return
      }
      case 'update.push': {
        const operation = this.updateQueue.then(() => this.handleUpdatePush(socket, connection, message))
        // Keep serialization alive after failure, but report this operation to its sender.
        this.updateQueue = operation.catch(() => undefined)
        await operation
        return
      }
      case 'presence.push':
        await this.handlePresencePush(socket, connection, message)
        return
      case 'barrier.request':
        await this.handleBarrierRequest(socket, connection, message)
        return
      case 'media.signal':
        this.handleMediaSignal(socket, connection, message)
        return
      case 'media.state':
        this.handleMediaState(socket, connection, message)
        return
    }
  }

  private async handleSyncRequest(
    socket: WebSocket,
    connection: SocketAttachment,
    message: SyncRequestMessage,
  ): Promise<void> {
    if (isV2Room(connection.roomId)) {
      const headSeq = await this.getSessionHeadSequence()
      const checkpoint = await this.state.storage.get<{ sequence: number }>('encrypted-checkpoint')
      if (checkpoint && message.payload.knownSeq < checkpoint.sequence) {
        socket.send(stringifyMessage({ type: 'error', payload: { code: 'CHECKPOINT_REQUIRED', message: 'Load the encrypted room checkpoint before replaying pending edits', recoverable: false } }))
        return
      }
      const entries = await this.state.storage.list<StoredSessionUpdate>({
        start: updateKey(message.payload.knownSeq + 1),
        end: 'update;',
        limit: SYNC_PAGE_SIZE,
      })
      const updates = [...entries.values()].sort((left, right) => left.seq - right.seq)
      let toSeq = message.payload.knownSeq
      const encoded: string[] = []
      let bytes = 0
      for (const update of updates) {
        if (update.seq !== toSeq + 1) throw new Error('Session recovery requires an encrypted checkpoint before this sequence')
        const value = await this.loadEncodedUpdate(update)
        if (value.length > COLLABORATION_CHUNK_CHARS) {
          if (encoded.length) break
          for (const chunk of await splitCollaborationUpdate(`seq_${update.seq}`, value)) {
            socket.send(stringifyMessage({ type: 'sync.chunk', payload: { roomId: connection.roomId, sequence: update.seq, headSeq, chunk } }))
          }
          return
        }
        if (bytes + value.length > COLLABORATION_CHUNK_CHARS) break
        encoded.push(value)
        bytes += value.length
        toSeq = update.seq
      }
      socket.send(stringifyMessage({
        type: 'sync.delta',
        payload: {
          roomId: connection.roomId, fromSeq: message.payload.knownSeq,
          toSeq, headSeq, hasMore: toSeq < headSeq, updatesBinary: encoded,
        },
      }))
      return
    }

    const updates = await fetchYjsDeltasFromConvex(
      this.env,
      connection.projectId,
      connection.roomId,
      message.payload.knownSeq,
    )
    socket.send(stringifyMessage({
      type: 'sync.delta',
      payload: {
        roomId: connection.roomId,
        fromSeq: message.payload.knownSeq,
        toSeq: updates.at(-1)?.seq ?? message.payload.knownSeq,
        hasMore: updates.length === SYNC_PAGE_SIZE,
        updatesBinary: updates.map((update) => update.updateBinary),
      },
    }))
  }

  private async handleUpdatePush(
    socket: WebSocket,
    connection: SocketAttachment,
    message: UpdatePushMessage,
  ): Promise<void> {
    const result = isV2Room(connection.roomId)
      ? await this.persistSessionUpdate(connection, message)
      : await persistYjsUpdateToConvex(this.env, {
          projectId: connection.projectId,
          roomId: connection.roomId,
          clientId: connection.clientId,
          idempotencyKey: message.payload.idempotencyKey,
          updateBinary: message.payload.updateBinary,
          authorType: message.payload.authorType,
          authorId: message.payload.authorId,
          timestamp: message.payload.timestamp,
        })

    connection.knownSeq = Math.max(connection.knownSeq, result.seq)
    socket.serializeAttachment(connection)
    socket.send(stringifyMessage({
      type: 'update.ack',
      payload: {
        roomId: connection.roomId,
        seq: result.seq,
        idempotencyKey: message.payload.idempotencyKey,
        persisted: true,
      },
    }))
    if (message.payload.updateBinary.length > COLLABORATION_CHUNK_CHARS) {
      for (const chunk of await splitCollaborationUpdate(`seq_${result.seq}`, message.payload.updateBinary)) {
        this.broadcast({ type: 'sync.chunk', payload: { roomId: connection.roomId, sequence: result.seq, headSeq: result.seq, chunk } }, socket)
      }
    } else {
      this.broadcast({
        type: 'sync.delta', payload: {
          roomId: connection.roomId, fromSeq: result.seq - 1, toSeq: result.seq,
          headSeq: result.seq, hasMore: false, updatesBinary: [message.payload.updateBinary],
        },
      }, socket)
    }
  }

  private async persistSessionUpdate(
    connection: SocketAttachment,
    message: UpdatePushMessage,
  ): Promise<{ seq: number }> {
    if (connection.role !== 'editor') throw new Error('An active editor is required')
    const retainedBytes = validateUpdateInput(message.payload)
    validateEncryptedCollaborationEnvelope(message.payload.updateBinary, {
      roomId: connection.roomId, projectId: connection.projectId, kind: 'yjs_update',
      idempotencyKey: message.payload.idempotencyKey, keyVersion: connection.keyVersion ?? 0,
    })
    const idempotencyKey = `${IDEMPOTENCY_PREFIX}${message.payload.idempotencyKey}`
    const existing = await this.state.storage.get<number | { seq: number; digest: string }>(idempotencyKey)
    if (existing !== undefined) {
      const saved = typeof existing === 'number' ? await this.state.storage.get<StoredSessionUpdate>(updateKey(existing)) : null
      const matches = typeof existing === 'number' ? saved && await this.loadEncodedUpdate(saved) === message.payload.updateBinary :
        existing.digest === await collaborationDigest(message.payload.updateBinary)
      if (!matches) throw new Error('Idempotency key was already used for another update')
      return { seq: typeof existing === 'number' ? existing : existing.seq }
    }
    const dedupCount = await this.state.storage.get<number>('dedup-count') ?? 0
    if (dedupCount >= 100_000) throw new Error('Session operation limit reached; preserve local work and start a new session')

    const usage = await this.getRetainedUsage()
    const rateKey = `rate:${connection.userId}`
    const rate = await this.state.storage.get<UpdateRate>(rateKey)
    const budget = reserveUpdateBudget(usage, rate, retainedBytes, Date.now())
    const seq = (await this.getSessionHeadSequence()) + 1
    const initialization = await acceptFileInitialization(this.state.storage, { userId: connection.userId, role: connection.role, keyVersion: connection.keyVersion ?? null }, message.payload.updateBinary, seq)
    const stored: StoredSessionUpdate = {
      seq,
      ...(message.payload.updateBinary.length <= COLLABORATION_CHUNK_CHARS ? { updateBinary: message.payload.updateBinary } : {
        chunkCount: Math.ceil(message.payload.updateBinary.length / COLLABORATION_CHUNK_CHARS),
        digest: await collaborationDigest(message.payload.updateBinary),
      }),
      idempotencyKey: message.payload.idempotencyKey,
      clientId: connection.clientId,
      timestamp: message.payload.timestamp,
      retainedBytes,
    }
    const parts: Record<string, string> = {}
    for (let index = 0; index < (stored.chunkCount ?? 0); index++) {
      parts[`update-piece:${seq}:${index}`] = message.payload.updateBinary.slice(index * COLLABORATION_CHUNK_CHARS, (index + 1) * COLLABORATION_CHUNK_CHARS)
    }
    await this.state.storage.put({
      ...parts,
      ...initialization,
      [HEAD_SEQUENCE_KEY]: seq,
      [updateKey(seq)]: stored,
      [idempotencyKey]: { seq, digest: await collaborationDigest(message.payload.updateBinary) },
      "dedup-count": dedupCount + 1,
      [RETAINED_USAGE_KEY]: budget.usage,
      [rateKey]: budget.rate,
    })
    return { seq }
  }

  private async handlePresencePush(
    socket: WebSocket,
    connection: SocketAttachment,
    message: PresencePushMessage,
  ): Promise<void> {
    connection.awarenessBinary = message.payload.awarenessBinary
    connection.presenceExpiresAt = Date.now() + Math.max(5_000, Math.min(120_000, message.payload.ttlMs))
    socket.serializeAttachment(connection)

    if (!isV2Room(connection.roomId)) {
      await upsertAwarenessInConvex(this.env, {
        projectId: connection.projectId,
        clientId: message.payload.clientId,
        awarenessBinary: message.payload.awarenessBinary,
        ttlMs: message.payload.ttlMs,
      })
    }
    this.broadcast({
      type: 'presence.snapshot',
      payload: { roomId: connection.roomId, entries: this.getActivePresenceEntries(connection.roomId) },
    })
  }

  private async handleBarrierRequest(
    socket: WebSocket,
    connection: SocketAttachment,
    message: BarrierRequestMessage,
  ): Promise<void> {
    await this.updateQueue
    const sequence = isV2Room(connection.roomId)
      ? await this.getSessionHeadSequence()
      : connection.knownSeq
    if (connection.sessionId) {
      await updateAuthoritativeRoomHead(this.env, connection.sessionId, sequence)
    }
    socket.send(stringifyMessage({
      type: 'barrier.ready',
      payload: { roomId: connection.roomId, requestId: message.payload.requestId, sequence },
    }))
  }

  private handleMediaSignal(
    socket: WebSocket,
    connection: SocketAttachment,
    message: MediaSignalMessage,
  ): void {
    if (message.payload.sourceClientId !== connection.mediaClientId) return
    for (const candidate of this.state.getWebSockets()) {
      const target = attachmentOf(candidate)
      if (target?.roomId === connection.roomId && target.mediaClientId === message.payload.targetClientId) {
        candidate.send(stringifyMessage({
          ...message,
          payload: { ...message.payload, roomId: connection.roomId, sourceClientId: connection.mediaClientId },
        }))
        return
      }
    }
    socket.send(stringifyMessage({
      type: 'error',
      payload: { code: 'MEDIA_TARGET_OFFLINE', message: 'Media participant is not connected', recoverable: true },
    }))
  }

  private handleMediaState(
    socket: WebSocket,
    connection: SocketAttachment,
    message: MediaStateMessage,
  ): void {
    if (message.payload.clientId !== connection.mediaClientId) return
    connection.audio = message.payload.audio
    connection.screenShare = message.payload.screenShare
    socket.serializeAttachment(connection)
    this.broadcast({ ...message, payload: { ...message.payload, roomId: connection.roomId, clientId: connection.mediaClientId } })
  }

  private broadcastMediaState(socket: WebSocket, connection: SocketAttachment): void {
    for (const candidate of this.state.getWebSockets()) {
      if (candidate === socket) continue
      const other = attachmentOf(candidate)
      if (!other || other.roomId !== connection.roomId) continue
      socket.send(stringifyMessage({
        type: 'media.state',
        payload: {
          roomId: connection.roomId,
          clientId: other.mediaClientId,
          audio: other.audio === true,
          screenShare: other.screenShare === true,
        },
      }))
    }
  }

  private sendPresenceSnapshot(socket: WebSocket, roomId: string): void {
    const message: PresenceSnapshotMessage = {
      type: 'presence.snapshot',
      payload: { roomId, entries: this.getActivePresenceEntries(roomId) },
    }
    socket.send(stringifyMessage(message))
  }

  private getActivePresenceEntries(roomId: string): PresenceEntry[] {
    const now = Date.now()
    const entries: PresenceEntry[] = []
    for (const socket of this.state.getWebSockets()) {
      const connection = attachmentOf(socket)
      if (
        connection?.roomId === roomId &&
        connection.awarenessBinary &&
        (connection.presenceExpiresAt ?? 0) > now
      ) {
        entries.push({
          clientId: connection.clientId,
          awarenessBinary: connection.awarenessBinary,
          expiresAt: connection.presenceExpiresAt!,
        })
      }
    }
    return entries
  }

  private broadcast(message: Parameters<typeof stringifyMessage>[0], except?: WebSocket): void {
    const serialized = stringifyMessage(message)
    for (const socket of this.state.getWebSockets()) {
      if (socket !== except && attachmentOf(socket)) socket.send(serialized)
    }
  }

  private async loadEncodedUpdate(update: StoredSessionUpdate): Promise<string> {
    if (update.updateBinary !== undefined) return update.updateBinary
    if (!update.chunkCount || update.chunkCount > 64) throw new Error('Encrypted update record is corrupt')
    const pieces: string[] = []
    for (let index = 0; index < update.chunkCount; index++) {
      const piece = await this.state.storage.get<string>(`update-piece:${update.seq}:${index}`)
      if (piece === undefined) throw new Error('Encrypted update storage is incomplete')
      pieces.push(piece)
    }
    const encoded = pieces.join('')
    if (await collaborationDigest(encoded) !== update.digest) throw new Error('Encrypted update storage checksum failed')
    return encoded
  }

  private async getSessionHeadSequence(): Promise<number> {
    return Math.max(0, Math.floor((await this.state.storage.get<number>(HEAD_SEQUENCE_KEY)) ?? 0))
  }

  private async getRetainedUsage(): Promise<RetainedUsage> {
    const saved = await this.state.storage.get<RetainedUsage>(RETAINED_USAGE_KEY)
    if (saved) return saved
    // Upgrade existing rooms without resetting their storage budget to zero.
    const usage = { bytes: 0, count: 0 }
    let start = UPDATE_PREFIX
    while (true) {
      const entries = await this.state.storage.list<StoredSessionUpdate>({ prefix: UPDATE_PREFIX, start, limit: 256 })
      for (const update of entries.values()) {
        usage.bytes += update.retainedBytes ?? (update.updateBinary?.length ?? 0) + update.idempotencyKey.length * 2 + 1024
        usage.count += 1
      }
      if (entries.size < 256) break
      start = [...entries.keys()].at(-1)! + '\0'
    }
    return usage
  }

  private async pruneThrough(sequence: number): Promise<void> {
    while (true) {
      const entries = await this.state.storage.list<StoredSessionUpdate>({
        prefix: UPDATE_PREFIX,
        limit: 256,
      })
      const removable = [...entries.entries()]
        .filter(([, update]) => update.seq <= sequence)
      if (removable.length === 0) return
      const keys: string[] = []
      for (const [key, update] of removable) {
        keys.push(key)
        for (let index = 0; index < (update.chunkCount ?? 0); index++) keys.push(`update-piece:${update.seq}:${index}`)
      }
      const usage = await this.getRetainedUsage()
      const removedBytes = removable.reduce((total, [, update]) =>
        total + (update.retainedBytes ?? (update.updateBinary?.length ?? 0) + update.idempotencyKey.length * 2 + 1024), 0)
      await this.state.storage.transaction(async (storage) => {
        await storage.delete(keys)
        await storage.put(RETAINED_USAGE_KEY, {
          bytes: Math.max(0, usage.bytes - removedBytes),
          count: Math.max(0, usage.count - removable.length),
        })
      })
      if (entries.size < 256) return
    }
  }

  private async hydrateLegacyPresence(projectId: string): Promise<void> {
    const existing = this.getActivePresenceEntries(`project:${projectId}`)
    if (existing.length > 0) return
    try {
      const entries = await fetchActiveAwarenessFromConvex(this.env, projectId)
      const sockets = this.state.getWebSockets()
      for (const entry of entries) {
        const socket = sockets.find((candidate) => attachmentOf(candidate)?.clientId === entry.clientId)
        const connection = socket ? attachmentOf(socket) : null
        if (!socket || !connection) continue
        connection.awarenessBinary = entry.awarenessBinary
        connection.presenceExpiresAt = entry.expiresAt
        socket.serializeAttachment(connection)
      }
    } catch (error) {
      console.warn('[CollabRoom] Failed to hydrate legacy presence', error)
    }
  }
}
