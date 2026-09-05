import { CollaborationChunkReceiver, COLLABORATION_CHUNK_CHARS, splitCollaborationUpdate, validateEncryptedCollaborationEnvelope, type CollaborationChunk } from "./collaborationWire"
import * as Y from "yjs"
import { AcknowledgedCollaborationState } from "./AcknowledgedCollaborationState"
import type { Awareness } from "y-protocols/awareness"
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness"

import {
  bytesToEnvelope,
  decryptPayload,
  decryptPayloadMetadata,
  encryptPayload,
  envelopeToBytes,
} from "./collaborationCipher"
import type { CollaborationOutbox } from "./collaborationOutbox"
import { fileInitializationOrigin } from "./collaborationFileInitialization"
import {
  extractAttributionOrigin,
  isRemoteYjsOrigin,
  makeRemoteYjsOrigin,
} from "./collaborationOrigins"

export interface CollabSessionDescriptor {
  projectId: string
  sessionId?: string
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
    status: "room_not_initialized" | "ready" | "missing_for_device" | "device_revoked"
    activeKeyVersion: number | null
    wrappedRoomKey: string | null
    wrapAlgorithm: string | null
    senderPublicKeyJwk: string | null
  }
}

export type CollaborationConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"

interface PendingUpdate {
  idempotencyKey: string
  updateBinary: string
  timestamp: number
}

interface IncomingMessage {
  type: string
  payload?: Record<string, unknown>
}

