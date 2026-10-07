import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as SqlClient from "@effect/sql/SqlClient"
import type { LocalProjectResult } from "@shared/localProjectTypes"
import { WorkspaceCatalog, type WorkspaceCatalogInterface } from "../../apps/desktop/electron/workspaces/WorkspaceCatalog"
import { makeWorkspaceCatalogLayer } from "../../apps/desktop/electron/workspaces/WorkspaceCatalogLayer"
import { reconcileLocalProjectOperations } from "../../apps/desktop/electron/workspaces/reconcileLocalProjectOperations"
vi.mock("../../apps/desktop/electron/gitRuntime.ts", () => ({ runGitCommand: vi.fn(async () => ({ success: true, exitCode: 0, stdout: "", stderr: "" })) }))
let root: string
let runtime: ManagedRuntime.ManagedRuntime<WorkspaceCatalog | SqlClient.SqlClient, unknown>
const hooks = { prepare: vi.fn(async () => {}), finalize: vi.fn(async () => {}), removeData: vi.fn(async () => {}), cancel: vi.fn(async () => {}), trash: vi.fn(async (_folder: string) => {}) }
const value = <A>(result: LocalProjectResult<A>) => { if (!result.success) throw new Error(result.error); return result.value }
const catalog = <A>(fn: (c: WorkspaceCatalogInterface) => Effect.Effect<A>) => runtime.runPromise(Effect.flatMap(Effect.service(WorkspaceCatalog), fn))
const restart = async () => { await runtime.dispose(); runtime = ManagedRuntime.make(makeWorkspaceCatalogLayer(path.join(root, "catalog.sqlite"))) }
const open = async () => {
  const folderPath = path.join(root, "source"); await fs.mkdir(folderPath); await fs.writeFile(path.join(folderPath, "keep"), "original")
  return value(await catalog((c) => c.projectLifecycle.open({ operationId: "open", name: "Source", slug: "source", folderPath })))
}
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "cozea-removal-"))); runtime = ManagedRuntime.make(makeWorkspaceCatalogLayer(path.join(root, "catalog.sqlite"))); for (const mock of Object.values(hooks)) mock.mockReset().mockResolvedValue(undefined) })
afterEach(async () => { await runtime.dispose(); await fs.rm(root, { recursive: true, force: true }) })

