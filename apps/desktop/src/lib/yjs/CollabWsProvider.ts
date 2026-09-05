import * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import {
  bytesToEnvelope,
  decryptPayload,
  encryptPayload,
  envelopeToBytes,
} from '@/lib/collab/cipherEnvelope'
import { invalidateCollabSession } from '@/features/collaboration/hooks/useCollabSession'
import { ensureActiveCheckpointGroup } from './checkpointGroups'
import { extractAttributionOrigin, isRemoteYjsOrigin, makeRemoteYjsOrigin } from './origins'

export interface CollabSessionDescriptor {
  projectId: string
  roomId: string
  collabWsUrl: string
  token: string
  protocolVersion: string
  deviceId: string
  deviceFingerprint?: string
  devicePublicKeyJwk?: string
  encryption: {
    roomId: string
    encryptionRequired: boolean
    status: 'room_not_initialized' | 'ready' | 'missing_for_device' | 'device_revoked'
    activeKeyVersion: number | null
    wrappedRoomKey: string | null
    wrapAlgorithm: string | null
    senderPublicKeyJwk: string | null
  }
}

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

interface SyncDeltaMessage {
  type: 'sync.delta'
  payload: {
    roomId: string
    fromSeq: number
    toSeq: number
    updatesBinary: string[]
    headSeq?: number
    hasMore?: boolean
  }
}

interface UpdatePushMessage {
  type: 'update.push'
  payload: {
    roomId?: string
    seq?: number
    idempotencyKey: string
    updateBinary: string
    authorType: 'user' | 'agent'
    authorId: string
    timestamp: number
  }
}

interface PresenceSnapshotMessage {
  type: 'presence.snapshot'
  payload: {
    roomId: string
    entries: Array<{
      clientId: string
      awarenessBinary: string
      expiresAt: number
    }>
  }
}

interface PresenceRemoveMessage {
  type: 'presence.remove'
  payload: {
    roomId: string
    clientIds: string[]
  }
}

interface ReadyMessage {
  type: 'ready'
  payload: {
    roomId: string
    serverTime: number
    headSeq: number
    resyncRequired: boolean
  }
}

interface UpdateAckMessage {
  type: 'update.ack'
  payload: {
    roomId: string
    seq: number
    idempotencyKey: string
    persisted: boolean
  }
}

interface ErrorMessage {
  type: 'error'
  payload: {
    code: string
    message: string
    recoverable: boolean
    retryAfterMs?: number
  }
}

type IncomingWireMessage =
  | ReadyMessage
  | SyncDeltaMessage
  | UpdatePushMessage
  | PresenceSnapshotMessage
  | PresenceRemoveMessage
  | UpdateAckMessage
  | ErrorMessage

interface PendingUpdate {
  updateBinary: string
  idempotencyKey: string
  timestamp: number
}