const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 10_000
const SESSION_REFRESH_BUFFER_MS = 2 * 60_000
const SYNC_PAGE_SIZE = 128
const AUTH_RECOVERY_ERRORS = new Set(["INVALID_SESSION_TOKEN", "SESSION_MISMATCH", "SESSION_EXPIRED"])
const SESSION_INVALIDATION_ERRORS = new Set(["DEVICE_REVOKED"])

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`
}

function finiteSequence(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function resolveWsUrl(value: string): string {
  const url = new URL(value.trim())
  if (url.protocol === "https:") url.protocol = "wss:"
  if (url.protocol === "http:") url.protocol = "ws:"
  return url.toString()
}

function decodeJwtExpiration(token: string): number | null {
  try {
    const payload = token.split(".")[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const parsed = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as { exp?: unknown }
    return typeof parsed.exp === "number" ? parsed.exp * 1_000 : null
  } catch {
    return null
  }
}

function envelopeMetadata(envelope: { aad: string }): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64(envelope.aad))) as Record<string, unknown>
  } catch {
    return {}
  }
}

export class CollabWsProvider {
  private readonly doc: Y.Doc
  private readonly acknowledged: AcknowledgedCollaborationState
  private readonly awareness: Awareness
  private session: CollabSessionDescriptor
  private readonly clientType: "web" | "electron"
  private readonly clientId: string
  private readonly onStateChange?: (state: CollaborationConnectionState, error?: string | null) => void
  private readonly onPermanentFailure?: (reason: string) => void
  private readonly onRecoveryRequired?: (code: string) => void
  private outgoingSuspended = false
  private recoveryPromise: Promise<void> = Promise.resolve()
  private readonly refreshSession?: () => Promise<CollabSessionDescriptor | null>
  private readonly encryption: { roomKeyBase64: string; keyVersion: number } | null
  private readonly outbox: CollaborationOutbox
  private readonly onMediaSignal?: (sourceClientId: string, signal: unknown) => void
  private readonly onMediaState?: (clientId: string, state: { audio: boolean; screenShare: boolean }) => void
  private readonly onInvalidated?: (projectId: string) => void
  private readonly getCheckpointGroup?: (projectId: string) => string
  private readonly onApplied?: (sequence: number, encoded: string) => Promise<void>
  private readonly onBaseAdvanced?: (commitSha: string, coveredThroughSequence: number) => void

  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private knownSeq: number
  private targetHeadSeq: number
  private destroyed = false
  private paused = false
  private readonly chunkReceiver = new CollaborationChunkReceiver()
  private readonly drainWaiters = new Set<() => void>()
  private handshakeReady = false
  private mediaClientId: string | null = null
  private pendingAwareness = false
  private pendingUpdates = new Map<string, PendingUpdate>()
  private incomingQueue: Promise<void> = Promise.resolve()
  private outgoingQueue: Promise<void> = Promise.resolve()
  private localPersistenceError: Error | null = null
  private barrierWaiters = new Map<string, {
    resolve: (sequence: number) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
    sequence?: number
  }>()

  constructor(args: {
    doc: Y.Doc
    awareness: Awareness
    session: CollabSessionDescriptor
    clientType?: "web" | "electron"
    initialKnownSeq?: number
    initialAcknowledgedUpdate?: Uint8Array
    onStateChange?: (state: CollaborationConnectionState, error?: string | null) => void
    onPermanentFailure?: (reason: string) => void
    onRecoveryRequired?: (code: string) => void
    canWrite?: boolean
    refreshSession?: () => Promise<CollabSessionDescriptor | null>
    encryption?: { roomKeyBase64: string; keyVersion: number } | null
    outbox: CollaborationOutbox
    onMediaSignal?: (sourceClientId: string, signal: unknown) => void
    onMediaState?: (clientId: string, state: { audio: boolean; screenShare: boolean }) => void
    onInvalidated?: (projectId: string) => void
    getCheckpointGroup?: (projectId: string) => string
    onApplied?: (sequence: number, encoded: string) => Promise<void>
    onBaseAdvanced?: (commitSha: string, coveredThroughSequence: number) => void
  }) {
    this.doc = args.doc
    this.awareness = args.awareness
    this.session = args.session
    this.clientType = args.clientType ?? "electron"
    this.clientId = String(args.doc.clientID)
    this.knownSeq = finiteSequence(args.initialKnownSeq) ?? 0
    this.acknowledged = new AcknowledgedCollaborationState(
      args.initialAcknowledgedUpdate ?? Y.encodeStateAsUpdate(args.doc), this.knownSeq,
    )
    this.targetHeadSeq = this.knownSeq
    this.onStateChange = args.onStateChange
    this.onPermanentFailure = args.onPermanentFailure
    this.onRecoveryRequired = args.onRecoveryRequired
    this.outgoingSuspended = args.canWrite === false
    this.refreshSession = args.refreshSession
    this.encryption = args.encryption ?? null
    this.outbox = args.outbox
    this.onMediaSignal = args.onMediaSignal
    this.onMediaState = args.onMediaState
    this.onBaseAdvanced = args.onBaseAdvanced
    this.onInvalidated = args.onInvalidated
    this.getCheckpointGroup = args.getCheckpointGroup
    this.onApplied = args.onApplied
  }

  start(): void {
    this.doc.on("update", this.handleLocalUpdate)
    this.awareness.on("update", this.handleAwarenessUpdate)
    this.recoveryPromise = this.restoreOutboxAndConnect()
    void this.recoveryPromise.catch((error) => this.failFrame(error))
  }

  async waitForLocalRecovery(): Promise<void> { await this.recoveryPromise }

  async startOffline(): Promise<void> {
    this.doc.on("update", this.handleLocalUpdate)
    this.awareness.on("update", this.handleAwarenessUpdate)
    await this.restoreOutboxAndConnect(false)
  }

  async reconnectAuthorized(session: CollabSessionDescriptor): Promise<void> {
    if (session.roomId !== this.session.roomId || session.projectId !== this.session.projectId || session.deviceId !== this.session.deviceId ||
      session.encryption.activeKeyVersion !== this.encryption?.keyVersion) throw new Error("Session key changed; retain old-key edits and recover the new checkpoint before reconnecting")
    this.session = session
    await this.connect()
  }

  destroy(): void {
    this.destroyed = true
    this.doc.off("update", this.handleLocalUpdate)
    this.awareness.off("update", this.handleAwarenessUpdate)
    if (this.reconnectTimer !== null) globalThis.clearTimeout(this.reconnectTimer)
    for (const waiter of this.barrierWaiters.values()) {
      globalThis.clearTimeout(waiter.timer)
      waiter.reject(new Error("Collaboration transport was destroyed"))
    }
    this.barrierWaiters.clear()
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, "Provider destroyed")
      }
    }
    this.outbox.close()
    this.acknowledged.destroy()
  }

  getConnectionState(): CollaborationConnectionState {
    if (this.socket?.readyState === WebSocket.OPEN && this.handshakeReady) return "connected"
    if (this.socket?.readyState === WebSocket.CONNECTING) return "connecting"
    return "idle"
  }

  getKnownSeq(): number {
    return this.knownSeq
  }

  async captureCommitState(): Promise<{ sequence: number; update: Uint8Array }> {
    const sequence = await this.requestBarrier()
    return { sequence, update: this.acknowledged.capture(sequence) }
  }

  retry(): void {
    if (this.destroyed) return
    this.paused = false
    this.chunkReceiver.clear()
    this.recoveryPromise = this.restoreOutboxAndConnect()
    void this.recoveryPromise.catch(error => this.failFrame(error))
  }

  acknowledgedCheckpoint(): { sequence: number; update: Uint8Array } {
    return { sequence: this.knownSeq, update: this.acknowledged.capture(this.knownSeq) }
  }

  async frozenCheckpoint(sequence: number): Promise<{ sequence: number; update: Uint8Array }> {
    this.outgoingSuspended = true
    this.paused = false
    await this.connect()
    await this.waitForCatchUp()
    this.targetHeadSeq = Math.max(this.targetHeadSeq, sequence)
    this.requestSync()
    await this.waitForSequence(sequence)
    return { sequence, update: this.acknowledged.capture(sequence) }
  }

  compactAcknowledged(sequence: number): void { this.acknowledged.compact(sequence) }

  async waitForSequence(sequence: number, timeoutMs = 15_000): Promise<void> {
    if (finiteSequence(sequence) === null) throw new Error("Invalid synchronization target")
    if (this.knownSeq >= sequence) return
    const id = randomId("catchup")
    await new Promise<number>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => { this.barrierWaiters.delete(id); reject(new Error("Waiting for acknowledged shared file state")) }, timeoutMs)
      this.barrierWaiters.set(id, { sequence, resolve, reject, timer })
    })
  }

  async waitForCatchUp(): Promise<void> {
    const deadline = Date.now() + 30_000
    while (!this.handshakeReady) {
      if (this.destroyed || this.paused || Date.now() >= deadline) throw new Error("Waiting for the authenticated room connection")
      await new Promise(resolve => globalThis.setTimeout(resolve, 25))
    }
    await this.waitForSequence(this.targetHeadSeq, Math.max(1, deadline - Date.now()))
  }

  async flushLocalPersistence(): Promise<void> {
    await this.outgoingQueue
    if (this.localPersistenceError) throw this.localPersistenceError
  }

  updateSession(session: CollabSessionDescriptor): void {
    this.session = session
  }

  async requestBarrier(timeoutMs = 15_000): Promise<number> {
    await this.outgoingQueue
    await this.flushPendingUpdates()
    if (this.paused) throw new Error("Synchronization is paused; preserve or retry local edits before committing")
    if (this.pendingUpdates.size) {
      await new Promise<void>((resolve, reject) => {
        const done = () => { globalThis.clearTimeout(timer); this.drainWaiters.delete(done); resolve() }
        const timer = globalThis.setTimeout(() => { this.drainWaiters.delete(done); reject(new Error("Local edits have not been durably acknowledged")) }, timeoutMs)
        this.drainWaiters.add(done)
        if (!this.pendingUpdates.size) done()
      })
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.handshakeReady) {
      throw new Error("Collaboration room is not connected")
    }
    const requestId = randomId("barrier")
    return await new Promise<number>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.barrierWaiters.delete(requestId)
        reject(new Error("Timed out waiting for collaboration barrier"))
      }, timeoutMs)
      this.barrierWaiters.set(requestId, { resolve, reject, timer })
      this.socket!.send(JSON.stringify({
        type: "barrier.request",
        payload: { roomId: this.session.roomId, requestId },
      }))
    })
  }

  sendMediaSignal(targetClientId: string, signal: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.handshakeReady) return
    this.socket.send(JSON.stringify({
      type: "media.signal",
      payload: {
        roomId: this.session.roomId,
        targetClientId,
        sourceClientId: this.mediaClientId ?? "",
        signal,
      },
    }))
  }

  setMediaState(state: { audio: boolean; screenShare: boolean }): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.handshakeReady) return
    this.socket.send(JSON.stringify({
      type: "media.state",
      payload: { roomId: this.session.roomId, clientId: this.mediaClientId ?? "", ...state },
    }))
  }

  private async restoreOutboxAndConnect(connect = true): Promise<void> {
    if (this.encryption) {
      const records = await this.outbox.list(this.session.roomId, this.encryption.keyVersion)
      for (const record of records) {
        const restored = await this.decodeInbound(record.updateBinary, "yjs_update")
        Y.applyUpdate(this.doc, restored.bytes, makeRemoteYjsOrigin({ origin: "remote" }))
        this.pendingUpdates.set(record.id, {
          idempotencyKey: record.id,
          updateBinary: record.updateBinary,
          timestamp: record.timestamp,
        })
      }
    }
    for (const pending of this.pendingUpdates.values()) {
      if (!this.encryption) break
      await this.outbox.enqueue({ id: pending.idempotencyKey, projectId: this.session.projectId, roomId: this.session.roomId,
        keyVersion: this.encryption.keyVersion, updateBinary: pending.updateBinary, timestamp: pending.timestamp })
    }
    this.localPersistenceError = null
    if (connect) await this.connect()
  }

  private async connect(): Promise<void> {
    if (this.destroyed || this.paused) return
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return

    const expiration = decodeJwtExpiration(this.session.token)
    if (expiration !== null && expiration - Date.now() <= SESSION_REFRESH_BUFFER_MS) {
      const refreshed = await this.refreshSession?.().catch(() => null)
      if (refreshed) this.session = refreshed
    }

    if (this.destroyed) return
    this.onStateChange?.("connecting", null)
    this.handshakeReady = false
    const socket = new WebSocket(resolveWsUrl(this.session.collabWsUrl))
    this.socket = socket

    socket.onopen = () => {
      if (this.destroyed || this.socket !== socket) return
      socket.send(JSON.stringify({
        type: "hello",
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
      this.incomingQueue = this.incomingQueue
        .then(() => this.handleIncoming(event.data))
        .catch((error) => this.failFrame(error))
    }
    socket.onerror = () => this.onStateChange?.("error", "Collaboration websocket error")
    socket.onclose = () => {
      if (this.destroyed || this.socket !== socket) return
      this.socket = null
      this.handshakeReady = false
      this.scheduleReconnect("Collaboration websocket disconnected")
    }
  }

  private scheduleReconnect(reason: string): void {
    if (this.destroyed || this.paused) return
    this.chunkReceiver.clear()
    this.onStateChange?.("reconnecting", reason)
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt)
    this.reconnectAttempt += 1
    if (this.reconnectTimer !== null) globalThis.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = globalThis.setTimeout(() => void this.connect(), delay)
  }

  private failFrame(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.paused = true
    if (this.reconnectTimer !== null) globalThis.clearTimeout(this.reconnectTimer)
    this.onStateChange?.("error", message)
    this.socket?.close(1011, "Collaboration frame processing failed")
  }

  private async handleIncoming(raw: unknown): Promise<void> {
    if (this.destroyed || typeof raw !== "string") return
    const message = JSON.parse(raw) as IncomingMessage
    const payload = message.payload ?? {}
    if (message.type !== "error" && payload.roomId !== this.session.roomId) throw new Error("Received data for a different collaboration room")

    if (message.type === "sync.chunk") {
      const sequence = finiteSequence(payload.sequence)
      const chunk = payload.chunk as CollaborationChunk
      if (sequence === null || !chunk || chunk.id !== `seq_${sequence}`) throw new Error("Invalid chunk sequence")
      const encoded = await this.chunkReceiver.accept(chunk)
      if (encoded !== null) await this.handleIncoming(JSON.stringify({ type: "sync.delta", payload: {
        roomId: this.session.roomId, fromSeq: sequence - 1, toSeq: sequence,
        headSeq: payload.headSeq, updatesBinary: [encoded],
      } }))
      return
    }

    if (message.type === "ready") {
      this.mediaClientId = typeof payload.mediaClientId === "string" ? payload.mediaClientId : null
      this.handshakeReady = true
      this.reconnectAttempt = 0
      this.targetHeadSeq = Math.max(this.knownSeq, finiteSequence(payload.headSeq) ?? this.knownSeq)
      this.onStateChange?.("connected", null)
      this.requestSync()
      await this.flushPendingUpdates()
      if (this.pendingAwareness) this.publishAwareness()
      return
    }

    if (message.type === "sync.delta") {
      const fromSeq = finiteSequence(payload.fromSeq)
      const toSeq = finiteSequence(payload.toSeq)
      if (fromSeq === null || toSeq === null) throw new Error("Invalid collaboration sequence")
      const updates = Array.isArray(payload.updatesBinary)
        ? payload.updatesBinary.filter((value): value is string => typeof value === "string")
        : []
      if (toSeq < fromSeq || updates.length !== toSeq - fromSeq) throw new Error("Collaboration delta does not contain its contiguous sequence range")
      const headSeq = finiteSequence(payload.headSeq)
      if (headSeq !== null) this.targetHeadSeq = Math.max(this.targetHeadSeq, headSeq)
      if (fromSeq > this.knownSeq) {
        this.requestSync()
        return
      }
      for (let index = 0; index < updates.length; index += 1) {
        const sequence = fromSeq + index + 1
        if (sequence <= this.knownSeq) continue
        const encoded = updates[index]!
        const decoded = await this.decodeInbound(encoded, "yjs_update")
        this.applyRemoteUpdate(decoded.bytes, decoded.metadata, null, sequence)
        await this.onApplied?.(sequence, encoded)
        this.knownSeq = sequence
      }
      this.resolveReadyBarriers()
      if (payload.hasMore === true || updates.length === SYNC_PAGE_SIZE || this.knownSeq < this.targetHeadSeq) {
        this.requestSync()
      }
      return
    }

    if (message.type === "update.ack") {
      const id = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : null
      if (id && payload.persisted === true && finiteSequence(payload.seq) !== null && this.pendingUpdates.has(id)) {
        await this.outbox.acknowledge(id)
        this.pendingUpdates.delete(id)
        if (!this.pendingUpdates.size) for (const done of this.drainWaiters) done()

        // An acknowledgement proves only that this local update was assigned a
        // server sequence. It does not prove that every earlier remote update
        // has been applied locally, so advancing knownSeq here could skip a gap.
        // Treat the acknowledged sequence as a catch-up target and advance only
        // after the contiguous sync.delta range has actually been decoded.
        const seq = finiteSequence(payload.seq)
        if (seq !== null) {
          this.targetHeadSeq = Math.max(this.targetHeadSeq, seq)
          if (this.knownSeq < this.targetHeadSeq) this.requestSync()
        }
      }
      return
    }

    if (message.type === "presence.snapshot") {
      const entries = Array.isArray(payload.entries) ? payload.entries : []
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue
        const encoded = (entry as { awarenessBinary?: unknown }).awarenessBinary
        if (typeof encoded !== "string") continue
        const decoded = await this.decodeInbound(encoded, "yjs_awareness")
        applyAwarenessUpdate(this.awareness, decoded.bytes, "remote")
      }
      return
    }

    if (message.type === "presence.remove") {
      const ids = Array.isArray(payload.clientIds)
        ? payload.clientIds.map(Number).filter(Number.isFinite)
        : []
      if (ids.length > 0) removeAwarenessStates(this.awareness, ids, "remote")
      return
    }

    if (message.type === "barrier.ready") {
      const requestId = typeof payload.requestId === "string" ? payload.requestId : null
      const sequence = finiteSequence(payload.sequence)
      const waiter = requestId ? this.barrierWaiters.get(requestId) : null
      if (requestId && waiter && sequence !== null) {
        waiter.sequence = sequence
        this.targetHeadSeq = Math.max(this.targetHeadSeq, sequence)
        this.resolveReadyBarriers()
        if (this.knownSeq < sequence) this.requestSync()
      }
      return
    }

    if (message.type === "base.advanced") {
      const commitSha = typeof payload.commitSha === "string" ? payload.commitSha : null
      const sequence = finiteSequence(payload.coveredThroughSequence)
      if (commitSha && sequence !== null) this.onBaseAdvanced?.(commitSha, sequence)
      return
    }

    if (message.type === "media.signal") {
      const source = typeof payload.sourceClientId === "string" ? payload.sourceClientId : null
      if (source) this.onMediaSignal?.(source, payload.signal)
      return
    }

    if (message.type === "media.state") {
      const clientId = typeof payload.clientId === "string" ? payload.clientId : null
      if (clientId) {
        this.onMediaState?.(clientId, {
          audio: payload.audio === true,
          screenShare: payload.screenShare === true,
        })
      }
      return
    }

    if (message.type === "error") {
      const code = typeof payload.code === "string" ? payload.code : "UNKNOWN"
      const text = typeof payload.message === "string" ? payload.message : "Collaboration error"
      if (code === "KEY_ROTATION_REQUIRED") {
        this.outgoingSuspended = true
        this.onStateChange?.("reconnecting", text)
      } else if (code === "ENCRYPTION_KEY_STALE" || code === "CHECKPOINT_REQUIRED") {
        this.failFrame(new Error(text))
        this.onRecoveryRequired?.(code)
      } else if (SESSION_INVALIDATION_ERRORS.has(code)) {
        this.onInvalidated?.(this.session.projectId)
        this.onPermanentFailure?.(text)
        this.failFrame(new Error(text))
      } else if (AUTH_RECOVERY_ERRORS.has(code)) {
        const refreshed = await this.refreshSession?.().catch(() => null)
        if (refreshed) {
          this.session = refreshed
          this.socket?.close(4001, "Refreshing collaboration session")
        }
      } else if (payload.recoverable === false) {
        this.failFrame(new Error(text))
      } else {
        this.onStateChange?.("error", text)
      }
    }
  }

  private resolveReadyBarriers(): void {
    for (const [id, waiter] of this.barrierWaiters) {
      if (waiter.sequence === undefined || this.knownSeq < waiter.sequence) continue
      globalThis.clearTimeout(waiter.timer)
      this.barrierWaiters.delete(id)
      waiter.resolve(waiter.sequence)
    }
  }

  private requestSync(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.handshakeReady) return
    this.socket.send(JSON.stringify({
      type: "sync.request",
      payload: { roomId: this.session.roomId, knownSeq: this.knownSeq },
    }))
  }

  private async flushPendingUpdates(): Promise<void> {
    if (this.outgoingSuspended) return
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.handshakeReady) return
    for (const update of [...this.pendingUpdates.values()].sort((a, b) => a.timestamp - b.timestamp)) {
      await this.sendUpdate(update)
    }
  }

  private async sendUpdate(update: PendingUpdate): Promise<void> {
    if (this.outgoingSuspended) return
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.handshakeReady) return
    if (update.updateBinary.length > COLLABORATION_CHUNK_CHARS) {
      for (const chunk of await splitCollaborationUpdate(update.idempotencyKey, update.updateBinary)) {
        this.socket.send(JSON.stringify({ type: "update.chunk", payload: { roomId: this.session.roomId, chunk, timestamp: update.timestamp } }))
      }
      return
    }
    this.socket.send(JSON.stringify({
      type: "update.push",
      payload: {
        roomId: this.session.roomId,
        idempotencyKey: update.idempotencyKey,
        updateBinary: update.updateBinary,
        authorType: "user",
        authorId: this.clientId,
        timestamp: update.timestamp,
      },
    }))
  }

  private readonly handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (isRemoteYjsOrigin(origin) || origin === "snapshot" || origin === "state-vector") return
    this.outgoingQueue = this.outgoingQueue.then(async () => {
      if (!this.encryption) throw new Error("Encrypted collaboration transport requires a room key")
      const idempotencyKey = randomId(`upd_${this.clientId}`)
      const checkpointGroupId = this.getCheckpointGroup?.(this.session.projectId)
      const attribution = extractAttributionOrigin(origin)
      const envelope = await encryptPayload({
        roomKeyBase64: this.encryption.roomKeyBase64,
        kind: "yjs_update",
        keyVersion: this.encryption.keyVersion,
        plaintext: update,
        metadata: {
          projectId: this.session.projectId,
          sessionId: this.session.sessionId,
          roomId: this.session.roomId,
          clientId: this.clientId,
          idempotencyKey,
          ...(fileInitializationOrigin(origin) ? { initialization: fileInitializationOrigin(origin) } : {}),
        },
        privateMetadata: {
          ...attribution,
          checkpointGroupId,
          origin: attribution?.origin ?? (typeof origin === "string" ? origin : "user"),
        },
      })
      const pending: PendingUpdate = {
        idempotencyKey,
        updateBinary: toBase64(envelopeToBytes(envelope)),
        timestamp: Date.now(),
      }
      this.pendingUpdates.set(idempotencyKey, pending)
      await this.outbox.enqueue({
        id: idempotencyKey,
        projectId: this.session.projectId,
        roomId: this.session.roomId,
        keyVersion: this.encryption.keyVersion,
        updateBinary: pending.updateBinary,
        timestamp: pending.timestamp,
      })
      await this.sendUpdate(pending)
    }).catch((error) => {
      this.localPersistenceError = error instanceof Error ? error : new Error("Local edit persistence failed")
      this.failFrame(error)
    })
  }

  private readonly handleAwarenessUpdate = (): void => {
    if (!this.handshakeReady) {
      this.pendingAwareness = true
      return
    }
    this.publishAwareness()
  }

  private publishAwareness(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.handshakeReady || !this.encryption) {
      this.pendingAwareness = true
      return
    }
    if (!this.awareness.getStates().has(this.doc.clientID)) return
    this.pendingAwareness = false
    const bytes = encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
    void encryptPayload({
      roomKeyBase64: this.encryption.roomKeyBase64,
      kind: "yjs_awareness",
      keyVersion: this.encryption.keyVersion,
      plaintext: bytes,
      metadata: { projectId: this.session.projectId, sessionId: this.session.sessionId, roomId: this.session.roomId },
    }).then((envelope) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.handshakeReady) return
      this.socket.send(JSON.stringify({
        type: "presence.push",
        payload: {
          roomId: this.session.roomId,
          clientId: this.clientId,
          awarenessBinary: toBase64(envelopeToBytes(envelope)),
          ttlMs: 30_000,
        },
      }))
    })
  }

  private async decodeInbound(
    encoded: string,
    kind: "yjs_update" | "yjs_awareness",
  ): Promise<{ bytes: Uint8Array; metadata: Record<string, unknown> }> {
    if (!this.encryption) throw new Error("Encrypted collaboration transport requires a room key")
    validateEncryptedCollaborationEnvelope(encoded, { roomId: this.session.roomId, projectId: this.session.projectId, keyVersion: this.encryption.keyVersion, kind })
    const envelope = bytesToEnvelope(fromBase64(encoded))
    const bytes = await decryptPayload({
      roomKeyBase64: this.encryption.roomKeyBase64,
      envelope,
      expectedKind: kind,
    })
    const metadata = envelopeMetadata(envelope)
    if (
      metadata.roomId !== this.session.roomId ||
      metadata.projectId !== this.session.projectId ||
      envelope.keyVersion !== this.encryption.keyVersion
    ) {
      throw new Error("Encrypted update does not belong to this room or key version")
    }
    const privateMetadata = await decryptPayloadMetadata({
      roomKeyBase64: this.encryption.roomKeyBase64,
      envelope,
    })
    return { bytes, metadata: { ...privateMetadata, ...metadata } }
  }

  private applyRemoteUpdate(bytes: Uint8Array, metadata: Record<string, unknown>, timestamp: number | null, sequence: number): void {
    this.acknowledged.apply(sequence, bytes)
    Y.applyUpdate(this.doc, bytes, makeRemoteYjsOrigin({
      origin: metadata.origin === "agent" || metadata.origin === "init" || metadata.origin === "user"
        ? metadata.origin
        : "remote",
      sourceOrigin: typeof metadata.sourceOrigin === "string" ? metadata.sourceOrigin : "remote",
      actorType: metadata.actorType === "agent" || metadata.actorType === "system" || metadata.actorType === "user"
        ? metadata.actorType
        : undefined,
      actorId: typeof metadata.actorId === "string" ? metadata.actorId : null,
      userId: typeof metadata.userId === "string" ? metadata.userId : null,
      userName: typeof metadata.userName === "string" ? metadata.userName : null,
      checkpointGroupId: typeof metadata.checkpointGroupId === "string" ? metadata.checkpointGroupId : null,
      clientId: typeof metadata.clientId === "string" ? metadata.clientId : null,
      terminalId: typeof metadata.terminalId === "string" ? metadata.terminalId : null,
      terminalTitle: typeof metadata.terminalTitle === "string" ? metadata.terminalTitle : null,
      terminalKind: typeof metadata.terminalKind === "string" ? metadata.terminalKind : null,
      commandId: typeof metadata.commandId === "string" ? metadata.commandId : null,
      commandText: typeof metadata.commandText === "string" ? metadata.commandText : null,
      runId: typeof metadata.runId === "string" ? metadata.runId : null,
      sessionKey: typeof metadata.sessionKey === "string" ? metadata.sessionKey : null,
      laneId: typeof metadata.laneId === "string" ? metadata.laneId : null,
      workspaceId: typeof metadata.workspaceId === "string" ? metadata.workspaceId : null,
      gitCwd: typeof metadata.gitCwd === "string" ? metadata.gitCwd : null,
      timestamp,
    }))
  }
}
