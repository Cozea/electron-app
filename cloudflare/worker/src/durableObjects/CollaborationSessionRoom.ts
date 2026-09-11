/**
 * Session-scoped Durable Object for Collaboration & AutoGit.
 *
 * Master Specification: Section 13.1 - 13.10, 15.3
 * Responsibilities:
 * - Session room identity: session:<publicSessionId> (Section 13.1)
 * - WebSocket Hibernation: per-socket state lives in socket attachments, never in
 *   instance memory, so it survives eviction (Section 13.2)
 * - Global monotonic sessionSeq (Section 13.3)
 * - Batch idempotency by batchId (Section 13.10)
 * - CRDT barrier creation (Section 15.3)
 * - Durable encrypted update log and replay (Section 13.6 - 13.8)
 *
 * The room only stores and relays ciphertext. A socket must present a session token
 * for this room before it can read or write; viewer tokens can read but not write.
 */

import { verifySessionToken } from '../lib/jwt'
import type { Env, SessionClaims } from '../types'

/** Must match SESSION_ROOM_PROTOCOL_VERSION in apps/projectd/src/collaboration/SessionRoomClient.ts. */
export const SESSION_ROOM_PROTOCOL_VERSION = 'session-room/1'
export const MAX_ENCRYPTED_BATCH_CHARS = 1024 * 1024
const REPLAY_PAGE_SIZE = 256
const BATCH_KEY_PREFIX = 'batch:'
const BATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export interface StoredSessionBatch {
  sessionSeq: number
  batchId: string
  clientId: string
  principalId: string
  encryptedPayload: string // Base64 encoded E2EE payload
  serverTime: number
}

export interface StoredBarrier {
  barrierId: string
  sessionSeq: number
  serverTime: number
}

interface SocketAttachment {
  roomId: string
  authenticated: boolean
  principalId?: string
  clientId?: string
  canWrite?: boolean
}

type ClientMessage =
  | { type: 'hello'; token: unknown; clientId: unknown; protocolVersion: unknown }
  | { type: 'sync_request'; knownSeq: unknown }
  | { type: 'submit_batch'; batchId: unknown; encryptedPayload: unknown }
  | { type: 'barrier_request' }

function batchKey(sessionSeq: number): string {
  return `${BATCH_KEY_PREFIX}${String(sessionSeq).padStart(16, '0')}`
}

function toWireBatch(batch: StoredSessionBatch) {
  return {
    sessionSeq: batch.sessionSeq,
    batchId: batch.batchId,
    clientId: batch.clientId,
    encryptedPayload: batch.encryptedPayload,
  }
}

