import type { ProjectdDatabase } from "../storage/Database"
import { LocalSessionCipher, type LocalSessionCipherOptions } from "./LocalSessionCipher"
import type { ReplicaSnapshot } from "./SessionReplica"

const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024

export interface StoredReplicaSnapshot {
  sequence: number
  replica: ReplicaSnapshot
}

/** Atomic encrypted local checkpoint. An invalid record is retained for recovery. */
export class LocalReplicaStore {
  private readonly cipher: LocalSessionCipher
  private readonly db: ProjectdDatabase

  constructor(db: ProjectdDatabase, keys: LocalSessionCipherOptions) {
    this.db = db
    this.cipher = new LocalSessionCipher(keys)
    db.db.exec(`CREATE TABLE IF NOT EXISTS local_replica_snapshots (
      session_id TEXT PRIMARY KEY, session_seq INTEGER NOT NULL, envelope TEXT NOT NULL
    )`)
  }

  save(snapshot: StoredReplicaSnapshot): void {
    this.validate(snapshot)
    const json = JSON.stringify(snapshot.replica, (_, value) => value instanceof Uint8Array
      ? { __b64: Buffer.from(value).toString("base64") } : value)
    if (Buffer.byteLength(json) > MAX_SNAPSHOT_BYTES) throw new Error("Local replica snapshot exceeds storage budget")
    const envelope = this.cipher.seal(json, `replica-snapshot:${snapshot.sequence}`)
    this.db.db.prepare(`INSERT INTO local_replica_snapshots VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET session_seq=excluded.session_seq, envelope=excluded.envelope`)
      .run(this.cipher.sessionId, snapshot.sequence, envelope)
  }

  load(): StoredReplicaSnapshot | null {
    const size = this.db.db.prepare("SELECT length(envelope) AS size FROM local_replica_snapshots WHERE session_id=?")
      .get(this.cipher.sessionId) as { size: number } | undefined
    if (!size) return null
    if (size.size > MAX_SNAPSHOT_BYTES * 2) throw new Error("Local replica snapshot exceeds storage budget")
    const row = this.db.db.prepare("SELECT session_seq, envelope FROM local_replica_snapshots WHERE session_id=?")
      .get(this.cipher.sessionId) as { session_seq: number; envelope: string }
    const json = this.cipher.open(row.envelope, `replica-snapshot:${row.session_seq}`)
    const replica = JSON.parse(json, (_, value) => value && typeof value === "object" && typeof value.__b64 === "string"
      ? new Uint8Array(Buffer.from(value.__b64, "base64")) : value) as ReplicaSnapshot
    const result = { sequence: row.session_seq, replica }
    this.validate(result)
    return result
  }

  private validate(snapshot: StoredReplicaSnapshot): void {
    if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0 ||
      snapshot.replica.sessionId !== this.cipher.sessionId || !(snapshot.replica.treeUpdate instanceof Uint8Array) ||
      !snapshot.replica.textUpdates || Object.values(snapshot.replica.textUpdates).some((value) => !(value instanceof Uint8Array)) ||
      !Array.isArray(snapshot.replica.binaryRevisions)) {
      throw new Error("Invalid local replica snapshot")
    }
  }
}