const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 10_000
const RECONNECT_FACTOR = 2
const INITIAL_CONNECT_FAILURE_LIMIT = 6
const INITIAL_CONNECT_FAILURE_WINDOW_MS = 2_500
const SESSION_REFRESH_BUFFER_MS = 2 * 60 * 1000
const SYNC_PAGE_SIZE = 128
const AUTH_RECOVERY_ERROR_CODES = new Set(['INVALID_SESSION_TOKEN', 'SESSION_MISMATCH'])
const SESSION_INVALIDATION_ERROR_CODES = new Set(['ENCRYPTION_KEY_STALE', 'DEVICE_REVOKED'])

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function parseEnvelopeMetadata(envelope: { aad: string }): Record<string, unknown> {
  try {
    const decoded = new TextDecoder().decode(fromBase64(envelope.aad))
    const parsed = JSON.parse(decoded)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function resolveWsUrl(base: string): string {
  const trimmed = base.trim()
  if (!trimmed) throw new Error('Collaboration websocket URL is empty')
  const parsed = new URL(trimmed)
  if (parsed.protocol === 'https:') parsed.protocol = 'wss:'
  if (parsed.protocol === 'http:') parsed.protocol = 'ws:'
  return parsed.toString()
}

function decodeJwtExpMs(token: string): number | null {
  const parts = token.split('.')
  if (parts.length < 2) return null

  try {
    const base64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=')
    const payload = JSON.parse(atob(base64)) as { exp?: unknown }
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null
  } catch {
    return null
  }
}

function finiteSequence(value: unknown): number | null {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue >= 0
    ? Math.floor(numberValue)
    : null
}

export class CollabWsProvider {
  private readonly doc: Y.Doc
  private readonly awareness: Awareness
  private session: CollabSessionDescriptor
  private readonly clientType: 'web' | 'electron'
  private readonly clientId: string
  private readonly onStateChange?: (state: ConnectionState, error?: string | null) => void
  private readonly onPermanentFailure?: (reason: string) => void
  private readonly refreshSession?: () => Promise<CollabSessionDescriptor | null>
  private readonly encryption?: { roomKeyBase64: string; keyVersion: number } | null

  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private currentConnectStartedAt = 0
  private hasConnectedOnce = false
  private consecutiveInitialFailures = 0
  private knownSeq: number
  private targetHeadSeq: number
  private isDestroyed = false
  private lastServerErrorCode: string | null = null
  private lastServerErrorMessage: string | null = null
  private sessionRefreshInFlight: Promise<boolean> | null = null
  private hasHandshakeAcknowledged = false
  private activeSocketInstanceId: string | null = null
  private readonly pendingUpdates: PendingUpdate[] = []
  private readonly localUpdatesById = new Map<string, PendingUpdate>()
  private hasPendingAwarenessPublish = false
  private requestedCatchUpAtSeq: number | null = null
  private incomingMessageQueue: Promise<void> = Promise.resolve()
  private outboundUpdateQueue: Promise<void> = Promise.resolve()

  constructor(args: {
    doc: Y.Doc
    awareness: Awareness
    session: CollabSessionDescriptor
    clientType?: 'web' | 'electron'
    initialKnownSeq?: number
    onStateChange?: (state: ConnectionState, error?: string | null) => void
    onPermanentFailure?: (reason: string) => void
    refreshSession?: () => Promise<CollabSessionDescriptor | null>
    encryption?: { roomKeyBase64: string; keyVersion: number } | null
  }) {
    this.doc = args.doc
    this.awareness = args.awareness
    this.session = args.session
    this.clientType = args.clientType ?? 'electron'
    this.clientId = String(this.doc.clientID)
    this.knownSeq = finiteSequence(args.initialKnownSeq) ?? 0
    this.targetHeadSeq = this.knownSeq
    this.onStateChange = args.onStateChange
    this.onPermanentFailure = args.onPermanentFailure
    this.refreshSession = args.refreshSession
    this.encryption = args.encryption ?? null
  }

  start(): void {
    this.doc.on('update', this.handleLocalUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)
    void this.connect()
  }

  destroy(): void {
    this.isDestroyed = true
    this.hasHandshakeAcknowledged = false
    this.hasPendingAwarenessPublish = false
    this.requestedCatchUpAtSeq = null
    this.doc.off('update', this.handleLocalUpdate)
    this.awareness.off('update', this.handleAwarenessUpdate)
    this.clearReconnectTimer()

    const socket = this.socket
    this.socket = null
    this.activeSocketInstanceId = null
    if (!socket) return

    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null

    if (socket.readyState === WebSocket.CONNECTING) {
      socket.onopen = () => socket.close(1000, 'Provider destroyed')
      return
    }

    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1000, 'Provider destroyed')
    }
  }

  getConnectionState(): ConnectionState {
    if (this.socket?.readyState === WebSocket.OPEN) return 'connected'
    if (this.socket?.readyState === WebSocket.CONNECTING) return 'connecting'
    return 'idle'
  }

  /** Highest contiguous server sequence decoded and applied to this Y.Doc. */
  getKnownSeq(): number {
    return this.knownSeq
  }

  updateSession(session: CollabSessionDescriptor): void {
    this.session = session
  }

  private advanceKnownSeq(value: unknown): void {
    const sequence = finiteSequence(value)
    if (sequence !== null) {
      this.knownSeq = Math.max(this.knownSeq, sequence)
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private isCurrentSocket(socket: WebSocket, socketInstanceId: string): boolean {
    return this.socket === socket &&
      this.activeSocketInstanceId === socketInstanceId &&
      !this.isDestroyed
  }

  private queuePendingUpdate(update: PendingUpdate): void {
    if (this.pendingUpdates.some((entry) => entry.idempotencyKey === update.idempotencyKey)) {
      return
    }
    this.pendingUpdates.push(update)
  }

  private queueUnacknowledgedUpdatesForRetry(): void {
    for (const update of this.localUpdatesById.values()) {
      this.queuePendingUpdate(update)
    }
  }

  private removePendingUpdate(idempotencyKey: string): void {
    const index = this.pendingUpdates.findIndex(
      (update) => update.idempotencyKey === idempotencyKey,
    )
    if (index >= 0) {
      this.pendingUpdates.splice(index, 1)
    }
  }

  private scheduleReconnect(errorMessage?: string): void {
    if (this.isDestroyed) return
    this.clearReconnectTimer()
    this.onStateChange?.('reconnecting', errorMessage ?? null)
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * Math.pow(RECONNECT_FACTOR, this.reconnectAttempt),
    )
    this.reconnectAttempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      void this.connect()
    }, delay)
  }

  private shouldRefreshSessionBeforeConnect(): boolean {
    const expirationMs = decodeJwtExpMs(this.session.token)
    return expirationMs !== null && expirationMs - Date.now() <= SESSION_REFRESH_BUFFER_MS
  }

  private async maybeRefreshSession(): Promise<boolean> {
    if (!this.refreshSession) return false
    if (this.sessionRefreshInFlight) return await this.sessionRefreshInFlight

    const refreshPromise = (async () => {
      try {
        const nextSession = await this.refreshSession?.()
        if (!nextSession?.token) return false
        this.session = nextSession
        this.reconnectAttempt = 0
        this.consecutiveInitialFailures = 0
        return true
      } catch (error) {
        console.warn('[CollabWsProvider] Failed to refresh collaboration session:', error)
        return false
      } finally {
        this.sessionRefreshInFlight = null
      }
    })()

    this.sessionRefreshInFlight = refreshPromise
    return await refreshPromise
  }

  private async handleAuthRecovery(reason: string): Promise<void> {
    if (this.isDestroyed) return
    this.onStateChange?.('reconnecting', reason)

    const refreshed = await this.maybeRefreshSession()
    if (this.isDestroyed) return

    if (refreshed) {
      await this.connect()
      return
    }

    this.scheduleReconnect(reason)
  }

  private handleSessionInvalidation(reason: string): void {
    if (this.isDestroyed) return
    this.onStateChange?.('error', reason)
    invalidateCollabSession(this.session.projectId)
  }

  private enqueueIncomingMessage(raw: unknown): void {
    this.incomingMessageQueue = this.incomingMessageQueue
      .then(async () => {
        await this.handleIncoming(raw)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        console.warn('[CollabWsProvider] Failed to process collaboration frame:', error)
        this.onStateChange?.('error', message)
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.close(1011, 'Collaboration frame processing failed')
        }
      })
  }

  private async connect(): Promise<void> {
    if (this.isDestroyed) return
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    this.clearReconnectTimer()
    if (this.shouldRefreshSessionBeforeConnect()) {
      await this.maybeRefreshSession()
      if (this.isDestroyed) return
    }

    this.currentConnectStartedAt = Date.now()
    this.hasHandshakeAcknowledged = false
    this.hasPendingAwarenessPublish = false
    this.requestedCatchUpAtSeq = null
    this.lastServerErrorCode = null
    this.lastServerErrorMessage = null
    this.onStateChange?.('connecting', null)

    const socket = new WebSocket(resolveWsUrl(this.session.collabWsUrl))
    const socketInstanceId = randomId('collab_socket')
    this.socket = socket
    this.activeSocketInstanceId = socketInstanceId

    socket.onopen = () => {
      if (!this.isCurrentSocket(socket, socketInstanceId)) {
        socket.close(1000, 'Stale socket')
        return
      }

      socket.send(JSON.stringify({
        type: 'hello',
        payload: {
          protocolVersion: this.session.protocolVersion,
          clientType: this.clientType,
          projectId: this.session.projectId,
          roomId: this.session.roomId,
          sessionToken: this.session.token,
          clientId: this.clientId,
          knownSeq: this.knownSeq,
        },
      }))
    }

    socket.onmessage = (event) => {
      if (!this.isCurrentSocket(socket, socketInstanceId)) return
      this.enqueueIncomingMessage(event.data)
    }

    socket.onerror = () => {
      if (!this.isCurrentSocket(socket, socketInstanceId)) return
      this.onStateChange?.('error', 'Collaboration websocket error')
    }

    socket.onclose = (event) => {
      if (!this.isCurrentSocket(socket, socketInstanceId)) return
      if (this.isDestroyed) return

      this.socket = null
      this.activeSocketInstanceId = null
      this.hasHandshakeAcknowledged = false
      this.requestedCatchUpAtSeq = null
      this.queueUnacknowledgedUpdatesForRetry()

      const connectLifetimeMs = Date.now() - this.currentConnectStartedAt
      const initialHandshakeFailure =
        !this.hasConnectedOnce && connectLifetimeMs <= INITIAL_CONNECT_FAILURE_WINDOW_MS

      if (initialHandshakeFailure) {
        this.consecutiveInitialFailures += 1
      } else if (this.hasConnectedOnce) {
        this.consecutiveInitialFailures = 0
      }

      const closeDetails = this.lastServerErrorMessage ??
        `Collaboration websocket disconnected (code ${event.code})`

      if (AUTH_RECOVERY_ERROR_CODES.has(this.lastServerErrorCode ?? '')) {
        void this.handleAuthRecovery(closeDetails)
        return
      }

      if (SESSION_INVALIDATION_ERROR_CODES.has(this.lastServerErrorCode ?? '')) {
        this.handleSessionInvalidation(closeDetails)
        return
      }

      if (this.consecutiveInitialFailures >= INITIAL_CONNECT_FAILURE_LIMIT) {
        const message = 'Collaboration websocket is unavailable after repeated failed handshakes.'
        this.onStateChange?.('error', message)
        this.onPermanentFailure?.(message)
        return
      }

      this.scheduleReconnect(closeDetails)
    }
  }

  private sendUpdate(update: PendingUpdate): void {
    const payload = {
      type: 'update.push',
      payload: {
        roomId: this.session.roomId,
        idempotencyKey: update.idempotencyKey,
        updateBinary: update.updateBinary,
        authorType: 'user',
        authorId: this.clientId,
        timestamp: update.timestamp,
      },
    }

    if (this.socket?.readyState === WebSocket.OPEN && this.hasHandshakeAcknowledged) {
      this.socket.send(JSON.stringify(payload))
      return
    }

    this.queuePendingUpdate(update)
  }

  private async encodeOutboundBytes(
    bytes: Uint8Array,
    kind: 'yjs_update' | 'yjs_awareness',
    metadata: Record<string, unknown>,
  ): Promise<string> {
    if (!this.encryption) {
      throw new Error('Encrypted collaboration transport requires a room key')
    }

    const envelope = await encryptPayload({
      roomKeyBase64: this.encryption.roomKeyBase64,
      kind,
      keyVersion: this.encryption.keyVersion,
      plaintext: bytes,
      metadata,
    })
    return toBase64(envelopeToBytes(envelope))
  }

  private async decodeInboundBytes(
    encoded: string,
    kind: 'yjs_update' | 'yjs_awareness',
  ): Promise<{ bytes: Uint8Array; metadata: Record<string, unknown> }> {
    if (!this.encryption) {
      throw new Error('Encrypted collaboration transport requires a room key')
    }

    const envelope = bytesToEnvelope(fromBase64(encoded))
    return {
      bytes: await decryptPayload({
        roomKeyBase64: this.encryption.roomKeyBase64,
        envelope,
        expectedKind: kind,
      }),
      metadata: parseEnvelopeMetadata(envelope),
    }
  }

  private applyRemoteUpdate(
    bytes: Uint8Array,
    metadata: Record<string, unknown>,
    timestamp: number | null,
  ): void {
    Y.applyUpdate(
      this.doc,
      bytes,
      makeRemoteYjsOrigin({
        origin:
          metadata.origin === 'agent' ||
          metadata.origin === 'init' ||
          metadata.origin === 'user' ||
          metadata.origin === 'remote'
            ? metadata.origin
            : 'remote',
        sourceOrigin: typeof metadata.sourceOrigin === 'string'
          ? metadata.sourceOrigin
          : typeof metadata.origin === 'string'
            ? metadata.origin
            : 'remote',
        actorType:
          metadata.actorType === 'user' ||
          metadata.actorType === 'agent' ||
          metadata.actorType === 'system'
            ? metadata.actorType
            : undefined,
        actorId: typeof metadata.actorId === 'string' ? metadata.actorId : null,
        userId: typeof metadata.userId === 'string' ? metadata.userId : null,
        userName: typeof metadata.userName === 'string' ? metadata.userName : null,
        checkpointGroupId: typeof metadata.checkpointGroupId === 'string'
          ? metadata.checkpointGroupId
          : null,
        clientId: typeof metadata.clientId === 'string' ? metadata.clientId : null,
        terminalId: typeof metadata.terminalId === 'string' ? metadata.terminalId : null,
        terminalTitle: typeof metadata.terminalTitle === 'string' ? metadata.terminalTitle : null,
        terminalKind: typeof metadata.terminalKind === 'string' ? metadata.terminalKind : null,
        commandId: typeof metadata.commandId === 'string' ? metadata.commandId : null,
        commandText: typeof metadata.commandText === 'string' ? metadata.commandText : null,
        runId: typeof metadata.runId === 'string' ? metadata.runId : null,
        sessionKey: typeof metadata.sessionKey === 'string' ? metadata.sessionKey : null,
        laneId: typeof metadata.laneId === 'string' ? metadata.laneId : null,
        workspaceId: typeof metadata.workspaceId === 'string' ? metadata.workspaceId : null,
        gitCwd: typeof metadata.gitCwd === 'string' ? metadata.gitCwd : null,
        timestamp,
      }),
    )
  }

  private flushPendingUpdates(): void {
    while (
      this.pendingUpdates.length > 0 &&
      this.socket?.readyState === WebSocket.OPEN &&
      this.hasHandshakeAcknowledged
    ) {
      const next = this.pendingUpdates.shift()
      if (next) this.sendUpdate(next)
    }
  }

  private readonly handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (
      isRemoteYjsOrigin(origin) ||
      origin === 'snapshot' ||
      origin === 'state-vector' ||
      origin === 'reconnect'
    ) {
      return
    }

    const idempotencyKey = randomId(`upd_${this.clientId}`)
    const checkpointGroupId = ensureActiveCheckpointGroup(this.session.projectId)
    const attribution = extractAttributionOrigin(origin)

    this.outboundUpdateQueue = this.outboundUpdateQueue
      .then(async () => {
        const encoded = await this.encodeOutboundBytes(update, 'yjs_update', {
          projectId: this.session.projectId,
          roomId: this.session.roomId,
          clientId: this.clientId,
          idempotencyKey,
          checkpointGroupId,
          origin: attribution?.origin ?? (typeof origin === 'string' ? origin : 'user'),
          sourceOrigin: attribution?.sourceOrigin,
          actorType: attribution?.actorType,
          actorId: attribution?.actorId,
          userId: attribution?.userId,
          userName: attribution?.userName,
          terminalId: attribution?.terminalId,
          terminalTitle: attribution?.terminalTitle,
          terminalKind: attribution?.terminalKind,
          commandId: attribution?.commandId,
          commandText: attribution?.commandText,
          runId: attribution?.runId,
          sessionKey: attribution?.sessionKey,
          laneId: attribution?.laneId,
          workspaceId: attribution?.workspaceId,
          gitCwd: attribution?.gitCwd,
        })

        const pendingUpdate: PendingUpdate = {
          updateBinary: encoded,
          idempotencyKey,
          timestamp: Date.now(),
        }
        this.localUpdatesById.set(idempotencyKey, pendingUpdate)
        this.sendUpdate(pendingUpdate)
      })
      .catch((error) => {
        console.warn('[CollabWsProvider] Failed to encrypt local update:', error)
      })
  }

  private readonly handleAwarenessUpdate = ({
    added,
    updated,
    removed,
  }: {
    added: number[]
    updated: number[]
    removed: number[]
  }): void => {
    if (added.length + updated.length + removed.length === 0) return
    if (!this.hasHandshakeAcknowledged || this.socket?.readyState !== WebSocket.OPEN) {
      this.hasPendingAwarenessPublish = true
      return
    }
    this.publishLocalAwareness()
  }

  private publishLocalAwareness(): void {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.hasHandshakeAcknowledged) {
      this.hasPendingAwarenessPublish = true
      return
    }

    this.hasPendingAwarenessPublish = false
    if (!this.awareness.getStates().has(this.doc.clientID)) return

    try {
      const update = encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
      const targetSocket = this.socket
      const targetSocketInstanceId = this.activeSocketInstanceId

      void this.encodeOutboundBytes(update, 'yjs_awareness', {
        projectId: this.session.projectId,
        roomId: this.session.roomId,
        clientId: this.clientId,
      })
        .then((encoded) => {
          if (
            this.socket !== targetSocket ||
            this.activeSocketInstanceId !== targetSocketInstanceId ||
            targetSocket?.readyState !== WebSocket.OPEN ||
            !this.hasHandshakeAcknowledged
          ) {
            this.hasPendingAwarenessPublish = true
            return
          }

          targetSocket.send(JSON.stringify({
            type: 'presence.push',
            payload: {
              roomId: this.session.roomId,
              clientId: this.clientId,
              awarenessBinary: encoded,
              ttlMs: 30_000,
            },
          }))
        })
        .catch((error) => {
          console.warn('[CollabWsProvider] Failed to encrypt awareness:', error)
        })
    } catch (error) {
      console.warn('[CollabWsProvider] Failed to publish awareness:', error)
    }
  }

  private requestInitialSync(): void {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.hasHandshakeAcknowledged) return
    if (this.requestedCatchUpAtSeq === this.knownSeq) return

    this.requestedCatchUpAtSeq = this.knownSeq
    this.socket.send(JSON.stringify({
      type: 'sync.request',
      payload: {
        roomId: this.session.roomId,
        knownSeq: this.knownSeq,
      },
    }))
  }

  private async handleIncoming(raw: unknown): Promise<void> {
    if (typeof raw !== 'string') return

    let message: IncomingWireMessage
    try {
      message = JSON.parse(raw) as IncomingWireMessage
    } catch {
      return
    }

    if (!message || typeof message !== 'object' || !('type' in message)) return

    if (message.type === 'ready') {
      const headSeq = finiteSequence(message.payload?.headSeq)
      if (headSeq !== null) {
        this.targetHeadSeq = Math.max(this.targetHeadSeq, headSeq)
      }

      if (!this.hasHandshakeAcknowledged) {
        this.hasHandshakeAcknowledged = true
        this.reconnectAttempt = 0
        this.hasConnectedOnce = true
        this.consecutiveInitialFailures = 0
        this.onStateChange?.('connected', null)
        this.flushPendingUpdates()
        if (this.hasPendingAwarenessPublish) this.publishLocalAwareness()
      }

      if (message.payload?.resyncRequired || this.knownSeq < this.targetHeadSeq) {
        this.requestInitialSync()
      }
      return
    }

    if (message.type === 'sync.delta') {
      const fromSeq = finiteSequence(message.payload?.fromSeq)
      const toSeq = finiteSequence(message.payload?.toSeq)
      const advertisedHeadSeq = finiteSequence(message.payload?.headSeq)

      if (advertisedHeadSeq !== null) {
        this.targetHeadSeq = Math.max(this.targetHeadSeq, advertisedHeadSeq)
      }
      if (toSeq !== null) {
        this.targetHeadSeq = Math.max(this.targetHeadSeq, toSeq)
      }

      if (fromSeq !== null && fromSeq > this.knownSeq) {
        // A live delta can overtake an initial catch-up response. Do not mark the
        // gap as applied; ask for the contiguous range from the current head.
        this.requestInitialSync()
        return
      }

      if (toSeq !== null && toSeq <= this.knownSeq) {
        return
      }

      this.requestedCatchUpAtSeq = null
      const updates = Array.isArray(message.payload?.updatesBinary)
        ? message.payload.updatesBinary
        : []

      for (const encoded of updates) {
        const decoded = await this.decodeInboundBytes(encoded, 'yjs_update')
        this.applyRemoteUpdate(decoded.bytes, decoded.metadata, null)
      }

      if (toSeq !== null) this.advanceKnownSeq(toSeq)

      const shouldContinueCatchUp =
        message.payload?.hasMore === true ||
        this.knownSeq < this.targetHeadSeq ||
        updates.length >= SYNC_PAGE_SIZE

      if (shouldContinueCatchUp) this.requestInitialSync()
      return
    }

    if (message.type === 'update.push') {
      const encoded = message.payload?.updateBinary
      if (typeof encoded !== 'string' || encoded.length === 0) return

      const sequence = finiteSequence(message.payload?.seq)
      if (sequence !== null && sequence > this.knownSeq + 1) {
        this.targetHeadSeq = Math.max(this.targetHeadSeq, sequence)
        this.requestInitialSync()
        return
      }

      const decoded = await this.decodeInboundBytes(encoded, 'yjs_update')
      this.applyRemoteUpdate(
        decoded.bytes,
        decoded.metadata,
        finiteSequence(message.payload?.timestamp),
      )
      if (sequence !== null) this.advanceKnownSeq(sequence)
      return
    }

    if (message.type === 'presence.snapshot') {
      const entries = Array.isArray(message.payload?.entries) ? message.payload.entries : []
      for (const entry of entries) {
        const encoded = entry?.awarenessBinary
        if (typeof encoded !== 'string' || encoded.length === 0) continue
        const decoded = await this.decodeInboundBytes(encoded, 'yjs_awareness')
        applyAwarenessUpdate(this.awareness, decoded.bytes, 'remote')
      }
      return
    }

    if (message.type === 'presence.remove') {
      const clientIds = Array.isArray(message.payload?.clientIds)
        ? message.payload.clientIds
            .map((clientId) => Number(clientId))
            .filter((clientId) => Number.isFinite(clientId))
        : []
      if (clientIds.length > 0) {
        removeAwarenessStates(this.awareness, clientIds, 'remote')
      }
      return
    }

    if (message.type === 'update.ack') {
      const sequence = finiteSequence(message.payload?.seq)
      if (sequence !== null) {
        this.targetHeadSeq = Math.max(this.targetHeadSeq, sequence)
      }

      const idempotencyKey = message.payload?.idempotencyKey
      if (
        message.payload?.persisted !== false &&
        typeof idempotencyKey === 'string' &&
        this.localUpdatesById.delete(idempotencyKey)
      ) {
        this.removePendingUpdate(idempotencyKey)
      }
      // Acknowledged means durable, not necessarily contiguous and applied.
      // The following sync.delta is what advances knownSeq.
      return
    }

    if (message.type === 'error') {
      this.lastServerErrorCode = typeof message.payload?.code === 'string'
        ? message.payload.code
        : null
      const messageText = typeof message.payload?.message === 'string'
        ? message.payload.message
        : 'Collaboration protocol error'
      this.lastServerErrorMessage = messageText
      this.onStateChange?.('error', messageText)

      if (SESSION_INVALIDATION_ERROR_CODES.has(this.lastServerErrorCode ?? '')) {
        this.socket?.close(4409, messageText)
      }
    }
  }
}
