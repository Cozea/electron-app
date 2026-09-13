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
import { validateSessionRoomPrincipalInConvex, finalizeSessionLifecycleInConvex } from '../lib/convex'
import type { Env, SessionClaims } from '../types'
import { parseCloudSnapshot, type CloudSnapshotRecord } from '../../../../shared/collaboration/cloudSnapshot'
import type { SessionLifecycleFence } from '../../../../shared/collaboration/lifecycleFence'

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
const REBASE_ADOPTION_KEY = 'autogit:rebase-adoption'
const REBASE_RECEIPT_PREFIX = 'autogit:rebase-receipt:'
const INTEGRATION_KEY = 'integration:active'
const INTEGRATION_PENDING = 'integration:pending:'
interface StoredIntegration {
  id: string
  adoptionId: string
  clientId: string
  principalId: string
  generation: number
  sessionSeq: number
  expiresAt: number
  count: number
  chars: number
}
interface BufferedIntegrationBatch {
  order?: number
  batchId: string
  clientId: string
  principalId: string
  encryptedPayload: string
}
class IntegrationBufferedError extends Error {}
const LIFECYCLE_FENCE_KEY = 'lifecycle:fence'
const LIFECYCLE_COMMIT_KEY = 'lifecycle:commit'
interface StoredLifecycleCommit {
  fenceId: string
  expectedRevision: number
  phase: 'committing' | 'committed'
  publicSessionId: string
  attempts: number
  nextAttemptAt: number
  fromPaused?: boolean
  pauseFenceId?: string
}
class SessionFrozenError extends Error {}
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

type StoredReceipt = Omit<StoredSessionBatch, 'encryptedPayload'>

export interface StoredBarrier {
  barrierId: string
  sessionSeq: number
  serverTime: number
  leaseGeneration: number
  /** A replica-only barrier authorizes this device to publish without owning Git. */
  snapshotClientId?: string
  snapshotPrincipalId?: string
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

export interface StoredRebaseAdoption {
  id: string
  from: string
  resultOid: string
  principalId: string
  startedSeq: number
}

/** The last checkpoint the leader pushed to the session branch (Section 15.10). */
export interface StoredCheckpoint {
  /** Server time of the latest barrier confirmed to be represented by this commit. */
  confirmedAt?: number
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
  rebaseAdoptionId?: string
}

type CheckpointInput = Pick<
  StoredCheckpoint,
  'commitOid' | 'parentOid' | 'treeOid' | 'sessionSeq' | 'barrierId' | 'logicalTreeHash' | 'rebasedFrom' | 'rebaseAdoptionId'
>

const NO_LEASE: StoredLease = { generation: 0, leaderClientId: null, leaderPrincipalId: null, expiresAt: 0, renewedAt: 0 }

interface SocketAttachment {
  roomId: string
  authenticated: boolean
  principalId?: string
  clientId?: string
  canWrite?: boolean
  canManage?: boolean
  lifecycleRevision?: number
  recovery?: boolean
  canClosePaused?: boolean
  keyVersion?: number
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
  | { type: 'barrier_request'; requestId: unknown; generation: unknown; rebaseAdoptionId?: unknown }
  | { type: 'integration_begin'; requestId: unknown; generation: unknown; adoptionId: unknown }
  | { type: 'integration_finish'; requestId: unknown; id: unknown; generation: unknown; batchId?: unknown; encryptedPayload?: unknown }
  | { type: 'rebase_receipt_get'; requestId: unknown; id: unknown }
  | { type: 'rebase_adoption_begin'; requestId: unknown; generation: unknown; id: unknown; from: unknown; resultOid: unknown }
  | { type: 'snapshot_barrier_request'; requestId: unknown }
  | { type: 'checkpoint_publish'; requestId: unknown; generation: unknown; checkpoint: unknown }
  | { type: 'checkpoint_clean'; requestId: unknown; generation: unknown; barrierId: unknown }
  | { type: 'checkpoint_request'; requestId: unknown }
  | { type: 'rebase_request'; requestId: unknown; allowConflicts: unknown }
  | { type: 'snapshot_publish'; requestId: unknown; generation: unknown; snapshot: unknown }
  | { type: 'snapshot_get'; requestId: unknown }
  | { type: 'lifecycle_prepare'; requestId: unknown; intent: unknown; barrierId: unknown; allowUnpublishedGit?: unknown }
  | { type: 'lifecycle_cancel'; requestId: unknown; fenceId: unknown }
  | { type: 'lifecycle_get'; requestId: unknown }
  | { type: 'lifecycle_commit'; requestId: unknown; fenceId: unknown }
  | { type: 'paused_close'; requestId: unknown; pauseFenceId: unknown; barrierId: unknown; allowUnpublishedGit: unknown }

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
  const rebaseAdoptionId = input.rebaseAdoptionId
  if (rebaseAdoptionId !== undefined && (typeof rebaseAdoptionId !== 'string' || !/^[a-f0-9-]{36}$/.test(rebaseAdoptionId))) return null
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
    ...(typeof rebaseAdoptionId === 'string' ? { rebaseAdoptionId } : {}),
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

    if (parsed.type === 'paused_close' && attachment.canClosePaused) {
      await this.handlePausedClose(socket, attachment, parsed)
      return
    }
    if (attachment.recovery && !['snapshot_get', 'sync_request', 'lifecycle_get'].includes(parsed.type)) {
      this.sendError(socket, 'RECOVERY_READ_ONLY', 'Recovery access can only read retained session state',
        'requestId' in parsed ? readRequestId(parsed.requestId) : undefined)
      return
    }

    // A finalization retry must reach the idempotent control-plane endpoint even
    // after that endpoint has changed ACTIVE to PAUSED/CLOSED. It rechecks auth.
    if (parsed.type === 'lifecycle_commit') {
      await this.handleLifecycleCommit(socket, attachment, parsed)
      return
    }

    // Membership removal rotates the session key generation. Revalidate every
    // mutating message so a removed device cannot keep writing on a socket opened
    // before the removal. Replay remains opaque ciphertext and is harmless without
    // the new generation's key.
    if ((parsed.type !== 'sync_request' || attachment.recovery) && !(await this.ensureCurrentAuthorization(socket, attachment))) {
      return
    }

