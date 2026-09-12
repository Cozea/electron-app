/**
 * Daemon-side client for the session room.
 *
 * Master Specification: Section 13.1 - 13.10, 14.5 - 14.7, 15.3
 * Speaks the session-room protocol over any WebSocket-like connection: authenticates
 * with a session token, replays from the transport's contiguous watermark, resends
 * batches the room never acknowledged, and applies peers' batches as they arrive.
 * The room deduplicates by batchId, so a resend after a lost acknowledgement cannot
 * create a second copy.
 *
 * It also carries AutoGit's side of the protocol: whether this daemon can push, the
 * leader lease, barriers, checkpoint records, and members' requests to save now.
 */

import type { CollaborationBatch } from "./SessionReplica"
import type { SessionTransport } from "./SessionTransport"

/** Must match SESSION_ROOM_PROTOCOL_VERSION in cloudflare/worker/src/durableObjects/CollaborationSessionRoom.ts. */
export const SESSION_ROOM_PROTOCOL_VERSION = "session-room/1"
const DEFAULT_LIVE_TIMEOUT_MS = 30_000
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

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
  leaseGeneration: number
}

/** Which daemon may push the session branch. The generation only grows (Section 14.5). */
export interface RoomLease {
  generation: number
  leaderClientId: string | null
  leaderPrincipalId: string | null
  expiresAt: number
  /** Why the leader stopped saving, when it did. */
  notice?: string | null
  /** What kind of stop the notice describes, such as ENV_NOT_IGNORED. */
  noticeCode?: string | null
}

/** The last checkpoint pushed to the session branch (Section 15.10). */
export interface RoomCheckpoint {
  commitOid: string
  parentOid: string | null
  treeOid: string
  sessionSeq: number
  barrierId: string
  logicalTreeHash: string
  leaseGeneration: number
  publishedAt: number
  publishedByPrincipalId: string
  /** The branch still holds the session at this later sequence; absent from older rooms. */
  savedThroughSeq?: number
  /** An explicit rebase rewrote the branch, replacing this commit; carried until the next rebase. */
  rebasedFrom?: string
}

export type RoomCheckpointInput = Pick<
  RoomCheckpoint,
  "commitOid" | "parentOid" | "treeOid" | "sessionSeq" | "barrierId" | "logicalTreeHash" | "rebasedFrom"
>

export interface RoomAutoGitState {
  lease: RoomLease | null
  checkpoint: RoomCheckpoint | null
  serverTime: number
}

/** The room refused one request, or did not answer it. */
export class RoomRequestError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "RoomRequestError"
    this.code = code
  }
}

interface WireBatch {
  sessionSeq: number
  batchId: string
  clientId: string
  encryptedPayload: string
}

type RequestReply =
  | { type: "barrier_ack"; requestId?: string; barrier: RoomBarrier }
  | { type: "lease_ack"; requestId?: string; lease: RoomLease }
  | { type: "checkpoint_ack"; requestId?: string; checkpoint: RoomCheckpoint }
  | { type: "checkpoint_clean_ack"; requestId?: string; checkpoint: RoomCheckpoint }
  | { type: "checkpoint_request_ack"; requestId?: string; routed: boolean }
  | { type: "rebase_request_ack"; requestId?: string; routed: boolean }

type ServerMessage =
  | RequestReply
  | { type: "ready"; headSeq: number }
  | { type: "sync_delta"; toSeq: number; headSeq: number; batches: WireBatch[] }
  | { type: "batch_ack"; batchId: string; sessionSeq: number; duplicate: boolean }
  | { type: "session_batch"; batch: WireBatch }
  | { type: "autogit_state"; lease: RoomLease | null; checkpoint: RoomCheckpoint | null; serverTime: number }
  | { type: "checkpoint_requested"; requestedByPrincipalId: string | null }
  | { type: "rebase_requested"; requestedByPrincipalId: string | null; allowConflicts?: boolean }
  | { type: "error"; code: string; message: string; recoverable?: boolean; requestId?: string }

type ReplyOf<K extends RequestReply["type"]> = Extract<RequestReply, { type: K }>

interface Waiter<T> {
  resolve(value: T): void
  reject(error: Error): void
}

interface PendingRequest {
  expected: RequestReply["type"]
  resolve(reply: RequestReply): void
  reject(error: Error): void
  timer: NodeJS.Timeout
  /** Runs while the reply is handled, before any later message is applied. */
  onReply?: (reply: RequestReply) => void
}

