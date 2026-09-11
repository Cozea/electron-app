/**
 * Daemon-side client for the session room.
 *
 * Master Specification: Section 13.1 - 13.10
 * Speaks the session-room protocol over any WebSocket-like connection: authenticates
 * with a session token, replays from the transport's contiguous watermark, resends
 * batches the room never acknowledged, and applies peers' batches as they arrive.
 * The room deduplicates by batchId, so a resend after a lost acknowledgement cannot
 * create a second copy.
 */

import type { CollaborationBatch } from "./SessionReplica"
import type { SessionTransport } from "./SessionTransport"

/** Must match SESSION_ROOM_PROTOCOL_VERSION in cloudflare/worker/src/durableObjects/CollaborationSessionRoom.ts. */
export const SESSION_ROOM_PROTOCOL_VERSION = "session-room/1"
const DEFAULT_LIVE_TIMEOUT_MS = 30_000

export interface RoomConnection {
  send(data: string): void
  close(): void
}

export interface RoomConnectionHandlers {
  onMessage(data: string): void
  onClose(): void
}

export type RoomConnector = (handlers: RoomConnectionHandlers) => Promise<RoomConnection>

export type RoomClientState = "disconnected" | "connecting" | "syncing" | "live"

export interface RoomBarrier {
  barrierId: string
  sessionSeq: number
  serverTime: number
}

interface WireBatch {
  sessionSeq: number
  batchId: string
  clientId: string
  encryptedPayload: string
}

type ServerMessage =
  | { type: "ready"; headSeq: number }
  | { type: "sync_delta"; toSeq: number; headSeq: number; batches: WireBatch[] }
  | { type: "batch_ack"; batchId: string; sessionSeq: number; duplicate: boolean }
  | { type: "session_batch"; batch: WireBatch }
  | { type: "barrier_ack"; barrier: RoomBarrier }
  | { type: "error"; code: string; message: string; recoverable?: boolean }

interface Waiter<T> {
  resolve(value: T): void
  reject(error: Error): void
}

export interface SessionRoomClientOptions {
  transport: SessionTransport
  connect: RoomConnector
  getToken: () => Promise<string>
  /** Called when the room assigns a sequence to one of this client's batches. */
  onAcknowledged?: (batchId: string, sessionSeq: number) => void
  onStateChange?: (state: RoomClientState) => void
  /** How long connect() waits for replay to finish before giving up. */
  liveTimeoutMs?: number
}

export class SessionRoomClient {
  readonly transport: SessionTransport
  private readonly connector: RoomConnector
  private readonly getToken: () => Promise<string>
  private readonly onAcknowledged?: (batchId: string, sessionSeq: number) => void
  private readonly onStateChange?: (state: RoomClientState) => void
  private readonly liveTimeoutMs: number

  private connection: RoomConnection | null = null
  private connecting: Promise<void> | null = null
  private clientState: RoomClientState = "disconnected"
  // Encrypted batches the room has not acknowledged, in submission order.
  private readonly pending = new Map<string, string>()
  private liveWaiters: Array<Waiter<void>> = []
  private barrierWaiters: Array<Waiter<RoomBarrier>> = []
  public lastError: { code: string; message: string } | null = null

  constructor(options: SessionRoomClientOptions) {
    this.transport = options.transport
    this.connector = options.connect
    this.getToken = options.getToken
    this.onAcknowledged = options.onAcknowledged
    this.onStateChange = options.onStateChange
    this.liveTimeoutMs = options.liveTimeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS
  }

  get state(): RoomClientState {
    return this.clientState
  }

  get pendingBatchCount(): number {
    return this.pending.size
  }

  /** Connects and resolves once replay has caught up and unacknowledged batches were resent. */
  connect(): Promise<void> {
    if (this.clientState === "live") return Promise.resolve()
    if (!this.connecting) {
      this.connecting = this.openConnection().finally(() => {
        this.connecting = null
      })
    }
    return this.connecting
  }

  disconnect(): void {
    const connection = this.connection
    if (!connection) return
    this.handleClose(connection)
    connection.close()
  }

  /**
   * Exports local CRDT changes as one encrypted batch and sends it when live; while
   * offline it waits in the pending list. Returns the batchId, or null when nothing changed.
   */
  submitLocalChanges(): string | null {
    const batch = this.transport.replica.exportBatch()
    if (!batch) return null
    this.submitBatch(batch)
    return batch.batchId
  }

  /** Queues an exported batch; it goes out now when live, otherwise on the next connect. */
  submitBatch(batch: CollaborationBatch): void {
    if (this.pending.has(batch.batchId)) return
    const encrypted = this.transport.encryptBatch(batch)
    this.pending.set(batch.batchId, encrypted)
    if (this.clientState === "live") {
      this.sendBatch(batch.batchId, encrypted)
    }
  }