export class CollaborationSessionRoom implements DurableObject {
  private readonly state: DurableObjectState
  private readonly env: Env
  private currentSeq = 0
  private readonly ready: Promise<void>

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    this.ready = state.blockConcurrencyWhile(async () => {
      this.currentSeq = (await state.storage.get<number>('currentSeq')) ?? 0
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('Expected websocket upgrade', { status: 426 })
    }
    const sessionId = new URL(request.url).searchParams.get('sessionId')
    if (!sessionId) {
      return new Response('sessionId is required', { status: 400 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.acceptSocket(server, `session:${sessionId}`)
    return new Response(null, { status: 101, webSocket: client })
  }

  /** Registers a hibernatable socket that must authenticate for roomId before anything else. */
  acceptSocket(socket: WebSocket, roomId: string): void {
    this.state.acceptWebSocket(socket)
    const attachment: SocketAttachment = { roomId, authenticated: false }
    socket.serializeAttachment(attachment)
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ready

    let parsed: ClientMessage
    try {
      parsed = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as ClientMessage
    } catch {
      this.reject(socket, 'BAD_REQUEST', 'Malformed websocket message')
      return
    }

    const attachment = socket.deserializeAttachment() as SocketAttachment | null
    if (!attachment) {
      this.reject(socket, 'BAD_REQUEST', 'Unknown socket')
      return
    }

    if (parsed.type === 'hello') {
      await this.handleHello(socket, attachment, parsed)
      return
    }
    if (!attachment.authenticated) {
      this.reject(socket, 'UNAUTHENTICATED', 'Send hello with a session token first')
      return
    }

    switch (parsed.type) {
      case 'sync_request':
        await this.handleSyncRequest(socket, parsed.knownSeq)
        return
      case 'submit_batch':
        await this.handleSubmitBatch(socket, attachment, parsed)
        return
      case 'barrier_request':
        await this.handleBarrierRequest(socket, attachment)
        return
      default:
        this.sendError(socket, 'BAD_REQUEST', 'Unknown message type')
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason)
    } catch {
      // Already closed
    }
  }

  webSocketError(socket: WebSocket): void {
    try {
      socket.close(1011, 'socket error')
    } catch {
      // Already closed
    }
  }

  /** Assigns the next sessionSeq, or returns the original one for a batchId it has already stored. */
  async acceptBatch(input: {
    batchId: string
    clientId: string
    principalId: string
    encryptedPayload: string
  }): Promise<{ stored: StoredSessionBatch; duplicate: boolean }> {
    await this.ready

    // Section 13.10: Idempotency check
    const existingSeq = await this.state.storage.get<number>(`batch-id:${input.batchId}`)
    if (existingSeq !== undefined) {
      const existing = await this.state.storage.get<StoredSessionBatch>(batchKey(existingSeq))
      if (existing) {
        return { stored: existing, duplicate: true }
      }
    }

    this.currentSeq += 1
    const stored: StoredSessionBatch = {
      sessionSeq: this.currentSeq,
      ...input,
      serverTime: Date.now(),
    }
    await this.state.storage.put({
      currentSeq: stored.sessionSeq,
      [batchKey(stored.sessionSeq)]: stored,
      [`batch-id:${input.batchId}`]: stored.sessionSeq,
    })
    return { stored, duplicate: false }
  }

  private async handleHello(
    socket: WebSocket,
    attachment: SocketAttachment,
    message: Extract<ClientMessage, { type: 'hello' }>,
  ): Promise<void> {
    if (attachment.authenticated) {
      this.sendError(socket, 'BAD_REQUEST', 'This socket is already authenticated')
      return
    }
    if (message.protocolVersion !== SESSION_ROOM_PROTOCOL_VERSION) {
      this.reject(socket, 'INVALID_PROTOCOL_VERSION', `Expected protocol ${SESSION_ROOM_PROTOCOL_VERSION}`)
      return
    }
    if (typeof message.clientId !== 'string' || !BATCH_ID_PATTERN.test(message.clientId)) {
      this.reject(socket, 'BAD_REQUEST', 'hello requires a clientId')
      return
    }

    let claims: SessionClaims
    try {
      claims = await verifySessionToken(this.env, String(message.token))
    } catch (error) {
      this.reject(socket, 'INVALID_SESSION_TOKEN', error instanceof Error ? error.message : 'Invalid session token')
      return
    }
    if (claims.roomId !== attachment.roomId || claims.protocolVersion !== SESSION_ROOM_PROTOCOL_VERSION) {
      this.reject(socket, 'ROOM_MISMATCH', 'The session token is for a different session')
      return
    }

    const authenticated: SocketAttachment = {
      roomId: attachment.roomId,
      authenticated: true,
      principalId: claims.principalId,
      clientId: message.clientId,
      canWrite: claims.sessionRole !== 'viewer',
    }
    socket.serializeAttachment(authenticated)
    this.send(socket, { type: 'ready', headSeq: this.currentSeq, serverTime: Date.now() })
  }

  private async handleSyncRequest(socket: WebSocket, knownSeq: unknown): Promise<void> {
    const fromSeq = typeof knownSeq === 'number' && Number.isSafeInteger(knownSeq) && knownSeq >= 0 ? knownSeq : 0
    const page = await this.state.storage.list<StoredSessionBatch>({
      prefix: BATCH_KEY_PREFIX,
      start: batchKey(fromSeq + 1),
      limit: REPLAY_PAGE_SIZE,
    })
    const batches = [...page.values()]
    this.send(socket, {
      type: 'sync_delta',
      fromSeq,
      toSeq: batches.length > 0 ? batches[batches.length - 1].sessionSeq : fromSeq,
      headSeq: this.currentSeq,
      batches: batches.map(toWireBatch),
    })
  }

  private async handleSubmitBatch(
    socket: WebSocket,
    attachment: SocketAttachment,
    message: Extract<ClientMessage, { type: 'submit_batch' }>,
  ): Promise<void> {
    if (!attachment.canWrite) {
      this.sendError(socket, 'FORBIDDEN', 'Viewers cannot change session files')
      return
    }
    const { batchId, encryptedPayload } = message
    if (typeof batchId !== 'string' || !BATCH_ID_PATTERN.test(batchId)) {
      this.sendError(socket, 'BAD_REQUEST', 'submit_batch requires a batchId')
      return
    }
    if (typeof encryptedPayload !== 'string' || encryptedPayload.length === 0) {
      this.sendError(socket, 'BAD_REQUEST', 'submit_batch requires an encrypted payload')
      return
    }
    if (encryptedPayload.length > MAX_ENCRYPTED_BATCH_CHARS) {
      this.sendError(socket, 'BATCH_TOO_LARGE', `Batches are limited to ${MAX_ENCRYPTED_BATCH_CHARS} characters`)
      return
    }

    const { stored, duplicate } = await this.acceptBatch({
      batchId,
      clientId: attachment.clientId ?? 'unknown',
      principalId: attachment.principalId ?? 'unknown',
      encryptedPayload,
    })
    this.send(socket, { type: 'batch_ack', batchId, sessionSeq: stored.sessionSeq, duplicate })
    if (!duplicate) {
      this.broadcast(socket, { type: 'session_batch', batch: toWireBatch(stored) })
    }
  }

  private async handleBarrierRequest(socket: WebSocket, attachment: SocketAttachment): Promise<void> {
    if (!attachment.canWrite) {
      this.sendError(socket, 'FORBIDDEN', 'Viewers cannot request checkpoints')
      return
    }
    const barrier: StoredBarrier = {
      barrierId: `barrier_${crypto.randomUUID().replace(/-/g, '')}`,
      sessionSeq: this.currentSeq,
      serverTime: Date.now(),
    }
    await this.state.storage.put(`barrier:${barrier.barrierId}`, barrier)
    this.send(socket, { type: 'barrier_ack', barrier })
  }

  private broadcast(except: WebSocket, message: unknown): void {
    const payload = JSON.stringify(message)
    for (const socket of this.state.getWebSockets()) {
      if (socket === except) continue
      const attachment = socket.deserializeAttachment() as SocketAttachment | null
      if (!attachment?.authenticated) continue
      try {
        socket.send(payload)
      } catch {
        // Closed
      }
    }
  }

  private send(socket: WebSocket, message: unknown): void {
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // Closed
    }
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    this.send(socket, { type: 'error', code, message, recoverable: true })
  }

  private reject(socket: WebSocket, code: string, message: string): void {
    this.send(socket, { type: 'error', code, message, recoverable: false })
    try {
      socket.close(1008, code)
    } catch {
      // Already closed
    }
  }
}