export interface SessionRoomClientOptions {
  transport: SessionTransport
  connect: RoomConnector
  getToken: () => Promise<string>
  /** Called when the room assigns a sequence to one of this client's batches. */
  onAcknowledged?: (batchId: string, sessionSeq: number) => void
  onStateChange?: (state: RoomClientState) => void
  /** Called with the room's AutoGit lease and last checkpoint on connect and whenever either changes. */
  onAutoGitState?: (state: RoomAutoGitState) => void
  /** Called on the leader when a member asks for a checkpoint now. */
  onCheckpointRequested?: (requestedByPrincipalId: string | null) => void
  /** Called on the leader when a member asks to rebase the session onto its target. */
  onRebaseRequested?: (allowConflicts: boolean, requestedByPrincipalId: string | null) => void
  /** How long connect() waits for replay to finish before giving up. */
  liveTimeoutMs?: number
  /** How long a request waits for the room's answer. */
  requestTimeoutMs?: number
}

export class SessionRoomClient {
  readonly transport: SessionTransport
  private readonly connector: RoomConnector
  private readonly getToken: () => Promise<string>
  private readonly onAcknowledged?: (batchId: string, sessionSeq: number) => void
  private readonly onStateChange?: (state: RoomClientState) => void
  private readonly onAutoGitState?: (state: RoomAutoGitState) => void
  private readonly onCheckpointRequested?: (requestedByPrincipalId: string | null) => void
  private readonly onRebaseRequested?: (allowConflicts: boolean, requestedByPrincipalId: string | null) => void
  private readonly liveTimeoutMs: number
  private readonly requestTimeoutMs: number

  private connection: RoomConnection | null = null
  private connecting: Promise<void> | null = null
  private clientState: RoomClientState = "disconnected"
  // Encrypted batches the room has not acknowledged, in submission order.
  private readonly pending = new Map<string, string>()
  private liveWaiters: Array<Waiter<void>> = []
  private readonly requests = new Map<string, PendingRequest>()
  private requestCounter = 0
  private autoGitEligible: boolean | null = null
  private lastAutoGitState: RoomAutoGitState | null = null
  public lastError: { code: string; message: string } | null = null

