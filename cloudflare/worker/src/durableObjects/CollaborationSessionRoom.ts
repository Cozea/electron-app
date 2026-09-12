/**
 * Session-scoped Durable Object for Collaboration & AutoGit.
 *
 * Master Specification: Section 13.1 - 13.10, 14.5 - 14.7, 15.3, 15.10
 * Responsibilities:
 * - Session room identity: session:<publicSessionId> (Section 13.1)
 * - WebSocket Hibernation: per-socket state lives in socket attachments, never in
 *   instance memory, so it survives eviction (Section 13.2)
 * - Global monotonic sessionSeq (Section 13.3)
 * - Batch idempotency by batchId (Section 13.10)
 * - Durable encrypted update log and replay (Section 13.6 - 13.8)
 * - The AutoGit leader lease, the one authority on which device may push (Section 14.5 - 14.7)
 * - CRDT barriers and checkpoint records, accepted only from the lease holder (Section 15.3, 15.10)
 *
 * The room only stores and relays ciphertext. A socket must present a session token
 * for this room before it can read or write; viewer tokens can read but not write.
 *
 * The lease names one connected daemon by clientId and carries a generation that
 * only grows. The leader keeps it by renewing; when renewals stop, the lease runs out
 * and the room's alarm elects the next eligible writer. A socket that drops keeps its
 * lease until it runs out, so a daemon that reconnects quickly stays leader.
 */

import { verifySessionToken } from '../lib/jwt'
import type { Env, SessionClaims } from '../types'

/** Must match SESSION_ROOM_PROTOCOL_VERSION in apps/projectd/src/collaboration/SessionRoomClient.ts. */
export const SESSION_ROOM_PROTOCOL_VERSION = 'session-room/1'
export const MAX_ENCRYPTED_BATCH_CHARS = 1024 * 1024
/** How long an AutoGit lease lasts without a renewal (Section 14.5). */
export const AUTOGIT_LEASE_MS = 20_000
const REPLAY_PAGE_SIZE = 256
const BATCH_KEY_PREFIX = 'batch:'
const BARRIER_KEY_PREFIX = 'barrier:'
const LEASE_KEY = 'autogit:lease'
const CHECKPOINT_KEY = 'autogit:checkpoint'
const BATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const BARRIER_ID_PATTERN = /^barrier_[0-9a-f]{32}$/
const OID_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const TREE_HASH_PATTERN = /^[0-9a-f]{64}$/
const MAX_NOTICE_CHARS = 500
const NOTICE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,39}$/

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
  leaseGeneration: number
}

/** The AutoGit leader lease. The generation only grows, so work from an older lease is recognisable. */
export interface StoredLease {
  generation: number
  leaderClientId: string | null
  leaderPrincipalId: string | null
  expiresAt: number
  renewedAt: number
  /** Why the leader stopped saving, shown to every member; cleared with each new lease. */
  notice?: string | null
  /** What kind of stop the notice describes, such as ENV_NOT_IGNORED, so members can offer the fix. */
  noticeCode?: string | null
}

/** The last checkpoint the leader pushed to the session branch (Section 15.10). */
export interface StoredCheckpoint {
  commitOid: string
  parentOid: string | null
  treeOid: string
  sessionSeq: number
  barrierId: string
  logicalTreeHash: string
  leaseGeneration: number
  publishedAt: number
  publishedByPrincipalId: string
  /** The branch still holds the session at this later sequence: a barrier found nothing new for Git. */
  savedThroughSeq?: number
  /**
   * An explicit rebase rewrote the branch, replacing this commit. Later checkpoints
   * carry it until the next rebase, so a member whose Git still has the old history
   * can follow the new one.
   */
  rebasedFrom?: string
}

type CheckpointInput = Pick<
  StoredCheckpoint,
  'commitOid' | 'parentOid' | 'treeOid' | 'sessionSeq' | 'barrierId' | 'logicalTreeHash' | 'rebasedFrom'
>

const NO_LEASE: StoredLease = { generation: 0, leaderClientId: null, leaderPrincipalId: null, expiresAt: 0, renewedAt: 0 }

interface SocketAttachment {
  roomId: string
  authenticated: boolean
  principalId?: string
  clientId?: string
  canWrite?: boolean
  /** The daemon behind this socket can push the session branch (Section 14.4). */
  autoGitEligible?: boolean
}

