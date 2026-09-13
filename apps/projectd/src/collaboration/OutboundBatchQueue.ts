/**
 * Durable SQLite-backed outbound batch queue.
 *
 * Master Specification: Section 9.5, 13.9, 13.10
 * Guarantees that local collaboration batches survive process restarts and
 * network disconnections without data loss.
 */

import type { ProjectdDatabase } from "../storage/Database"
import type { CollaborationBatch } from "./SessionReplica"
import { LocalSessionCipher, type LocalSessionCipherOptions } from "./LocalSessionCipher"

interface QueueRow {
  batch_id: string
  session_id: string
  state: QueuedBatch["state"]
  local_order: number
  payload_json: string
  created_at: number
  acked_session_seq: number | null
  retry_count: number
  last_error: string | null
}

export interface IntegrationIntent { adoptionId: string; barrierId: string; generation: number }

export interface QueuedBatch {
  readonly batchId: string
  readonly sessionId: string
  readonly state: "pending" | "sent" | "acked" | "failed" | "integration"
  readonly integration?: IntegrationIntent
  readonly localOrder: number
  readonly batch: CollaborationBatch
  readonly createdAt: number
  readonly ackedSessionSeq?: number | null
  readonly retryCount: number
  readonly lastError?: string | null
}

export class OutboundBatchQueue {
  readonly db: ProjectdDatabase
  private readonly cipher: LocalSessionCipher

  constructor(db: ProjectdDatabase, keys: LocalSessionCipherOptions) {
    this.db = db
    this.cipher = new LocalSessionCipher(keys)
  }

  enqueue(batch: CollaborationBatch, integration?: IntegrationIntent): void {
    this.assertSession(batch.sessionId)
    const orderStmt = this.db.db.prepare(
      "SELECT COALESCE(MAX(local_order), 0) + 1 AS next_order FROM outbound_batches WHERE session_id = ?",
    )
    const nextOrder = (orderStmt.get(batch.sessionId) as { next_order: number }).next_order

    // Serialize operations with base64 for binary buffers
    const serializedPayload = JSON.stringify({ ...batch, ...(integration ? { integration } : {}) }, (_, val) => {
      if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
        return { __b64: Buffer.from(val).toString("base64") }
      }
      return val
    })

    const stmt = this.db.db.prepare(`
      INSERT INTO outbound_batches (
        batch_id, session_id, created_at, state, local_order, payload_json, retry_count
      ) VALUES (?, ?, ?, ?, ?, ?, 0)
    `)