    switch (parsed.type) {
      case 'integration_begin':
        await this.handleIntegrationBegin(socket, attachment, parsed)
        return
      case 'integration_finish':
        await this.handleIntegrationFinish(socket, attachment, parsed)
        return
      case 'rebase_receipt_get': {
        const requestId = readRequestId(parsed.requestId)
        if (typeof parsed.id !== 'string' || !/^[a-f0-9-]{36}$/.test(parsed.id)) {
          this.sendError(socket, 'BAD_REQUEST', 'Invalid rebase recovery ID', requestId)
          return
        }
        const receipt = await this.state.storage.get<{ adoption: StoredRebaseAdoption; checkpoint: StoredCheckpoint }>(`${REBASE_RECEIPT_PREFIX}${parsed.id}`)
        this.send(socket, { type: 'rebase_receipt_ack', requestId,
          receipt: receipt?.adoption.principalId === attachment.principalId ? receipt : null })
        return
      }
      case 'rebase_adoption_begin':
        await this.handleRebaseAdoption(socket, attachment, parsed)
        return
      case 'snapshot_barrier_request':
        await this.handleSnapshotBarrier(socket, attachment, readRequestId(parsed.requestId))
        return
      case 'lifecycle_get': {
        const lifecycle = await this.state.storage.transaction(async (storage) => {
          const fence = await storage.get<SessionLifecycleFence>(LIFECYCLE_FENCE_KEY) ?? null
          const commit = await storage.get<StoredLifecycleCommit>(LIFECYCLE_COMMIT_KEY)
          const pausedClose = commit?.fromPaused && commit.pauseFenceId && commit.fenceId === fence?.fenceId &&
            fence.requestedByPrincipalId === attachment.principalId
            ? { pauseFenceId: commit.pauseFenceId, phase: commit.phase } : undefined
          return { fence, ...(pausedClose ? { pausedClose } : {}) }
        })
        this.send(socket, { type: 'lifecycle_ack', requestId: readRequestId(parsed.requestId), ...lifecycle })
        return
      }
      case 'lifecycle_prepare':
      case 'lifecycle_cancel':
        await this.handleLifecycleFence(socket, attachment, parsed)
        return
      case 'snapshot_get':
        this.send(socket, { type: 'snapshot_ack', requestId: parsed.requestId,
          snapshot: await this.state.storage.get<CloudSnapshotRecord>('replica:snapshot') ?? null })
        return
      case 'snapshot_publish':
        await this.handleSnapshotPublish(socket, attachment, parsed)
        return
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
        await this.handleBarrierRequest(socket, attachment, readRequestId(parsed.requestId), parsed.generation, parsed.rebaseAdoptionId)
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
    const integration = await this.state.storage.get<StoredIntegration>(INTEGRATION_KEY)
    if (integration && integration.expiresAt <= Date.now()) await this.finishIntegration(integration.id)
    const commit = await this.state.storage.get<StoredLifecycleCommit>(LIFECYCLE_COMMIT_KEY)
    if (commit?.phase === 'committing' && commit.nextAttemptAt <= Date.now()) {
      const fence = await this.state.storage.get<SessionLifecycleFence>(LIFECYCLE_FENCE_KEY)
      if (fence?.fenceId === commit.fenceId) {
        try { await this.finishLifecycleCommit(fence, commit) } catch {
          // The next attempt was persisted before HTTP; do not exhaust the
          // platform's finite alarm-error retries during a control-plane outage.
        }
      }
    }
    const more = await this.compactReplay()
    const lease = await this.readLease()
    // An alarm that fires a moment early comes back once the lease has run out.
    if (lease.leaderClientId !== null && lease.expiresAt > Date.now()) {
      await this.scheduleRoomAlarm(lease.expiresAt)
      return
    }
    await this.electIfNeeded()
    await this.scheduleRoomAlarm(more ? Date.now() + 1000 : 0)
  }

