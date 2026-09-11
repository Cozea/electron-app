/**
 * Durable SQLite-backed outbound batch queue.
 *
 * Master Specification: Section 9.5, 13.9, 13.10
 * Guarantees that local collaboration batches survive process restarts and
 * network disconnections without data loss.
 */

import type { ProjectdDatabase } from "../storage/Database"
import type { CollaborationBatch } from "./SessionReplica"

export interface QueuedBatch {
  readonly batchId: string
  readonly sessionId: string
  readonly state: "pending" | "sent" | "acked" | "failed"
  readonly localOrder: number
  readonly batch: CollaborationBatch
  readonly createdAt: number
  readonly ackedSessionSeq?: number | null
  readonly retryCount: number
  readonly lastError?: string | null
}

export class OutboundBatchQueue {
  readonly db: ProjectdDatabase

  constructor(db: ProjectdDatabase) {
    this.db = db
  }

  enqueue(batch: CollaborationBatch): void {
    const orderStmt = this.db.db.prepare(
      "SELECT COALESCE(MAX(local_order), 0) + 1 AS next_order FROM outbound_batches WHERE session_id = ?",
    )
    const nextOrder = (orderStmt.get(batch.sessionId) as any)?.next_order ?? 1

    // Serialize operations with base64 for binary buffers
    const serializedPayload = JSON.stringify(batch, (_, val) => {
      if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
        return { __b64: Buffer.from(val).toString("base64") }
      }
      return val
    })

    const stmt = this.db.db.prepare(`
      INSERT INTO outbound_batches (
        batch_id, session_id, created_at, state, local_order, payload_json, retry_count
      ) VALUES (?, ?, ?, 'pending', ?, ?, 0)
    `)

    stmt.run(batch.batchId, batch.sessionId, batch.createdAt, nextOrder, serializedPayload)
  }

  getPendingBatches(sessionId: string): QueuedBatch[] {
    const stmt = this.db.db.prepare(
      "SELECT * FROM outbound_batches WHERE session_id = ? AND state IN ('pending', 'sent') ORDER BY local_order ASC",
    )
    const rows = stmt.all(sessionId) as any[]
    return rows.map((r) => this.rowToQueuedBatch(r))
  }

  markSent(batchId: string): void {
    const stmt = this.db.db.prepare(
      "UPDATE outbound_batches SET state = 'sent', retry_count = retry_count + 1 WHERE batch_id = ?",
    )
    stmt.run(batchId)
  }

  markAcked(batchId: string, sessionSeq: number): void {
    const stmt = this.db.db.prepare(
      "UPDATE outbound_batches SET state = 'acked', acked_session_seq = ? WHERE batch_id = ?",
    )
    stmt.run(sessionSeq, batchId)
  }

  /** Deletes a session's acknowledged batches: the room holds them from then on. */
  pruneAcked(sessionId: string): number {
    const result = this.db.db
      .prepare("DELETE FROM outbound_batches WHERE session_id = ? AND state = 'acked'")
      .run(sessionId)
    return Number(result.changes)
  }

  markFailed(batchId: string, error: string): void {
    const stmt = this.db.db.prepare(
      "UPDATE outbound_batches SET state = 'failed', last_error = ? WHERE batch_id = ?",
    )
    stmt.run(error, batchId)
  }

  private rowToQueuedBatch(row: any): QueuedBatch {
    const batch = JSON.parse(row.payload_json, (_, val) => {
      if (val && typeof val === "object" && val.__b64) {
        return new Uint8Array(Buffer.from(val.__b64, "base64"))
      }
      return val
    }) as CollaborationBatch

    return {
      batchId: String(row.batch_id),
      sessionId: String(row.session_id),
      state: row.state,
      localOrder: Number(row.local_order),
      batch,
      createdAt: Number(row.created_at),
      ackedSessionSeq: row.acked_session_seq ? Number(row.acked_session_seq) : null,
      retryCount: Number(row.retry_count),
      lastError: row.last_error ? String(row.last_error) : null,
    }
  }
}
