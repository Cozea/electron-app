import { createHash } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import type { ProjectdDatabase } from "../storage/Database"
import { CHUNK_SIZE_BYTES } from "./BinaryContentCache"
import { LocalSessionCipher, type LocalSessionCipherOptions } from "./LocalSessionCipher"

export interface PendingBinaryIntent {
  path: string
  fileId: string | null
  baseRevisionId: string | null
  mode: number
}

export interface PendingBinaryRecord extends PendingBinaryIntent {
  revisionId: string
  contentHash: string
  size: number
  createdAt: number
  chunks: number
}

export interface PendingBinarySource {
  contentHash: string
  size: number
  read(offset: number, length: number): Promise<Buffer>
}

/** Durable encrypted versions captured before cloud upload or disk-index advancement. */
export class PendingBinaryStore {
  private readonly database: ProjectdDatabase
  private readonly cipher: LocalSessionCipher

  constructor(database: ProjectdDatabase, keys: LocalSessionCipherOptions) {
    this.database = database
    this.cipher = new LocalSessionCipher(keys)
    database.db.exec(`CREATE TABLE IF NOT EXISTS pending_binary_versions (
      session_id TEXT NOT NULL, revision_id TEXT NOT NULL, envelope TEXT NOT NULL,
      PRIMARY KEY (session_id, revision_id)
    );
    CREATE TABLE IF NOT EXISTS pending_binary_chunks (
      session_id TEXT NOT NULL, revision_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, envelope TEXT NOT NULL,
      PRIMARY KEY (session_id, revision_id, chunk_index)
    )`)
  }