  /** Assigns the next sessionSeq, or returns the original one for a batchId it has already stored. */
  async acceptBatch(input: {
    batchId: string
    clientId: string
    principalId: string
    encryptedPayload: string
  }): Promise<{ stored: StoredSessionBatch; duplicate: boolean }> {
    await this.ready

    const result = await this.state.storage.transaction(async (storage) => {
      const receipt = await storage.get<StoredReceipt>(`receipt:${input.batchId}`)
      const existingSeq = await storage.get<number>(`batch-id:${input.batchId}`)
      if (receipt || existingSeq !== undefined) {
        const existing = receipt ?? await storage.get<StoredSessionBatch>(batchKey(existingSeq!))
        if (!existing || existing.principalId !== input.principalId) throw new Error('Batch receipt identity mismatch')
        // A restart may re-encrypt the same durable batch with a new nonce/key.
        // Receipts preserve its original sequence and never rebroadcast it.
        return { stored: { ...existing, encryptedPayload: input.encryptedPayload }, duplicate: true }
      }
      if (await storage.get(LIFECYCLE_FENCE_KEY)) throw new SessionFrozenError('Session writes are frozen')
      const integration = await storage.get<StoredIntegration>(INTEGRATION_KEY)
      if (integration) {
        const duplicate = await storage.get<BufferedIntegrationBatch>(`${INTEGRATION_PENDING}${input.batchId}`)
        if (duplicate && duplicate.principalId !== input.principalId) throw new Error('Buffered batch identity mismatch')
        if (!duplicate) {
          if (integration.count >= 64 || integration.chars + input.encryptedPayload.length > 4 * 1024 * 1024) throw new Error('Integration buffer full')
          await storage.put(`${INTEGRATION_PENDING}${input.batchId}`, { ...input, order: integration.count })
          await storage.put(INTEGRATION_KEY, { ...integration, count: integration.count + 1, chars: integration.chars + input.encryptedPayload.length })
        }
        return null
      }
      const sequence = ((await storage.get<number>('currentSeq')) ?? 0) + 1
      const stored: StoredSessionBatch = { sessionSeq: sequence, ...input, serverTime: Date.now() }
      const receiptValue: StoredReceipt = { sessionSeq: sequence, batchId: input.batchId, clientId: input.clientId,
        principalId: input.principalId, serverTime: stored.serverTime }
      await storage.put({ currentSeq: sequence, [batchKey(sequence)]: stored,
        [`batch-id:${input.batchId}`]: sequence, [`receipt:${input.batchId}`]: receiptValue })
      return { stored, duplicate: false }
    })
    if (!result) throw new IntegrationBufferedError()
    this.currentSeq = Math.max(this.currentSeq, result.stored.sessionSeq)
    return result
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
    const keyVersion = Math.max(1, Math.floor(claims.sessionKeyVersion ?? 1))
    if (this.env.CONVEX_URL && this.env.AI_GATEWAY_SECRET) {
      try {
        const current = await validateSessionRoomPrincipalInConvex(this.env, {
          publicSessionId: attachment.roomId.replace(/^session:/, ''),
          principalId: claims.principalId,
          recovery: claims.sessionAccess !== undefined,
        })
        if (current.keyVersion !== keyVersion || current.role !== claims.sessionRole) {
          this.reject(socket, 'STALE_SESSION_KEY', 'The session key changed; reconnect with a fresh ticket')
          return
        }
      } catch (error) {
        this.reject(socket, 'SESSION_ACCESS_REVOKED', error instanceof Error ? error.message : 'Session access was revoked')
        return
      }
    }

    const authenticated: SocketAttachment = {
      roomId: attachment.roomId,
      authenticated: true,
      principalId: claims.principalId,
      clientId: message.clientId,
      canWrite: claims.sessionRole !== 'viewer' && claims.sessionAccess === undefined,
      canManage: claims.sessionRole === 'project_manager' && claims.sessionAccess === undefined,
      recovery: claims.sessionAccess !== undefined,
      canClosePaused: claims.sessionAccess === 'paused_close' && claims.sessionRole === 'project_manager',
      keyVersion,
    }
    socket.serializeAttachment(authenticated)
    this.send(socket, { type: 'ready', headSeq: this.currentSeq, serverTime: Date.now(), snapshots: Boolean(this.env.COLLAB_BINARY_OBJECTS) })
    this.send(socket, await this.autoGitState())
  }

  private async ensureCurrentAuthorization(socket: WebSocket, attachment: SocketAttachment): Promise<boolean> {
    // Headless room tests intentionally omit Convex bindings. Production always has them.
    if (!this.env.CONVEX_URL || !this.env.AI_GATEWAY_SECRET || !attachment.principalId) return true
    try {
      const current = await validateSessionRoomPrincipalInConvex(this.env, {
        publicSessionId: attachment.roomId.replace(/^session:/, ''),
        principalId: attachment.principalId,
        recovery: attachment.recovery === true,
      })
      if (current.keyVersion !== (attachment.keyVersion ?? 1)) {
        this.reject(socket, 'STALE_SESSION_KEY', 'The session key changed; reconnect with a fresh ticket')
        return false
      }
      if ((!attachment.recovery && current.role !== 'viewer') !== attachment.canWrite ||
        (!attachment.recovery && current.role === 'project_manager') !== Boolean(attachment.canManage)) {
        this.reject(socket, 'SESSION_ACCESS_CHANGED', 'The session role changed; reconnect with a fresh ticket')
        return false
      }
      attachment.lifecycleRevision = current.lifecycleRevision
      socket.serializeAttachment(attachment)
      // Admission above proves ACTIVE. A revision after commit+Resume makes a
      // lingering fence obsolete, including when the commit reply was lost.
      await this.state.storage.transaction(async (storage) => {
        const commit = await storage.get<StoredLifecycleCommit>(LIFECYCLE_COMMIT_KEY)
        if (!attachment.recovery && commit && current.lifecycleRevision > commit.expectedRevision + (commit.fromPaused ? 0 : 1)) {
          const fence = await storage.get<SessionLifecycleFence>(LIFECYCLE_FENCE_KEY)
          if (fence?.fenceId === commit.fenceId) await storage.delete(LIFECYCLE_FENCE_KEY)
          await storage.delete(LIFECYCLE_COMMIT_KEY)
        }
      })
      return true
    } catch (error) {
      this.reject(socket, 'SESSION_ACCESS_REVOKED', error instanceof Error ? error.message : 'Session access was revoked')
      return false
    }
  }

  private async handleSyncRequest(socket: WebSocket, knownSeq: unknown): Promise<void> {
    const fromSeq = typeof knownSeq === 'number' && Number.isSafeInteger(knownSeq) && knownSeq >= 0 ? knownSeq : 0
    const floor = (await this.state.storage.get<number>('replayFloor')) ?? 0
    if (fromSeq < floor) {
      this.send(socket, { type: 'snapshot_required', replayFloor: floor })
      return
    }
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

    let accepted: { stored: StoredSessionBatch; duplicate: boolean }
    try {
      accepted = await this.acceptBatch({ batchId, clientId: attachment.clientId ?? 'unknown',
        principalId: attachment.principalId ?? 'unknown', encryptedPayload })
    } catch (error) {
      if (error instanceof IntegrationBufferedError) return
      if (error instanceof SessionFrozenError) {
        this.reject(socket, 'SESSION_FROZEN', 'The session is preparing to pause or close; keep pending work for recovery')
        return
      }
      this.reject(socket, 'BATCH_NOT_DURABLE', 'The room could not retain this batch; reconnect to retry retained local work')
      return
    }
    const { stored, duplicate } = accepted
    this.send(socket, { type: 'batch_ack', batchId, sessionSeq: stored.sessionSeq, duplicate })
    if (!duplicate) {
      this.broadcast(socket, { type: 'session_batch', batch: toWireBatch(stored) })
    }
  }

