import type { ProjectId, WorkspaceId } from "@shared/collaboration"
import type { ProjectdDatabase } from "../storage/Database"
import type { WorkspaceRecord } from "./WorkspaceCatalogImporter"

export class WorkspaceRegistry {
  readonly db: ProjectdDatabase

  constructor(db: ProjectdDatabase) {
    this.db = db
  }

  async get(workspaceId: WorkspaceId): Promise<WorkspaceRecord | null> {
    const stmt = this.db.db.prepare("SELECT * FROM workspaces WHERE workspace_id = ?")
    const row = stmt.get(workspaceId) as any
    return row ? this.rowToRecord(row) : null
  }

  async listByProject(projectId: ProjectId): Promise<WorkspaceRecord[]> {
    const stmt = this.db.db.prepare("SELECT * FROM workspaces WHERE project_id = ? ORDER BY updated_at DESC")
    const rows = stmt.all(projectId) as any[]
    return rows.map((r) => this.rowToRecord(r))
  }

  async registerWorkspace(params: {
    workspaceId: WorkspaceId
    projectId: ProjectId
    rootPath: string
    projectRootPath?: string
    gitRootPath?: string | null
    gitOriginUrl?: string | null
    source: string
    storageOwnership?: "managed" | "attached"
    managedRootId?: string | null
  }): Promise<WorkspaceRecord> {
    const now = Date.now()
    const stmt = this.db.db.prepare(`
      INSERT INTO workspaces (
        workspace_id, project_id, root_path, project_root_path,
        git_root_path, git_origin_url, source, storage_ownership,
        managed_root_id, created_at, updated_at, last_opened_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        last_opened_at = excluded.last_opened_at
    `)

    stmt.run(
      params.workspaceId,
      params.projectId,
      params.rootPath,
      params.projectRootPath ?? params.rootPath,
      params.gitRootPath ?? null,
      params.gitOriginUrl ?? null,
      params.source,
      params.storageOwnership ?? "attached",
      params.managedRootId ?? null,
      now,
      now,
      now,
    )

    const created = await this.get(params.workspaceId)
    return created!
  }

  async touchLastOpened(workspaceId: WorkspaceId): Promise<void> {
    const stmt = this.db.db.prepare(
      "UPDATE workspaces SET last_opened_at = ?, updated_at = ? WHERE workspace_id = ?",
    )
    const now = Date.now()
    stmt.run(now, now, workspaceId)
  }

  async delete(workspaceId: WorkspaceId): Promise<boolean> {
    const checkWb = this.db.db.prepare(
      "SELECT 1 FROM local_workbenches WHERE workspace_id = ? AND lifecycle != 'closed' LIMIT 1",
    )
    if (checkWb.get(workspaceId)) {
      throw new Error(`Cannot delete workspace '${workspaceId}': active workbenches still reference it`)
    }

    const stmt = this.db.db.prepare("DELETE FROM workspaces WHERE workspace_id = ?")
    const res = stmt.run(workspaceId)
    return res.changes > 0
  }

  private rowToRecord(row: any): WorkspaceRecord {
    return {
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      rootPath: String(row.root_path),
      projectRootRelativePath: String(row.project_root_relative_path ?? "."),
      projectRootPath: String(row.project_root_path),
      gitRootPath: row.git_root_path ? String(row.git_root_path) : null,
      gitOriginUrl: row.git_origin_url ? String(row.git_origin_url) : null,
      source: String(row.source),
      storageOwnership: row.storage_ownership === "managed" ? "managed" : "attached",
      managedRootId: row.managed_root_id ? String(row.managed_root_id) : null,
      markerPolicy: String(row.marker_policy ?? "none"),
      isActive: Boolean(row.is_active),
      workspaceRevision: Number(row.workspace_revision) || 1,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      lastOpenedAt: row.last_opened_at ? Number(row.last_opened_at) : null,
    }
  }
}
