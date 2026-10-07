import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { asBranchName, asProjectId, asSessionId, asWorkspaceId, createOrdinaryWorkbench, createSessionWorkbench } from "@shared/collaboration"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import { WorkspaceRegistry } from "../../apps/projectd/src/workspaces/WorkspaceRegistry"
import { SqliteWorkbenchStore } from "../../apps/projectd/src/workbenches/SqliteWorkbenchStore"
import { WorkspaceCatalogImporter } from "../../apps/projectd/src/workspaces/WorkspaceCatalogImporter"

let db: ProjectdDatabase
let registry: WorkspaceRegistry
let root: string
beforeEach(() => {
  db = new ProjectdDatabase(":memory:")
  registry = new WorkspaceRegistry(db)
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-binding-revision-"))
})
afterEach(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }) })
const original = { workspaceId: "workspace_one", projectId: "project_one", rootPath: "/projects/one", source: "import", workspaceRevision: 1 }

describe("catalog to daemon binding revisions", () => {
  it("updates an ordinary repair and its workbench without changing either identity", async () => {
    await registry.registerWorkspace(original)
    const store = new SqliteWorkbenchStore(db)
    const workbench = await store.save(createOrdinaryWorkbench({ projectId: asProjectId(original.projectId), workspaceId: asWorkspaceId(original.workspaceId), title: "One", lifecycle: "active" }))
    const updated = await registry.registerWorkspace({ ...original, rootPath: "/projects/moved", workspaceRevision: 2 })
    expect(updated).toMatchObject({ workspaceId: original.workspaceId, projectId: original.projectId, rootPath: "/projects/moved", projectRootPath: "/projects/moved", workspaceRevision: 2 })
    expect(await store.get(workbench.workbenchId)).toMatchObject({ workbenchId: workbench.workbenchId, workspaceId: original.workspaceId, workspaceRevision: 2 })
    await expect(registry.registerWorkspace({ ...original, workspaceRevision: 1 })).rejects.toThrow("Stale")
    expect((await registry.get(asWorkspaceId(original.workspaceId)))?.rootPath).toBe("/projects/moved")
  })

  it("rejects changed paths without a newer revision and cross-project claims", async () => {
    const before = await registry.registerWorkspace(original)
    await expect(registry.registerWorkspace({ ...original, rootPath: "/different" })).rejects.toThrow("newer catalog revision")
    await expect(registry.registerWorkspace({ ...original, rootPath: "/different", workspaceRevision: undefined })).rejects.toThrow("newer catalog revision")
    await expect(registry.registerWorkspace({ ...original, projectId: "other_project", workspaceRevision: 2 })).rejects.toThrow("reassigned")
    expect(await registry.get(asWorkspaceId(original.workspaceId))).toEqual(before)
  })

  it("rolls back a repair if updating its ordinary workbench fails", async () => {
    const before = await registry.registerWorkspace(original)
    await new SqliteWorkbenchStore(db).save(createOrdinaryWorkbench({ projectId: asProjectId(original.projectId), workspaceId: asWorkspaceId(original.workspaceId), title: "One" }))
    db.db.exec("CREATE TRIGGER reject_workbench_revision BEFORE UPDATE ON local_workbenches BEGIN SELECT RAISE(ABORT, 'fixture revision failure'); END")
    await expect(registry.registerWorkspace({ ...original, rootPath: "/moved", workspaceRevision: 2 })).rejects.toThrow("fixture revision failure")
    expect(await registry.get(asWorkspaceId(original.workspaceId))).toEqual(before)
  })

  it("rejects malformed registration before changing durable state", async () => {
    await expect(registry.registerWorkspace({ ...original, rootPath: "relative" })).rejects.toThrow("Invalid")
    await expect(registry.registerWorkspace({ ...original, projectRootRelativePath: "../outside" })).rejects.toThrow("Invalid")
    await expect(registry.registerWorkspace({ ...original, workspaceRevision: 1.5 })).rejects.toThrow("Invalid")
    await expect(registry.registerWorkspace({ ...original, markerPolicy: "invented" })).rejects.toThrow("Invalid")
    expect(await registry.get(asWorkspaceId(original.workspaceId))).toBeNull()
  })

  it("preserves ownership when compatibility re-registration omits it", async () => {
    await registry.registerWorkspace({ ...original, storageOwnership: "managed", managedRootId: "root_one", markerPolicy: "required", workspaceRevision: 3 })
    const repeated = await registry.registerWorkspace({ ...original, workspaceRevision: undefined, source: "compatibility" })
    expect(repeated).toMatchObject({ storageOwnership: "managed", managedRootId: "root_one", markerPolicy: "required", workspaceRevision: 3, source: "import" })
    await expect(registry.registerWorkspace({ ...original, storageOwnership: "attached", workspaceRevision: 3 })).rejects.toThrow("newer catalog revision")
  })

  it("serializes competing newer and older registrations", async () => {
    await registry.registerWorkspace(original)
    const results = await Promise.allSettled([
      registry.registerWorkspace({ ...original, rootPath: "/newest", workspaceRevision: 3 }),
      registry.registerWorkspace({ ...original, rootPath: "/older", workspaceRevision: 2 }),
    ])
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"])
    expect(await registry.get(asWorkspaceId(original.workspaceId))).toMatchObject({ rootPath: "/newest", workspaceRevision: 3 })
  })

  it("qualifies an older partial registration once without moving its path", async () => {
    db.db.prepare(`INSERT INTO workspaces (workspace_id, project_id, root_path, project_root_path, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'create', 1, 1)`).run(original.workspaceId, original.projectId, original.rootPath, original.rootPath)
    const qualified = await registry.registerWorkspace({ ...original, workspaceRevision: 1,
      projectRootRelativePath: ".", gitRootPath: original.rootPath, storageOwnership: "managed", managedRootId: "verified_catalog_root", markerPolicy: "required",
    })
    expect(qualified).toMatchObject({ rootPath: original.rootPath, workspaceRevision: 1, managedRootId: "verified_catalog_root", storageOwnership: "managed" })
    await expect(registry.registerWorkspace({ ...original, workspaceRevision: 1, storageOwnership: "attached" })).rejects.toThrow("newer catalog revision")
    expect(db.db.prepare("SELECT catalog_binding_revision FROM workspaces WHERE workspace_id = ?").get(original.workspaceId)?.catalog_binding_revision).toBe(1)
  })

  it("upgrades an existing daemon database with unknown catalog qualification", async () => {
    const dbPath = path.join(root, "old-projectd.sqlite")
    const old = new DatabaseSync(dbPath)
    old.exec(`CREATE TABLE workspaces (
      workspace_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, root_path TEXT NOT NULL, project_root_path TEXT NOT NULL,
      project_root_relative_path TEXT DEFAULT '', git_root_path TEXT, git_origin_url TEXT, source TEXT NOT NULL,
      storage_ownership TEXT DEFAULT 'attached', managed_root_id TEXT, marker_policy TEXT DEFAULT 'none', is_active INTEGER DEFAULT 0,
      workspace_revision INTEGER DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_opened_at INTEGER)`)
    old.prepare("INSERT INTO workspaces (workspace_id, project_id, root_path, project_root_path, source, created_at, updated_at) VALUES (?, ?, ?, ?, 'import', 1, 1)")
      .run(original.workspaceId, original.projectId, original.rootPath, original.rootPath)
    old.close()
    db.close()
    db = new ProjectdDatabase(dbPath)
    registry = new WorkspaceRegistry(db)
    expect(db.db.prepare("SELECT catalog_binding_revision FROM workspaces").get()?.catalog_binding_revision).toBeNull()
    expect(await registry.get(asWorkspaceId(original.workspaceId))).toMatchObject({ projectRootRelativePath: ".", workspaceRevision: 1, rootPath: original.rootPath })
    await registry.registerWorkspace({ ...original, projectRootRelativePath: ".", storageOwnership: "attached", managedRootId: null, markerPolicy: "none" })
    expect(db.db.prepare("SELECT catalog_binding_revision FROM workspaces").get()?.catalog_binding_revision).toBe(1)
  })

  it("refuses to relocate a live session workspace", async () => {
    await registry.registerWorkspace(original)
    await new SqliteWorkbenchStore(db).save(createSessionWorkbench({ projectId: asProjectId(original.projectId), workspaceId: asWorkspaceId(original.workspaceId), sessionId: asSessionId("session_one"), branchName: asBranchName("session"), title: "Session", lifecycle: "active" }))
    await expect(registry.registerWorkspace({ ...original, rootPath: "/moved_session", workspaceRevision: 2 })).rejects.toThrow("session retains the binding")
    expect((await registry.get(asWorkspaceId(original.workspaceId)))?.rootPath).toBe(original.rootPath)
  })

  it("retries absence and an older premature import marker against the real catalog", async () => {
    const sourcePath = path.join(root, "local-workspaces.sqlite")
    db.db.prepare("INSERT INTO _projectd_migrations (name, applied_at) VALUES (?, ?)").run("001_import_workspace_catalog", 1)
    const importer = new WorkspaceCatalogImporter(db, sourcePath)
    expect(await importer.importIfNecessary()).toEqual({ importedCount: 0, alreadyImported: false })
    const source = new DatabaseSync(sourcePath)
    source.exec(`CREATE TABLE local_workspaces (workspace_id TEXT, project_id TEXT, root_path TEXT, project_root_path TEXT, source TEXT)`)
    source.prepare("INSERT INTO local_workspaces VALUES (?, ?, ?, ?, ?)").run("imported", "project", root, root, "import")
    source.close()
    expect(await importer.importIfNecessary()).toEqual({ importedCount: 1, alreadyImported: false })
    expect(await importer.importIfNecessary()).toEqual({ importedCount: 0, alreadyImported: true })
    expect((await registry.get(asWorkspaceId("imported")))?.rootPath).toBe(root)
  })

  it("does not replace a daemon binding or claim a new revision during legacy import", async () => {
    const before = await registry.registerWorkspace(original)
    const sourcePath = path.join(root, "source.sqlite")
    const source = new DatabaseSync(sourcePath)
    source.exec(`CREATE TABLE local_workspaces (workspace_id TEXT, project_id TEXT, root_path TEXT, project_root_path TEXT, workspace_revision INTEGER, source TEXT)`)
    source.prepare("INSERT INTO local_workspaces VALUES (?, ?, ?, ?, ?, ?)").run(original.workspaceId, original.projectId, "/moved", "/moved", 9, "import")
    source.close()
    new WorkspaceCatalogImporter(db, sourcePath).importFromPath(sourcePath)
    expect(await registry.get(asWorkspaceId(original.workspaceId))).toEqual(before)
  })
})
