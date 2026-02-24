import * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'

export interface CollabSessionDescriptor {
  projectId: string
  roomId: string
  collabWsUrl: string
  token: string
  protocolVersion: string
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

export class CollabWsProvider {
  private readonly doc: Y.Doc
  private readonly awareness: Awareness
  private readonly session: CollabSessionDescriptor
  private readonly clientType: 'web' | 'electron'
  private readonly clientId: string
  private readonly onStateChange?: (state: ConnectionState, error?: string | null) => void
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private knownSeq = 0
  private isDestroyed = false
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
    onStateChange?: (state: ConnectionState, error?: string | null) => void
  }) {
    this.doc = args.doc
    this.awareness = args.awareness
    this.session = args.session
    this.clientType = args.clientType ?? 'electron'
    this.clientId = String(this.doc.clientID)
    this.onStateChange = args.onStateChange
  }

  start(): void {
    this.connect()
    this.doc.on('update', this.handleLocalUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)
  }

  destroy(): void {
    this.isDestroyed = true
    this.doc.off('update', this.handleLocalUpdate)
    this.awareness.off('update', this.handleAwarenessUpdate)
    this.clearReconnectTimer()
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  }

  getConnectionState(): ConnectionState {
    if (this.socket?.readyState === WebSocket.OPEN) return 'connected'
    if (this.socket?.readyState === WebSocket.CONNECTING) return 'connecting'
    return 'idle'
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
    this.reconnectAttempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.connect()
    }, delay)
  }

  private connect(): void {
    if (this.isDestroyed) return
    this.onStateChange?.('connecting', null)

    const socket = new WebSocket(resolveWsUrl(this.session.collabWsUrl))
    this.socket = socket

    socket.onopen = () => {
      this.reconnectAttempt = 0
      this.onStateChange?.('connected', null)
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
      socket.send(
        JSON.stringify({
          type: 'sync_request',
          payload: {
            roomId: this.session.roomId,
            knownSeq: this.knownSeq,
          },
        })
      )
      this.flushPendingUpdates()
      this.publishLocalAwareness()
    }

    socket.onmessage = (event) => {
      this.handleIncoming(event.data)
    }

    socket.onerror = () => {
      this.onStateChange?.('error', 'Collaboration websocket error')
    }

    socket.onclose = () => {
      if (this.isDestroyed) return
      this.scheduleReconnect('Collaboration websocket disconnected')
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

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload))
      return
    }
    this.pendingUpdates.push({ updateBinary, idempotencyKey, timestamp })
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
    this.sendUpdate(toBase64(update), idempotencyKey, Date.now())
  }

  private readonly handleAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changed = [...added, ...updated, ...removed]
    if (changed.length === 0) return
    this.publishLocalAwareness()
  }

  private publishLocalAwareness(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    try {
      const update = encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
      this.socket.send(
        JSON.stringify({
          type: 'awareness_push',
          payload: {
            roomId: this.session.roomId,
            clientId: this.clientId,
            awarenessBinary: toBase64(update),
            ttlMs: 30_000,
          },
        })
      )
    } catch (error) {
      console.warn('[CollabWsProvider] Failed to publish awareness:', error)
    }
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
      for (const encoded of updates) {
        try {
          Y.applyUpdate(this.doc, fromBase64(encoded), 'remote')
        } catch (error) {
          console.warn('[CollabWsProvider] Failed to apply sync delta update:', error)
        }
      }
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
      try {
        Y.applyUpdate(this.doc, fromBase64(encoded), 'remote')
      } catch (error) {
        console.warn('[CollabWsProvider] Failed to apply update_push:', error)
      }
      return
    }

    if (message.type === 'awareness_push') {
      const encoded = message.payload?.awarenessBinary
      if (typeof encoded !== 'string' || encoded.length === 0) return
      try {
        applyAwarenessUpdate(this.awareness, fromBase64(encoded), 'remote')
      } catch (error) {
        console.warn('[CollabWsProvider] Failed to apply awareness update:', error)
      }
      return
    }

    if (message.type === 'ack') {
      const seq = Number(message.payload?.seq)
      if (Number.isFinite(seq)) {
        this.knownSeq = Math.max(this.knownSeq, seq)
      }
      return
    }

    if (message.type === 'error') {
      const messageText =
        typeof message.payload?.message === 'string'
          ? message.payload.message
          : 'Collaboration protocol error'
      this.onStateChange?.('error', messageText)
    }
  }
}
