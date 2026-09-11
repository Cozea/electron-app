import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export function getDefaultProjectdDbPath(): string {
  if (process.env.COZEA_PROJECTD_DB) {
    return process.env.COZEA_PROJECTD_DB
  }
  const appSupport = path.join(os.homedir(), "Library/Application Support/Cozea")
  return path.join(appSupport, "projectd.sqlite")
}

export class ProjectdDatabase {
  readonly dbPath: string
  readonly db: DatabaseSync

  constructor(customPath?: string) {
    this.dbPath = customPath ?? getDefaultProjectdDbPath()

    // Ensure directory exists if not memory
    if (this.dbPath !== ":memory:") {
      const dir = path.dirname(this.dbPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }

    this.db = new DatabaseSync(this.dbPath)
    this.initPragmas()
    this.initSchema()
  }

  private initPragmas(): void {
    if (this.dbPath !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;")
    }
    this.db.exec("PRAGMA foreign_keys = ON;")
    this.db.exec("PRAGMA busy_timeout = 5000;")
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _projectd_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        root_path TEXT NOT NULL,
        project_root_relative_path TEXT NOT NULL DEFAULT '',
        project_root_path TEXT NOT NULL,
        git_root_path TEXT,
        git_origin_url TEXT,
        source TEXT NOT NULL,
        storage_ownership TEXT NOT NULL DEFAULT 'attached',
        managed_root_id TEXT,
        marker_policy TEXT NOT NULL DEFAULT 'none',
        is_active INTEGER NOT NULL DEFAULT 0,
        workspace_revision INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_opened_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_id);

      CREATE TABLE IF NOT EXISTS local_workbenches (
        workbench_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        workspace_revision INTEGER NOT NULL DEFAULT 1,
        kind TEXT NOT NULL,
        branch_name TEXT,
        session_id TEXT,
        lifecycle TEXT NOT NULL,
        title TEXT NOT NULL,
        presentation_ref TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_activated_at INTEGER,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_workbenches_project ON local_workbenches(project_id);
      CREATE INDEX IF NOT EXISTS idx_workbenches_workspace ON local_workbenches(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workbenches_lifecycle ON local_workbenches(lifecycle);

      CREATE TABLE IF NOT EXISTS session_bindings (
        session_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        repository_binding_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        target_branch TEXT NOT NULL,
        last_applied_session_seq INTEGER NOT NULL DEFAULT 0,
        last_durable_session_seq INTEGER NOT NULL DEFAULT 0,
        last_git_checkpoint_seq INTEGER,
        last_git_checkpoint_oid TEXT,
        connection_state TEXT NOT NULL DEFAULT 'disconnected',
        key_version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_session_bindings_project ON session_bindings(project_id);

      CREATE TABLE IF NOT EXISTS file_materializations (
        session_id TEXT NOT NULL,
        file_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        mode INTEGER NOT NULL DEFAULT 420,
        disk_hash TEXT NOT NULL,
        disk_size INTEGER NOT NULL DEFAULT 0,
        disk_mtime_ms INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'materialized',
        PRIMARY KEY(session_id, file_id)
      );
      CREATE INDEX IF NOT EXISTS idx_file_mat_path ON file_materializations(session_id, relative_path);

      CREATE TABLE IF NOT EXISTS path_index (
        session_id TEXT NOT NULL,
        normalized_path TEXT NOT NULL,
        file_id TEXT NOT NULL,
        display_path TEXT NOT NULL,
        conflict_state TEXT NOT NULL DEFAULT 'clean',
        PRIMARY KEY(session_id, normalized_path, file_id)
      );

      CREATE TABLE IF NOT EXISTS outbound_batches (
        batch_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        local_order INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        acked_session_seq INTEGER,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_outbound_session_state ON outbound_batches(session_id, state);
    `)
  }

  close(): void {
    this.db.close()
  }
}
