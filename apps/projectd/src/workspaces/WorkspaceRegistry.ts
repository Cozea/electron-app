import type { ProjectId, WorkspaceId } from "@shared/collaboration"
import type { SQLOutputValue } from "node:sqlite"
import { isProjectdProjectRemovalRequest, type ProjectdProjectRemovalRequest, isProjectdWorkspaceRegistration, isProjectdWorkspaceCloseRequest, type ProjectdWorkspaceCloseRequest, type ProjectdWorkspaceRegistration } from "@shared/projectdWorkspaceTypes"
import type { ProjectdDatabase } from "../storage/Database"
import type { WorkspaceRecord } from "./WorkspaceCatalogImporter"

export class WorkspaceRegistry {
  readonly db: ProjectdDatabase

  constructor(db: ProjectdDatabase) {
    this.db = db
  }

  async get(workspaceId: WorkspaceId): Promise<WorkspaceRecord | null> {
    const stmt = this.db.db.prepare("SELECT * FROM workspaces WHERE workspace_id = ?")
    const row = stmt.get(workspaceId)
    return row ? this.rowToRecord(row) : null
  }

  async listByProject(projectId: ProjectId): Promise<WorkspaceRecord[]> {
    const stmt = this.db.db.prepare("SELECT * FROM workspaces WHERE project_id = ? ORDER BY updated_at DESC")
    const rows = stmt.all(projectId)
    return rows.map((r) => this.rowToRecord(r))
  }

  async registerWorkspace(params: ProjectdWorkspaceRegistration): Promise<WorkspaceRecord> {
    if (!isProjectdWorkspaceRegistration(params)) {
      throw new Error("Invalid workspace registration")
    }
    this.db.db.exec("BEGIN IMMEDIATE")
    try {
      const result = this.applyWorkspaceRegistration(params)
      this.db.db.exec("COMMIT")
      return result
    } catch (error) {
      this.db.db.exec("ROLLBACK")
      throw error
    }
  }

