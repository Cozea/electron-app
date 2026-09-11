/**
 * Session-scoped Durable Object for Collaboration & AutoGit.
 *
 * Master Specification: Section 13.1 - 13.10, 14.5, 15.3
 * Responsibilities:
 * - Session room identity: session:<sessionId> (Section 13.1)
 * - WebSocket Hibernation (Section 13.2)
 * - Global monotonic sessionSeq (Section 13.3)
 * - Batch idempotency (Section 13.10)
 * - AutoGit leader lease coordination (Section 14.5)
 * - CRDT barrier creation (Section 15.3)
 * - Durable update log and replay cursor (Section 13.6 - 13.8)
 */

export interface StoredSessionBatch {
  sessionSeq: number
  batchId: string
  clientId: string
  encryptedPayload: string // Base64 encoded E2EE payload
  serverTime: number
}

export interface StoredBarrier {
  barrierId: string
  sessionSeq: number
  serverTime: number
}

export interface StoredAutoGitLease {
  leaderIdentityKey: string
  leaseGeneration: number
  leaseExpiresAt: number
  lastRenewedAt: number
}

export class CollaborationSessionRoom {
  private readonly state: DurableObjectState
  private readonly sockets = new Set<WebSocket>()
  private currentSeq = 0
  private lease: StoredAutoGitLease | null = null
  private initialized = false

  constructor(state: DurableObjectState) {
    this.state = state
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return

    const storedSeq = await this.state.storage.get<number>("currentSeq")
    this.currentSeq = storedSeq ?? 0

    const storedLease = await this.state.storage.get<StoredAutoGitLease>("lease")
    this.lease = storedLease ?? null

    this.initialized = true
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized()

    const url = new URL(request.url)

    // Handle WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      this.state.acceptWebSocket(server)
      this.sockets.add(server)
      server.send(
        JSON.stringify({
          type: "session_ready",
          currentSeq: this.currentSeq,
          lease: this.lease,
          serverTime: Date.now(),
        }),
      )

      return new Response(null, { status: 101, webSocket: client })
    }

    if (url.pathname === "/batch" && request.method === "POST") {
      const body = (await request.json()) as any
      const result = await this.acceptBatch(body)
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.pathname === "/barrier" && request.method === "POST") {
      const result = await this.createBarrier()
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.pathname === "/replay" && request.method === "GET") {
      const fromSeq = Number(url.searchParams.get("fromSeq")) || 0
      const batches = await this.getBatchesAfter(fromSeq)
      return new Response(JSON.stringify({ batches, currentSeq: this.currentSeq }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    return new Response("Not found", { status: 404 })
  }

  async acceptBatch(batch: {
    batchId: string
    clientId: string
    encryptedPayload: string
  }): Promise<{ sessionSeq: number; duplicate: boolean }> {
    // Section 13.10: Idempotency check
    const existingSeq = await this.state.storage.get<number>(`idemp:${batch.batchId}`)
    if (existingSeq !== undefined) {
      return { sessionSeq: existingSeq, duplicate: true }
    }

    this.currentSeq += 1
    const sessionSeq = this.currentSeq

    const storedBatch: StoredSessionBatch = {
      sessionSeq,
      batchId: batch.batchId,
      clientId: batch.clientId,
      encryptedPayload: batch.encryptedPayload,
      serverTime: Date.now(),
    }

    await this.state.storage.put(`batch:${sessionSeq}`, storedBatch)
    await this.state.storage.put(`idemp:${batch.batchId}`, sessionSeq)
    await this.state.storage.put("currentSeq", sessionSeq)

    // Broadcast to connected WebSocket participants
    const broadcastPayload = JSON.stringify({
      type: "session_batch",
      sessionSeq,
      batch: storedBatch,
    })

    for (const ws of this.sockets) {
      try {
        ws.send(broadcastPayload)
      } catch {
        // Closed
      }
    }

    return { sessionSeq, duplicate: false }
  }

  async getBatchesAfter(fromSeq: number): Promise<StoredSessionBatch[]> {
    const batches: StoredSessionBatch[] = []
    for (let s = fromSeq + 1; s <= this.currentSeq; s++) {
      const b = await this.state.storage.get<StoredSessionBatch>(`batch:${s}`)
      if (b) {
        batches.push(b)
      }
    }
    return batches
  }

  async createBarrier(): Promise<StoredBarrier> {
    const barrierId = `barrier_${crypto.randomUUID().slice(0, 12)}`
    const barrier: StoredBarrier = {
      barrierId,
      sessionSeq: this.currentSeq,
      serverTime: Date.now(),
    }

    await this.state.storage.put(`barrier:${barrierId}`, barrier)
    return barrier
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message)
    try {
      const parsed = JSON.parse(text)
      if (parsed.type === "sync_request") {
        const fromSeq = Number(parsed.knownSeq) || 0
        const batches = await this.getBatchesAfter(fromSeq)
        ws.send(
          JSON.stringify({
            type: "sync_delta",
            fromSeq,
            toSeq: this.currentSeq,
            batches,
          }),
        )
      } else if (parsed.type === "submit_batch") {
        const res = await this.acceptBatch(parsed.batch)
        ws.send(
          JSON.stringify({
            type: "batch_ack",
            batchId: parsed.batch.batchId,
            sessionSeq: res.sessionSeq,
            duplicate: res.duplicate,
          }),
        )
      } else if (parsed.type === "barrier_request") {
        const barrier = await this.createBarrier()
        ws.send(
          JSON.stringify({
            type: "barrier_ack",
            barrier,
          }),
        )
      }
    } catch (err: any) {
      ws.send(JSON.stringify({ type: "error", error: err.message }))
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.sockets.delete(ws)
    ws.close()
  }

  webSocketError(ws: WebSocket): void {
    this.sockets.delete(ws)
    ws.close()
  }
}
