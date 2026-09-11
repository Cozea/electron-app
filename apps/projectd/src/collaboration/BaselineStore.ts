/**
 * Materialization baseline store for snapshot-anchored ingress.
 *
 * Master Specification: Section 10.11
 * Stores exact materialized text B, its Yjs state vector, and snapshot update.
 * Given a database, baselines survive a daemon restart, so an edit made while the
 * daemon was down still diffs against the bytes it last wrote instead of
 * replacing the file wholesale.
 */

import { createHash } from "node:crypto"

import type { ProjectdDatabase } from "../storage/Database"

export interface TextBaseline {
  readonly fileId: string
  readonly text: string
  readonly contentHash: string
  readonly stateVector: Uint8Array
  readonly snapshotUpdate: Uint8Array
  readonly updatedAt: number
}

export interface BaselinePersistence {
  db: ProjectdDatabase
  sessionId: string
}

interface BaselineRow {
  file_id: string
  text: string
  content_hash: string
  state_vector: Uint8Array
  snapshot_update: Uint8Array
  updated_at: number
}

export class BaselineStore {
  private readonly baselines = new Map<string, TextBaseline>()
  private readonly persistence?: BaselinePersistence

  constructor(persistence?: BaselinePersistence) {
    this.persistence = persistence
    if (persistence) {
      this.load(persistence)
    }
  }

  setBaseline(params: {
    fileId: string
    text: string
    stateVector: Uint8Array
    snapshotUpdate: Uint8Array
    contentHash?: string
  }): TextBaseline {
    const contentHash =
      params.contentHash ?? createHash("sha256").update(params.text).digest("hex")

    const baseline: TextBaseline = {
      fileId: params.fileId,
      text: params.text,
      contentHash,
      stateVector: params.stateVector,
      snapshotUpdate: params.snapshotUpdate,
      updatedAt: Date.now(),
    }

    this.baselines.set(params.fileId, baseline)
    if (this.persistence) {
      this.persistence.db.db
        .prepare(`
          INSERT INTO text_baselines (
            session_id, file_id, text, content_hash, state_vector, snapshot_update, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id, file_id) DO UPDATE SET
            text = excluded.text,
            content_hash = excluded.content_hash,
            state_vector = excluded.state_vector,
            snapshot_update = excluded.snapshot_update,
            updated_at = excluded.updated_at
        `)
        .run(
          this.persistence.sessionId,
          baseline.fileId,
          baseline.text,
          baseline.contentHash,
          baseline.stateVector,
          baseline.snapshotUpdate,
          baseline.updatedAt,
        )
    }
    return baseline
  }

  getBaseline(fileId: string): TextBaseline | null {
    return this.baselines.get(fileId) ?? null
  }

  hasBaseline(fileId: string): boolean {
    return this.baselines.has(fileId)
  }

  deleteBaseline(fileId: string): boolean {
    const existed = this.baselines.delete(fileId)
    if (this.persistence) {
      this.persistence.db.db
        .prepare("DELETE FROM text_baselines WHERE session_id = ? AND file_id = ?")
        .run(this.persistence.sessionId, fileId)
    }
    return existed
  }

  clear(): void {
    this.baselines.clear()
    if (this.persistence) {
      this.persistence.db.db
        .prepare("DELETE FROM text_baselines WHERE session_id = ?")
        .run(this.persistence.sessionId)
    }
  }

  private load({ db, sessionId }: BaselinePersistence): void {
    const rows = db.db
      .prepare(
        "SELECT file_id, text, content_hash, state_vector, snapshot_update, updated_at FROM text_baselines WHERE session_id = ?",
      )
      .all(sessionId) as unknown as BaselineRow[]
    for (const row of rows) {
      this.baselines.set(row.file_id, {
        fileId: row.file_id,
        text: row.text,
        contentHash: row.content_hash,
        stateVector: new Uint8Array(row.state_vector),
        snapshotUpdate: new Uint8Array(row.snapshot_update),
        updatedAt: Number(row.updated_at),
      })
    }
  }
}