  private applyWorkspaceRegistration(params: ProjectdWorkspaceRegistration): WorkspaceRecord {
    this.assertProjectAvailable(params.projectId)
    const previousRow = this.db.db.prepare("SELECT * FROM workspaces WHERE workspace_id = ?").get(params.workspaceId)
    const previous = previousRow ? this.rowToRecord(previousRow) : null
    if (previous && previous.projectId !== params.projectId) throw new Error("A workspace cannot be reassigned to another project")
    const record = {
      ...params,
      projectRootPath: params.projectRootPath ?? (previous?.rootPath === params.rootPath ? previous.projectRootPath : params.rootPath),
      projectRootRelativePath: params.projectRootRelativePath ?? previous?.projectRootRelativePath ?? ".",
      gitRootPath: params.gitRootPath === undefined ? previous?.gitRootPath ?? null : params.gitRootPath,
      gitOriginUrl: params.gitOriginUrl === undefined ? previous?.gitOriginUrl ?? null : params.gitOriginUrl,
      source: previous?.source ?? params.source ?? "register",
      storageOwnership: params.storageOwnership ?? previous?.storageOwnership ?? "attached",
      managedRootId: params.managedRootId === undefined ? previous?.managedRootId ?? null : params.managedRootId,
      markerPolicy: params.markerPolicy ?? previous?.markerPolicy ?? "none",
      workspaceRevision: params.workspaceRevision ?? previous?.workspaceRevision ?? 1,
    }
    if (previous) {
      const pathChanged = previous.rootPath !== record.rootPath || previous.projectRootPath !== record.projectRootPath ||
        previous.projectRootRelativePath !== record.projectRootRelativePath || previous.gitRootPath !== record.gitRootPath
      const ownershipChanged = previous.storageOwnership !== record.storageOwnership || previous.managedRootId !== record.managedRootId ||
        previous.markerPolicy !== record.markerPolicy
      const firstCatalogQualification = previousRow?.catalog_binding_revision == null && params.workspaceRevision !== undefined &&
        params.projectRootRelativePath !== undefined && params.markerPolicy !== undefined && params.storageOwnership !== undefined &&
        params.managedRootId !== undefined && previous.rootPath === record.rootPath && previous.projectRootPath === record.projectRootPath &&
        (previous.gitRootPath === record.gitRootPath || previous.gitRootPath === null && record.gitRootPath === previous.projectRootPath)
      if (record.workspaceRevision < previous.workspaceRevision) throw new Error("Stale workspace binding revision")
      if ((pathChanged || ownershipChanged) && record.workspaceRevision <= previous.workspaceRevision && !firstCatalogQualification) {
        throw new Error("A changed workspace binding requires a newer catalog revision")
      }
      if (pathChanged && !firstCatalogQualification) {
        const session = this.db.db.prepare(`
          SELECT 1 FROM local_workbenches WHERE workspace_id = ? AND kind = 'collaboration' AND lifecycle != 'closed'
          UNION ALL SELECT 1 FROM session_bindings WHERE workspace_id = ?
          UNION ALL SELECT 1 FROM session_folders WHERE workspace_id = ? LIMIT 1
        `).get(params.workspaceId, params.workspaceId, params.workspaceId)
        if (session) throw new Error("A session workspace cannot move while its session retains the binding")
      }
    }
    const now = Date.now()
    const stmt = this.db.db.prepare(`
      INSERT INTO workspaces (
        workspace_id, project_id, root_path, project_root_path,
        git_root_path, git_origin_url, source, storage_ownership,
        managed_root_id, project_root_relative_path, marker_policy, workspace_revision,
        catalog_binding_revision,
        created_at, updated_at, last_opened_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        root_path = excluded.root_path,
        project_root_path = excluded.project_root_path,
        project_root_relative_path = excluded.project_root_relative_path,
        git_root_path = excluded.git_root_path,
        git_origin_url = excluded.git_origin_url,
        storage_ownership = excluded.storage_ownership,
        managed_root_id = excluded.managed_root_id,
        marker_policy = excluded.marker_policy,
        workspace_revision = excluded.workspace_revision,
        catalog_binding_revision = COALESCE(excluded.catalog_binding_revision, workspaces.catalog_binding_revision),
        updated_at = excluded.updated_at,
        last_opened_at = excluded.last_opened_at
    `)
    stmt.run(
      params.workspaceId,
      params.projectId,
      params.rootPath,
      record.projectRootPath,
      record.gitRootPath,
      record.gitOriginUrl,
      record.source,
      record.storageOwnership,
      record.managedRootId,
      record.projectRootRelativePath,
      record.markerPolicy,
      record.workspaceRevision,
      params.workspaceRevision ?? null,
      now,
      now,
      now,
    )
    this.db.db.prepare("UPDATE local_workbenches SET workspace_revision = ?, updated_at = ? WHERE workspace_id = ? AND kind = 'ordinary'")
      .run(record.workspaceRevision, now, params.workspaceId)

    const created = this.db.db.prepare("SELECT * FROM workspaces WHERE workspace_id = ?").get(params.workspaceId)
    return this.rowToRecord(created!)
  }

  async touchLastOpened(workspaceId: WorkspaceId): Promise<void> {
    const stmt = this.db.db.prepare(
      "UPDATE workspaces SET last_opened_at = ?, updated_at = ? WHERE workspace_id = ?",
    )
    const now = Date.now()
    stmt.run(now, now, workspaceId)
  }

