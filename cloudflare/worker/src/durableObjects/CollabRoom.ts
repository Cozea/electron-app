import { RoomCheckpointStore, ROOM_COMPACTION_FLOOR_KEY } from "./RoomCheckpointStore"
import { currentRoomAuthority } from "../lib/liveRoomAuthority"
import { CollaborationProtocolError, parseCheckpointRequest, parseRoomAuthority, protocolRecord, protocolSequence, type RoomAuthority } from "../../../../shared/collaborationProtocol"
import { decodeCanonicalBase64, validateEncryptedCollaborationEnvelope } from "../../../../shared/collaborationWire"
import { fileInitializationOrigin } from "../../../../shared/collaborationFileInitialization"
import type { Env } from '../types'
import { COLLAB_MAX_FRAME_BYTES, reserveUpdateBudget, validateUpdateInput, type RetainedUsage, type UpdateRate } from '../lib/collaborationLimits'
import {
  fetchActiveAwarenessFromConvex,
  fetchYjsDeltasFromConvex,
  persistYjsUpdateToConvex,
  upsertAwarenessInConvex,
} from '../lib/convex'
import { updateAuthoritativeRoomHead } from '../lib/collaborationV2Convex'
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
  principalId: string
  identityKey?: string
  expiresAt?: number
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
  updateBinary: string
  idempotencyKey: string
  clientId: string
  timestamp: number
  retainedBytes?: number
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
  private readonly checkpoints: RoomCheckpointStore

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    this.checkpoints = new RoomCheckpointStore(state.storage)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/internal/')) {
      if (!this.env.AI_GATEWAY_SECRET || request.headers.get('authorization') !== `Bearer ${this.env.AI_GATEWAY_SECRET}`) return new Response('Unauthorized', { status: 401 })
      try {
        if (url.pathname === '/internal/checkpoint' && request.method === 'POST') {
          const body = protocolRecord(await request.json(), "Internal checkpoint request")
          const authority = parseRoomAuthority(body.authority)
          const command = parseCheckpointRequest(body.request)
          const operation = this.updateQueue.then(() => this.checkpoints.handle(authority, command))
          this.updateQueue = operation.then(() => undefined, () => undefined)
          return Response.json(await operation)
        }
        if (url.pathname === '/internal/base-advanced' && request.method === 'POST') {
          const body = protocolRecord(await request.json(), "Publication receipt")
          const sequence = protocolSequence(body.coveredThroughSequence, "coveredThroughSequence")
          if (typeof body.commitSha !== "string" || !/^[a-f0-9]{40}$/.test(body.commitSha)) throw new CollaborationProtocolError("INVALID_REQUEST", "Invalid publication commit")
          const commitSha = body.commitSha
          const operation = this.updateQueue.then(async () => {
            if (sequence > await this.getSessionHeadSequence()) throw new CollaborationProtocolError("INVALID_SEQUENCE", "Publication exceeds the canonical room head", 409)
            await this.state.storage.put("g3:publication", { commitSha, coveredThroughSequence: sequence })
            // Git publication is not CRDT compaction. Keep the replay history
            // until an independently finalized checkpoint permits retirement.
            this.broadcast({ type: 'base.advanced', payload: { roomId: this.currentRoomId() ?? '', commitSha, coveredThroughSequence: sequence } })
          })
          this.updateQueue = operation.catch(() => undefined)
          await operation
          return new Response(null, { status: 204 })
        }
        if (url.pathname === '/internal/close' && request.method === 'POST') {
          await this.updateQueue
          await this.state.storage.put("g3:closed", true)
          for (const socket of this.state.getWebSockets()) socket.close(1000, 'Session closed')
          return new Response(null, { status: 204 })
        }
        return new Response('Unknown internal operation', { status: 404 })
      } catch (error) {
        if (error instanceof CollaborationProtocolError) return protocolError(error.code, error.message, { status: error.status }, error.recoverable)
        throw error
      }
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

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
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
          code: error instanceof CollaborationProtocolError ? error.code : 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unhandled websocket room error',
          recoverable: error instanceof CollaborationProtocolError && error.recoverable,
        },
      }))
      socket.close(1011, 'internal room error')
    }
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
      const claims = await verifySessionToken(this.env, message.payload.sessionToken)
      const selected = socket.deserializeAttachment<{ handshaken: boolean; roomId: string }>()
      if (!selected || selected.roomId !== claims.roomId) {
        throw new Error('Session token does not match the selected room')
      }
      if (selected.handshaken) throw new Error('Socket is already authenticated')
      if (!claims.principalId) throw new Error('Session principal is missing')
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(message.payload.clientId)) throw new Error('Invalid document client ID')
      const protocolVersion = this.env.COLLAB_PROTOCOL_VERSION ?? COLLAB_PROTOCOL_VERSION
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

      const headSeq = isV2Room(claims.roomId)
        ? await this.getSessionHeadSequence()
        : Math.max(0, Math.floor(message.payload.knownSeq))
      if (roomSessionId) {
        if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) throw new Error("Session token expired")
        const authority = await currentRoomAuthority(this.env, claims.sub, roomSessionId)
        if (authority.principalId !== claims.principalId || authority.projectId !== claims.projectId || authority.roomId !== claims.roomId) throw new Error("Current room authority changed")
        await this.checkpoints.bind(authority)
      }
      const attachment: SocketAttachment = {
        handshaken: true,
        clientId: message.payload.clientId,
        projectId: claims.projectId,
        roomId: claims.roomId,
        sessionId: claims.sessionId,
        principalId: claims.principalId,
        identityKey: claims.sub,
        expiresAt: claims.exp * 1000,
        mediaClientId: `${claims.principalId}:${crypto.randomUUID()}`,
        knownSeq: Math.max(0, Math.floor(message.payload.knownSeq)),
      }
      socket.serializeAttachment(attachment)

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
    if (connection.sessionId && message.type !== 'update.push') await this.requireRoomAuthority(connection)
    switch (message.type) {
      case 'sync.request':
        await this.handleSyncRequest(socket, connection, message)
        return
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
      const known = protocolSequence(message.payload.knownSeq, "knownSeq")
      const floor = await this.state.storage.get<number>(ROOM_COMPACTION_FLOOR_KEY) ?? 0
      if (known < floor || known > headSeq) throw new CollaborationProtocolError("CHECKPOINT_REQUIRED", "Replay cursor requires a canonical checkpoint", 409, true)
      const entries = await this.state.storage.list<StoredSessionUpdate>({
        start: updateKey(message.payload.knownSeq + 1),
        end: 'update;',
        limit: 1, // Bounded legacy-sized replay until chunked replay is installed.
      })
      const updates = [...entries.values()].sort((left, right) => left.seq - right.seq)
      if (known < headSeq && updates[0]?.seq !== known + 1) throw new CollaborationProtocolError("CHECKPOINT_REQUIRED", "The next canonical update is unavailable; reload the checkpoint", 409, true)
      const toSeq = updates.at(-1)?.seq ?? message.payload.knownSeq
      socket.send(stringifyMessage({
        type: 'sync.delta',
        payload: {
          roomId: connection.roomId,
          fromSeq: message.payload.knownSeq,
          toSeq,
          headSeq,
          hasMore: toSeq < headSeq,
          updatesBinary: updates.map((update) => update.updateBinary),
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
    this.broadcast({
      type: 'sync.delta',
      payload: {
        roomId: connection.roomId,
        fromSeq: result.seq - 1,
        toSeq: result.seq,
        headSeq: result.seq,
        hasMore: false,
        updatesBinary: [message.payload.updateBinary],
      },
    }, socket)
  }

  private async persistSessionUpdate(
    connection: SocketAttachment,
    message: UpdatePushMessage,
  ): Promise<{ seq: number }> {
    const authority = await this.requireRoomAuthority(connection, true)
    const retainedBytes = validateUpdateInput(message.payload)
    const envelope = validateEncryptedCollaborationEnvelope(message.payload.updateBinary, { roomId: authority.roomId, projectId: authority.projectId, kind: "yjs_update", idempotencyKey: message.payload.idempotencyKey })
    if (envelope.keyVersion !== authority.keyVersion) throw new CollaborationProtocolError("ENCRYPTION_KEY_STALE", "Update uses an old room key; reconcile retained local work", 409, true)
    const idempotencyKey = `${IDEMPOTENCY_PREFIX}${message.payload.idempotencyKey}`
    const existing = await this.state.storage.get<number>(idempotencyKey)
    if (typeof existing === 'number') {
      const saved = await this.state.storage.get<StoredSessionUpdate>(updateKey(existing))
      if (!saved || saved.updateBinary !== message.payload.updateBinary) {
        throw new Error('Idempotency key was already used for another update')
      }
      return { seq: existing }
    }

    const usage = await this.getRetainedUsage()
    const rateKey = `rate:${connection.principalId}`
    const rate = await this.state.storage.get<UpdateRate>(rateKey)
    const budget = reserveUpdateBudget(usage, rate, retainedBytes, Date.now())
    const seq = (await this.getSessionHeadSequence()) + 1
    const encodedEnvelope = JSON.parse(new TextDecoder().decode(decodeCanonicalBase64(message.payload.updateBinary, 4 * 1024 * 1024))) as { aad: string }
    const metadata = protocolRecord(JSON.parse(new TextDecoder().decode(decodeCanonicalBase64(encodedEnvelope.aad, 8192))), "Update metadata")
    const initialization = fileInitializationOrigin(metadata.initialization)
    const receipt = initialization ? await this.checkpoints.initializationReceipt(authority, initialization, seq) : {}
    const stored: StoredSessionUpdate = {
      seq,
      updateBinary: message.payload.updateBinary,
      idempotencyKey: message.payload.idempotencyKey,
      clientId: connection.clientId,
      timestamp: message.payload.timestamp,
      retainedBytes,
    }
    await this.state.storage.put({
      ...receipt,
      [HEAD_SEQUENCE_KEY]: seq,
      [updateKey(seq)]: stored,
      [idempotencyKey]: seq,
      [RETAINED_USAGE_KEY]: budget.usage,
      [rateKey]: budget.rate,
    })
    return { seq }
  }

  private async requireRoomAuthority(connection: SocketAttachment, write = false): Promise<RoomAuthority> {
    if (!connection.sessionId || !connection.identityKey || !connection.expiresAt || connection.expiresAt <= Date.now()) throw new CollaborationProtocolError("SESSION_EXPIRED", "Session authority expired; refresh the connection", 401, true)
    if (await this.state.storage.get("g3:closed")) throw new CollaborationProtocolError("DEVICE_REVOKED", "This session is closed", 403)
    const authority = await currentRoomAuthority(this.env, connection.identityKey, connection.sessionId)
    if (authority.principalId !== connection.principalId || authority.projectId !== connection.projectId || authority.roomId !== connection.roomId) throw new CollaborationProtocolError("SESSION_MISMATCH", "Socket authority does not match this room", 403)
    if (write && authority.role !== "editor") throw new CollaborationProtocolError("READ_ONLY", "Observers cannot submit shared updates", 403)
    if (write && authority.rotationRequired) throw new CollaborationProtocolError("KEY_ROTATION_REQUIRED", "Room key rotation must finish before accepting updates", 409, true)
    return authority
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

  private currentRoomId(): string | null {
    for (const socket of this.state.getWebSockets()) {
      const connection = attachmentOf(socket)
      if (connection) return connection.roomId
    }
    return null
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
        usage.bytes += update.retainedBytes ?? update.updateBinary.length + update.idempotencyKey.length * 2 + 1024
        usage.count += 1
      }
      if (entries.size < 256) break
      start = [...entries.keys()].at(-1)! + '\0'
    }
    return usage
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