describe("durable permanent local removal", () => {
  it("detaches attached folders, retains conversations by default and preserves replay keys across restart", async () => {
    const original = await open()
    const request = { operationId: "remove", projectId: original.project.projectId, removeLocalData: false, trashManagedFolder: true }
    expect(value(await catalog((c) => c.projectLifecycle.remove(request, hooks))).retainedLocalData).toBe(true)
    expect(hooks.trash).not.toHaveBeenCalled(); expect(hooks.removeData).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(original.workspace.projectRootPath, "keep"), "utf8")).toBe("original")
    expect(await catalog((c) => c.projects.list())).toEqual([])
    expect(await catalog((c) => c.getById(original.workspace.workspaceId))).toBeNull()
    await restart()
    expect(await catalog((c) => c.projects.get(original.project.projectId))).toMatchObject({ status: "removed" })
    value(await catalog((c) => c.projectLifecycle.remove(request, hooks)))
    expect(hooks.prepare).toHaveBeenCalledTimes(1)
    const reopened = value(await catalog((c) => c.projectLifecycle.open({ operationId: "reopen", name: "New", slug: "new", folderPath: original.workspace.projectRootPath })))
    expect(reopened.project.projectId).not.toBe(original.project.projectId)
    value(await catalog((c) => c.projectLifecycle.resumeRemove(request.operationId, hooks)))
    expect(hooks.prepare).toHaveBeenCalledTimes(1)
    expect(await catalog((c) => c.getById(reopened.workspace.workspaceId))).not.toBeNull()
  })
  it("persists exclusion across a failed preflight and supports explicit cancellation before effects", async () => {
    const original = await open()
    hooks.prepare.mockRejectedValueOnce(new Error("A retained session prevents removal"))
    const request = { operationId: "remove", projectId: original.project.projectId, removeLocalData: false, trashManagedFolder: false }
    expect(await catalog((c) => c.projectLifecycle.remove(request, hooks))).toMatchObject({ success: false })
    await restart()
    expect(await catalog((c) => c.getById(original.workspace.workspaceId))).toBeNull()
    expect(await catalog((c) => c.projects.getOperation("remove"))).toMatchObject({ state: "unknown" })
    expect(await catalog((c) => reconcileLocalProjectOperations({ projects: c.projects, lifecycle: c.projectLifecycle }))).toBe(0)
    await expect(runtime.runPromise(Effect.flatMap(SqlClient.SqlClient, (sql) => sql`UPDATE local_workspaces SET workspace_revision = 2 WHERE workspace_id = ${original.workspace.workspaceId}`))).rejects.toThrow()
    value(await catalog((c) => c.projectLifecycle.cancelRemove("remove", hooks)))
    expect(await catalog((c) => c.getById(original.workspace.workspaceId))).not.toBeNull()
    expect(await catalog((c) => c.projects.getOperation("remove"))).toMatchObject({ state: "cancelled" })
    expect(await fs.readFile(path.join(original.workspace.projectRootPath, "keep"), "utf8")).toBe("original")
  })
  it("never repeats an uncertain Trash call or deletes a replacement directory", async () => {
    const original = value(await catalog((c) => c.projectLifecycle.create({ operationId: "create", name: "Managed", slug: "managed", parentFolder: path.join(root, "projects") })))
    hooks.trash.mockImplementationOnce(async (folder) => { await fs.rename(folder, path.join(root, "trash")); throw new Error("lost Trash result") })
    const request = { operationId: "remove", projectId: original.project.projectId, removeLocalData: false, trashManagedFolder: true }
    expect(await catalog((c) => c.projectLifecycle.remove(request, hooks))).toMatchObject({ success: false })
    await fs.mkdir(original.workspace.projectRootPath); await fs.writeFile(path.join(original.workspace.projectRootPath, "replacement"), "keep replacement")
    await restart()
    expect(await catalog((c) => c.projectLifecycle.resumeRemove("remove", hooks))).toMatchObject({ success: false, error: expect.stringContaining("Trash outcome needs inspection") })
    expect(hooks.trash).toHaveBeenCalledTimes(1)
    value(await catalog((c) => c.projectLifecycle.confirmTrashOutcome("remove", original.workspace.workspaceId)))
    value(await catalog((c) => c.projectLifecycle.resumeRemove("remove", hooks)))
    expect(await fs.readFile(path.join(original.workspace.projectRootPath, "replacement"), "utf8")).toBe("keep replacement")
    expect(hooks.trash).toHaveBeenCalledTimes(1)
  })
  it("retains irreversible data intent after response loss and rejects changed retention choices", async () => {
    const original = await open()
    hooks.removeData.mockRejectedValueOnce(new Error("lost native erase reply"))
    const request = { operationId: "remove", projectId: original.project.projectId, removeLocalData: true, trashManagedFolder: false }
    expect(await catalog((c) => c.projectLifecycle.remove(request, hooks))).toMatchObject({ success: false })
    expect(await catalog((c) => c.projectLifecycle.cancelRemove("remove", hooks))).toMatchObject({ success: false })
    expect(await catalog((c) => c.projectLifecycle.remove({ ...request, removeLocalData: false }, hooks))).toMatchObject({ success: false })
    await restart()
    value(await catalog((c) => c.projectLifecycle.resumeRemove("remove", hooks)))
    expect(hooks.removeData).toHaveBeenCalledTimes(2)
    expect(await fs.readFile(path.join(original.workspace.projectRootPath, "keep"), "utf8")).toBe("original")
  })
  it("rejects replaced managed folders before reserving exclusion", async () => {
    const original = value(await catalog((c) => c.projectLifecycle.create({ operationId: "create", name: "Managed", slug: "managed", parentFolder: path.join(root, "projects") })))
    await fs.rename(original.workspace.projectRootPath, path.join(root, "original")); await fs.cp(path.join(root, "original"), original.workspace.projectRootPath, { recursive: true })
    expect(await catalog((c) => c.projectLifecycle.remove({ operationId: "remove", projectId: original.project.projectId, removeLocalData: false, trashManagedFolder: true }, hooks))).toMatchObject({ success: false })
    expect(await catalog((c) => c.projects.getOperation("remove"))).toBeNull()
    expect(hooks.prepare).not.toHaveBeenCalled()
  })
  it("compacts diagnostics without erasing close replay or repair resource provenance", async () => {
    const original = await open()
    value(await catalog((c) => c.projectLifecycle.close({ operationId: "close", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId }, { prepareRuntime: async () => {} })))
    const before = await catalog((c) => c.projects.getOperation("close"))
    await runtime.runPromise(Effect.flatMap(SqlClient.SqlClient, (sql) => sql`UPDATE project_operations SET last_error = 'old diagnostic', updated_at = 1 WHERE operation_id = 'close'`))
    expect(await catalog((c) => c.projects.compactJournal())).toBe(1)
    expect(await catalog((c) => c.projects.getOperation("close"))).toMatchObject({ requestDetails: before!.requestDetails, details: before!.details, state: "completed", lastError: null })
  })
})
