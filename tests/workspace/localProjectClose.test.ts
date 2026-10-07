import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as SqlClient from "@effect/sql/SqlClient"
import type { LocalProjectResult } from "../../shared/localProjectTypes"
import type { LocalWorkspaceDTO } from "../../shared/workspaceTypes"
import { WorkspaceCatalog, type WorkspaceCatalogInterface } from "../../apps/desktop/electron/workspaces/WorkspaceCatalog"
import { makeWorkspaceCatalogLayer } from "../../apps/desktop/electron/workspaces/WorkspaceCatalogLayer"
import { reconcileLocalProjectOperations } from "../../apps/desktop/electron/workspaces/reconcileLocalProjectOperations"

vi.mock("../../apps/desktop/electron/gitRuntime.ts", () => ({ runGitCommand: vi.fn(async () => ({ success: true, exitCode: 0, stdout: "", stderr: "" })) }))
type Runtime = ManagedRuntime.ManagedRuntime<WorkspaceCatalog | SqlClient.SqlClient, unknown>
let runtime: Runtime
let root: string
let filename: string
const prepareRuntime = vi.fn<(workspace: LocalWorkspaceDTO, roots: readonly string[]) => Promise<void>>()
const hooks = { prepareRuntime }
function catalog<A>(f: (c: WorkspaceCatalogInterface) => Effect.Effect<A>) { return runtime.runPromise(Effect.flatMap(Effect.service(WorkspaceCatalog), f)) }
function value<A>(r: LocalProjectResult<A>): A { if (!r.success) throw new Error(r.error); return r.value }
async function restart() { await runtime.dispose(); runtime = ManagedRuntime.make(makeWorkspaceCatalogLayer(filename)) as Runtime }
async function attached(name = "source") {
  const folderPath = path.join(root, name)
  await fs.mkdir(folderPath)
  await fs.writeFile(path.join(folderPath, "keep.txt"), "original contents")
  return value(await catalog((c) => c.projectLifecycle.open({ operationId: `open_${name}`, name, slug: name, folderPath })))
}
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "cozea-project-close-")))
  filename = path.join(root, "catalog.sqlite")
  runtime = ManagedRuntime.make(makeWorkspaceCatalogLayer(filename)) as Runtime
  prepareRuntime.mockReset().mockResolvedValue(undefined)
})
afterEach(async () => { await runtime.dispose(); await fs.rm(root, { recursive: true, force: true }) })