  /** Preparing does not change Convex lifecycle. A coordinator must finalize or cancel this fence. */
  private async handleLifecycleFence(socket: WebSocket, attachment: SocketAttachment,
    message: Extract<ClientMessage, { type: 'lifecycle_prepare' | 'lifecycle_cancel' }>): Promise<void> {
    const requestId = readRequestId(message.requestId)
    if (!attachment.canManage) {
      this.sendError(socket, 'FORBIDDEN', 'Only a session manager can freeze or resume write admission', requestId)
      return
    }
    if (message.type === 'lifecycle_prepare' &&
      ((message.intent !== 'pause' && message.intent !== 'close') || typeof message.barrierId !== 'string' ||
        !BARRIER_ID_PATTERN.test(message.barrierId) ||
        (message.allowUnpublishedGit !== undefined && typeof message.allowUnpublishedGit !== 'boolean'))) {
      this.sendError(socket, 'BAD_REQUEST', 'A lifecycle intent and durable snapshot barrier are required', requestId)
      return
    }
    try {
      // The snapshot frontier check and fence write share the batch admission
      // transaction boundary: an intervening edit makes preparation fail.
      const result = await this.state.storage.transaction(async (storage) => {
        const existing = await storage.get<SessionLifecycleFence>(LIFECYCLE_FENCE_KEY)
        if (message.type === 'lifecycle_prepare' && await storage.get(INTEGRATION_KEY)) return { error: 'INTEGRATION_PENDING', message: 'Wait for final rebase integration before freezing the session' }
        if (message.type === 'lifecycle_cancel') {
          if (!existing || existing.fenceId !== message.fenceId) {
            return { error: 'FENCE_CHANGED', message: 'Refresh lifecycle state before cancelling this fence' }
          }
          if (await storage.get(LIFECYCLE_COMMIT_KEY)) {
            return { error: 'COMMIT_PENDING', message: 'Finalization may already be applied; retry it or resume through the control plane' }
          }
          await storage.delete(LIFECYCLE_FENCE_KEY)
          return { fence: null }
        }
        if (existing) {
          if (existing.intent === message.intent && existing.barrierId === message.barrierId) return { fence: existing }
          return { error: 'FENCE_CHANGED', message: 'Another lifecycle transition already holds write admission' }
        }
        const snapshot = await storage.get<CloudSnapshotRecord>('replica:snapshot')
        const head = await storage.get<number>('currentSeq') ?? 0
        if (!snapshot || snapshot.sessionSeq !== head || snapshot.barrierId !== message.barrierId ||
          snapshot.keyVersion !== attachment.keyVersion) {
          return { error: 'SNAPSHOT_BEHIND', message: 'Publish a current durable snapshot before freezing writes' }
        }
        const checkpoint = await storage.get<StoredCheckpoint>(CHECKPOINT_KEY)
        const gitSavedThroughSeq = checkpoint ? checkpoint.savedThroughSeq ?? checkpoint.sessionSeq : null
        if (message.intent === 'close' && (gitSavedThroughSeq === null || gitSavedThroughSeq < head) &&
          message.allowUnpublishedGit !== true) {
          return { error: 'UNPUBLISHED_GIT', message: 'Explicitly choose whether to close with durable changes not yet saved to Git' }
        }
        const fence: SessionLifecycleFence = {
          fenceId: crypto.randomUUID(), intent: message.intent as 'pause' | 'close', sessionSeq: head,
          barrierId: snapshot.barrierId, keyVersion: snapshot.keyVersion,
          requestedByPrincipalId: attachment.principalId!, createdAt: Date.now(), gitSavedThroughSeq,
        }
        await storage.put({ [LIFECYCLE_FENCE_KEY]: fence, 'lifecycle:fenceRevision': attachment.lifecycleRevision ?? 0 })
        return { fence }
      })
      if ('error' in result) {
        this.sendError(socket, result.error!, result.message!, requestId)
      } else {
        this.send(socket, { type: 'lifecycle_ack', requestId, fence: result.fence })
      }
    } catch {
      this.sendError(socket, 'LIFECYCLE_NOT_DURABLE', 'The room could not retain the lifecycle transition; refresh and retry', requestId)
    }
  }

  /** A dedicated manager scope closes retained state without reopening write admission. */
  private async handlePausedClose(socket: WebSocket, attachment: SocketAttachment,
    message: Extract<ClientMessage, { type: 'paused_close' }>): Promise<void> {
    const requestId = readRequestId(message.requestId)
    if (!attachment.canClosePaused || !this.env.CONVEX_URL || !this.env.AI_GATEWAY_SECRET ||
      typeof message.pauseFenceId !== 'string' || typeof message.barrierId !== 'string' ||
      typeof message.allowUnpublishedGit !== 'boolean') {
      this.sendError(socket, 'FORBIDDEN', 'A scoped manager ticket and reviewed pause frontier are required', requestId)
      return
    }
    try {
      const current = await validateSessionRoomPrincipalInConvex(this.env, {
        publicSessionId: attachment.roomId.replace(/^session:/, ''), principalId: attachment.principalId!, recovery: true,
      })
      if (current.role !== 'project_manager' || current.keyVersion !== attachment.keyVersion) {
        this.sendError(socket, 'SESSION_ACCESS_CHANGED', 'Refresh manager access before closing', requestId)
        return
      }
      const prepared = await this.state.storage.transaction(async (storage) => {
        const previous = await storage.get<StoredLifecycleCommit>(LIFECYCLE_COMMIT_KEY)
        const paused = await storage.get<SessionLifecycleFence>(LIFECYCLE_FENCE_KEY)
        if (previous?.fromPaused && previous.pauseFenceId === message.pauseFenceId &&
          paused?.fenceId === previous.fenceId && paused.intent === 'close' &&
          paused.barrierId === message.barrierId && paused.requestedByPrincipalId === attachment.principalId) {
          return { fence: paused, commit: previous }
        }
        if (!paused || paused.intent !== 'pause' || paused.fenceId !== message.pauseFenceId ||
          paused.barrierId !== message.barrierId || previous?.fenceId !== paused.fenceId ||
          previous.phase !== 'committed' || current.lifecycleRevision !== previous.expectedRevision + 1) return null
        const snapshot = await storage.get<CloudSnapshotRecord>('replica:snapshot')
        const head = await storage.get<number>('currentSeq') ?? 0
        if (!snapshot || snapshot.barrierId !== paused.barrierId || snapshot.sessionSeq !== paused.sessionSeq ||
          head !== paused.sessionSeq || snapshot.keyVersion !== current.keyVersion) return null
        if ((paused.gitSavedThroughSeq === null || paused.gitSavedThroughSeq < head) && message.allowUnpublishedGit !== true) return null
        const fence: SessionLifecycleFence = { ...paused, fenceId: crypto.randomUUID(), intent: 'close',
          requestedByPrincipalId: attachment.principalId!, createdAt: Date.now() }
        const commit: StoredLifecycleCommit = { fenceId: fence.fenceId, expectedRevision: current.lifecycleRevision,
          phase: 'committing', publicSessionId: attachment.roomId.replace(/^session:/, ''),
          attempts: 0, nextAttemptAt: Date.now() + 15_000, fromPaused: true, pauseFenceId: paused.fenceId }
        await storage.put({ [LIFECYCLE_FENCE_KEY]: fence, [LIFECYCLE_COMMIT_KEY]: commit,
          'lifecycle:fenceRevision': current.lifecycleRevision })
        await this.scheduleRoomAlarm(0, storage)
        return { fence, commit }
      })
      if (!prepared) {
        this.sendError(socket, 'CLOSE_REVIEW_CHANGED', 'Refresh the retained pause and confirm any unpublished Git changes', requestId)
        return
      }
      await this.finishLifecycleCommit(prepared.fence, prepared.commit)
      this.send(socket, { type: 'lifecycle_ack', requestId, fence: prepared.fence })
    } catch {
      this.sendError(socket, 'LIFECYCLE_COMMIT_UNCERTAIN', 'Refresh or retry paused Close; retained write admission remains fenced', requestId)
    }
  }

