import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  asBranchName,
  asProjectId,
  asSessionId,
  asWorkspaceId,
  createOrdinaryWorkbench,
  createSessionWorkbench,
} from "@shared/collaboration"
import { ProjectdClient } from "@cozea/projectd-protocol"

import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import { SqliteWorkbenchStore } from "../../apps/projectd/src/workbenches/SqliteWorkbenchStore"
import { WorkspaceRegistry } from "../../apps/projectd/src/workspaces/WorkspaceRegistry"
import { WorkspaceCatalogImporter } from "../../apps/projectd/src/workspaces/WorkspaceCatalogImporter"
import { ProjectdServer } from "../../apps/projectd/src/server/ProjectdServer"

describe("P04 daemon-owned workspace + Workbench registry", () => {
  const tmpDir = "/tmp"
  let testDbPath: string
  let testCatalogPath: string
  let testSocketPath: string
  let db: ProjectdDatabase | null = null
  let server: ProjectdServer | null = null

  beforeEach(() => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testDbPath = path.join(tmpDir, `test_projectd_${id}.sqlite`)
    testCatalogPath = path.join(tmpDir, `test_catalog_${id}.sqlite`)
    testSocketPath = path.join(tmpDir, `test_socket_${id}.sock`)
  })

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
    if (db) {
      db.close()
      db = null
    }
    for (const p of [
      testDbPath,
      `${testDbPath}-wal`,
      `${testDbPath}-shm`,
      testCatalogPath,
      testSocketPath,
    ]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        // Ignore
      }
    }
  })

  describe("WorkspaceCatalog migration idempotency & storage ownership", () => {
    it("imports existing WorkspaceCatalog records idempotently without touching attached folders", async () => {
      // 1. Create a mock source workspace-catalog.sqlite
      const sourceDb = new DatabaseSync(testCatalogPath)
      sourceDb.exec(`
        CREATE TABLE local_workspaces (
          workspace_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          root_path TEXT NOT NULL,
          project_root_path TEXT NOT NULL,
          project_root_relative_path TEXT NOT NULL DEFAULT '.',
          git_root_path TEXT,
          git_origin_url TEXT,
          source TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 0,
          workspace_revision INTEGER NOT NULL DEFAULT 1,
          storage_ownership TEXT NOT NULL DEFAULT 'attached',
          managed_root_id TEXT,
          marker_policy TEXT NOT NULL DEFAULT 'none',
          label TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_opened_at INTEGER
        );
      `)

      // Create physical test folder for attached workspace
      const attachedDir = path.join(tmpDir, `attached_repo_${Date.now()}`)
      fs.mkdirSync(attachedDir, { recursive: true })
      fs.writeFileSync(path.join(attachedDir, "README.md"), "# Test Attached")

      sourceDb.exec(`
        INSERT INTO local_workspaces (
          workspace_id, project_id, root_path, project_root_path, source,
          is_active, storage_ownership, label, created_at, updated_at
        ) VALUES (
          'ws_attached_1', 'proj_alpha', '${attachedDir}', '${attachedDir}',
          'import', 1, 'attached', 'Alpha Attached', 1000, 1000
        );
      `)
      sourceDb.close()

      // 2. Run initial import
      db = new ProjectdDatabase(testDbPath)
      const importer = new WorkspaceCatalogImporter(db, testCatalogPath)
      const firstRun = await importer.importIfNecessary()

      expect(firstRun.alreadyImported).toBe(false)
      expect(firstRun.importedCount).toBe(1)

      // Verify workspace in database
      const registry = new WorkspaceRegistry(db)
      const ws = await registry.get(asWorkspaceId("ws_attached_1"))
      expect(ws).not.toBeNull()
      expect(ws?.storageOwnership).toBe("attached")
      expect(ws?.rootPath).toBe(attachedDir)

      // Verify attached folder on disk remains completely untouched
      expect(fs.existsSync(attachedDir)).toBe(true)
      expect(fs.readFileSync(path.join(attachedDir, "README.md"), "utf8")).toBe("# Test Attached")

      // Verify auto-provisioned ordinary workbench
      const workbenchStore = new SqliteWorkbenchStore(db)
      const workbenches = await workbenchStore.listByProject(asProjectId("proj_alpha"))
      expect(workbenches).toHaveLength(1)
      expect(workbenches[0].kind).toBe("ordinary")
      expect(workbenches[0].lifecycle).toBe("active")
      expect(workbenches[0].title).toBe("Alpha Attached")

      // 3. Second run must be idempotent
      const secondRun = await importer.importIfNecessary()
      expect(secondRun.alreadyImported).toBe(true)
      expect(secondRun.importedCount).toBe(0)

      // Clean up physical attached dir
      fs.rmSync(attachedDir, { recursive: true, force: true })
    })
  })

  describe("Workbench persistence, atomic active switch, and restart durability", () => {
    it("enforces atomic active switch between workbenches in a project", async () => {
      db = new ProjectdDatabase(testDbPath)
      const store = new SqliteWorkbenchStore(db)
      const projectId = asProjectId("proj_beta")

      const wb1 = createOrdinaryWorkbench({
        projectId,
        workspaceId: asWorkspaceId("ws_1"),
        title: "Workbench 1",
        lifecycle: "active",
      })

      const wb2 = createOrdinaryWorkbench({
        projectId,
        workspaceId: asWorkspaceId("ws_2"),
        title: "Workbench 2",
        lifecycle: "idle",
      })

      await store.save(wb1)
      await store.save(wb2)

      expect((await store.getActive(projectId))?.workbenchId).toBe(wb1.workbenchId)

      // Switch active workbench: activate wb2 -> wb1 must become idle atomically
      const switchResult = await store.setActive(projectId, wb2.workbenchId)
      expect(switchResult.activated.workbenchId).toBe(wb2.workbenchId)
      expect(switchResult.activated.lifecycle).toBe("active")
      expect(switchResult.idled?.workbenchId).toBe(wb1.workbenchId)
      expect(switchResult.idled?.lifecycle).toBe("idle")

      // Verify state in store
      const active = await store.getActive(projectId)
      expect(active?.workbenchId).toBe(wb2.workbenchId)
      expect((await store.get(wb1.workbenchId))?.lifecycle).toBe("idle")
    })

    it("restores active and idle workbenches accurately across restart", async () => {
      const projectId = asProjectId("proj_gamma")

      // First run: save workbenches
      db = new ProjectdDatabase(testDbPath)
      const store1 = new SqliteWorkbenchStore(db)

      const wb1 = createOrdinaryWorkbench({
        projectId,
        workspaceId: asWorkspaceId("ws_gamma_1"),
        branchName: asBranchName("main"),
        title: "Main WB",
        lifecycle: "active",
      })

      const wb2 = createSessionWorkbench({
        projectId,
        workspaceId: asWorkspaceId("ws_gamma_2"),
        branchName: asBranchName("collab/test"),
        sessionId: asSessionId("sess_gamma"),
        title: "Collab Session WB",
        lifecycle: "idle",
      })

      await store1.save(wb1)
      await store1.save(wb2)

      // Close database connection
      db.close()
      db = null

      // Simulate restart by reopening database from same path
      db = new ProjectdDatabase(testDbPath)
      const store2 = new SqliteWorkbenchStore(db)

      const active = await store2.getActive(projectId)
      expect(active?.workbenchId).toBe(wb1.workbenchId)
      expect(active?.lifecycle).toBe("active")
      expect(active?.kind).toBe("ordinary")

      const all = await store2.listByProject(projectId)
      expect(all).toHaveLength(2)

      const sessionWb = all.find((w) => w.kind === "collaboration")
      expect(sessionWb?.workbenchId).toBe(wb2.workbenchId)
      expect(sessionWb?.collaborationSessionId).toBe(asSessionId("sess_gamma"))
      expect(sessionWb?.lifecycle).toBe("idle")
    })

    it("removing one Workbench does not remove unrelated workspace", async () => {
      db = new ProjectdDatabase(testDbPath)
      const store = new SqliteWorkbenchStore(db)
      const registry = new WorkspaceRegistry(db)
      const projectId = asProjectId("proj_delta")
      const workspaceId = asWorkspaceId("ws_shared")

      await registry.registerWorkspace({
        workspaceId,
        projectId,
        rootPath: "/tmp/delta_repo",
        source: "create",
      })

      const wb1 = createOrdinaryWorkbench({
        projectId,
        workspaceId,
        title: "Ordinary View",
        lifecycle: "active",
      })

      const wb2 = createSessionWorkbench({
        projectId,
        workspaceId,
        branchName: asBranchName("feature/x"),
        sessionId: asSessionId("sess_delta"),
        title: "Collab View",
        lifecycle: "idle",
      })

      await store.save(wb1)
      await store.save(wb2)

      // Delete session workbench
      const deleted = await store.delete(wb2.workbenchId)
      expect(deleted).toBe(true)

      // Verify wb2 is deleted
      expect(await store.get(wb2.workbenchId)).toBeNull()

      // Invariant: Workspace record and wb1 remain intact!
      const ws = await registry.get(workspaceId)
      expect(ws).not.toBeNull()
      expect(ws?.workspaceId).toBe("ws_shared")

      const remainingWb = await store.get(wb1.workbenchId)
      expect(remainingWb).not.toBeNull()
      expect(remainingWb?.title).toBe("Ordinary View")
    })
  })

  describe("Headless API query and switch via ProjectdServer / ProjectdClient", () => {
    it("allows headless querying and active workbench switching over Unix socket", async () => {
      db = new ProjectdDatabase(testDbPath)
      server = new ProjectdServer({
        socketPath: testSocketPath,
        database: db,
      })
      await server.start()

      const client = new ProjectdClient({ socketPath: testSocketPath })
      await client.connect()

      const projectId = "proj_headless"
      const wsId = "ws_headless_1"

      // Register workspace
      const ws = await client.registerWorkspace({
        workspaceId: wsId,
        projectId,
        rootPath: "/tmp/headless_repo",
        source: "headless",
      })
      expect(ws.workspaceId).toBe(wsId)

      // Create two workbenches
      const wb1 = createOrdinaryWorkbench({
        projectId: asProjectId(projectId),
        workspaceId: asWorkspaceId(wsId),
        title: "Headless WB 1",
        lifecycle: "active",
      })

      const wb2 = createOrdinaryWorkbench({
        projectId: asProjectId(projectId),
        workspaceId: asWorkspaceId(wsId),
        title: "Headless WB 2",
        lifecycle: "idle",
      })

      await client.saveWorkbench(wb1)
      await client.saveWorkbench(wb2)

      // List workbenches headlessly
      const workbenches = await client.listWorkbenches(projectId)
      expect(workbenches).toHaveLength(2)

      // Switch active workbench headlessly
      const switchRes = await client.activateWorkbench(projectId, wb2.workbenchId)
      expect(switchRes.activated.workbenchId).toBe(wb2.workbenchId)
      expect(switchRes.activated.lifecycle).toBe("active")
      expect(switchRes.idled?.workbenchId).toBe(wb1.workbenchId)

      // Verify active workbench via get
      const currentWb1 = await client.getWorkbench(wb1.workbenchId)
      expect(currentWb1.lifecycle).toBe("idle")

      client.disconnect()
    })
  })
})
