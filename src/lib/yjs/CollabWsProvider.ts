import * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import {
  bytesToEnvelope,
  decryptPayload,
  encryptPayload,
  envelopeToBytes,
} from '@/lib/collab/cipherEnvelope'

export interface CollabSessionDescriptor {
  projectId: string
  roomId: string
  collabWsUrl: string
  token: string
  protocolVersion: string
  deviceId: string
  devicePublicKeyJwk?: string
  encryption: {
    roomId: string
    encryptionRequired: boolean
    status: 'plaintext_legacy' | 'room_not_initialized' | 'ready' | 'missing_for_device'
    activeKeyVersion: number | null
    wrappedRoomKey: string | null
    wrapAlgorithm: string | null
    senderPublicKeyJwk: string | null
  }
}

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

interface SyncDeltaMessage {
  type: 'sync_delta'
  payload: {
    roomId: string
    fromSeq: number
    toSeq: number
    updatesBinary: string[]
  }
}

interface UpdatePushMessage {
  type: 'update_push'
  payload: {
    roomId: string
    seq: number
    idempotencyKey?: string
    updateBinary: string
    authorType: 'user' | 'agent'
    authorId: string
    timestamp: number
  }
}

interface AwarenessPushMessage {
  type: 'awareness_push'
  payload: {
    roomId: string
    clientId: string
    awarenessBinary: string
    ttlMs: number
  }
}

interface AckMessage {
  type: 'ack'
  payload: {
    roomId: string
    seq: number
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
  | SyncDeltaMessage
  | UpdatePushMessage
  | AwarenessPushMessage
  | AckMessage
  | ErrorMessage

const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 10_000
const RECONNECT_FACTOR = 2
const INITIAL_CONNECT_FAILURE_LIMIT = 6
const INITIAL_CONNECT_FAILURE_WINDOW_MS = 2_500
const SESSION_REFRESH_BUFFER_MS = 2 * 60 * 1000
const AUTH_RECOVERY_ERROR_CODES = new Set(['INVALID_SESSION_TOKEN', 'SESSION_MISMATCH'])

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function resolveWsUrl(base: string): string {
  const trimmed = base.trim()
  if (!trimmed) throw new Error('Collab websocket URL is empty')
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
  private isDestroyed = false
  private lastServerErrorCode: string | null = null
  private lastServerErrorMessage: string | null = null
  private sessionRefreshInFlight: Promise<boolean> | null = null
  private hasHandshakeAcknowledged = false
  private readonly pendingUpdates: Array<{
    updateBinary: string
    idempotencyKey: string
    timestamp: number
  }> = []

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
    this.knownSeq =
      typeof args.initialKnownSeq === 'number' && Number.isFinite(args.initialKnownSeq)
        ? Math.max(0, Math.floor(args.initialKnownSeq))
        : 0
    this.onStateChange = args.onStateChange
    this.onPermanentFailure = args.onPermanentFailure
    this.refreshSession = args.refreshSession
    this.encryption = args.encryption ?? null
  }

  start(): void {
    void this.connect()
    this.doc.on('update', this.handleLocalUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)
  }

  destroy(): void {
    this.isDestroyed = true
    this.hasHandshakeAcknowledged = false
    this.doc.off('update', this.handleLocalUpdate)
    this.awareness.off('update', this.handleAwarenessUpdate)
    this.clearReconnectTimer()
    const socket = this.socket
    this.socket = null
    if (!socket) return

    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null

    // Closing a CONNECTING socket triggers noisy browser warnings in dev.
    // Defer close until after open to avoid false-positive "connection failed" noise.
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.onopen = () => {
        socket.close(1000, 'Provider destroyed')
      }
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

  updateSession(session: CollabSessionDescriptor): void {
    this.session = session
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect(errorMessage?: string): void {
    if (this.isDestroyed) return
    this.clearReconnectTimer()
    this.onStateChange?.('reconnecting', errorMessage ?? null)
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * Math.pow(RECONNECT_FACTOR, this.reconnectAttempt)
    )
    console.warn('[CollabWsProvider] Scheduling reconnect', {
      projectId: this.session.projectId,
      roomId: this.session.roomId,
      attempt: this.reconnectAttempt + 1,
      delayMs: delay,
      reason: errorMessage ?? null,
    })
    this.reconnectAttempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      void this.connect()
    }, delay)
  }

  private shouldRefreshSessionBeforeConnect(): boolean {
    const expirationMs = decodeJwtExpMs(this.session.token)
    if (!expirationMs) return false
    return expirationMs - Date.now() <= SESSION_REFRESH_BUFFER_MS
  }