  // ─── AutoGit lease (Section 14.5 - 14.7) ─────────────────────────────────────

  private async handleLifecycleCommit(socket: WebSocket, attachment: SocketAttachment,
    message: Extract<ClientMessage, { type: 'lifecycle_commit' }>): Promise<void> {
    const requestId = readRequestId(message.requestId)
    if (!attachment.canManage || !this.env.CONVEX_URL || !this.env.AI_GATEWAY_SECRET) {
      this.sendError(socket, 'FORBIDDEN', 'Lifecycle finalization requires a manager and the trusted control plane', requestId)
      return
    }
    try {
      const pending = await this.state.storage.get<StoredLifecycleCommit>(LIFECYCLE_COMMIT_KEY)
      if (!pending && !(await this.ensureCurrentAuthorization(socket, attachment))) return
      const prepared = await this.state.storage.transaction(async (storage) => {
        const fence = await storage.get<SessionLifecycleFence>(LIFECYCLE_FENCE_KEY)
        if (!fence || fence.fenceId !== message.fenceId || fence.requestedByPrincipalId !== attachment.principalId) return null
        const previous = await storage.get<StoredLifecycleCommit>(LIFECYCLE_COMMIT_KEY)
        if (previous && previous.fenceId !== fence.fenceId) return null
        const expectedRevision = await storage.get<number>('lifecycle:fenceRevision')
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision! < 0) return null
        const commit: StoredLifecycleCommit = previous ?? { fenceId: fence.fenceId,
          expectedRevision: expectedRevision!, phase: 'committing',
          publicSessionId: attachment.roomId.replace(/^session:/, ''), attempts: 0, nextAttemptAt: Date.now() + 15_000 }
        await storage.put(LIFECYCLE_COMMIT_KEY, commit)
        await this.scheduleRoomAlarm(0, storage)
        return { fence, commit }
      })
      if (!prepared) {
        this.sendError(socket, 'FENCE_CHANGED', 'Refresh the lifecycle fence before finalization', requestId)
        return
      }
      await this.finishLifecycleCommit(prepared.fence, prepared.commit)
      this.send(socket, { type: 'lifecycle_ack', requestId, fence: prepared.fence })
    } catch {
      // Never reopen admission on a timeout: the remote mutation may have committed.
      this.sendError(socket, 'LIFECYCLE_COMMIT_UNCERTAIN', 'Finalization is retained; retry to resolve its control-plane receipt', requestId)
    }
  }

  private async finishLifecycleCommit(fence: SessionLifecycleFence, commit: StoredLifecycleCommit): Promise<void> {
    await this.state.storage.transaction(async (storage) => {
      const current = await storage.get<StoredLifecycleCommit>(LIFECYCLE_COMMIT_KEY)
      if (current?.fenceId !== fence.fenceId) throw new Error('Lifecycle attempt was superseded')
      const attempts = Math.min((current.attempts ?? 0) + 1, 16)
      const nextAttemptAt = Date.now() + Math.min(60_000, 15_000 * 2 ** (attempts - 1))
      await storage.put(LIFECYCLE_COMMIT_KEY, { ...current, attempts, nextAttemptAt })
      await this.scheduleRoomAlarm(0, storage)
    })
    const result = await finalizeSessionLifecycleInConvex(this.env, {
      publicSessionId: commit.publicSessionId, principalId: fence.requestedByPrincipalId,
      expectedRevision: commit.expectedRevision, fence,
    })
    if (result.committed !== true || !Number.isSafeInteger(result.revision) ||
      result.revision < commit.expectedRevision + 1) throw new Error('Invalid lifecycle receipt')
    await this.state.storage.transaction(async (storage) => {
      const current = await storage.get<StoredLifecycleCommit>(LIFECYCLE_COMMIT_KEY)
      if (current?.fenceId !== fence.fenceId) return
      await storage.put(LIFECYCLE_COMMIT_KEY, { ...current, phase: 'committed' })
    })
  }

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
    await this.scheduleRoomAlarm(renewed.expiresAt)
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
      await this.scheduleRoomAlarm(granted.expiresAt)
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