  /** Asks the room for a barrier at its current sequence (Section 15.3). */
  requestBarrier(): Promise<RoomBarrier> {
    if (!this.connection || this.clientState !== "live") {
      return Promise.reject(new Error("Connect to the session room before requesting a barrier"))
    }
    const barrier = new Promise<RoomBarrier>((resolve, reject) => this.barrierWaiters.push({ resolve, reject }))
    this.connection.send(JSON.stringify({ type: "barrier_request" }))
    return barrier
  }

  private async openConnection(): Promise<void> {
    this.setState("connecting")
    this.lastError = null

    let connection: RoomConnection | null = null
    let token: string
    try {
      token = await this.getToken()
      connection = await this.connector({
        onMessage: (data) => this.handleMessage(data),
        onClose: () => this.handleClose(connection),
      })
    } catch (error) {
      this.setState("disconnected")
      throw error
    }
    this.connection = connection

    const live = this.waitForLive()
    connection.send(
      JSON.stringify({
        type: "hello",
        token,
        clientId: this.transport.replica.clientId,
        protocolVersion: SESSION_ROOM_PROTOCOL_VERSION,
      }),
    )

    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("The session room did not finish syncing in time")), this.liveTimeoutMs)
    })
    try {
      await Promise.race([live, timeout])
    } catch (error) {
      this.disconnect()
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private waitForLive(): Promise<void> {
    return new Promise<void>((resolve, reject) => this.liveWaiters.push({ resolve, reject }))
  }

  private handleMessage(data: string): void {
    let message: ServerMessage
    try {
      message = JSON.parse(data) as ServerMessage
    } catch {
      return
    }

    switch (message.type) {
      case "ready":
        this.setState("syncing")
        this.requestSync(this.transport.lastAppliedSessionSeq)
        return
      case "sync_delta":
        for (const batch of message.batches) this.applyWireBatch(batch)
        if (message.batches.length > 0 && message.toSeq < message.headSeq) {
          this.requestSync(message.toSeq)
          return
        }
        this.becomeLive()
        return
      case "batch_ack":
        this.transport.acknowledgeLocalBatch(message.sessionSeq)
        if (this.pending.delete(message.batchId)) {
          this.onAcknowledged?.(message.batchId, message.sessionSeq)
        }
        return
      case "session_batch":
        this.applyWireBatch(message.batch)
        return
      case "barrier_ack":
        this.barrierWaiters.shift()?.resolve(message.barrier)
        return
      case "error":
        this.lastError = { code: message.code, message: message.message }
        if (!message.recoverable) {
          this.failWaiters(new Error(`${message.code}: ${message.message}`))
        }
        return
    }
  }

  private becomeLive(): void {
    this.setState("live")
    for (const [batchId, encrypted] of this.pending) {
      this.sendBatch(batchId, encrypted)
    }
    for (const waiter of this.liveWaiters.splice(0)) waiter.resolve()
  }

  private applyWireBatch(batch: WireBatch): void {
    try {
      this.transport.receiveEncryptedBatch(batch.sessionSeq, batch.encryptedPayload)
    } catch (error) {
      // Left unapplied, so the watermark stays below it and the next replay retries it.
      this.lastError = {
        code: "BATCH_REJECTED",
        message: `Batch ${batch.batchId} at ${batch.sessionSeq} could not be applied: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }
  }

  private requestSync(knownSeq: number): void {
    this.connection?.send(JSON.stringify({ type: "sync_request", knownSeq }))
  }

  private sendBatch(batchId: string, encryptedPayload: string): void {
    this.connection?.send(JSON.stringify({ type: "submit_batch", batchId, encryptedPayload }))
  }

  private handleClose(connection: RoomConnection | null): void {
    if (!connection || connection !== this.connection) return
    this.connection = null
    this.setState("disconnected")
    this.failWaiters(new Error("The session room connection closed"))
  }

  private failWaiters(error: Error): void {
    for (const waiter of this.liveWaiters.splice(0)) waiter.reject(error)
    for (const waiter of this.barrierWaiters.splice(0)) waiter.reject(error)
  }

  private setState(state: RoomClientState): void {
    if (this.clientState === state) return
    this.clientState = state
    this.onStateChange?.(state)
  }
}

interface MinimalWebSocket {
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
}

/** Connector for the real room, using the runtime's global WebSocket. */
export function webSocketRoomConnector(url: string): RoomConnector {
  return (handlers) =>
    new Promise<RoomConnection>((resolve, reject) => {
      const WebSocketImpl = (globalThis as { WebSocket?: new (url: string) => MinimalWebSocket }).WebSocket
      if (!WebSocketImpl) {
        reject(new Error("This runtime has no WebSocket implementation"))
        return
      }
      const socket = new WebSocketImpl(url)
      let opened = false
      socket.onopen = () => {
        opened = true
        resolve({ send: (data) => socket.send(data), close: () => socket.close() })
      }
      socket.onmessage = (event) => {
        handlers.onMessage(typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf8"))
      }
      socket.onclose = () => {
        if (opened) handlers.onClose()
        else reject(new Error(`Could not connect to ${url}`))
      }
      socket.onerror = () => {
        if (!opened) reject(new Error(`Could not connect to ${url}`))
      }
    })
}