type ClientMessage =
  | { type: 'hello'; token: unknown; clientId: unknown; protocolVersion: unknown }
  | { type: 'sync_request'; knownSeq: unknown }
  | { type: 'submit_batch'; batchId: unknown; encryptedPayload: unknown }
  | { type: 'autogit_eligibility'; eligible: unknown }
  | { type: 'lease_renew'; requestId: unknown; generation: unknown }
  | { type: 'lease_release'; generation: unknown }
  | { type: 'lease_notice'; generation: unknown; notice: unknown; code?: unknown }
  | { type: 'barrier_request'; requestId: unknown; generation: unknown }
  | { type: 'checkpoint_publish'; requestId: unknown; generation: unknown; checkpoint: unknown }
  | { type: 'checkpoint_clean'; requestId: unknown; generation: unknown; barrierId: unknown }
  | { type: 'checkpoint_request'; requestId: unknown }
  | { type: 'rebase_request'; requestId: unknown; allowConflicts: unknown }

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

function toWireLease(lease: StoredLease) {
  if (lease.generation === 0) return null
  return {
    generation: lease.generation,
    leaderClientId: lease.leaderClientId,
    leaderPrincipalId: lease.leaderPrincipalId,
    expiresAt: lease.expiresAt,
    notice: lease.notice ?? null,
    noticeCode: lease.noticeCode ?? null,
  }
}

function readRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && BATCH_ID_PATTERN.test(value) ? value : undefined
}

function parseCheckpoint(value: unknown): CheckpointInput | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const { commitOid, treeOid, sessionSeq, barrierId, logicalTreeHash } = input
  const parentOid = input.parentOid ?? null
  if (typeof commitOid !== 'string' || !OID_PATTERN.test(commitOid)) return null
  if (parentOid !== null && (typeof parentOid !== 'string' || !OID_PATTERN.test(parentOid))) return null
  if (typeof treeOid !== 'string' || !OID_PATTERN.test(treeOid)) return null
  if (typeof sessionSeq !== 'number' || !Number.isSafeInteger(sessionSeq) || sessionSeq < 0) return null
  if (typeof barrierId !== 'string' || !BARRIER_ID_PATTERN.test(barrierId)) return null
  if (typeof logicalTreeHash !== 'string' || !TREE_HASH_PATTERN.test(logicalTreeHash)) return null
  const rebasedFrom = input.rebasedFrom ?? null
  if (rebasedFrom !== null && (typeof rebasedFrom !== 'string' || !OID_PATTERN.test(rebasedFrom))) return null
  return {
    commitOid,
    parentOid,
    treeOid,
    sessionSeq,
    barrierId,
    logicalTreeHash,
    ...(rebasedFrom ? { rebasedFrom } : {}),
  }
}

export class CollaborationSessionRoom implements DurableObject {
  private readonly state: DurableObjectState
  private readonly env: Env
  private readonly leaseMs: number
  private currentSeq = 0
  private readonly ready: Promise<void>

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    const configuredLeaseMs = Number(env.AUTOGIT_LEASE_MS)
    this.leaseMs = Number.isFinite(configuredLeaseMs) && configuredLeaseMs > 0 ? configuredLeaseMs : AUTOGIT_LEASE_MS
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
      case 'autogit_eligibility':
        await this.handleEligibility(socket, attachment, parsed.eligible)
        return
      case 'lease_renew':
        await this.handleLeaseRenew(socket, attachment, readRequestId(parsed.requestId), parsed.generation)
        return
      case 'lease_release':
        await this.handleLeaseRelease(socket, attachment, parsed.generation)
        return
      case 'lease_notice':
        await this.handleLeaseNotice(attachment, parsed.generation, parsed.notice, parsed.code)
        return
      case 'barrier_request':
        await this.handleBarrierRequest(socket, attachment, readRequestId(parsed.requestId), parsed.generation)
        return
      case 'checkpoint_publish':
        await this.handleCheckpointPublish(
          socket,
          attachment,
          readRequestId(parsed.requestId),
          parsed.generation,
          parsed.checkpoint,
        )
        return
      case 'checkpoint_clean':
        await this.handleCheckpointClean(
          socket,
          attachment,
          readRequestId(parsed.requestId),
          parsed.generation,
          parsed.barrierId,
        )
        return
      case 'checkpoint_request':
        await this.handleCheckpointRequest(socket, attachment, readRequestId(parsed.requestId))
        return
      case 'rebase_request':
        await this.handleRebaseRequest(socket, attachment, readRequestId(parsed.requestId), parsed.allowConflicts)
        return
      default:
        this.sendError(socket, 'BAD_REQUEST', 'Unknown message type')
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    // A leader that drops keeps its lease until it runs out, so a quick reconnect stays leader.
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