    const envelope = this.cipher.seal(serializedPayload, this.context(batch.batchId, nextOrder, batch.createdAt))
    stmt.run(batch.batchId, batch.sessionId, batch.createdAt, integration ? "integration" : "pending", nextOrder, envelope)
  }

  pendingCount(sessionId: string): number {
    this.assertSession(sessionId)
    return (this.db.db.prepare("SELECT count(*) AS count FROM outbound_batches WHERE session_id=? AND state IN ('pending', 'sent')")
      .get(sessionId) as { count: number }).count
  }

  getPendingBatches(sessionId: string, migrateLegacy = true): QueuedBatch[] {
    this.assertSession(sessionId)
    const stmt = this.db.db.prepare(
      "SELECT * FROM outbound_batches WHERE session_id = ? AND state IN ('pending', 'sent') ORDER BY local_order ASC",
    )
    const rows = stmt.all(sessionId) as unknown as QueueRow[]
    return rows.map((r) => this.rowToQueuedBatch(r, migrateLegacy))
  }

  getIntegrationBatches(sessionId: string): QueuedBatch[] {
    this.assertSession(sessionId)
    const rows = this.db.db.prepare("SELECT * FROM outbound_batches WHERE session_id=? AND state='integration' ORDER BY local_order").all(sessionId) as unknown as QueueRow[]
    return rows.map((row) => this.rowToQueuedBatch(row))
  }

  removeIntegration(batchId: string): void {
    this.db.db.prepare("DELETE FROM outbound_batches WHERE batch_id=? AND session_id=? AND state='integration'").run(batchId, this.cipher.sessionId)
  }

  markSent(batchId: string): void {
    const stmt = this.db.db.prepare(
      "UPDATE outbound_batches SET state = 'sent', retry_count = retry_count + 1 WHERE batch_id = ? AND state IN ('pending', 'sent', 'failed')",
    )
    stmt.run(batchId)
  }

  markAcked(batchId: string, sessionSeq: number): void {
    const stmt = this.db.db.prepare(
      "UPDATE outbound_batches SET state = 'acked', acked_session_seq = ? WHERE batch_id = ? AND state IN ('pending', 'sent', 'failed')",
    )
    stmt.run(sessionSeq, batchId)
  }

  /** Deletes a session's acknowledged batches: the room holds them from then on. */
  pruneAcked(sessionId: string): number {
    this.assertSession(sessionId)
    const result = this.db.db
      .prepare("DELETE FROM outbound_batches WHERE session_id = ? AND state = 'acked'")
      .run(sessionId)
    return Number(result.changes)
  }

  markFailed(batchId: string, error: string): void {
    const stmt = this.db.db.prepare(
      "UPDATE outbound_batches SET state = 'failed', last_error = ? WHERE batch_id = ? AND state IN ('pending', 'sent', 'failed')",
    )
    stmt.run(error, batchId)
  }

  private assertSession(sessionId: string): void {
    if (sessionId !== this.cipher.sessionId) throw new Error("Outbound queue session mismatch")
  }

  private context(batchId: string, order: number, createdAt: number): string {
    return JSON.stringify(["outbound-batch", batchId, order, createdAt])
  }

  private rowToQueuedBatch(row: QueueRow, migrateLegacy = true): QueuedBatch {
    this.assertSession(row.session_id)
    const context = this.context(row.batch_id, row.local_order, row.created_at)
    const legacy = !row.payload_json.startsWith("czenc1:")
    const plaintext = legacy ? row.payload_json : this.cipher.open(row.payload_json, context)
    const batch = JSON.parse(plaintext, (_, val) => {
      if (val && typeof val === "object" && val.__b64) {
        return new Uint8Array(Buffer.from(val.__b64, "base64"))
      }
      return val
    }) as CollaborationBatch & { integration?: IntegrationIntent }
    if (batch.batchId !== row.batch_id || batch.sessionId !== row.session_id || batch.createdAt !== row.created_at ||
      !Array.isArray(batch.operations) || typeof batch.clientId !== "string") {
      throw new Error("Outbound recovery batch identity mismatch")
    }
    const integration = batch.integration
    if (integration && row.state !== "integration") throw new Error("Staged integration cannot replay as an ordinary batch")
    if (row.state === "integration" && (!integration || !/^[a-f0-9-]{36}$/.test(integration.adoptionId) ||
      !/^[a-f0-9-]{36}$/.test(integration.barrierId) || !Number.isSafeInteger(integration.generation) || integration.generation < 1)) throw new Error("Invalid retained integration intent")
    // Upgrade a retained pre-cutover batch before exposing it to replay. Never
    // discard pending work just because its on-disk format predates encryption.
    if (legacy && migrateLegacy) {
      this.db.db.prepare("UPDATE outbound_batches SET payload_json=? WHERE batch_id=? AND session_id=?")
        .run(this.cipher.seal(plaintext, context), row.batch_id, row.session_id)
    }

    return {
      batchId: String(row.batch_id),
      sessionId: String(row.session_id),
      state: row.state,
      localOrder: Number(row.local_order),
      ...(integration ? { integration } : {}),
      batch,
      createdAt: Number(row.created_at),
      ackedSessionSeq: row.acked_session_seq === null ? null : Number(row.acked_session_seq),
      retryCount: Number(row.retry_count),
      lastError: row.last_error ? String(row.last_error) : null,
    }
  }
}