  async delete(workspaceId: WorkspaceId): Promise<boolean> {
    this.assertNoRetainedSession(workspaceId)
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

  private assertNoRetainedSession(workspaceId: string): void {
    const retained = this.db.db.prepare(`
      SELECT 1 FROM local_workbenches WHERE workspace_id = ? AND kind = 'collaboration' AND lifecycle != 'closed'
      UNION ALL SELECT 1 FROM session_bindings WHERE workspace_id = ?
      UNION ALL SELECT 1 FROM session_folders WHERE workspace_id = ? LIMIT 1
    `).get(workspaceId, workspaceId, workspaceId)
    if (retained) throw new Error("A collaboration session retains this workspace. Leave the session explicitly before closing it.")
  }

  /** Idles ordinary workbenches without removing their identities or presentation. */
  async closeWorkspace(request: ProjectdWorkspaceCloseRequest): Promise<WorkspaceRecord> {
    if (!isProjectdWorkspaceCloseRequest(request)) throw new Error("Invalid workspace close scope")
    this.db.db.exec("BEGIN IMMEDIATE")
    try {
      const row = this.db.db.prepare("SELECT * FROM workspaces WHERE workspace_id = ?").get(request.workspaceId)
      const workspace = row ? this.rowToRecord(row) : null
      if (!workspace || workspace.projectId !== request.projectId || workspace.projectRootPath !== request.projectRootPath || workspace.workspaceRevision !== request.workspaceRevision) throw new Error("The daemon workspace binding changed. Refresh before closing it.")
      this.assertNoRetainedSession(request.workspaceId)
      if (!request.preflightOnly) this.db.db.prepare("UPDATE local_workbenches SET lifecycle = 'idle', updated_at = ? WHERE workspace_id = ? AND kind = 'ordinary' AND lifecycle = 'active'")
        .run(Date.now(), request.workspaceId)
      this.db.db.exec("COMMIT")
      return workspace
    } catch (error) { this.db.db.exec("ROLLBACK"); throw error }
  }

  assertProjectAvailable(projectId: string): void {
    if (this.db.db.prepare("SELECT 1 FROM project_exclusions WHERE project_id = ?").get(projectId)) throw new Error("This project is excluded by its saved local removal.")
  }

  async removeProject(request: ProjectdProjectRemovalRequest): Promise<{ operationId: string; state: "removing" | "removed" | "cancelled" }> {
    if (!isProjectdProjectRemovalRequest(request)) throw new Error("Invalid project removal scope")
    const scope = JSON.stringify(request.workspaces.map((item) => ({ workspaceId: item.workspaceId, projectRootPath: item.projectRootPath, workspaceRevision: item.workspaceRevision })).sort((a, b) => a.workspaceId.localeCompare(b.workspaceId)))
    this.db.db.exec("BEGIN IMMEDIATE")
    try {
      const existing = this.db.db.prepare("SELECT * FROM project_exclusions WHERE project_id = ?").get(request.projectId)
      if (existing && (existing.operation_id !== request.operationId || existing.scope_json !== scope)) throw new Error("Another removal owns this project's daemon exclusion.")
      if (request.phase === "cancel") {
        if (existing?.state === "removed") throw new Error("The daemon removal already committed.")
        this.db.db.prepare("DELETE FROM project_exclusions WHERE project_id = ? AND operation_id = ?").run(request.projectId, request.operationId)
        this.db.db.exec("COMMIT")
        return { operationId: request.operationId, state: "cancelled" }
      }
      if (existing?.state === "removed") { this.db.db.exec("COMMIT"); return { operationId: request.operationId, state: "removed" } }
      const rows = this.db.db.prepare("SELECT workspace_id, project_root_path, workspace_revision FROM workspaces WHERE project_id = ? ORDER BY workspace_id").all(request.projectId)
      const actual = JSON.stringify(rows.map((row) => ({ workspaceId: String(row.workspace_id), projectRootPath: String(row.project_root_path), workspaceRevision: Number(row.workspace_revision) })))
      if (scope !== actual) throw new Error("The daemon retains a different set of project bindings. Inspect them before removal.")
      for (const workspace of request.workspaces) this.assertNoRetainedSession(workspace.workspaceId)
      const retained = this.db.db.prepare("SELECT 1 FROM session_bindings WHERE project_id = ? LIMIT 1").get(request.projectId)
      if (retained) throw new Error("A collaboration session retains this project. Leave it explicitly before removal.")
      if (!existing) this.db.db.prepare("INSERT INTO project_exclusions(project_id, operation_id, scope_json, state, updated_at) VALUES (?, ?, ?, 'removing', ?)").run(request.projectId, request.operationId, scope, Date.now())
      if (request.phase === "finalize") {
        this.db.db.prepare("DELETE FROM local_workbenches WHERE project_id = ? AND kind = 'ordinary'").run(request.projectId)
        this.db.db.prepare("DELETE FROM workspaces WHERE project_id = ?").run(request.projectId)
        this.db.db.prepare("UPDATE project_exclusions SET state = 'removed', updated_at = ? WHERE project_id = ?").run(Date.now(), request.projectId)
      }
      this.db.db.exec("COMMIT")
      return { operationId: request.operationId, state: request.phase === "finalize" ? "removed" : "removing" }
    } catch (error) { this.db.db.exec("ROLLBACK"); throw error }
  }

  private rowToRecord(row: Record<string, SQLOutputValue>): WorkspaceRecord {
    return {
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      rootPath: String(row.root_path),
      projectRootRelativePath: String(row.project_root_relative_path || "."),
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