  constructor(options: SessionRoomClientOptions) {
    this.transport = options.transport
    this.connector = options.connect
    this.getToken = options.getToken
    this.onAcknowledged = options.onAcknowledged
    this.onStateChange = options.onStateChange
    this.onAutoGitState = options.onAutoGitState
    this.onCheckpointRequested = options.onCheckpointRequested
    this.onRebaseRequested = options.onRebaseRequested
    this.liveTimeoutMs = options.liveTimeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  get state(): RoomClientState {
    return this.clientState
  }

  get pendingBatchCount(): number {
    return this.pending.size
  }

  /** The id this daemon's replica goes by in the room; the lease names it. */
  get clientId(): string {
    return this.transport.replica.clientId
  }

  /** The room's AutoGit lease and last checkpoint, as of the last message about them. */
  get autoGitState(): RoomAutoGitState | null {
    return this.lastAutoGitState
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

  // ─── AutoGit (Section 14, 15) ────────────────────────────────────────────────

  /** Tells the room whether this daemon can push the session branch; sent again after each reconnect. */
  setAutoGitEligibility(eligible: boolean): void {
    this.autoGitEligible = eligible
    if (this.clientState === "live") this.sendEligibility()
  }

  /** Extends this daemon's lease. The room refuses with LEASE_STALE once it has moved on (Section 14.6). */
  async renewLease(generation: number): Promise<RoomLease> {
    return (await this.request("lease_ack", { type: "lease_renew", generation })).lease
  }

  /** Gives the lease up now, so the room elects another device without waiting for it to run out. */
  releaseLease(generation: number): void {
    if (this.clientState !== "live") return
    this.connection?.send(JSON.stringify({ type: "lease_release", generation }))
  }

  /** Tells every member why the leader stopped saving, and what kind of stop it is; null clears it. */
  setLeaderNotice(generation: number, notice: string | null, code: string | null = null): void {
    if (this.clientState !== "live") return
    this.connection?.send(JSON.stringify({ type: "lease_notice", generation, notice, code }))
  }

  /**
   * Asks the room for a barrier at its current sequence (Section 15.3). `onBarrier`
   * runs as the answer arrives, before any later batch is applied, so it sees this
   * replica exactly at the barrier.
   */
  async requestBarrier(generation: number, onBarrier?: (barrier: RoomBarrier) => void): Promise<RoomBarrier> {
    const reply = await this.request(
      "barrier_ack",
      { type: "barrier_request", generation },
      onBarrier ? (answer) => onBarrier(answer.barrier) : undefined,
    )
    return reply.barrier
  }

  /** Records a pushed checkpoint in the room, which tells every member (Section 15.10). */
  async publishCheckpoint(generation: number, checkpoint: RoomCheckpointInput): Promise<RoomCheckpoint> {
    return (await this.request("checkpoint_ack", { type: "checkpoint_publish", generation, checkpoint })).checkpoint
  }

  /**
   * Records that the last checkpoint still holds the session at this barrier: Git had
   * nothing new to take, as after an edit to an ignored env file.
   */
  async markSavedThrough(generation: number, barrierId: string): Promise<RoomCheckpoint> {
    return (await this.request("checkpoint_clean_ack", { type: "checkpoint_clean", generation, barrierId })).checkpoint
  }

  /** Asks the leader for a checkpoint now. False when no device leads. */
  async requestCheckpoint(): Promise<boolean> {
    return (await this.request("checkpoint_request_ack", { type: "checkpoint_request" })).routed
  }

  /** Asks the leader to rebase the session onto its target. False when no device leads. */
  async requestRebase(allowConflicts: boolean): Promise<boolean> {
    return (await this.request("rebase_request_ack", { type: "rebase_request", allowConflicts })).routed
  }

  private request<K extends RequestReply["type"]>(
    expected: K,
    message: Record<string, unknown>,
    onReply?: (reply: ReplyOf<K>) => void,
  ): Promise<ReplyOf<K>> {
    const connection = this.connection
    if (!connection || this.clientState !== "live") {
      return Promise.reject(new RoomRequestError("NOT_CONNECTED", "The session room is not connected"))
    }
    this.requestCounter += 1
    const requestId = `req_${this.requestCounter}`
    return new Promise<ReplyOf<K>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(requestId)
        reject(new RoomRequestError("TIMEOUT", `The session room did not answer ${String(message.type)}`))
      }, this.requestTimeoutMs)
      this.requests.set(requestId, {
        expected,
        resolve: resolve as (reply: RequestReply) => void,
        reject,
        timer,
        onReply: onReply as ((reply: RequestReply) => void) | undefined,
      })
      connection.send(JSON.stringify({ ...message, requestId }))
    })
  }

  private settleRequest(reply: RequestReply): void {
    const pending = reply.requestId ? this.requests.get(reply.requestId) : undefined
    if (!pending || !reply.requestId) return
    this.requests.delete(reply.requestId)
    clearTimeout(pending.timer)
    if (reply.type !== pending.expected) {
      pending.reject(new RoomRequestError("BAD_REPLY", `Expected ${pending.expected}, got ${reply.type}`))
      return
    }
    try {
      pending.onReply?.(reply)
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    pending.resolve(reply)
  }

  private rejectRequest(requestId: string, error: Error): boolean {
    const pending = this.requests.get(requestId)
    if (!pending) return false
    this.requests.delete(requestId)
    clearTimeout(pending.timer)
    pending.reject(error)
    return true
  }

  private sendEligibility(): void {
    if (this.autoGitEligible === null) return
    this.connection?.send(JSON.stringify({ type: "autogit_eligibility", eligible: this.autoGitEligible }))
  }

  // ─── Connection ──────────────────────────────────────────────────────────────

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
      case "lease_ack":
      case "checkpoint_ack":
      case "checkpoint_clean_ack":
      case "checkpoint_request_ack":
      case "rebase_request_ack":
        this.settleRequest(message)
        return
      case "autogit_state":
        this.lastAutoGitState = {
          lease: message.lease ?? null,
          checkpoint: message.checkpoint ?? null,
          serverTime: message.serverTime,
        }
        this.onAutoGitState?.(this.lastAutoGitState)
        return
      case "checkpoint_requested":
        this.onCheckpointRequested?.(message.requestedByPrincipalId ?? null)
        return
      case "rebase_requested":
        this.onRebaseRequested?.(message.allowConflicts === true, message.requestedByPrincipalId ?? null)
        return
      case "error":
        // A refused request belongs to its caller, not to the connection.
        if (message.requestId && this.rejectRequest(message.requestId, new RoomRequestError(message.code, message.message))) {
          return
        }
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
    this.sendEligibility()
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
    for (const [requestId, pending] of this.requests) {
      this.requests.delete(requestId)
      clearTimeout(pending.timer)
      pending.reject(new RoomRequestError("NOT_CONNECTED", error.message))
    }
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