  private async handleSnapshotPublish(socket: WebSocket, attachment: SocketAttachment,
    message: Extract<ClientMessage, { type: 'snapshot_publish' }>): Promise<void> {
    const requestId = typeof message.requestId === 'string' ? message.requestId : undefined
    const snapshot = parseCloudSnapshot(message.snapshot)
    if (!snapshot || snapshot.keyVersion !== (attachment.keyVersion ?? 1)) {
      this.sendError(socket, 'BAD_REQUEST', 'Invalid snapshot manifest or key generation', requestId)
      return
    }
    const barrier = await this.state.storage.get<StoredBarrier>(`${BARRIER_KEY_PREFIX}${snapshot.barrierId}`)
    const previous = await this.state.storage.get<CloudSnapshotRecord>('replica:snapshot')
    if (!barrier || barrier.sessionSeq !== snapshot.sessionSeq || barrier.leaseGeneration !== message.generation ||
      (previous && previous.sessionSeq > snapshot.sessionSeq)) {
      this.sendError(socket, 'INVALID_BARRIER', 'Snapshot does not match a current room barrier', requestId)
      return
    }
    const ownsSnapshotBarrier = message.generation === 0 && barrier.snapshotClientId === attachment.clientId &&
      barrier.snapshotPrincipalId === attachment.principalId
    const bucket = this.env.COLLAB_BINARY_OBJECTS
    if (!bucket || !attachment.canWrite || (!ownsSnapshotBarrier &&
      !this.holdsLease(attachment, await this.readLease(), message.generation, Date.now()))) {
      this.sendError(socket, 'LEASE_STALE', 'Only the current leader can publish a durable snapshot', requestId)
      return
    }
    const publicSessionId = attachment.roomId.replace(/^session:/, '')
    for (const chunk of snapshot.manifest.chunks) {
      const object = await bucket.head(`${publicSessionId}/${chunk.encryptedRef}`)
      if (!object || object.size !== chunk.size + 28) {
        this.sendError(socket, 'SNAPSHOT_NOT_DURABLE', 'A snapshot chunk is missing or has the wrong size', requestId)
        return
      }
    }
    if (!(await this.ensureCurrentAuthorization(socket, attachment))) return
    if (!ownsSnapshotBarrier && !this.holdsLease(attachment, await this.readLease(), message.generation, Date.now())) {
      this.sendError(socket, 'LEASE_STALE', 'Snapshot lease expired during verification', requestId)
      return
    }
    const publication = await this.state.storage.transaction(async (storage) => {
      if (await storage.get(LIFECYCLE_FENCE_KEY)) return 'frozen'
      const latest = await storage.get<CloudSnapshotRecord>('replica:snapshot')
      if (latest && latest.sessionSeq > snapshot.sessionSeq) return 'behind'
      await storage.put({ 'replica:snapshot': snapshot, replayFloor: snapshot.sessionSeq, compactionPending: true })
      return 'published'
    })
    if (publication === 'frozen') {
      this.sendError(socket, 'SESSION_FROZEN', 'The lifecycle fence retains its durable snapshot until completion or cancellation', requestId)
      return
    }
    if (publication === 'behind') {
      this.sendError(socket, 'INVALID_BARRIER', 'A newer snapshot was published during verification', requestId)
      return
    }
    await this.compactReplay()
    await this.scheduleRoomAlarm((await this.readLease()).expiresAt)
    this.send(socket, { type: 'snapshot_ack', requestId, snapshot })
  }

  private async handleSnapshotBarrier(socket: WebSocket, attachment: SocketAttachment, requestId?: string): Promise<void> {
    if (!attachment.canWrite) {
      this.sendError(socket, 'FORBIDDEN', 'Viewers cannot publish session snapshots', requestId)
      return
    }
    const barrier = await this.state.storage.transaction(async (storage) => {
      if (await storage.get(LIFECYCLE_FENCE_KEY)) return null
      const value: StoredBarrier = {
        barrierId: `barrier_${crypto.randomUUID().replace(/-/g, '')}`,
        sessionSeq: await storage.get<number>('currentSeq') ?? 0,
        serverTime: Date.now(), leaseGeneration: 0,
        snapshotClientId: attachment.clientId, snapshotPrincipalId: attachment.principalId,
      }
      await storage.put(`${BARRIER_KEY_PREFIX}${value.barrierId}`, value)
      return value
    })
    if (!barrier) {
      this.sendError(socket, 'SESSION_FROZEN', 'The lifecycle transition already holds a durable snapshot', requestId)
      return
    }
    // Principal metadata is room-private; clients need only the frontier.
    this.send(socket, { type: 'barrier_ack', requestId, barrier: {
      barrierId: barrier.barrierId, sessionSeq: barrier.sessionSeq, serverTime: barrier.serverTime, leaseGeneration: 0,
    } })
  }

  private async scheduleRoomAlarm(expiresAt: number, storage = this.state.storage): Promise<void> {
    const integration = await storage.get<StoredIntegration>(INTEGRATION_KEY)
    const pending = await storage.get<boolean>('compactionPending')
    const commit = await storage.get<StoredLifecycleCommit>(LIFECYCLE_COMMIT_KEY)
    const existing = await storage.getAlarm()
    const now = Date.now()
    const next = Math.min(expiresAt > now ? expiresAt : Infinity,
      integration ? Math.max(now + 1, integration.expiresAt) : Infinity,
      existing !== null && existing > now ? existing : Infinity,
      pending ? now + 1000 : Infinity,
      commit?.phase === 'committing' ? Math.max(now + 1, commit.nextAttemptAt) : Infinity)
    if (Number.isFinite(next)) await storage.setAlarm(next)
  }

  /** One bounded, transactional page; the durable alarm resumes larger histories. */
  private async compactReplay(): Promise<boolean> {
    if (!(await this.state.storage.get<boolean>('compactionPending'))) return false
    return this.state.storage.transaction(async (storage) => {
      const floor = (await storage.get<number>('replayFloor')) ?? 0
      const snapshot = await storage.get<CloudSnapshotRecord>('replica:snapshot')
      if (!snapshot || snapshot.sessionSeq < floor) throw new Error('Replay floor has no durable snapshot')
      const page = await storage.list<StoredSessionBatch>({ prefix: BATCH_KEY_PREFIX, limit: 128 })
      for (const [key, batch] of page) {
        if (batch.sessionSeq > floor) break
        const receipt: StoredReceipt = { batchId: batch.batchId, sessionSeq: batch.sessionSeq,
          clientId: batch.clientId, principalId: batch.principalId, serverTime: batch.serverTime }
        await storage.put(`receipt:${batch.batchId}`, receipt)
        await storage.delete(key)
      }
      const last = [...page.values()].at(-1)
      const more = page.size === 128 && Boolean(last && last.sessionSeq < floor)
      await storage.put('compactionPending', more)
      return more
    })
  }