  private async maybeRefreshSession(): Promise<boolean> {
    if (!this.refreshSession) return false
    if (this.sessionRefreshInFlight) {
      return await this.sessionRefreshInFlight
    }

    const refreshPromise = (async () => {
      try {
        const nextSession = await this.refreshSession?.()
        if (!nextSession?.token) return false
        this.session = nextSession
        this.reconnectAttempt = 0
        this.consecutiveInitialFailures = 0
        return true
      } catch (error) {
        console.warn('[CollabWsProvider] Failed to refresh collab session:', error)
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

  private async connect(): Promise<void> {
    if (this.isDestroyed) return
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return
    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) return

    this.clearReconnectTimer()
    if (this.shouldRefreshSessionBeforeConnect()) {
      await this.maybeRefreshSession()
      if (this.isDestroyed) return
      if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
        return
      }
    }

    this.currentConnectStartedAt = Date.now()
    this.hasHandshakeAcknowledged = false
    this.lastServerErrorCode = null
    this.lastServerErrorMessage = null
    this.onStateChange?.('connecting', null)

    const socket = new WebSocket(resolveWsUrl(this.session.collabWsUrl))
    this.socket = socket

    // console.info('[CollabWsProvider] Opening collaboration websocket', {
    //   projectId: this.session.projectId,
    //   roomId: this.session.roomId,
    //   reconnectAttempt: this.reconnectAttempt,
    // })

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'hello',
          payload: {
            protocolVersion: this.session.protocolVersion,
            clientType: this.clientType,
            projectId: this.session.projectId,
            sessionToken: this.session.token,
            clientId: this.clientId,
          },
        })
      )
    }

    socket.onmessage = (event) => {
      this.handleIncoming(event.data)
    }

    socket.onerror = () => {
      console.warn('[CollabWsProvider] Collaboration websocket transport error', {
        projectId: this.session.projectId,
        roomId: this.session.roomId,
      })
      this.onStateChange?.('error', 'Collaboration websocket error')
    }

    socket.onclose = (event) => {
      if (this.isDestroyed) return
      if (this.socket === socket) {
        this.socket = null
      }
      this.hasHandshakeAcknowledged = false

      const connectLifetimeMs = Date.now() - this.currentConnectStartedAt
      const initialHandshakeFailure =
        !this.hasConnectedOnce && connectLifetimeMs <= INITIAL_CONNECT_FAILURE_WINDOW_MS

      if (initialHandshakeFailure) {
        this.consecutiveInitialFailures += 1
      } else if (this.hasConnectedOnce) {
        this.consecutiveInitialFailures = 0
      }

      const closeDetails =
        this.lastServerErrorMessage ??
        (typeof event.code === 'number'
          ? `Collaboration websocket disconnected (code ${event.code})`
          : 'Collaboration websocket disconnected')

      console.warn('[CollabWsProvider] Collaboration websocket closed', {
        projectId: this.session.projectId,
        roomId: this.session.roomId,
        code: event.code,
        reason: event.reason || null,
        serverErrorCode: this.lastServerErrorCode,
        message: closeDetails,
        connectLifetimeMs,
        consecutiveInitialFailures: this.consecutiveInitialFailures,
      })

      if (AUTH_RECOVERY_ERROR_CODES.has(this.lastServerErrorCode ?? '')) {
        void this.handleAuthRecovery(closeDetails)
        return
      }

      if (this.consecutiveInitialFailures >= INITIAL_CONNECT_FAILURE_LIMIT) {
        const message =
          'Collaboration websocket is unavailable after repeated failed handshakes. Switching to fallback sync transport.'
        this.onStateChange?.('error', message)
        this.onPermanentFailure?.(message)
        return
      }

      this.scheduleReconnect(closeDetails)
    }
  }

  private sendUpdate(updateBinary: string, idempotencyKey: string, timestamp: number): void {
    const payload = {
      type: 'update_push',
      payload: {
        roomId: this.session.roomId,
        idempotencyKey,
        updateBinary,
        authorType: 'user',
        authorId: this.clientId,
        timestamp,
      },
    }

    if (this.socket?.readyState === WebSocket.OPEN && this.hasHandshakeAcknowledged) {
      this.socket.send(JSON.stringify(payload))
      return
    }
    this.pendingUpdates.push({ updateBinary, idempotencyKey, timestamp })
  }

  private async encodeOutboundBytes(
    bytes: Uint8Array,
    kind: 'yjs_update' | 'yjs_awareness',
    metadata: Record<string, unknown>,
  ): Promise<string> {
    if (!this.encryption) {
      return toBase64(bytes)
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
  ): Promise<Uint8Array> {
    const bytes = fromBase64(encoded)
    if (!this.encryption) {
      return bytes
    }

    const envelope = bytesToEnvelope(bytes)
    return await decryptPayload({
      roomKeyBase64: this.encryption.roomKeyBase64,
      envelope,
      expectedKind: kind,
    })
  }

  private flushPendingUpdates(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    while (this.pendingUpdates.length > 0) {
      const next = this.pendingUpdates.shift()
      if (!next) continue
      this.sendUpdate(next.updateBinary, next.idempotencyKey, next.timestamp)
    }
  }

  private readonly handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === 'remote' || origin === 'snapshot' || origin === 'state-vector' || origin === 'reconnect') {
      return
    }
    const idempotencyKey = randomId(`upd_${this.clientId}`)
    void this.encodeOutboundBytes(update, 'yjs_update', {
      projectId: this.session.projectId,
      roomId: this.session.roomId,
      clientId: this.clientId,
      idempotencyKey,
    })
      .then((encoded) => {
        this.sendUpdate(encoded, idempotencyKey, Date.now())
      })
      .catch((error) => {
        console.warn('[CollabWsProvider] Failed to encrypt local update:', error)
      })
  }

  private readonly handleAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changed = [...added, ...updated, ...removed]
    if (changed.length === 0) return
    this.publishLocalAwareness()
  }

  private publishLocalAwareness(): void {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.hasHandshakeAcknowledged) return
    try {
      const update = encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
      void this.encodeOutboundBytes(update, 'yjs_awareness', {
        projectId: this.session.projectId,
        roomId: this.session.roomId,
        clientId: this.clientId,
      })
        .then((encoded) => {
          if (this.socket?.readyState !== WebSocket.OPEN || !this.hasHandshakeAcknowledged) return
          this.socket.send(
            JSON.stringify({
              type: 'awareness_push',
              payload: {
                roomId: this.session.roomId,
                clientId: this.clientId,
                awarenessBinary: encoded,
                ttlMs: 30_000,
              },
            })
          )
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
    this.socket.send(
      JSON.stringify({
        type: 'sync_request',
        payload: {
          roomId: this.session.roomId,
          knownSeq: this.knownSeq,
        },
      })
    )
  }

  private handleIncoming(raw: unknown): void {
    if (typeof raw !== 'string') return
    let message: IncomingWireMessage
    try {
      message = JSON.parse(raw) as IncomingWireMessage
    } catch {
      return
    }

    if (!message || typeof message !== 'object' || !('type' in message)) return
    if (message.type === 'sync_delta') {
      const updates = Array.isArray(message.payload?.updatesBinary) ? message.payload.updatesBinary : []
      void (async () => {
        for (const encoded of updates) {
          const bytes = await this.decodeInboundBytes(encoded, 'yjs_update')
          Y.applyUpdate(this.doc, bytes, 'remote')
        }
      })().catch((error) => {
        console.warn('[CollabWsProvider] Failed to apply sync delta update:', error)
      })
      const toSeq = Number(message.payload?.toSeq)
      if (Number.isFinite(toSeq)) {
        this.knownSeq = Math.max(this.knownSeq, toSeq)
      }
      return
    }

    if (message.type === 'update_push') {
      const seq = Number(message.payload?.seq)
      if (Number.isFinite(seq)) {
        this.knownSeq = Math.max(this.knownSeq, seq)
      }
      const encoded = message.payload?.updateBinary
      if (typeof encoded !== 'string' || encoded.length === 0) return
      void this.decodeInboundBytes(encoded, 'yjs_update')
        .then((bytes) => {
          Y.applyUpdate(this.doc, bytes, 'remote')
        })
        .catch((error) => {
          console.warn('[CollabWsProvider] Failed to apply update_push:', error)
        })
      return
    }

    if (message.type === 'awareness_push') {
      const encoded = message.payload?.awarenessBinary
      if (typeof encoded !== 'string' || encoded.length === 0) return
      void this.decodeInboundBytes(encoded, 'yjs_awareness')
        .then((bytes) => {
          applyAwarenessUpdate(this.awareness, bytes, 'remote')
        })
        .catch((error) => {
          console.warn('[CollabWsProvider] Failed to apply awareness update:', error)
        })
      return
    }

    if (message.type === 'ack') {
      const seq = Number(message.payload?.seq)
      if (Number.isFinite(seq)) {
        this.knownSeq = Math.max(this.knownSeq, seq)
      }

      if (!this.hasHandshakeAcknowledged) {
        this.hasHandshakeAcknowledged = true
        this.reconnectAttempt = 0
        this.hasConnectedOnce = true
        this.consecutiveInitialFailures = 0
        this.onStateChange?.('connected', null)
        // console.info('[CollabWsProvider] Collaboration websocket handshake acknowledged', {
        //   projectId: this.session.projectId,
        //   roomId: this.session.roomId,
        // })
        this.requestInitialSync()
        this.flushPendingUpdates()
        this.publishLocalAwareness()
      }
      return
    }

    if (message.type === 'error') {
      this.lastServerErrorCode =
        typeof message.payload?.code === 'string' ? message.payload.code : null
      const messageText =
        typeof message.payload?.message === 'string'
          ? message.payload.message
          : 'Collaboration protocol error'
      this.lastServerErrorMessage = messageText
      console.warn('[CollabWsProvider] Collaboration protocol error', {
        projectId: this.session.projectId,
        roomId: this.session.roomId,
        code: this.lastServerErrorCode,
        recoverable:
          typeof message.payload?.recoverable === 'boolean' ? message.payload.recoverable : null,
        retryAfterMs:
          typeof message.payload?.retryAfterMs === 'number' ? message.payload.retryAfterMs : null,
        message: messageText,
      })
      this.onStateChange?.('error', messageText)
    }
  }
}