describe("preservation-only journaled workspace close", () => {
  it("retains attached source, metadata, workspace and lane through restart and repeated import", async () => {
    const original = await attached()
    const lane = await catalog((c) => c.getLane(original.workspace.workspaceId))
    const request = { operationId: "close_one", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId }
    const closed = value(await catalog((c) => c.projectLifecycle.close(request, hooks)))
    expect(closed.workspace).toEqual(original.workspace)
    expect(prepareRuntime).toHaveBeenCalledWith(original.workspace, [original.workspace.projectRootPath])
    expect(await catalog((c) => c.projects.getOperation(request.operationId))).toMatchObject({ state: "completed", requestDetails: { closeOnly: true, removeLocalData: false, trashManagedFolder: false } })
    await restart()
    expect(await catalog((c) => c.getLane(original.workspace.workspaceId))).toEqual(lane)
    const reopened = value(await catalog((c) => c.projectLifecycle.open({ operationId: "reopen", name: "Other requested name", slug: "other", folderPath: original.workspace.projectRootPath })))
    expect(reopened.project.projectId).toBe(original.project.projectId)
    expect(reopened.workspace.workspaceId).toBe(original.workspace.workspaceId)
    expect(await fs.readdir(original.workspace.projectRootPath)).toEqual(["keep.txt"])
    expect(await fs.readFile(path.join(original.workspace.projectRootPath, "keep.txt"), "utf8")).toBe("original contents")
    value(await catalog((c) => c.projectLifecycle.close(request, hooks)))
    expect(prepareRuntime).toHaveBeenCalledTimes(1)
  })

  it("retains managed ownership, marker and source instead of moving the folder", async () => {
    const original = value(await catalog((c) => c.projectLifecycle.create({ operationId: "create", name: "Managed", slug: "managed", parentFolder: path.join(root, "projects") })))
    const before = await fs.readdir(original.workspace.projectRootPath)
    value(await catalog((c) => c.projectLifecycle.close({ operationId: "close_managed", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId }, hooks)))
    expect(await fs.readdir(original.workspace.projectRootPath)).toEqual(before)
    expect(await catalog((c) => c.getManagedDeletionTarget(original.workspace.workspaceId))).not.toBeNull()
  })

  it("keeps an unknown close across restart, never auto-replays it and reuses its exact request", async () => {
    const original = await attached()
    const request = { operationId: "close_unavailable", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId }
    prepareRuntime.mockRejectedValueOnce(new Error("A collaboration session retains this workspace"))
    expect(await catalog((c) => c.projectLifecycle.close(request, hooks))).toMatchObject({ success: false, error: expect.stringContaining("retains") })
    await restart()
    expect(await catalog((c) => c.projects.getOperation(request.operationId))).toMatchObject({ state: "unknown", stage: "prepared" })
    expect(await catalog((c) => reconcileLocalProjectOperations({ projects: c.projects, lifecycle: c.projectLifecycle }))).toBe(0)
    const resumed = value(await catalog((c) => c.projectLifecycle.close({ ...request, operationId: "second_click" }, hooks)))
    expect(resumed.operationId).toBe(request.operationId)
    expect(await catalog((c) => c.projects.getOperation("second_click"))).toBeNull()
    expect(await fs.readFile(path.join(original.workspace.projectRootPath, "keep.txt"), "utf8")).toBe("original contents")
  })

  it("refuses workspace changes during shutdown and lets the user cancel the obsolete scope", async () => {
    const original = await attached()
    const request = { operationId: "changed_scope", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId }
    prepareRuntime.mockImplementationOnce(async () => {
      await runtime.runPromise(Effect.flatMap(SqlClient.SqlClient, (sql) => sql`UPDATE local_workspaces SET workspace_revision = 2 WHERE workspace_id = ${original.workspace.workspaceId}`))
    })
    expect(await catalog((c) => c.projectLifecycle.close(request, hooks))).toMatchObject({ success: false, error: expect.stringContaining("changed while closing") })
    expect(await catalog((c) => c.projectLifecycle.resumeClose(request.operationId, hooks))).toMatchObject({ success: false, error: expect.stringContaining("changed since close") })
    expect(prepareRuntime).toHaveBeenCalledTimes(1)
    value(await catalog((c) => c.projectLifecycle.cancelClose(request.operationId)))
    await restart()
    expect(await catalog((c) => c.projects.getOperation(request.operationId))).toMatchObject({ state: "cancelled" })
    expect(await catalog((c) => c.projects.listRecoverableOperations())).toEqual([])
    value(await catalog((c) => c.projectLifecycle.close({ ...request, operationId: "new_scope" }, hooks)))
  })

  it("does not allow another project or close request to reuse a receipt", async () => {
    const first = await attached()
    const other = await attached("other")
    const request = { operationId: "close_one", projectId: first.project.projectId, workspaceId: first.workspace.workspaceId }
    value(await catalog((c) => c.projectLifecycle.close(request, hooks)))
    expect(await catalog((c) => c.projectLifecycle.close({ ...request, workspaceId: other.workspace.workspaceId }, hooks))).toMatchObject({ success: false })
    expect(await catalog((c) => c.projectLifecycle.close({ ...request, operationId: "bad", projectId: other.project.projectId }, hooks))).toMatchObject({ success: false })
    expect(await catalog((c) => c.projectLifecycle.cancelClose(request.operationId))).toMatchObject({ success: false, error: expect.stringContaining("already completed") })
    expect(prepareRuntime).toHaveBeenCalledTimes(1)
    expect(await catalog((c) => c.getById(other.workspace.workspaceId))).toEqual(other.workspace)
  })

  it("cannot use a removal or creation receipt as a preservation-only close", async () => {
    const original = await attached()
    expect(await catalog((c) => c.projectLifecycle.resumeClose("open_source", hooks))).toMatchObject({ success: false })
    value(await catalog((c) => c.projects.beginOperation({ operationId: "destructive", projectId: original.project.projectId, kind: "remove", details: { removeLocalData: true } })))
    expect(await catalog((c) => c.projectLifecycle.resumeClose("destructive", hooks))).toMatchObject({ success: false })
    expect(await catalog((c) => c.projectLifecycle.cancelClose("destructive"))).toMatchObject({ success: false })
    expect(prepareRuntime).not.toHaveBeenCalled()
  })
})

