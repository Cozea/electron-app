import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  asBranchName,
  asProjectId,
  asSessionId,
  asWorkspaceId,
} from "@shared/collaboration"

import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import { SqliteWorkbenchStore } from "../../apps/projectd/src/workbenches/SqliteWorkbenchStore"
import { WorkspaceRegistry } from "../../apps/projectd/src/workspaces/WorkspaceRegistry"
import { WorkbenchManager } from "../../apps/projectd/src/workbenches/WorkbenchManager"

describe("P13 local Session Workbench and multi-Workbench switching", () => {
  const tmpDir = "/tmp"
  let testDbPath: string
  let testCollabDir: string
  let testOrdinaryDir: string
  let db: ProjectdDatabase
  let store: SqliteWorkbenchStore
  let registry: WorkspaceRegistry
  let manager: WorkbenchManager

  const projectId = asProjectId("proj_multi_wb")

  beforeEach(async () => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testDbPath = path.join(tmpDir, `test_p13_db_${id}.sqlite`)
    testCollabDir = path.join(tmpDir, `test_p13_collab_${id}`)
    testOrdinaryDir = path.join(tmpDir, `test_p13_ord_${id}`)

    fs.mkdirSync(testOrdinaryDir, { recursive: true })

    db = new ProjectdDatabase(testDbPath)
    store = new SqliteWorkbenchStore(db)
    registry = new WorkspaceRegistry(db)
    manager = new WorkbenchManager({
      store,
      workspaceRegistry: registry,
      collabReposDir: testCollabDir,
    })

    // Register ordinary workspace
    await registry.registerWorkspace({
      workspaceId: asWorkspaceId("ws_ord_1"),
      projectId,
      rootPath: testOrdinaryDir,
      source: "local",
      storageOwnership: "attached",
    })
  })

  afterEach(() => {
    if (db) db.close()
    for (const p of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`, testCollabDir, testOrdinaryDir]) {
      try {
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
      } catch {
        // Ignore
      }
    }
  })

  it("persists multiple local workbenches (main ordinary, feature ordinary, and session WB)", async () => {
    // 1. Create main ordinary WB
    const wbMain = await manager.createOrdinaryWorkbench({
      projectId,
      workspaceId: asWorkspaceId("ws_ord_1"),
      branchName: asBranchName("main"),
      title: "Main Branch",
      setActive: true,
    })
    expect(wbMain.kind).toBe("ordinary")
    expect(wbMain.lifecycle).toBe("active")

    // 2. Create feature ordinary WB
    const wbFeature = await manager.createOrdinaryWorkbench({
      projectId,
      workspaceId: asWorkspaceId("ws_ord_1"),
      branchName: asBranchName("feature/quick-fix"),
      title: "Feature Fix",
      setActive: false,
    })
    expect(wbFeature.kind).toBe("ordinary")
    expect(wbFeature.lifecycle).toBe("idle")

    // 3. Create Session WB in dedicated managed session workspace
    const sessionId = asSessionId("session_xyz_789")
    const wbSession = await manager.createSessionWorkbench({
      projectId,
      sessionId,
      branchName: asBranchName("feature/cloud-collab"),
      title: "Cloud Collab Session",
      setActive: false,
    })
    expect(wbSession.kind).toBe("collaboration")
    expect(wbSession.collaborationSessionId).toBe(sessionId)
    expect(wbSession.lifecycle).toBe("idle")

    // Verify all 3 persist independently
    const all = await manager.listWorkbenches(projectId)
    expect(all).toHaveLength(3)

    // Verify session clone workspace was created in dedicated location (Section 7.1)
    const expectedCollabPath = manager.getSessionWorkspacePath(projectId, sessionId)
    expect(fs.existsSync(expectedCollabPath)).toBe(true)

    const collabWs = await registry.get(wbSession.workspaceId)
    expect(collabWs?.storageOwnership).toBe("managed")
    expect(collabWs?.rootPath).toBe(expectedCollabPath)
  })

  it("switches repeatedly without mutating underlying workspace directories (Section 5.2)", async () => {
    const wb1 = await manager.createOrdinaryWorkbench({
      projectId,
      workspaceId: asWorkspaceId("ws_ord_1"),
      branchName: asBranchName("main"),
      title: "Main WB",
      setActive: true,
    })

    const wb2 = await manager.createSessionWorkbench({
      projectId,
      sessionId: asSessionId("sess_switch_test"),
      branchName: asBranchName("feature/collab"),
      title: "Session WB",
      setActive: false,
    })

    // Initial state: wb1 active, wb2 idle
    expect((await manager.getActiveWorkbench(projectId))?.workbenchId).toBe(wb1.workbenchId)

    // Switch to wb2 (session)
    const res1 = await manager.switchActiveWorkbench(projectId, wb2.workbenchId)
    expect(res1.activated.workbenchId).toBe(wb2.workbenchId)
    expect(res1.idled?.workbenchId).toBe(wb1.workbenchId)
    expect((await manager.getActiveWorkbench(projectId))?.workbenchId).toBe(wb2.workbenchId)

    // Switch back to wb1
    const res2 = await manager.switchActiveWorkbench(projectId, wb1.workbenchId)
    expect(res2.activated.workbenchId).toBe(wb1.workbenchId)
    expect(res2.idled?.workbenchId).toBe(wb2.workbenchId)
    expect((await manager.getActiveWorkbench(projectId))?.workbenchId).toBe(wb1.workbenchId)

    // Verify ordinary workspace directory remained untouched throughout
    expect(fs.existsSync(testOrdinaryDir)).toBe(true)
  })
})
