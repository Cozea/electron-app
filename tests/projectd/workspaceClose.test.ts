import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { asProjectId, asWorkspaceId, createOrdinaryWorkbench, createSessionWorkbench, asSessionId, asBranchName } from "@shared/collaboration"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import { WorkspaceRegistry } from "../../apps/projectd/src/workspaces/WorkspaceRegistry"
import { SqliteWorkbenchStore } from "../../apps/projectd/src/workbenches/SqliteWorkbenchStore"

let db: ProjectdDatabase
let registry: WorkspaceRegistry
const request = { workspaceId: "workspace", projectId: "project", projectRootPath: "/project", workspaceRevision: 1, preflightOnly: false }
beforeEach(async () => {
  db = new ProjectdDatabase(":memory:")
  registry = new WorkspaceRegistry(db)
  await registry.registerWorkspace({ ...request, rootPath: request.projectRootPath })
})
afterEach(() => db.close())
describe("daemon preservation-only workspace close", () => {
  it("preflights and idles ordinary workbenches without deleting their identities", async () => {
    const store = new SqliteWorkbenchStore(db)
    const workbench = await store.save(createOrdinaryWorkbench({ projectId: asProjectId(request.projectId), workspaceId: asWorkspaceId(request.workspaceId), title: "One", lifecycle: "active" }))
    await registry.closeWorkspace({ ...request, preflightOnly: true })
    expect((await store.get(workbench.workbenchId))?.lifecycle).toBe("active")
    await registry.closeWorkspace(request)
    await registry.closeWorkspace(request)
    expect(await store.get(workbench.workbenchId)).toMatchObject({ workbenchId: workbench.workbenchId, lifecycle: "idle", presentationStateRef: workbench.presentationStateRef })
    expect(await registry.get(asWorkspaceId(request.workspaceId))).toMatchObject({ workspaceRevision: 1, projectRootPath: request.projectRootPath })
  })
  it("refuses a retained collaboration workbench before touching its lifecycle", async () => {
    const store = new SqliteWorkbenchStore(db)
    const workbench = await store.save(createSessionWorkbench({ projectId: asProjectId(request.projectId), workspaceId: asWorkspaceId(request.workspaceId), sessionId: asSessionId("session"), branchName: asBranchName("main"), title: "Session", lifecycle: "idle" }))
    await expect(registry.closeWorkspace(request)).rejects.toThrow("retains")
    expect((await store.get(workbench.workbenchId))?.lifecycle).toBe("idle")
    await expect(registry.delete(asWorkspaceId(request.workspaceId))).rejects.toThrow("retains")
  })
  it("refuses durable materialization ownership even with no active workbench", async () => {
    db.db.prepare("INSERT INTO session_folders(session_id, workspace_id, root_path, updated_at) VALUES(?,?,?,?)").run("retained", request.workspaceId, request.projectRootPath, Date.now())
    await expect(registry.closeWorkspace(request)).rejects.toThrow("retains")
    await expect(registry.delete(asWorkspaceId(request.workspaceId))).rejects.toThrow("retains")
    expect(db.db.prepare("SELECT session_id FROM session_folders").all()).toHaveLength(1)
  })
  it("refuses a disconnected durable session binding without a live workbench", async () => {
    db.db.prepare("INSERT INTO session_bindings(session_id, project_id, repository_binding_id, workspace_id, branch_name, target_branch, updated_at) VALUES(?,?,?,?,?,?,?)")
      .run("retained", request.projectId, "repository", request.workspaceId, "session", "main", Date.now())
    await expect(registry.closeWorkspace(request)).rejects.toThrow("retains")
    await expect(registry.delete(asWorkspaceId(request.workspaceId))).rejects.toThrow("retains")
    expect(db.db.prepare("SELECT session_id FROM session_bindings").all()).toHaveLength(1)
  })
  it("rejects mismatched project, path, revision and malformed requests", async () => {
    for (const input of [{ ...request, projectId: "other" }, { ...request, projectRootPath: "/other" }, { ...request, workspaceRevision: 2 }, { ...request, workspaceRevision: 1.5 }]) await expect(registry.closeWorkspace(input)).rejects.toThrow()
    expect(await registry.get(asWorkspaceId(request.workspaceId))).toMatchObject({ workspaceRevision: 1, projectId: request.projectId })
  })
  it("rolls back if ordinary workbench shutdown cannot be committed", async () => {
    const store = new SqliteWorkbenchStore(db)
    const workbench = await store.save(createOrdinaryWorkbench({ projectId: asProjectId(request.projectId), workspaceId: asWorkspaceId(request.workspaceId), title: "One", lifecycle: "active" }))
    db.db.exec("CREATE TRIGGER reject_idle BEFORE UPDATE ON local_workbenches BEGIN SELECT RAISE(ABORT, 'fixture idle failure'); END")
    await expect(registry.closeWorkspace(request)).rejects.toThrow("fixture idle failure")
    expect((await store.get(workbench.workbenchId))?.lifecycle).toBe("active")
  })
})