  private async handleIntegrationBegin(socket: WebSocket, attachment: SocketAttachment,
    request: Extract<ClientMessage, { type: 'integration_begin' }>): Promise<void> {
    const requestId = readRequestId(request.requestId)
    const integration = await this.state.storage.transaction(async (storage) => {
      const lease = await storage.get<StoredLease>(LEASE_KEY) ?? NO_LEASE
      const adoption = await storage.get<StoredRebaseAdoption>(REBASE_ADOPTION_KEY)
      if (!this.holdsLease(attachment, lease, request.generation, Date.now()) || !adoption ||
        adoption.id !== request.adoptionId || adoption.principalId !== attachment.principalId || await storage.get(LIFECYCLE_FENCE_KEY)) return null
      const existing = await storage.get<StoredIntegration>(INTEGRATION_KEY)
      if (existing) return existing.adoptionId === adoption.id && existing.clientId === attachment.clientId && existing.generation === lease.generation && existing.expiresAt > Date.now() ? existing : null
      const value: StoredIntegration = { id: crypto.randomUUID(), adoptionId: adoption.id,
        clientId: attachment.clientId!, principalId: attachment.principalId!, generation: lease.generation,
        sessionSeq: await storage.get<number>('currentSeq') ?? 0, expiresAt: Date.now() + 5000, count: 0, chars: 0 }
      await storage.put(INTEGRATION_KEY, value)
      await this.scheduleRoomAlarm(value.expiresAt, storage)
      return value
    })
    if (!integration) { this.sendError(socket, 'INTEGRATION_UNAVAILABLE', 'The current adoption owner must start the final integration barrier', requestId); return }
    this.send(socket, { type: 'integration_started', requestId, barrier: { id: integration.id, sessionSeq: integration.sessionSeq, expiresAt: integration.expiresAt } })
  }

  private async handleIntegrationFinish(socket: WebSocket, attachment: SocketAttachment,
    request: Extract<ClientMessage, { type: 'integration_finish' }>): Promise<void> {
    const requestId = readRequestId(request.requestId)
    if (typeof request.id !== 'string' || !/^[a-f0-9-]{36}$/.test(request.id) ||
      (request.batchId !== undefined && (typeof request.batchId !== 'string' || !BATCH_ID_PATTERN.test(request.batchId) ||
        typeof request.encryptedPayload !== 'string' || request.encryptedPayload.length === 0 || request.encryptedPayload.length > MAX_ENCRYPTED_BATCH_CHARS))) {
      this.sendError(socket, 'BAD_REQUEST', 'Invalid integration completion', requestId); return
    }
    try {
      const sequence = await this.finishIntegration(request.id, { attachment, generation: request.generation,
        batch: typeof request.batchId === 'string' ? { batchId: request.batchId, encryptedPayload: request.encryptedPayload as string,
          clientId: attachment.clientId!, principalId: attachment.principalId! } : undefined })
      this.send(socket, { type: 'integration_finished', requestId, sessionSeq: sequence })
    } catch {
      this.sendError(socket, 'INTEGRATION_STALE', 'The integration barrier expired or leadership changed; recompute before adoption', requestId)
    }
  }