  /** Runs when the lease runs out, and elects a successor when the leader stopped renewing. */
  async alarm(): Promise<void> {
    await this.ready
    const lease = await this.readLease()
    // An alarm that fires a moment early comes back once the lease has run out.
    if (lease.leaderClientId !== null && lease.expiresAt > Date.now()) {
      await this.state.storage.setAlarm(lease.expiresAt)
      return
    }
    await this.electIfNeeded()
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
    this.send(socket, await this.autoGitState())
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

  // ─── AutoGit lease (Section 14.5 - 14.7) ─────────────────────────────────────

  private async readLease(): Promise<StoredLease> {
    return (await this.state.storage.get<StoredLease>(LEASE_KEY)) ?? NO_LEASE
  }

  private holdsLease(attachment: SocketAttachment, lease: StoredLease, generation: unknown, now: number): boolean {
    return (
      Boolean(attachment.canWrite) &&
      lease.leaderClientId !== null &&
      lease.leaderClientId === attachment.clientId &&
      lease.generation === generation &&
      lease.expiresAt > now
    )
  }

  private async handleEligibility(socket: WebSocket, attachment: SocketAttachment, eligible: unknown): Promise<void> {
    if (!attachment.canWrite) {
      this.sendError(socket, 'FORBIDDEN', 'Viewers cannot save the session to Git')
      return
    }
    const autoGitEligible = eligible === true
    socket.serializeAttachment({ ...attachment, autoGitEligible })
    const lease = await this.readLease()
    if (!autoGitEligible && lease.leaderClientId !== null && lease.leaderClientId === attachment.clientId) {
      await this.vacateLease(lease)
      return
    }
    await this.electIfNeeded()
  }

  private async handleLeaseRenew(
    socket: WebSocket,
    attachment: SocketAttachment,
    requestId: string | undefined,
    generation: unknown,
  ): Promise<void> {
    const now = Date.now()
    const lease = await this.readLease()
    if (!this.holdsLease(attachment, lease, generation, now)) {
      this.sendError(socket, 'LEASE_STALE', 'This device no longer holds the AutoGit lease', requestId)
      await this.electIfNeeded()
      this.send(socket, await this.autoGitState())
      return
    }
    const renewed: StoredLease = { ...lease, expiresAt: now + this.leaseMs, renewedAt: now }
    await this.state.storage.put(LEASE_KEY, renewed)
    await this.state.storage.setAlarm(renewed.expiresAt)
    this.send(socket, { type: 'lease_ack', requestId, lease: toWireLease(renewed) })
  }

  private async handleLeaseRelease(socket: WebSocket, attachment: SocketAttachment, generation: unknown): Promise<void> {
    const lease = await this.readLease()
    if (lease.leaderClientId === null || lease.leaderClientId !== attachment.clientId || lease.generation !== generation) {
      return
    }
    // The device steps aside, so this election passes it over.
    socket.serializeAttachment({ ...attachment, autoGitEligible: false })
    await this.vacateLease(lease)
  }

  /** The leader tells every member why it stopped saving, or clears that. A stale leader is ignored. */
  private async handleLeaseNotice(
    attachment: SocketAttachment,
    generation: unknown,
    notice: unknown,
    code: unknown,
  ): Promise<void> {
    const lease = await this.readLease()
    if (!this.holdsLease(attachment, lease, generation, Date.now())) return
    const next = typeof notice === 'string' && notice.trim() ? notice.trim().slice(0, MAX_NOTICE_CHARS) : null
    const nextCode = next && typeof code === 'string' && NOTICE_CODE_PATTERN.test(code) ? code : null
    if ((lease.notice ?? null) === next && (lease.noticeCode ?? null) === nextCode) return
    await this.state.storage.put(LEASE_KEY, { ...lease, notice: next, noticeCode: nextCode })
    await this.broadcastAutoGitState()
  }

  /** Ends the current lease now and elects a successor if a device is eligible. */
  private async vacateLease(lease: StoredLease): Promise<void> {
    await this.state.storage.put(LEASE_KEY, { ...lease, leaderClientId: null, leaderPrincipalId: null, expiresAt: 0, notice: null, noticeCode: null })
    await this.electIfNeeded(true)
  }

  /**
   * Keeps a leader whose lease has not run out. Otherwise grants the next generation
   * to the eligible writer with the lowest clientId, so every room picks alike.
   */
  private async electIfNeeded(changed = false): Promise<void> {
    const now = Date.now()
    const lease = await this.readLease()
    if (lease.leaderClientId !== null && lease.expiresAt > now) {
      if (changed) await this.broadcastAutoGitState()
      return
    }
    const candidate = this.pickCandidate()
    if (candidate) {
      const granted: StoredLease = {
        generation: lease.generation + 1,
        leaderClientId: candidate.clientId,
        leaderPrincipalId: candidate.principalId,
        expiresAt: now + this.leaseMs,
        renewedAt: now,
      }
      await this.state.storage.put(LEASE_KEY, granted)
      await this.state.storage.setAlarm(granted.expiresAt)
      changed = true
    } else if (lease.leaderClientId !== null) {
      await this.state.storage.put(LEASE_KEY, { ...lease, leaderClientId: null, leaderPrincipalId: null, expiresAt: 0, notice: null, noticeCode: null })
      changed = true
    }
    if (changed) await this.broadcastAutoGitState()
  }

  private pickCandidate(): { clientId: string; principalId: string } | null {
    let best: { clientId: string; principalId: string } | null = null
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null
      if (!attachment?.authenticated || !attachment.canWrite || !attachment.autoGitEligible) continue
      if (!attachment.clientId || !attachment.principalId) continue
      if (!best || attachment.clientId < best.clientId) {
        best = { clientId: attachment.clientId, principalId: attachment.principalId }
      }
    }
    return best
  }

