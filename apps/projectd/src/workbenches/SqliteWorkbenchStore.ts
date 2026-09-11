import {
  asBranchName,
  asProjectId,
  asSessionId,
  asWorkbenchId,
  asWorkspaceId,
  assertValidWorkbenchTransition,
  type LocalProjectWorkbench,
  type LocalProjectWorkbenchStore,
  type LocalWorkbenchLifecycle,
  type ProjectId,
  type SetActiveWorkbenchResult,
  validateWorkbenchInvariants,
  type WorkbenchId,
  WorkbenchInvariantError,
  type WorkbenchKind,
} from "@shared/collaboration"

import type { ProjectdDatabase } from "../storage/Database"

export class SqliteWorkbenchStore implements LocalProjectWorkbenchStore {
  readonly db: ProjectdDatabase

  constructor(db: ProjectdDatabase) {
    this.db = db
  }

  private rowToWorkbench(row: any): LocalProjectWorkbench {
    return {
      workbenchId: asWorkbenchId(row.workbench_id),
      projectId: asProjectId(row.project_id),
      workspaceId: asWorkspaceId(row.workspace_id),
      workspaceRevision: Number(row.workspace_revision) || 1,
      kind: row.kind as WorkbenchKind,
      branchName: row.branch_name ? asBranchName(row.branch_name) : null,
      collaborationSessionId: row.session_id ? asSessionId(row.session_id) : null,
      lifecycle: row.lifecycle as LocalWorkbenchLifecycle,
      title: String(row.title),
      presentationStateRef: String(row.presentation_ref ?? ""),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      lastActivatedAt: row.last_activated_at ? Number(row.last_activated_at) : null,
    }
  }

  async get(workbenchId: WorkbenchId): Promise<LocalProjectWorkbench | null> {
    const stmt = this.db.db.prepare("SELECT * FROM local_workbenches WHERE workbench_id = ?")
    const row = stmt.get(workbenchId)
    return row ? this.rowToWorkbench(row) : null
  }

  async listByProject(projectId: ProjectId): Promise<LocalProjectWorkbench[]> {
    const stmt = this.db.db.prepare(
      "SELECT * FROM local_workbenches WHERE project_id = ? AND lifecycle != 'closed' ORDER BY updated_at DESC",
    )
    const rows = stmt.all(projectId) as any[]
    return rows.map((r) => this.rowToWorkbench(r))
  }

  async getActive(projectId: ProjectId): Promise<LocalProjectWorkbench | null> {
    const stmt = this.db.db.prepare(
      "SELECT * FROM local_workbenches WHERE project_id = ? AND lifecycle = 'active' LIMIT 1",
    )
    const row = stmt.get(projectId)
    return row ? this.rowToWorkbench(row) : null
  }