  /** Assign the system batch first and buffered edits after it in one durable transaction. */
  private async finishIntegration(id: string, owner?: { attachment: SocketAttachment; generation: unknown; batch?: BufferedIntegrationBatch }): Promise<number> {
    const result = await this.state.storage.transaction(async (storage) => {
      const receiptKey = `integration:receipt:${id}`
      const receipt = await storage.get<{ clientId: string; principalId: string; batchId: string | null; sequence: number }>(receiptKey)
      if (receipt && owner && receipt.clientId === owner.attachment.clientId && receipt.principalId === owner.attachment.principalId && receipt.batchId === (owner.batch?.batchId ?? null)) return { sequence: receipt.sequence, batches: [] as StoredSessionBatch[] }
      const integration = await storage.get<StoredIntegration>(INTEGRATION_KEY)
      if (!integration || integration.id !== id) throw new Error('Missing integration')
      if (owner) {
        const lease = await storage.get<StoredLease>(LEASE_KEY) ?? NO_LEASE
        if (integration.clientId !== owner.attachment.clientId || integration.principalId !== owner.attachment.principalId ||
          !this.holdsLease(owner.attachment, lease, owner.generation, Date.now()) || integration.generation !== lease.generation ||
          (owner.batch && integration.expiresAt <= Date.now())) throw new Error('Stale integration')
      } else if (integration.expiresAt > Date.now()) throw new Error('Integration still active')
      let sequence = await storage.get<number>('currentSeq') ?? 0
      const pending = await storage.list<BufferedIntegrationBatch>({ prefix: INTEGRATION_PENDING, limit: 64 })
      const batches: StoredSessionBatch[] = []
      const append = async (input: BufferedIntegrationBatch) => {
        const existing = await storage.get<StoredReceipt>(`receipt:${input.batchId}`)
        if (existing) {
          if (existing.principalId !== input.principalId) throw new Error('Batch identity mismatch')
          return
        }
        const batch: StoredSessionBatch = { ...input, sessionSeq: ++sequence, serverTime: Date.now() }
        const receipt: StoredReceipt = { batchId: batch.batchId, clientId: batch.clientId, principalId: batch.principalId,
          sessionSeq: batch.sessionSeq, serverTime: batch.serverTime }
        await storage.put({ [batchKey(sequence)]: batch, [`batch-id:${batch.batchId}`]: sequence, [`receipt:${batch.batchId}`]: receipt })
        batches.push(batch)
      }
      if (owner?.batch) await append(owner.batch)
      for (const [key, batch] of [...pending].sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0))) { await append(batch); await storage.delete(key) }
      await storage.put('currentSeq', sequence)
      await storage.delete(INTEGRATION_KEY)
      if (owner) await storage.put(receiptKey, { clientId: integration.clientId, principalId: integration.principalId, batchId: owner.batch?.batchId ?? null, sequence })
      return { sequence, batches }
    })
    this.currentSeq = Math.max(this.currentSeq, result.sequence)
    for (const batch of result.batches) {
      for (const socket of this.state.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null
        if (!attachment?.authenticated) continue
        this.send(socket, { type: 'session_batch', batch: toWireBatch(batch) })
        if (attachment.clientId === batch.clientId && attachment.principalId === batch.principalId) {
          this.send(socket, { type: 'batch_ack', batchId: batch.batchId, sessionSeq: batch.sessionSeq, duplicate: false })
        }
      }
    }
    return result.sequence
  }

  private async handleRebaseAdoption(socket: WebSocket, attachment: SocketAttachment,
    request: Extract<ClientMessage, { type: 'rebase_adoption_begin' }>): Promise<void> {
    const requestId = readRequestId(request.requestId)
    if (typeof request.id !== 'string' || !/^[a-f0-9-]{36}$/.test(request.id) ||
      typeof request.from !== 'string' || !OID_PATTERN.test(request.from) || typeof request.resultOid !== 'string' || !OID_PATTERN.test(request.resultOid)) {
      this.sendError(socket, 'BAD_REQUEST', 'Invalid rebase adoption basis', requestId)
      return
    }
    const id = request.id, from = request.from, resultOid = request.resultOid
    const adoption = await this.state.storage.transaction(async (storage) => {
      const lease = await storage.get<StoredLease>(LEASE_KEY) ?? NO_LEASE
      if (!attachment.canWrite || !attachment.principalId || !this.holdsLease(attachment, lease, request.generation, Date.now())) return null
      if (await storage.get(LIFECYCLE_FENCE_KEY)) return null
      if (await storage.get(`${REBASE_RECEIPT_PREFIX}${id}`)) return null
      const existing = await storage.get<StoredRebaseAdoption>(REBASE_ADOPTION_KEY)
      if (existing) return existing.id === id && existing.from === from && existing.resultOid === resultOid && existing.principalId === attachment.principalId ? existing : null
      const checkpoint = await storage.get<StoredCheckpoint>(CHECKPOINT_KEY)
      if (checkpoint?.commitOid !== from) return null
      const record: StoredRebaseAdoption = { id, from, resultOid, principalId: attachment.principalId, startedSeq: this.currentSeq }
      await storage.put(REBASE_ADOPTION_KEY, record)
      return record
    })
    if (!adoption) { this.sendError(socket, 'REBASE_RECOVERY_REQUIRED', 'The leader or rebase basis changed, or another adoption is pending', requestId); return }
    this.send(socket, { type: 'rebase_adoption_ack', requestId, adoption })
    await this.broadcastAutoGitState()
  }

  private async handleBarrierRequest(
    socket: WebSocket,
    attachment: SocketAttachment,
    requestId: string | undefined,
    generation: unknown,
    rebaseAdoptionId?: unknown,
  ): Promise<void> {
    const adoption = await this.state.storage.get<StoredRebaseAdoption>(REBASE_ADOPTION_KEY)
    if (adoption && (adoption.id !== rebaseAdoptionId || adoption.principalId !== attachment.principalId)) {
      this.sendError(socket, 'REBASE_RECOVERY_REQUIRED', 'An interrupted rebase must finish before ordinary checkpoints', requestId)
      return
    }
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
      confirmedAt: barrier.serverTime,
      ...(rebasedFrom ? { rebasedFrom } : {}),
      leaseGeneration: lease.generation,
      publishedAt: now,
      publishedByPrincipalId: attachment.principalId ?? 'unknown',
    }
    const published = await this.state.storage.transaction(async (storage) => {
      if (await storage.get(INTEGRATION_KEY)) return false
      const currentLease = await storage.get<StoredLease>(LEASE_KEY) ?? NO_LEASE
      if (!this.holdsLease(attachment, currentLease, generation, Date.now())) return false
      const adoption = await storage.get<StoredRebaseAdoption>(REBASE_ADOPTION_KEY)
      if (adoption && (input.rebaseAdoptionId !== adoption.id || input.rebasedFrom !== adoption.from || attachment.principalId !== adoption.principalId || input.sessionSeq < adoption.startedSeq)) return false
      await storage.put(CHECKPOINT_KEY, checkpoint)
      if (adoption) {
        await storage.put(`${REBASE_RECEIPT_PREFIX}${adoption.id}`, { adoption, checkpoint })
        await storage.delete(REBASE_ADOPTION_KEY)
      }
      return true
    })
    if (!published) { this.sendError(socket, 'REBASE_RECOVERY_REQUIRED', 'Checkpoint does not complete the current rebase adoption', requestId); return }
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
    if (await this.state.storage.get(REBASE_ADOPTION_KEY)) {
      this.sendError(socket, 'REBASE_RECOVERY_REQUIRED', 'A pending rebase cannot be marked clean', requestId)
      return
    }
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
    const checkpoint: StoredCheckpoint = {
      ...previous,
      savedThroughSeq: Math.max(previous.sessionSeq, previous.savedThroughSeq ?? 0, barrier.sessionSeq),
      confirmedAt: Math.max(previous.confirmedAt ?? 0, barrier.serverTime),
    }
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
    const serverTime = Date.now()
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
    this.send(socket, { type: 'checkpoint_request_ack', requestId, routed, serverTime })
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
    const rebaseAdoption = await this.state.storage.get<StoredRebaseAdoption>(REBASE_ADOPTION_KEY) ?? null
    return { type: 'autogit_state', lease: toWireLease(lease), checkpoint, rebaseAdoption, serverTime: Date.now() }
  }

  private async broadcastAutoGitState(): Promise<void> {
    const payload = JSON.stringify(await this.autoGitState())
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null
      if (!attachment?.authenticated || attachment.recovery) continue
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
      if (!attachment?.authenticated || attachment.recovery) continue
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
