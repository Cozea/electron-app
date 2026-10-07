import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import type { ProjectdDatabase } from "../storage/Database"
import type { ProjectdWorkspaceRecord } from "@shared/projectdWorkspaceTypes"

export function getDefaultWorkspaceCatalogPath(): string {
  if (process.env.COZEA_WORKSPACE_CATALOG_PATH) {
    return process.env.COZEA_WORKSPACE_CATALOG_PATH
  }
  const appSupport = path.join(os.homedir(), "Library/Application Support/Cozea")
  return path.join(appSupport, "local-workspaces.sqlite")
}

export type WorkspaceRecord = ProjectdWorkspaceRecord

export class WorkspaceCatalogImporter {
  readonly db: ProjectdDatabase
  readonly sourceCatalogPath: string

  constructor(db: ProjectdDatabase, sourceCatalogPath?: string) {
    this.db = db
    this.sourceCatalogPath = sourceCatalogPath ?? getDefaultWorkspaceCatalogPath()
  }

  async importIfNecessary(): Promise<{ importedCount: number; alreadyImported: boolean }> {
    // Check if migration already ran
    const checkStmt = this.db.db.prepare(
      "SELECT 1 FROM _projectd_migrations WHERE name = '002_import_local_workspaces_catalog' LIMIT 1",
    )
    const alreadyRun = checkStmt.get()
    if (alreadyRun) {
      return { importedCount: 0, alreadyImported: true }
    }

    if (!fs.existsSync(this.sourceCatalogPath)) {
      return { importedCount: 0, alreadyImported: false }
    }

    const imported = this.importFromPath(this.sourceCatalogPath)
    // A daemon may start before Electron has initialized the catalog. Absence
    // is retryable, including installations with the old 001 marker.
    if (this.hasWorkspaceTable(this.sourceCatalogPath)) {
      this.markMigrationApplied("002_import_local_workspaces_catalog")
    }
    return { importedCount: imported, alreadyImported: false }
  }

  importFromPath(catalogPath: string): number {
    if (!fs.existsSync(catalogPath)) {
      return 0
    }

    const sourceDb = new DatabaseSync(catalogPath, { readOnly: true })
    let imported = 0

    try {
      // Check if local_workspaces table exists in source
      const tableCheck = sourceDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='local_workspaces'")
        .get()

      if (!tableCheck) {
        return 0
      }

      const rows = sourceDb.prepare("SELECT * FROM local_workspaces").all() as any[]

      const insertWorkspace = this.db.db.prepare(`
        INSERT INTO workspaces (
          workspace_id,
          project_id,
          root_path,
          project_root_relative_path,
          project_root_path,
          git_root_path,
          git_origin_url,
          source,
          storage_ownership,
          managed_root_id,
          marker_policy,
          is_active,
          workspace_revision,
          catalog_binding_revision,
          created_at,
          updated_at,
          last_opened_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO NOTHING
      `)

      const insertWorkbench = this.db.db.prepare(`
        INSERT INTO local_workbenches (
          workbench_id,
          project_id,
          workspace_id,
          workspace_revision,
          kind,
          branch_name,
          session_id,
          lifecycle,
          title,
          presentation_ref,
          created_at,
          updated_at,
          last_activated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workbench_id) DO NOTHING
      `)

      this.db.db.exec("BEGIN TRANSACTION;")

      try {
        for (const row of rows) {
          const workspaceId = String(row.workspace_id)
          const projectId = String(row.project_id)
          if (this.db.db.prepare("SELECT 1 FROM project_exclusions WHERE project_id = ?").get(projectId)) continue
          const excluded = sourceDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_exclusions'").get()
          if (excluded && sourceDb.prepare("SELECT 1 FROM project_exclusions WHERE project_id = ?").get(projectId)) continue
          const rootPath = String(row.root_path)
          const projectRootPath = String(row.project_root_path ?? rootPath)
          const storageOwnership = row.storage_ownership === "managed" ? "managed" : "attached"
          const isActive = Boolean(row.is_active)
          const now = Date.now()

          // Invariant C37: Source attached folders stay untouched on disk.
          insertWorkspace.run(
            workspaceId,
            projectId,
            rootPath,
            String(row.project_root_relative_path ?? "."),
            projectRootPath,
            row.git_root_path ? String(row.git_root_path) : null,
            row.git_origin_url ? String(row.git_origin_url) : null,
            String(row.source ?? "import"),
            storageOwnership,
            row.managed_root_id ? String(row.managed_root_id) : null,
            String(row.marker_policy ?? "none"),
            isActive ? 1 : 0,
            Number(row.workspace_revision) || 1,
            Number(row.workspace_revision) || 1,
            Number(row.created_at) || now,
            Number(row.updated_at) || now,
            row.last_opened_at ? Number(row.last_opened_at) : null,
          )

          // Provision ordinary workbench for this workspace
          const workbenchId = `wb_${workspaceId}`
          const title = row.label ? String(row.label) : path.basename(projectRootPath) || "Main"

          insertWorkbench.run(
            workbenchId,
            projectId,
            workspaceId,
            Number(row.workspace_revision) || 1,
            "ordinary",
            null,
            null,
            isActive ? "active" : "idle",
            title,
            "",
            Number(row.created_at) || now,
            Number(row.updated_at) || now,
            isActive ? now : null,
          )

          imported += 1
        }

        this.db.db.exec("COMMIT;")
      } catch (err) {
        this.db.db.exec("ROLLBACK;")
        throw err
      }
    } finally {
      sourceDb.close()
    }

    return imported
  }

  private markMigrationApplied(name: string): void {
    const stmt = this.db.db.prepare(
      "INSERT OR IGNORE INTO _projectd_migrations (name, applied_at) VALUES (?, ?)",
    )
    stmt.run(name, Date.now())
  }

  private hasWorkspaceTable(catalogPath: string): boolean {
    const source = new DatabaseSync(catalogPath, { readOnly: true })
    try {
      return Boolean(source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_workspaces'").get())
    } finally { source.close() }
  }
}
