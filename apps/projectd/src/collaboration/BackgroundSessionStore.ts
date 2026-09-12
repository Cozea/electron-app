import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"
import type { ProjectdSessionAttachParams, ProjectdSessionRecoveryEntry } from "@cozea/projectd-protocol"
import type { ProjectdDatabase } from "../storage/Database"
import type { StoredDeviceIdentity } from "../identity/BackgroundDeviceIdentity"

export interface BackgroundSessionDescriptor extends ProjectdSessionAttachParams {
  background: { gatewayUrl: string; convexUrl: string }
}
export type BackgroundSessionIntent = Omit<BackgroundSessionDescriptor, "ticket" | "roomKeyBase64"> &
  Partial<Pick<BackgroundSessionDescriptor, "ticket" | "roomKeyBase64">>

/** Joined-session intent survives process shutdown; explicit leave removes it. */
export class BackgroundSessionStore {
  private readonly database: ProjectdDatabase

  constructor(database: ProjectdDatabase) {
    this.database = database
    database.db.exec(`CREATE TABLE IF NOT EXISTS background_sessions (
      session_id TEXT PRIMARY KEY, identity_key TEXT NOT NULL, envelope BLOB NOT NULL
    )`)
    database.db.exec(`CREATE TABLE IF NOT EXISTS background_session_recovery (
      session_id TEXT PRIMARY KEY, identity_key TEXT NOT NULL, envelope BLOB NOT NULL
    )`)
    database.db.exec(`CREATE TABLE IF NOT EXISTS background_session_access (
      session_id TEXT NOT NULL, identity_key TEXT NOT NULL, generation INTEGER NOT NULL, denied INTEGER NOT NULL,
      PRIMARY KEY (session_id, identity_key)
    )`)
  }

  accessState(sessionId: string, identity: StoredDeviceIdentity): { generation: number; denied: boolean } {
    const row = this.database.db.prepare("SELECT generation, denied FROM background_session_access WHERE session_id=? AND identity_key=?")
      .get(sessionId, identity.identityKey) as { generation: number; denied: number } | undefined
    return { generation: row?.generation ?? 0, denied: row?.denied === 1 }
  }

  denyAccess(sessionId: string, identity: StoredDeviceIdentity): void {
    this.database.db.prepare(`INSERT INTO background_session_access VALUES (?, ?, 1, 1)
      ON CONFLICT(session_id, identity_key) DO UPDATE SET generation=generation+1, denied=1`)
      .run(sessionId, identity.identityKey)
  }

  /** Only an auth attempt started after the most recent denial may clear it. */
  acceptFreshAccess(sessionId: string, identity: StoredDeviceIdentity, expectedGeneration: number): boolean {
    if (this.accessState(sessionId, identity).generation !== expectedGeneration) return false
    this.database.db.prepare("UPDATE background_session_access SET denied=0 WHERE session_id=? AND identity_key=?")
      .run(sessionId, identity.identityKey)
    return true
  }

  private key(identity: StoredDeviceIdentity): Buffer {
    return Buffer.from(hkdfSync("sha256", Buffer.from(identity.signingPrivateKeyJwk.d!, "base64url"),
      identity.identityKey, "cozea-projectd-background-sessions-v1", 32))
  }

  save(descriptor: BackgroundSessionIntent, identity: StoredDeviceIdentity): void {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", this.key(identity), iv)
    cipher.setAAD(Buffer.from(descriptor.publicSessionId))
    const content = Buffer.concat([cipher.update(JSON.stringify(descriptor), "utf8"), cipher.final()])
    const envelope = Buffer.concat([iv, cipher.getAuthTag(), content])
    this.database.db.prepare(`INSERT INTO background_sessions VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET identity_key=excluded.identity_key, envelope=excluded.envelope`)
      .run(descriptor.publicSessionId, identity.identityKey, envelope)
  }

  list(identity: StoredDeviceIdentity): BackgroundSessionIntent[] {
    return this.readRecords(identity, "background_sessions")
  }

  findActive(publicSessionId: string, identity: StoredDeviceIdentity): BackgroundSessionIntent | null {
    const row = this.database.db.prepare("SELECT session_id, envelope FROM background_sessions WHERE session_id=? AND identity_key=?")
      .get(publicSessionId, identity.identityKey) as { session_id: string; envelope: Uint8Array } | undefined
    return row ? this.decryptRecord(row, identity) : null
  }

  /** Retained credentials can decrypt local work after Leave, but never autojoin. */
  listRecovery(identity: StoredDeviceIdentity): BackgroundSessionIntent[] {
    return this.readRecords(identity, "background_session_recovery")
  }