  // ─── Barriers and checkpoints (Section 15.3, 15.10) ──────────────────────────

  private async handleBarrierRequest(
    socket: WebSocket,
    attachment: SocketAttachment,
    requestId: string | undefined,
    generation: unknown,
  ): Promise<void> {
    if (!attachment.canWrite) {
      this.sendError(socket, 'FORBIDDEN', 'Viewers cannot request checkpoints', requestId)
      return
    }
    const now = Date.now()
    const lease = await this.readLease()
    if (!this.holdsLease(attachment, lease, generation, now)) {
      this.sendError(socket, 'LEASE_STALE', 'Only the AutoGit leader can create checkpoint barriers', requestId)
      return
    }
    const barrier: StoredBarrier = {
      barrierId: `barrier_${crypto.randomUUID().replace(/-/g, '')}`,
      sessionSeq: this.currentSeq,
      serverTime: now,
      leaseGeneration: lease.generation,
    }
    await this.state.storage.put(`${BARRIER_KEY_PREFIX}${barrier.barrierId}`, barrier)
    this.send(socket, { type: 'barrier_ack', requestId, barrier })
  }

  private async handleCheckpointPublish(
    socket: WebSocket,
    attachment: SocketAttachment,
    requestId: string | undefined,
    generation: unknown,
    rawCheckpoint: unknown,
  ): Promise<void> {
    const now = Date.now()
    const lease = await this.readLease()
    if (!this.holdsLease(attachment, lease, generation, now)) {
      this.sendError(socket, 'LEASE_STALE', 'Only the AutoGit leader can publish checkpoints', requestId)
      return
    }
    const input = parseCheckpoint(rawCheckpoint)
    if (!input) {
      this.sendError(
        socket,
        'BAD_REQUEST',
        'checkpoint_publish requires commitOid, parentOid, treeOid, sessionSeq, barrierId and logicalTreeHash',
        requestId,
      )
      return
    }
    const barrier = await this.state.storage.get<StoredBarrier>(`${BARRIER_KEY_PREFIX}${input.barrierId}`)
    if (!barrier || barrier.sessionSeq !== input.sessionSeq) {
      this.sendError(socket, 'BAD_REQUEST', 'The checkpoint does not match a barrier this room created', requestId)
      return
    }
    const previous = await this.state.storage.get<StoredCheckpoint>(CHECKPOINT_KEY)
    if (previous?.commitOid === input.commitOid) {
      this.send(socket, { type: 'checkpoint_ack', requestId, checkpoint: previous })
      return
    }
    if (previous && input.sessionSeq < previous.sessionSeq) {
      this.sendError(socket, 'STALE_CHECKPOINT', `The room already has a checkpoint at ${previous.sessionSeq}`, requestId)
      return
    }
    // A rebase's mark stays on the checkpoints after it, until the next rebase.
    const rebasedFrom = input.rebasedFrom ?? previous?.rebasedFrom
    const checkpoint: StoredCheckpoint = {
      ...input,
      ...(rebasedFrom ? { rebasedFrom } : {}),
      leaseGeneration: lease.generation,
      publishedAt: now,
      publishedByPrincipalId: attachment.principalId ?? 'unknown',
    }
    await this.state.storage.put(CHECKPOINT_KEY, checkpoint)
    this.send(socket, { type: 'checkpoint_ack', requestId, checkpoint })
    await this.broadcastAutoGitState()
  }