  stage(intent: PendingBinaryIntent, bytes: Buffer): PendingBinaryRecord {
    const contentHash = hash(bytes)
    const revisionId = stagedRevisionId(intent, contentHash)
    const existing = this.readRecord(revisionId)
    if (existing) {
      // Do not silently bless a damaged previous write as a durable retry.
      this.verifyRecord(existing)
      return existing
    }
    const record: PendingBinaryRecord = { ...intent, revisionId, contentHash, size: bytes.length,
      createdAt: Date.now(), chunks: Math.ceil(bytes.length / CHUNK_SIZE_BYTES) }
    const db = this.database.db
    db.exec("BEGIN IMMEDIATE")
    try {
      db.prepare("INSERT INTO pending_binary_versions VALUES (?, ?, ?)").run(this.cipher.sessionId, revisionId,
        this.cipher.seal(JSON.stringify(record), `binary-intent:${revisionId}`))
      const insert = db.prepare("INSERT INTO pending_binary_chunks VALUES (?, ?, ?, ?)")
      for (let index = 0; index < record.chunks; index++) {
        const chunk = bytes.subarray(index * CHUNK_SIZE_BYTES, (index + 1) * CHUNK_SIZE_BYTES)
        insert.run(this.cipher.sessionId, revisionId, index,
          this.cipher.seal(chunk.toString("base64"), `binary-chunk:${revisionId}:${index}`))
      }
      db.exec("COMMIT")
      return record
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }

  /**
   * Captures a stable source without ever assembling the full payload in memory.
   * Chunk rows are written first and the version row is the commit marker. A crash
   * before that final row leaves only invisible orphan chunks, which the next retry
   * deletes before starting again.
   */
  async stageFrom(intent: PendingBinaryIntent, source: PendingBinarySource): Promise<PendingBinaryRecord> {
    if (!/^[a-f0-9]{64}$/.test(source.contentHash) || !Number.isSafeInteger(source.size) || source.size < 0) {
      throw new Error("Invalid retained binary source metadata")
    }
    const revisionId = stagedRevisionId(intent, source.contentHash)
    const existing = this.readRecord(revisionId)
    if (existing) {
      if (existing.size !== source.size || existing.contentHash !== source.contentHash) {
        throw new Error("Retained binary retry metadata changed")
      }
      this.verifyRecord(existing)
      return existing
    }

    const record: PendingBinaryRecord = {
      ...intent,
      revisionId,
      contentHash: source.contentHash,
      size: source.size,
      createdAt: Date.now(),
      chunks: Math.ceil(source.size / CHUNK_SIZE_BYTES),
    }
    const db = this.database.db
    db.prepare("DELETE FROM pending_binary_chunks WHERE session_id=? AND revision_id=?")
      .run(this.cipher.sessionId, revisionId)
    const insert = db.prepare("INSERT INTO pending_binary_chunks VALUES (?, ?, ?, ?)")
    const digest = createHash("sha256")
    let offset = 0
    try {
      for (let index = 0; index < record.chunks; index++) {
        const length = Math.min(CHUNK_SIZE_BYTES, record.size - offset)
        const chunk = await source.read(offset, length)
        if (!Buffer.isBuffer(chunk) || chunk.length !== length) {
          throw new Error("Retained binary source returned an incomplete chunk")
        }
        digest.update(chunk)
        insert.run(
          this.cipher.sessionId,
          revisionId,
          index,
          this.cipher.seal(chunk.toString("base64"), `binary-chunk:${revisionId}:${index}`),
        )
        offset += chunk.length
      }
      if (offset !== record.size || digest.digest("hex") !== record.contentHash) {
        throw new Error("Retained binary source changed while it was being captured")
      }
      db.prepare("INSERT INTO pending_binary_versions VALUES (?, ?, ?)").run(
        this.cipher.sessionId,
        revisionId,
        this.cipher.seal(JSON.stringify(record), `binary-intent:${revisionId}`),
      )
      return record
    } catch (error) {
      db.prepare("DELETE FROM pending_binary_versions WHERE session_id=? AND revision_id=?")
        .run(this.cipher.sessionId, revisionId)
      db.prepare("DELETE FROM pending_binary_chunks WHERE session_id=? AND revision_id=?")
        .run(this.cipher.sessionId, revisionId)
      throw error
    }
  }

  count(): number {
    return (this.database.db.prepare("SELECT count(*) AS count FROM pending_binary_versions WHERE session_id=?")
      .get(this.cipher.sessionId) as { count: number }).count
  }

  list(): PendingBinaryRecord[] {
    const rows = this.database.db.prepare("SELECT revision_id FROM pending_binary_versions WHERE session_id=? ORDER BY rowid")
      .all(this.cipher.sessionId) as Array<{ revision_id: string }>
    return rows.map((row) => this.readRecord(row.revision_id)!)
  }

  /** Streams a retained version in fixed-size chunks and verifies the whole revision. */
  async writeTo(record: PendingBinaryRecord, write: (chunk: Buffer) => Promise<void>): Promise<void> {
    const digest = createHash("sha256")
    let size = 0
    for (let index = 0; index < record.chunks; index++) {
      const chunk = this.readChunk(record, index, size)
      digest.update(chunk)
      size += chunk.length
      await write(chunk)
    }
    if (size !== record.size || digest.digest("hex") !== record.contentHash) {
      throw new Error("Retained binary content failed verification")
    }
  }

  readBytes(record: PendingBinaryRecord): Buffer {
    const chunks: Buffer[] = []
    let size = 0
    for (let index = 0; index < record.chunks; index++) {
      const chunk = this.readChunk(record, index, size)
      size += chunk.length
      chunks.push(chunk)
    }
    const bytes = Buffer.concat(chunks)
    if (bytes.length !== record.size || hash(bytes) !== record.contentHash) throw new Error("Retained binary content failed verification")
    return bytes
  }

  /** Synchronously captures encrypted chunks before the exporter yields. SQLite
   * owns the temporary disk file and removes it when this capture is closed. */
  captureForExport(): {
    records: PendingBinaryRecord[]
    writeTo: (record: PendingBinaryRecord, write: (chunk: Buffer) => Promise<void>) => Promise<void>
    close: () => void
  } {
    const captured = new DatabaseSync("")
    try {
      captured.exec("CREATE TABLE chunks (revision_id TEXT, chunk_index INTEGER, envelope TEXT, PRIMARY KEY(revision_id, chunk_index))")
      const records = this.list()
      const insert = captured.prepare("INSERT INTO chunks VALUES (?, ?, ?)")
      const rows = this.database.db.prepare("SELECT revision_id, chunk_index, envelope FROM pending_binary_chunks WHERE session_id=?")
      captured.exec("BEGIN")
      for (const row of rows.iterate(this.cipher.sessionId)) {
        insert.run(row.revision_id, row.chunk_index, row.envelope)
      }
      captured.exec("COMMIT")
      return { records, close: () => captured.close(), writeTo: async (record, write) => {
        const digest = createHash("sha256")
        let size = 0
        for (let index = 0; index < record.chunks; index++) {
          const row = captured.prepare("SELECT envelope FROM chunks WHERE revision_id=? AND chunk_index=?")
            .get(record.revisionId, index) as { envelope: string } | undefined
          if (!row) throw new Error("A retained binary chunk is missing")
          const chunk = Buffer.from(this.cipher.open(row.envelope, `binary-chunk:${record.revisionId}:${index}`), "base64")
          if (chunk.length !== Math.min(CHUNK_SIZE_BYTES, record.size - size)) throw new Error("A retained binary chunk has the wrong size")
          digest.update(chunk)
          size += chunk.length
          await write(chunk)
        }
        if (size !== record.size || digest.digest("hex") !== record.contentHash) throw new Error("Retained binary content failed verification")
      } }
    } catch (error) { captured.close(); throw error }
  }

  /** Only after the exact revision is durably represented in the replica/outbox. */
  remove(revisionId: string): void {
    const db = this.database.db
    db.exec("BEGIN IMMEDIATE")
    try {
      db.prepare("DELETE FROM pending_binary_chunks WHERE session_id=? AND revision_id=?").run(this.cipher.sessionId, revisionId)
      db.prepare("DELETE FROM pending_binary_versions WHERE session_id=? AND revision_id=?").run(this.cipher.sessionId, revisionId)
      db.exec("COMMIT")
    } catch (error) { db.exec("ROLLBACK"); throw error }
  }

  private verifyRecord(record: PendingBinaryRecord): void {
    const digest = createHash("sha256")
    let size = 0
    for (let index = 0; index < record.chunks; index++) {
      const chunk = this.readChunk(record, index, size)
      digest.update(chunk)
      size += chunk.length
    }
    if (size !== record.size || digest.digest("hex") !== record.contentHash) {
      throw new Error("Retained binary content failed verification")
    }
  }

  private readChunk(record: PendingBinaryRecord, index: number, consumed: number): Buffer {
    const row = this.database.db.prepare("SELECT envelope FROM pending_binary_chunks WHERE session_id=? AND revision_id=? AND chunk_index=?")
      .get(this.cipher.sessionId, record.revisionId, index) as { envelope: string } | undefined
    if (!row) throw new Error("A retained binary chunk is missing")
    const chunk = Buffer.from(this.cipher.open(row.envelope, `binary-chunk:${record.revisionId}:${index}`), "base64")
    if (chunk.length !== Math.min(CHUNK_SIZE_BYTES, record.size - consumed)) {
      throw new Error("A retained binary chunk has the wrong size")
    }
    return chunk
  }

  private readRecord(revisionId: string): PendingBinaryRecord | null {
    const row = this.database.db.prepare("SELECT envelope FROM pending_binary_versions WHERE session_id=? AND revision_id=?")
      .get(this.cipher.sessionId, revisionId) as { envelope: string } | undefined
    if (!row) return null
    const record = JSON.parse(this.cipher.open(row.envelope, `binary-intent:${revisionId}`)) as PendingBinaryRecord
    if (record.revisionId !== revisionId || typeof record.path !== "string" || !Number.isSafeInteger(record.size) ||
      record.size < 0 || record.chunks !== Math.ceil(record.size / CHUNK_SIZE_BYTES) || !/^[a-f0-9]{64}$/.test(record.contentHash)) {
      throw new Error("Invalid retained binary intent")
    }
    return record
  }
}

function stagedRevisionId(intent: PendingBinaryIntent, contentHash: string): string {
  return `staged_${hash(Buffer.from(JSON.stringify([
    intent.path,
    intent.fileId,
    intent.baseRevisionId,
    intent.mode,
    contentHash,
  ])))}`
}

function hash(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex") }