  /** Select exactly one device-owned record; unrelated damage must not block recovery. */
  findRecovery(publicSessionId: string, identity: StoredDeviceIdentity): BackgroundSessionIntent | null {
    for (const table of ["background_sessions", "background_session_recovery"] as const) {
      const row = this.database.db.prepare(`SELECT session_id, envelope FROM ${table} WHERE session_id=? AND identity_key=?`)
        .get(publicSessionId, identity.identityKey) as { session_id: string; envelope: Uint8Array } | undefined
      if (row) return this.decryptRecord(row, identity)
    }
    return null
  }

  /** A damaged descriptor remains visible without hiding unrelated recovery records. */
  discoverRecovery(identity: StoredDeviceIdentity): ProjectdSessionRecoveryEntry[] {
    const entries = new Map<string, ProjectdSessionRecoveryEntry>()
    const hasStagedBinaries = Boolean(this.database.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pending_binary_versions'").get())
    const hasSnapshots = Boolean(this.database.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_replica_snapshots'").get())
    for (const [table, source] of [["background_sessions", "joined"], ["background_session_recovery", "left"]] as const) {
      const rows = this.database.db.prepare(`SELECT session_id, envelope FROM ${table} WHERE identity_key=? ORDER BY session_id`)
        .all(identity.identityKey) as Array<{ session_id: string; envelope: Uint8Array }>
      for (const row of rows) {
        if (entries.has(row.session_id)) continue
        let descriptor: BackgroundSessionIntent | null = null
        try { descriptor = this.decryptRecord(row, identity) } catch { /* Retain an explicit unreadable entry. */ }
        const pending = this.database.db.prepare(`SELECT count(*) AS count FROM outbound_batches
          WHERE session_id=? AND state IN ('pending', 'sent')`).get(row.session_id) as { count: number }
        const snapshot = hasSnapshots ? this.database.db.prepare("SELECT session_seq FROM local_replica_snapshots WHERE session_id=?")
          .get(row.session_id) as { session_seq: number } | undefined : undefined
        entries.set(row.session_id, { publicSessionId: row.session_id,
          projectId: descriptor?.projectId ?? null, workspaceId: descriptor?.workspaceId ?? null,
          branchName: descriptor?.branchName ?? null, source, descriptorState: descriptor ? "readable" : "unreadable",
          hasRetainedKey: typeof descriptor?.roomKeyBase64 === "string" && Buffer.from(descriptor.roomKeyBase64, "base64").length === 32,
          requiresOnlineVerification: this.accessState(row.session_id, identity).denied,
          pendingBatches: pending.count,
          pendingBinaryVersions: hasStagedBinaries ? (this.database.db.prepare("SELECT count(*) AS count FROM pending_binary_versions WHERE session_id=?")
            .get(row.session_id) as { count: number }).count : 0,
          snapshotSequence: snapshot && Number.isSafeInteger(snapshot.session_seq) && snapshot.session_seq >= 0 ? snapshot.session_seq : null })
      }
    }
    return [...entries.values()]
  }

  private decryptRecord(row: { session_id: string; envelope: Uint8Array }, identity: StoredDeviceIdentity): BackgroundSessionIntent {
    const bytes = Buffer.from(row.envelope)
    const decipher = createDecipheriv("aes-256-gcm", this.key(identity), bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(12, 28))
    decipher.setAAD(Buffer.from(row.session_id))
    const descriptor = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as BackgroundSessionIntent
    if (descriptor.publicSessionId !== row.session_id) throw new Error("Background session identity mismatch")
    return descriptor
  }

  private readRecords(identity: StoredDeviceIdentity,
    table: "background_sessions" | "background_session_recovery"): BackgroundSessionIntent[] {
    const rows = this.database.db.prepare(`SELECT session_id, envelope FROM ${table} WHERE identity_key=?`)
      .all(identity.identityKey) as Array<{ session_id: string; envelope: Uint8Array }>
    return rows.map((row) => this.decryptRecord(row, identity))
  }

  remove(publicSessionId: string): void {
    // Leaving removes autojoin authority, not the keys needed to recover an
    // unacknowledged local journal. The descriptor stays device-encrypted.
    this.database.db.exec("BEGIN IMMEDIATE")
    try {
      this.database.db.prepare(`INSERT OR REPLACE INTO background_session_recovery
        SELECT session_id, identity_key, envelope FROM background_sessions WHERE session_id=?`).run(publicSessionId)
      this.database.db.prepare("DELETE FROM background_sessions WHERE session_id=?").run(publicSessionId)
      this.database.db.exec("COMMIT")
    } catch (error) {
      this.database.db.exec("ROLLBACK")
      throw error
    }
  }
}
