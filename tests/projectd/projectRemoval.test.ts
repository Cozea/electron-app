import { beforeEach, afterEach, describe, expect, it } from "vitest"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import { WorkspaceRegistry } from "../../apps/projectd/src/workspaces/WorkspaceRegistry"
import { SqliteWorkbenchStore } from "../../apps/projectd/src/workbenches/SqliteWorkbenchStore"
import { createOrdinaryWorkbench, asProjectId, asWorkspaceId } from "@shared/collaboration"
let db: ProjectdDatabase
let registry: WorkspaceRegistry
const binding = { projectId: "project", workspaceId: "workspace", rootPath: "/project", projectRootPath: "/project", workspaceRevision: 1 }
const request = { projectId: "project", operationId: "remove", phase: "prepare" as const, workspaces: [{ workspaceId: "workspace", projectRootPath: "/project", workspaceRevision: 1 }] }
beforeEach(async () => { db = new ProjectdDatabase(":memory:"); registry = new WorkspaceRegistry(db); await registry.registerWorkspace(binding) })
afterEach(() => db.close())
describe("daemon removal exclusion and tombstone", () => {
  it("excludes stale registration and activation, then finalizes idempotently", async () => {
    const store = new SqliteWorkbenchStore(db)
    const workbench = await store.save(createOrdinaryWorkbench({ projectId: asProjectId("project"), workspaceId: asWorkspaceId("workspace"), title: "Retained" }))
    await registry.removeProject(request)
    await expect(registry.registerWorkspace(binding)).rejects.toThrow("excluded")
    await expect(store.setActive(asProjectId("project"), workbench.workbenchId)).rejects.toThrow("excludes")
    await registry.removeProject({ ...request, phase: "finalize" })
    expect(await registry.get(asWorkspaceId("workspace"))).toBeNull()
    expect(await registry.removeProject({ ...request, phase: "finalize" })).toEqual({ operationId: "remove", state: "removed" })
    await expect(registry.registerWorkspace(binding)).rejects.toThrow("excluded")
    await expect(registry.removeProject({ ...request, phase: "cancel" })).rejects.toThrow("committed")
  })
  it("cancels only the owning pre-effect request and permits normal work again", async () => {
    await registry.removeProject(request)
    await expect(registry.removeProject({ ...request, operationId: "other", phase: "cancel" })).rejects.toThrow("Another removal")
    await registry.removeProject({ ...request, phase: "cancel" })
    expect(await registry.registerWorkspace(binding)).toMatchObject(binding)
  })
  it("rejects omitted bindings and retained disconnected materialization", async () => {
    await expect(registry.removeProject({ ...request, workspaces: [] })).rejects.toThrow("different set")
    db.db.prepare("INSERT INTO session_folders(session_id, workspace_id, root_path, updated_at) VALUES(?,?,?,?)").run("retained", "workspace", "/project", 1)
    await expect(registry.removeProject(request)).rejects.toThrow("retains")
    expect(db.db.prepare("SELECT * FROM project_exclusions").all()).toEqual([])
  })
  it("prevents new session enrollment after removal preflight", async () => {
    await registry.removeProject(request)
    expect(() => db.db.prepare("INSERT INTO session_folders(session_id, workspace_id, root_path, updated_at) VALUES(?,?,?,?)").run("new", "workspace", "/project", 1)).toThrow("excludes")
  })
  it("rolls back native records and the tombstone on finalization failure", async () => {
    await registry.removeProject(request)
    db.db.exec("CREATE TRIGGER fixture_block BEFORE DELETE ON workspaces BEGIN SELECT RAISE(ABORT, 'fixture failure'); END")
    await expect(registry.removeProject({ ...request, phase: "finalize" })).rejects.toThrow("fixture failure")
    expect(await registry.get(asWorkspaceId("workspace"))).not.toBeNull()
    expect(db.db.prepare("SELECT state FROM project_exclusions").get()?.state).toBe("removing")
  })
})