describe("managed deletion authority", () => {
  it("rejects a replacement with a copied ownership marker", async () => {
    const original = value(await catalog((c) => c.projectLifecycle.create({ operationId: "create", name: "Managed", slug: "managed", parentFolder: path.join(root, "projects") })))
    const moved = path.join(root, "original")
    await fs.rename(original.workspace.projectRootPath, moved)
    await fs.cp(moved, original.workspace.projectRootPath, { recursive: true })
    expect(await catalog((c) => c.getManagedDeletionTarget(original.workspace.workspaceId))).toBeNull()
    expect(await fs.readdir(moved)).toContain(".cozea")
  })

  it("rejects a symlink to the original managed directory", async () => {
    const original = value(await catalog((c) => c.projectLifecycle.create({ operationId: "create", name: "Managed", slug: "managed", parentFolder: path.join(root, "projects") })))
    const moved = path.join(root, "original")
    await fs.rename(original.workspace.projectRootPath, moved)
    await fs.symlink(moved, original.workspace.projectRootPath)
    expect(await catalog((c) => c.getManagedDeletionTarget(original.workspace.workspaceId))).toBeNull()
  })

  it("never grants deletion ownership to an attached folder within a managed root", async () => {
    const managed = value(await catalog((c) => c.projectLifecycle.create({ operationId: "create", name: "Managed", slug: "managed", parentFolder: path.join(root, "projects") })))
    const attachedRoot = path.join(root, "projects", "user-source")
    await fs.mkdir(attachedRoot)
    const attached = value(await catalog((c) => c.projectLifecycle.open({ operationId: "attach", name: "Attached", slug: "attached", folderPath: attachedRoot })))
    expect(await catalog((c) => c.getManagedDeletionTarget(attached.workspace.workspaceId))).toBeNull()
    expect(await catalog((c) => c.getManagedDeletionTarget(managed.workspace.workspaceId))).not.toBeNull()
  })
  it("rejects missing physical proof and another workspace's overlapping worktree claim", async () => {
    const managed = value(await catalog((c) => c.projectLifecycle.create({ operationId: "create", name: "Managed", slug: "managed", parentFolder: path.join(root, "projects") })))
    const other = await attached("other")
    expect(await catalog((c) => c.getLane(other.workspace.workspaceId))).not.toBeNull()
    await runtime.runPromise(Effect.flatMap(SqlClient.SqlClient, (sql) => sql`UPDATE workspace_lanes SET project_root_path = ${path.join(managed.workspace.projectRootPath, "other-worktree")} WHERE workspace_id = ${other.workspace.workspaceId}`))
    expect(await catalog((c) => c.getManagedDeletionTarget(managed.workspace.workspaceId))).toBeNull()
    await runtime.runPromise(Effect.flatMap(SqlClient.SqlClient, (sql) => sql`UPDATE workspace_lanes SET project_root_path = ${other.workspace.projectRootPath} WHERE workspace_id = ${other.workspace.workspaceId}`))
    expect(await catalog((c) => c.getManagedDeletionTarget(managed.workspace.workspaceId))).not.toBeNull()
    await runtime.runPromise(Effect.flatMap(SqlClient.SqlClient, (sql) => sql`UPDATE local_workspaces SET filesystem_inode = NULL WHERE workspace_id = ${managed.workspace.workspaceId}`))
    expect(await catalog((c) => c.getManagedDeletionTarget(managed.workspace.workspaceId))).toBeNull()
  })
})