  async save(workbench: LocalProjectWorkbench): Promise<LocalProjectWorkbench> {
    validateWorkbenchInvariants(workbench)

    this.db.db.exec("BEGIN IMMEDIATE;")
    try {
      if (workbench.lifecycle === "active") {
        const activeCheck = this.db.db.prepare(
          "SELECT workbench_id FROM local_workbenches WHERE project_id = ? AND lifecycle = 'active' AND workbench_id != ? LIMIT 1",
        )
        const conflicting = activeCheck.get(workbench.projectId, workbench.workbenchId) as any
        if (conflicting) {
          throw new WorkbenchInvariantError(
            `Invariant C29 violated: Cannot save workbench '${workbench.workbenchId}' as active; workbench '${conflicting.workbench_id}' is already active for project '${workbench.projectId}'`,
          )
        }
      }

      // Ensure workspace exists in workspaces table if referenced
      const wsCheck = this.db.db
        .prepare("SELECT workspace_id FROM workspaces WHERE workspace_id = ?")
        .get(workbench.workspaceId)

      if (!wsCheck) {
        // Auto-provision placeholder workspace record if not present
        const insertWs = this.db.db.prepare(`
          INSERT INTO workspaces (
            workspace_id, project_id, root_path, project_root_path, source, storage_ownership, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        insertWs.run(
          workbench.workspaceId,
          workbench.projectId,
          `/tmp/${workbench.workspaceId}`,
          `/tmp/${workbench.workspaceId}`,
          "workbench_init",
          workbench.kind === "collaboration" ? "managed" : "attached",
          workbench.createdAt,
          workbench.updatedAt,
        )
      }

      const upsertStmt = this.db.db.prepare(`
        INSERT INTO local_workbenches (
          workbench_id, project_id, workspace_id, workspace_revision, kind, branch_name,
          session_id, lifecycle, title, presentation_ref, created_at, updated_at, last_activated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workbench_id) DO UPDATE SET
          workspace_revision = excluded.workspace_revision,
          kind = excluded.kind,
          branch_name = excluded.branch_name,
          session_id = excluded.session_id,
          lifecycle = excluded.lifecycle,
          title = excluded.title,
          presentation_ref = excluded.presentation_ref,
          updated_at = excluded.updated_at,
          last_activated_at = excluded.last_activated_at
      `)

      upsertStmt.run(
        workbench.workbenchId,
        workbench.projectId,
        workbench.workspaceId,
        workbench.workspaceRevision,
        workbench.kind,
        workbench.branchName,
        workbench.collaborationSessionId,
        workbench.lifecycle,
        workbench.title,
        workbench.presentationStateRef,
        workbench.createdAt,
        workbench.updatedAt,
        workbench.lastActivatedAt,
      )

      this.db.db.exec("COMMIT;")
      return { ...workbench }
    } catch (err) {
      this.db.db.exec("ROLLBACK;")
      throw err
    }
  }

  /**
   * Atomic single-active workbench switch transaction (Section 5.2).
   */
  async setActive(
    projectId: ProjectId,
    workbenchId: WorkbenchId,
  ): Promise<SetActiveWorkbenchResult> {
    this.db.db.exec("BEGIN IMMEDIATE;")
    try {
      const getStmt = this.db.db.prepare("SELECT * FROM local_workbenches WHERE workbench_id = ?")
      const row = getStmt.get(workbenchId) as any

      if (!row) {
        throw new Error(`Workbench '${workbenchId}' not found`)
      }

      const destination = this.rowToWorkbench(row)
      if (destination.projectId !== projectId) {
        throw new WorkbenchInvariantError(
          `Workbench '${workbenchId}' belongs to project '${destination.projectId}', not '${projectId}'`,
        )
      }
      if (destination.lifecycle === "closed") {
        throw new WorkbenchInvariantError(`Cannot activate closed workbench '${workbenchId}'`)
      }

      if (destination.lifecycle === "active") {
        this.db.db.exec("COMMIT;")
        return { activated: destination, idled: null }
      }

      assertValidWorkbenchTransition(destination.lifecycle, "active")

      const now = Date.now()

      // Find active workbench for project
      const activeStmt = this.db.db.prepare(
        "SELECT * FROM local_workbenches WHERE project_id = ? AND lifecycle = 'active' AND workbench_id != ? LIMIT 1",
      )
      const currentActiveRow = activeStmt.get(projectId, workbenchId) as any

      let idled: LocalProjectWorkbench | null = null
      if (currentActiveRow) {
        const currentActive = this.rowToWorkbench(currentActiveRow)
        assertValidWorkbenchTransition(currentActive.lifecycle, "idle")

        const idleStmt = this.db.db.prepare(
          "UPDATE local_workbenches SET lifecycle = 'idle', updated_at = ? WHERE workbench_id = ?",
        )
        idleStmt.run(now, currentActive.workbenchId)
        idled = { ...currentActive, lifecycle: "idle", updatedAt: now }
      }

      // Activate destination
      const activateStmt = this.db.db.prepare(
        "UPDATE local_workbenches SET lifecycle = 'active', last_activated_at = ?, updated_at = ? WHERE workbench_id = ?",
      )
      activateStmt.run(now, now, destination.workbenchId)

      const activated: LocalProjectWorkbench = {
        ...destination,
        lifecycle: "active",
        lastActivatedAt: now,
        updatedAt: now,
      }

      this.db.db.exec("COMMIT;")
      return { activated, idled }
    } catch (err) {
      this.db.db.exec("ROLLBACK;")
      throw err
    }
  }

  async setIdle(
    projectId: ProjectId,
    workbenchId: WorkbenchId,
  ): Promise<LocalProjectWorkbench> {
    const destination = await this.get(workbenchId)
    if (!destination) {
      throw new Error(`Workbench '${workbenchId}' not found`)
    }
    if (destination.projectId !== projectId) {
      throw new WorkbenchInvariantError(
        `Workbench '${workbenchId}' belongs to project '${destination.projectId}', not '${projectId}'`,
      )
    }

    if (destination.lifecycle === "idle") {
      return destination
    }

    assertValidWorkbenchTransition(destination.lifecycle, "idle")
    const now = Date.now()
    const stmt = this.db.db.prepare(
      "UPDATE local_workbenches SET lifecycle = 'idle', updated_at = ? WHERE workbench_id = ?",
    )
    stmt.run(now, workbenchId)
    return { ...destination, lifecycle: "idle", updatedAt: now }
  }

  async delete(workbenchId: WorkbenchId): Promise<boolean> {
    const wb = await this.get(workbenchId)
    if (!wb) return false

    if (wb.lifecycle !== "closed") {
      assertValidWorkbenchTransition(wb.lifecycle, "closed")
    }

    // Invariant: Deleting a Workbench removes the local presentation record,
    // but leaves the underlying workspace folder and workspace catalog entry intact.
    const stmt = this.db.db.prepare("DELETE FROM local_workbenches WHERE workbench_id = ?")
    const res = stmt.run(workbenchId)
    return res.changes > 0
  }
}
