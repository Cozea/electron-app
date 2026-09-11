/**
 * Materialization index and hash-based echo classification.
 *
 * Master Specification: Section 9.3, 9.4, 12.7
 * Invariants:
 * - C14: No time-based echo suppression. Echo detection uses exact materialized hash.
 * - C17: Tree identity is stable. File identity survives rename/move.
 * - C18: Path collisions create explicit conflict state.
 */

import type { ProjectdDatabase } from "../storage/Database"

export interface MaterializedEntry {
  sessionId: string
  fileId: string
  relativePath: string
  kind: "text" | "binary" | "symlink"
  mode: number
  diskHash: string
  diskSize: number
  diskMtimeMs: number
  state: "materialized" | "dirty_local" | "conflict"
}

export interface PathIndexEntry {
  sessionId: string
  normalizedPath: string
  fileId: string
  displayPath: string
  conflictState: "clean" | "collision"
}

export class MaterializationIndex {
  readonly db: ProjectdDatabase

  constructor(db: ProjectdDatabase) {
    this.db = db
  }

  normalizePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "")
  }

  recordMaterialization(entry: MaterializedEntry): void {
    const normalized = this.normalizePath(entry.relativePath)

    this.db.db.exec("BEGIN TRANSACTION;")
    try {
      const upsertMat = this.db.db.prepare(`
        INSERT INTO file_materializations (
          session_id, file_id, relative_path, kind, mode, disk_hash, disk_size, disk_mtime_ms, state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, file_id) DO UPDATE SET
          relative_path = excluded.relative_path,
          kind = excluded.kind,
          mode = excluded.mode,
          disk_hash = excluded.disk_hash,
          disk_size = excluded.disk_size,
          disk_mtime_ms = excluded.disk_mtime_ms,
          state = excluded.state
      `)

      upsertMat.run(
        entry.sessionId,
        entry.fileId,
        entry.relativePath,
        entry.kind,
        entry.mode,
        entry.diskHash,
        entry.diskSize,
        entry.diskMtimeMs,
        entry.state,
      )

      // Clean up previous path_index for this fileId
      const delPath = this.db.db.prepare(
        "DELETE FROM path_index WHERE session_id = ? AND file_id = ?",
      )
      delPath.run(entry.sessionId, entry.fileId)

      // Check if another fileId already claims this normalized path (Path collision!)
      const checkCollision = this.db.db.prepare(
        "SELECT file_id FROM path_index WHERE session_id = ? AND normalized_path = ? AND file_id != ?",
      )
      const existingCollision = checkCollision.get(entry.sessionId, normalized, entry.fileId) as any

      const conflictState = existingCollision ? "collision" : "clean"

      const insertPath = this.db.db.prepare(`
        INSERT INTO path_index (session_id, normalized_path, file_id, display_path, conflict_state)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_id, normalized_path, file_id) DO UPDATE SET
          display_path = excluded.display_path,
          conflict_state = excluded.conflict_state
      `)
      insertPath.run(entry.sessionId, normalized, entry.fileId, entry.relativePath, conflictState)

      if (existingCollision) {
        // Mark existing entry as collision as well
        this.db.db
          .prepare(
            "UPDATE path_index SET conflict_state = 'collision' WHERE session_id = ? AND normalized_path = ?",
          )
          .run(entry.sessionId, normalized)
      }

      this.db.db.exec("COMMIT;")
    } catch (err) {
      this.db.db.exec("ROLLBACK;")
      throw err
    }
  }

  getByFileId(sessionId: string, fileId: string): MaterializedEntry | null {
    const stmt = this.db.db.prepare(
      "SELECT * FROM file_materializations WHERE session_id = ? AND file_id = ?",
    )
    const row = stmt.get(sessionId, fileId) as any
    return row ? this.rowToEntry(row) : null
  }

  getByPath(sessionId: string, relativePath: string): MaterializedEntry | null {
    const normalized = this.normalizePath(relativePath)
    const stmt = this.db.db.prepare(`
      SELECT m.* FROM file_materializations m
      JOIN path_index p ON m.session_id = p.session_id AND m.file_id = p.file_id
      WHERE p.session_id = ? AND p.normalized_path = ?
      LIMIT 1
    `)
    const row = stmt.get(sessionId, normalized) as any
    return row ? this.rowToEntry(row) : null
  }

  /**
   * Hash-based echo classification (Section 12.7, Invariant C14).
   *
   * True if disk bytes equal exact materialized hash.
   * False if bytes differ (genuine local modification).
   * Zero clocks or time window checks.
   */
  isEcho(sessionId: string, relativePath: string, currentDiskHash: string): boolean {
    const entry = this.getByPath(sessionId, relativePath)
    if (!entry) return false
    return entry.diskHash === currentDiskHash
  }

  list(sessionId: string): MaterializedEntry[] {
    const stmt = this.db.db.prepare(
      "SELECT * FROM file_materializations WHERE session_id = ? ORDER BY relative_path ASC",
    )
    const rows = stmt.all(sessionId) as any[]
    return rows.map((r) => this.rowToEntry(r))
  }

  remove(sessionId: string, fileId: string): void {
    this.db.db.exec("BEGIN TRANSACTION;")
    try {
      this.db.db
        .prepare("DELETE FROM file_materializations WHERE session_id = ? AND file_id = ?")
        .run(sessionId, fileId)
      this.db.db
        .prepare("DELETE FROM path_index WHERE session_id = ? AND file_id = ?")
        .run(sessionId, fileId)
      this.db.db.exec("COMMIT;")
    } catch (err) {
      this.db.db.exec("ROLLBACK;")
      throw err
    }
  }

  /** Forgets what was written for a session, as before its first attach. */
  clearSession(sessionId: string): void {
    this.db.db.exec("BEGIN TRANSACTION;")
    try {
      this.db.db.prepare("DELETE FROM file_materializations WHERE session_id = ?").run(sessionId)
      this.db.db.prepare("DELETE FROM path_index WHERE session_id = ?").run(sessionId)
      this.db.db.exec("COMMIT;")
    } catch (err) {
      this.db.db.exec("ROLLBACK;")
      throw err
    }
  }

  private rowToEntry(row: any): MaterializedEntry {
    return {
      sessionId: String(row.session_id),
      fileId: String(row.file_id),
      relativePath: String(row.relative_path),
      kind: row.kind,
      mode: Number(row.mode),
      diskHash: String(row.disk_hash),
      diskSize: Number(row.disk_size),
      diskMtimeMs: Number(row.disk_mtime_ms),
      state: row.state,
    }
  }
}