  /**
   * The leader found nothing new for Git at a barrier: the branch already holds the
   * session through it. Members stop counting those changes as unsaved, such as an
   * edit to an env file Git ignores.
   */
  private async handleCheckpointClean(
    socket: WebSocket,
    attachment: SocketAttachment,
    requestId: string | undefined,
    generation: unknown,
    barrierId: unknown,
  ): Promise<void> {
    const lease = await this.readLease()
    if (!this.holdsLease(attachment, lease, generation, Date.now())) {
      this.sendError(socket, 'LEASE_STALE', 'Only the AutoGit leader can mark the session saved', requestId)
      return
    }
    const barrier =
      typeof barrierId === 'string' && BARRIER_ID_PATTERN.test(barrierId)
        ? await this.state.storage.get<StoredBarrier>(`${BARRIER_KEY_PREFIX}${barrierId}`)
        : undefined
    if (!barrier) {
      this.sendError(socket, 'BAD_REQUEST', 'checkpoint_clean needs a barrier this room created', requestId)
      return
    }
    const previous = await this.state.storage.get<StoredCheckpoint>(CHECKPOINT_KEY)
    if (!previous) {
      this.sendError(socket, 'NO_CHECKPOINT', 'The room has no checkpoint to mark as current', requestId)
      return
    }
    if (barrier.sessionSeq <= Math.max(previous.sessionSeq, previous.savedThroughSeq ?? 0)) {
      this.send(socket, { type: 'checkpoint_clean_ack', requestId, checkpoint: previous })
      return
    }
    const checkpoint: StoredCheckpoint = { ...previous, savedThroughSeq: barrier.sessionSeq }
    await this.state.storage.put(CHECKPOINT_KEY, checkpoint)
    this.send(socket, { type: 'checkpoint_clean_ack', requestId, checkpoint })
    await this.broadcastAutoGitState()
  }

  /** A member's "save now": the room passes it to the leader (Section 14.3). */
  private async handleCheckpointRequest(
    socket: WebSocket,
    attachment: SocketAttachment,
    requestId: string | undefined,
  ): Promise<void> {
    if (!attachment.canWrite) {
      this.sendError(socket, 'FORBIDDEN', 'Viewers cannot save the session to Git', requestId)
      return
    }
    const lease = await this.readLease()
    let routed = false
    if (lease.leaderClientId !== null && lease.expiresAt > Date.now()) {
      for (const candidate of this.state.getWebSockets()) {
        const target = candidate.deserializeAttachment() as SocketAttachment | null
        if (!target?.authenticated || target.clientId !== lease.leaderClientId) continue
        this.send(candidate, { type: 'checkpoint_requested', requestedByPrincipalId: attachment.principalId ?? null })
        routed = true
      }
    }
    this.send(socket, { type: 'checkpoint_request_ack', requestId, routed })
  }

  /**
   * A member's explicit "rebase from the target" (Section 21.1): the room passes it to
   * the leader, the one device that pushes the session branch.
   */
  private async handleRebaseRequest(
    socket: WebSocket,
    attachment: SocketAttachment,
    requestId: string | undefined,
    allowConflicts: unknown,
  ): Promise<void> {
    if (!attachment.canWrite) {
      this.sendError(socket, 'FORBIDDEN', 'Viewers cannot rebase the session', requestId)
      return
    }
    const lease = await this.readLease()
    let routed = false
    if (lease.leaderClientId !== null && lease.expiresAt > Date.now()) {
      for (const candidate of this.state.getWebSockets()) {
        const target = candidate.deserializeAttachment() as SocketAttachment | null
        if (!target?.authenticated || target.clientId !== lease.leaderClientId) continue
        this.send(candidate, {
          type: 'rebase_requested',
          requestedByPrincipalId: attachment.principalId ?? null,
          allowConflicts: allowConflicts === true,
        })
        routed = true
      }
    }
    this.send(socket, { type: 'rebase_request_ack', requestId, routed })
  }

  private async autoGitState() {
    const lease = await this.readLease()
    const checkpoint = (await this.state.storage.get<StoredCheckpoint>(CHECKPOINT_KEY)) ?? null
    return { type: 'autogit_state', lease: toWireLease(lease), checkpoint, serverTime: Date.now() }
  }

  private async broadcastAutoGitState(): Promise<void> {
    const payload = JSON.stringify(await this.autoGitState())
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null
      if (!attachment?.authenticated) continue
      try {
        socket.send(payload)
      } catch {
        // Closed
      }
    }
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

  private sendError(socket: WebSocket, code: string, message: string, requestId?: string): void {
    this.send(socket, { type: 'error', code, message, recoverable: true, requestId })
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
