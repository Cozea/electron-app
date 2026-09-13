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
import { GitService } from "../../apps/projectd/src/git/GitService"

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

describe("Session provisioning matrix and presentation lifecycle (S01-S06, S10, W03, W05)", () => {
  const tmpDir = "/tmp"
  let testDbPath: string
  let testCollabDir: string
  let ordinaryDir: string
  let sourceDir: string
  let db: ProjectdDatabase
  let store: SqliteWorkbenchStore
  let registry: WorkspaceRegistry
  let gitManager: WorkbenchManager
  let gitService: GitService

  const projectId = asProjectId("proj_provision_matrix")

  async function makeSourceRepo(files: Record<string, string>): Promise<string> {    const dir = path.join(tmpDir, `test_p13_source_${Date.now()}_${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content)
    }
    await gitService.initRepo(dir, "main")
    await gitService.process.execute(["add", "-A"], { cwd: dir })
    await gitService.createCommit(dir, "base", { author: { name: "Tester", email: "test@example.com" } })
    return dir
  }

  beforeEach(async () => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testDbPath = path.join(tmpDir, `test_p13_matrix_db_${id}.sqlite`)
    testCollabDir = path.join(tmpDir, `test_p13_matrix_collab_${id}`)
    ordinaryDir = path.join(tmpDir, `test_p13_matrix_ord_${id}`)
    fs.mkdirSync(testCollabDir, { recursive: true })
    fs.mkdirSync(ordinaryDir, { recursive: true })

    db = new ProjectdDatabase(testDbPath)
    store = new SqliteWorkbenchStore(db)
    registry = new WorkspaceRegistry(db)
    gitService = new GitService()
    gitManager = new WorkbenchManager({ store, workspaceRegistry: registry, gitService, collabReposDir: testCollabDir })
    sourceDir = await makeSourceRepo({ "app.ts": "export const answer = 42\n" })
    fs.writeFileSync(path.join(sourceDir, "draft.md"), "# uncommitted draft\n")
  })

  afterEach(() => {
    if (db) db.close()
    for (const p of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`, testCollabDir, ordinaryDir, sourceDir]) {
      try {
        if (fs.existsSync(p)) {
          fs.rmSync(p, { recursive: true, force: true })
        }
      } catch {
        // Ignore
      }
    }
  })

  it("provisions an existing branch excluding dirty work without touching the source", async () => {
    const ensured = await gitManager.ensureSessionWorkbench({
      projectId,
      sessionId: asSessionId("sess_existing_branch"),
      branchName: asBranchName("main"),
      title: "Existing",
      sourceRepoUrl: sourceDir,
      sourceRootPath: sourceDir,
      includeDirtyChanges: false,
    })

    expect(ensured.reused).toBe(false)
    expect(fs.readFileSync(path.join(ensured.rootPath, "app.ts"), "utf8")).toBe("export const answer = 42\n")
    expect(fs.existsSync(path.join(ensured.rootPath, "draft.md"))).toBe(false)
    expect(fs.readFileSync(path.join(sourceDir, "draft.md"), "utf8")).toBe("# uncommitted draft\n")
  })

  it("creates a new branch from its base and includes dirty work as a copy", async () => {
    const ensured = await gitManager.ensureSessionWorkbench({
      projectId,
      sessionId: asSessionId("sess_new_branch"),
      branchName: asBranchName("feature/live"),
      baseBranch: asBranchName("main"),
      createBranch: true,
      title: "New branch",
      sourceRepoUrl: sourceDir,
      sourceRootPath: sourceDir,
      includeDirtyChanges: true,
    })

    const current = await gitService.process.execute(["branch", "--show-current"], { cwd: ensured.rootPath })
    expect(current.stdout.trim()).toBe("feature/live")
    expect(fs.readFileSync(path.join(ensured.rootPath, "app.ts"), "utf8")).toBe("export const answer = 42\n")
    expect(fs.readFileSync(path.join(ensured.rootPath, "draft.md"), "utf8")).toBe("# uncommitted draft\n")
    // The source folder is a copy source, never modified by provisioning.
    expect(fs.readFileSync(path.join(sourceDir, "draft.md"), "utf8")).toBe("# uncommitted draft\n")
  })

  it("retries the same session after a failed setup without duplicating the workbench", async () => {
    const params = {
      projectId,
      sessionId: asSessionId("sess_retry_setup"),
      branchName: asBranchName("main"),
      title: "Retry",
      sourceRepoUrl: "file:///nonexistent-cozea-test-remote",
      sourceRootPath: sourceDir,
    } as const
    await expect(gitManager.ensureSessionWorkbench({ ...params })).rejects.toThrow()
    expect(await store.listByProject(projectId)).toHaveLength(0)

    const first = await gitManager.ensureSessionWorkbench({ ...params, sourceRepoUrl: sourceDir })
    expect(first.reused).toBe(false)
    const second = await gitManager.ensureSessionWorkbench({ ...params, sourceRepoUrl: sourceDir })
    expect(second.reused).toBe(true)
    expect(second.workbench.workbenchId).toBe(first.workbench.workbenchId)
    expect(second.rootPath).toBe(first.rootPath)
    expect(await store.listByProject(projectId)).toHaveLength(1)
  })

  it("W03: switching presentation away leaves the session workbench intact", async () => {
    // Ordinary workspace must exist in the registry for creation.
    await registry.registerWorkspace({
      workspaceId: asWorkspaceId("ws_matrix_ord"),
      projectId,
      rootPath: ordinaryDir,
      source: "local",
      storageOwnership: "attached",
    })
    const ordinary = await gitManager.createOrdinaryWorkbench({
      projectId,
      workspaceId: asWorkspaceId("ws_matrix_ord"),
      branchName: asBranchName("main"),
      title: "Ordinary",
      setActive: false,
    })
    const session = await gitManager.ensureSessionWorkbench({
      projectId,
      sessionId: asSessionId("sess_switch_away"),
      branchName: asBranchName("main"),
      title: "Session",
      sourceRepoUrl: sourceDir,
      sourceRootPath: sourceDir,
      setActive: true,
    })
    expect((await gitManager.getActiveWorkbench(projectId))?.workbenchId).toBe(session.workbench.workbenchId)

    await gitManager.switchActiveWorkbench(projectId, ordinary.workbenchId)
    const listed = await store.listByProject(projectId)
    expect(listed).toHaveLength(2)
    const kept = listed.find((candidate) => candidate.workbenchId === session.workbench.workbenchId)
    expect(kept?.collaborationSessionId).toBe("sess_switch_away")
    expect(kept?.lifecycle).toBe("idle")
    expect((await gitManager.getActiveWorkbench(projectId))?.workbenchId).toBe(ordinary.workbenchId)

    await gitManager.switchActiveWorkbench(projectId, session.workbench.workbenchId)
    expect((await gitManager.getActiveWorkbench(projectId))?.workbenchId).toBe(session.workbench.workbenchId)
    expect(await store.listByProject(projectId)).toHaveLength(2)
  })

  it("W05: deleting the presentation record keeps the folder and lets the session reopen", async () => {
    const ensured = await gitManager.ensureSessionWorkbench({
      projectId,
      sessionId: asSessionId("sess_reopen"),
      branchName: asBranchName("main"),
      title: "Session",
      sourceRepoUrl: sourceDir,
      sourceRootPath: sourceDir,
    })
    const marker = path.join(ensured.rootPath, "local-proof.txt")
    fs.writeFileSync(marker, "survives presentation deletion\n")

    expect(await store.delete(ensured.workbench.workbenchId)).toBe(true)
    expect(await store.get(ensured.workbench.workbenchId)).toBeNull()
    // Folder and catalog entry survive presentation deletion by invariant.
    expect(fs.existsSync(marker)).toBe(true)
    expect((await registry.get(ensured.workbench.workspaceId))?.rootPath).toBe(ensured.rootPath)

    const reopened = await gitManager.ensureSessionWorkbench({
      projectId,
      sessionId: asSessionId("sess_reopen"),
      branchName: asBranchName("main"),
      title: "Session",
      sourceRepoUrl: sourceDir,
      sourceRootPath: sourceDir,
    })
    expect(reopened.rootPath).toBe(ensured.rootPath)
    expect(fs.readFileSync(marker, "utf8")).toBe("survives presentation deletion\n")
  })
})
