import * as Y from "yjs"
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
} from "@/lib/collab/cipherEnvelope"
import { invalidateCollabSession } from "@/features/collaboration/hooks/useCollabSession"
import { EncryptedCollabOutbox } from "@/features/collaboration/persistence/EncryptedCollabOutbox"
import { ensureActiveCheckpointGroup } from "@/lib/yjs/checkpointGroups"
import {
  extractAttributionOrigin,
  isRemoteYjsOrigin,
  makeRemoteYjsOrigin,
} from "@/lib/yjs/origins"

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
const AUTH_RECOVERY_ERRORS = new Set(["INVALID_SESSION_TOKEN", "SESSION_MISMATCH"])
const SESSION_INVALIDATION_ERRORS = new Set(["ENCRYPTION_KEY_STALE", "DEVICE_REVOKED"])

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
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null
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
  private readonly awareness: Awareness
  private session: CollabSessionDescriptor
  private readonly clientType: "web" | "electron"
  private readonly clientId: string
  private readonly onStateChange?: (state: CollaborationConnectionState, error?: string | null) => void
  private readonly onPermanentFailure?: (reason: string) => void
  private readonly refreshSession?: () => Promise<CollabSessionDescriptor | null>
  private readonly encryption: { roomKeyBase64: string; keyVersion: number } | null
  private readonly outbox: EncryptedCollabOutbox
  private readonly onMediaSignal?: (sourceClientId: string, signal: unknown) => void
  private readonly onMediaState?: (clientId: string, state: { audio: boolean; screenShare: boolean }) => void
  private readonly onBaseAdvanced?: (commitSha: string, coveredThroughSequence: number) => void

  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private knownSeq: number
  private targetHeadSeq: number
  private destroyed = false
  private handshakeReady = false
  private mediaClientId: string | null = null
  private pendingAwareness = false
  private pendingUpdates = new Map<string, PendingUpdate>()
  private incomingQueue: Promise<void> = Promise.resolve()
  private outgoingQueue: Promise<void> = Promise.resolve()
  private barrierWaiters = new Map<string, {
    resolve: (sequence: number) => void
    reject: (error: Error) => void
    timer: number
  }>()

  constructor(args: {
    doc: Y.Doc
    awareness: Awareness
    session: CollabSessionDescriptor
    clientType?: "web" | "electron"
    initialKnownSeq?: number
    onStateChange?: (state: CollaborationConnectionState, error?: string | null) => void
    onPermanentFailure?: (reason: string) => void
    refreshSession?: () => Promise<CollabSessionDescriptor | null>
    encryption?: { roomKeyBase64: string; keyVersion: number } | null
    outbox?: EncryptedCollabOutbox
    onMediaSignal?: (sourceClientId: string, signal: unknown) => void
    onMediaState?: (clientId: string, state: { audio: boolean; screenShare: boolean }) => void
    onBaseAdvanced?: (commitSha: string, coveredThroughSequence: number) => void
  }) {
    this.doc = args.doc
    this.awareness = args.awareness
    this.session = args.session
    this.clientType = args.clientType ?? "electron"
    this.clientId = String(args.doc.clientID)
    this.knownSeq = finiteSequence(args.initialKnownSeq) ?? 0
    this.targetHeadSeq = this.knownSeq
    this.onStateChange = args.onStateChange
    this.onPermanentFailure = args.onPermanentFailure
    this.refreshSession = args.refreshSession
    this.encryption = args.encryption ?? null
    this.outbox = args.outbox ?? new EncryptedCollabOutbox()
    this.onMediaSignal = args.onMediaSignal
    this.onMediaState = args.onMediaState
    this.onBaseAdvanced = args.onBaseAdvanced
  }

  start(): void {
    this.doc.on("update", this.handleLocalUpdate)
    this.awareness.on("update", this.handleAwarenessUpdate)
    void this.restoreOutboxAndConnect().catch((error) => this.failFrame(error))
  }

  destroy(): void {
    this.destroyed = true
    this.doc.off("update", this.handleLocalUpdate)
    this.awareness.off("update", this.handleAwarenessUpdate)
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    for (const waiter of this.barrierWaiters.values()) {
      window.clearTimeout(waiter.timer)
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
  }

  getConnectionState(): CollaborationConnectionState {
    if (this.socket?.readyState === WebSocket.OPEN && this.handshakeReady) return "connected"
    if (this.socket?.readyState === WebSocket.CONNECTING) return "connecting"
    return "idle"
  }

  getKnownSeq(): number {
    return this.knownSeq
  }

  updateSession(session: CollabSessionDescriptor): void {
    this.session = session
  }

  async requestBarrier(timeoutMs = 15_000): Promise<number> {
    await this.outgoingQueue
    await this.flushPendingUpdates()
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.handshakeReady) {
      throw new Error("Collaboration room is not connected")
    }
    const requestId = randomId("barrier")
    return await new Promise<number>((resolve, reject) => {
      const timer = window.setTimeout(() => {
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

  private async restoreOutboxAndConnect(): Promise<void> {
    if (this.encryption) {
      const records = await this.outbox.list(this.session.roomId, this.encryption.keyVersion)
      for (const record of records) {
        this.pendingUpdates.set(record.id, {
          idempotencyKey: record.id,
          updateBinary: record.updateBinary,
          timestamp: record.timestamp,
        })
      }
    }
    await this.connect()
  }

  private async connect(): Promise<void> {
    if (this.destroyed) return
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
    if (this.destroyed) return
    this.onStateChange?.("reconnecting", reason)
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt)
    this.reconnectAttempt += 1
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = window.setTimeout(() => void this.connect(), delay)
  }

  private failFrame(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.onStateChange?.("error", message)
    this.socket?.close(1011, "Collaboration frame processing failed")
  }

  private async handleIncoming(raw: unknown): Promise<void> {
    if (this.destroyed || typeof raw !== "string") return
    const message = JSON.parse(raw) as IncomingMessage
    const payload = message.payload ?? {}

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
      const fromSeq = finiteSequence(payload.fromSeq) ?? this.knownSeq
      const toSeq = finiteSequence(payload.toSeq) ?? fromSeq
      const updates = Array.isArray(payload.updatesBinary)
        ? payload.updatesBinary.filter((value): value is string => typeof value === "string")
        : []
      const headSeq = finiteSequence(payload.headSeq)
      if (headSeq !== null) this.targetHeadSeq = Math.max(this.targetHeadSeq, headSeq)
      if (fromSeq > this.knownSeq) {
        this.requestSync()
        return
      }
      for (const encoded of updates) {
        const decoded = await this.decodeInbound(encoded, "yjs_update")
        this.applyRemoteUpdate(decoded.bytes, decoded.metadata, null)
      }
      this.knownSeq = Math.max(this.knownSeq, toSeq)
      if (payload.hasMore === true || updates.length === SYNC_PAGE_SIZE || this.knownSeq < this.targetHeadSeq) {
        this.requestSync()
      }
      return
    }

    if (message.type === "update.ack") {
      const id = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : null
      if (id && this.pendingUpdates.has(id)) {
        await this.outbox.acknowledge(id)
        this.pendingUpdates.delete(id)

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
        window.clearTimeout(waiter.timer)
        this.barrierWaiters.delete(requestId)
        this.knownSeq = Math.max(this.knownSeq, sequence)
        waiter.resolve(sequence)
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
      if (SESSION_INVALIDATION_ERRORS.has(code)) {
        invalidateCollabSession(this.session.projectId)
        this.onPermanentFailure?.(text)
      } else if (AUTH_RECOVERY_ERRORS.has(code)) {
        const refreshed = await this.refreshSession?.().catch(() => null)
        if (refreshed) {
          this.session = refreshed
          this.socket?.close(4001, "Refreshing collaboration session")
        }
      } else {
        this.onStateChange?.("error", text)
      }
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
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.handshakeReady) return
    for (const update of [...this.pendingUpdates.values()].sort((a, b) => a.timestamp - b.timestamp)) {
      this.sendUpdate(update)
    }
  }

  private sendUpdate(update: PendingUpdate): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.handshakeReady) return
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
      const checkpointGroupId = ensureActiveCheckpointGroup(this.session.projectId)
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
      await this.outbox.enqueue({
        id: idempotencyKey,
        projectId: this.session.projectId,
        roomId: this.session.roomId,
        keyVersion: this.encryption.keyVersion,
        updateBinary: pending.updateBinary,
        timestamp: pending.timestamp,
      })
      this.pendingUpdates.set(idempotencyKey, pending)
      this.sendUpdate(pending)
    }).catch((error) => this.onStateChange?.("error", error instanceof Error ? error.message : String(error)))
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

  private applyRemoteUpdate(bytes: Uint8Array, metadata: Record<string, unknown>, timestamp: number | null): void {
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
