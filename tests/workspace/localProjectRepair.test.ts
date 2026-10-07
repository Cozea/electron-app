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
const prepareRuntime = vi.fn<(old: LocalWorkspaceDTO, next: LocalWorkspaceDTO) => Promise<void>>()
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
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "cozea-project-repair-")))
  filename = path.join(root, "catalog.sqlite")
  runtime = ManagedRuntime.make(makeWorkspaceCatalogLayer(filename)) as Runtime
  prepareRuntime.mockReset().mockResolvedValue(undefined)
})
afterEach(async () => { await runtime.dispose(); await fs.rm(root, { recursive: true, force: true }) })

describe("journal-backed original folder repair", () => {
  it("authorizes chat relocation through consecutive completed repairs and rejects a gap", async () => {
    const original = await attached()
    const first = path.join(root, "first-move")
    const second = path.join(root, "second-move")
    await fs.rename(original.workspace.rootPath, first)
    value(await catalog((c) => c.projectLifecycle.repair({ operationId: "first_move", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId, folderPath: first }, hooks)))
    await fs.rename(first, second)
    value(await catalog((c) => c.projectLifecycle.repair({ operationId: "second_move", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId, folderPath: second }, hooks)))
    await restart()
    expect(await catalog((c) => c.projects.getCompletedRepair(original.workspace.workspaceId, original.workspace.rootPath, second))).toMatchObject({ operationId: "second_move" })
    expect(await catalog((c) => c.projects.getCompletedRepair(original.workspace.workspaceId, null, second, 1))).toMatchObject({ operationId: "second_move" })
    expect(await catalog((c) => c.projects.getCompletedRepair(original.workspace.workspaceId, null, second))).toBeNull()
    expect(await catalog((c) => c.projects.getCompletedRepair(original.workspace.workspaceId, original.workspace.rootPath, first))).toBeNull()
    expect(await catalog((c) => c.projects.getCompletedRepair(original.workspace.workspaceId, "another-folder", second))).toBeNull()
    await runtime.runPromise(Effect.flatMap(SqlClient.SqlClient, (sql) => sql`UPDATE project_operations SET state = 'unknown' WHERE operation_id = 'first_move'`))
    expect(await catalog((c) => c.projects.getCompletedRepair(original.workspace.workspaceId, original.workspace.rootPath, second))).toBeNull()
    expect(await catalog((c) => c.projects.getCompletedRepair(original.workspace.workspaceId, null, second, 1))).toBeNull()
  })

  it("preserves the project, workspace and lane across a non-Git move and restart", async () => {
    const original = await attached()
    const lane = await catalog((c) => c.getLane(original.workspace.workspaceId))
    const folderPath = path.join(root, "moved")
    await fs.rename(original.workspace.rootPath, folderPath)
    await restart()
    const request = { operationId: "repair_move", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId, folderPath }
    const repaired = value(await catalog((c) => c.projectLifecycle.repair(request, hooks)))
    expect(repaired.workspace).toMatchObject({ workspaceId: original.workspace.workspaceId, rootPath: folderPath, workspaceRevision: 2, storageOwnership: "attached", markerPolicy: "none" })
    expect((await catalog((c) => c.getLane(original.workspace.workspaceId)))?.laneId).toBe(lane?.laneId)
    expect((await catalog((c) => c.getLane(original.workspace.workspaceId)))?.projectRootPath).toBe(folderPath)
    expect(await fs.readdir(folderPath)).toEqual(["keep.txt"])
    expect(await fs.readFile(path.join(folderPath, "keep.txt"), "utf8")).toBe("original contents")
    await restart()
    expect(value(await catalog((c) => c.projectLifecycle.repair(request, hooks))).workspace.workspaceRevision).toBe(2)
    expect(prepareRuntime).toHaveBeenCalledTimes(1)
    expect(await catalog((c) => c.projects.list())).toHaveLength(1)
  })

  it("leaves the original binding unchanged when daemon session ownership rejects relocation", async () => {
    const original = await attached()
    const folderPath = path.join(root, "moved")
    await fs.rename(original.workspace.rootPath, folderPath)
    prepareRuntime.mockRejectedValueOnce(new Error("A session retains this folder"))
    expect(await catalog((c) => c.projectLifecycle.repair({ operationId: "retained_session", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId, folderPath }, hooks))).toMatchObject({ success: false, error: "A session retains this folder" })
    expect(await catalog((c) => c.getById(original.workspace.workspaceId))).toMatchObject({ rootPath: original.workspace.rootPath, workspaceRevision: 1 })
    expect(await catalog((c) => c.projects.getOperation("retained_session"))).toMatchObject({ state: "unknown", lastError: "A session retains this folder" })
    await restart()
    const result = value(await catalog((c) => c.projectLifecycle.repair({ operationId: "different_retry", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId, folderPath }, hooks)))
    expect(result.operationId).toBe("retained_session")
    expect(await catalog((c) => c.projects.getOperation("different_retry"))).toBeNull()
  })

  it("rejects copied folders even with matching markers and preserves original contents", async () => {
    const original = value(await catalog((c) => c.projectLifecycle.create({ operationId: "create", name: "Managed", slug: "managed", parentFolder: path.join(root, "projects") })))
    const folderPath = path.join(root, "copy")
    await fs.cp(original.workspace.rootPath, folderPath, { recursive: true })
    expect(await catalog((c) => c.projectLifecycle.repair({ operationId: "copy_repair", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId, folderPath }, hooks))).toMatchObject({ success: false, error: expect.stringContaining("copied or replacement") })
    expect(prepareRuntime).not.toHaveBeenCalled()
    expect(await catalog((c) => c.projects.getOperation("copy_repair"))).toBeNull()
    expect(await fs.readdir(folderPath)).toContain(".cozea")
  })

  it("repairs the proven original when another folder occupies its former path", async () => {
    const original = await attached()
    const folderPath = path.join(root, "moved")
    await fs.rename(original.workspace.rootPath, folderPath)
    await fs.mkdir(original.workspace.rootPath)
    await fs.writeFile(path.join(original.workspace.rootPath, "replacement.txt"), "replacement contents")
    const result = value(await catalog((c) => c.projectLifecycle.repair({ operationId: "path_reused", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId, folderPath }, hooks)))
    expect(result.workspace).toMatchObject({ workspaceId: original.workspace.workspaceId, projectRootPath: folderPath, workspaceRevision: 2 })
    expect(await fs.readdir(original.workspace.rootPath)).toEqual(["replacement.txt"])
    expect(await fs.readFile(path.join(original.workspace.rootPath, "replacement.txt"), "utf8")).toBe("replacement contents")
    expect(await fs.readFile(path.join(folderPath, "keep.txt"), "utf8")).toBe("original contents")
  })

  it("downgrades a moved managed folder outside its recorded root instead of claiming deletion authority", async () => {
    const original = value(await catalog((c) => c.projectLifecycle.create({ operationId: "create", name: "Managed", slug: "managed", parentFolder: path.join(root, "projects") })))
    const folderPath = path.join(root, "outside")
    await fs.rename(original.workspace.rootPath, folderPath)
    const result = value(await catalog((c) => c.projectLifecycle.repair({ operationId: "outside_move", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId, folderPath }, hooks)))
    expect(result.workspace).toMatchObject({ storageOwnership: "attached", managedRootId: null, workspaceRevision: 2 })
    expect(await catalog((c) => c.getManagedDeletionTarget(result.workspace.workspaceId))).toBeNull()
    expect(await fs.readdir(folderPath)).toContain(".cozea")
  })

  it("rejects a changed folder between runtime acknowledgement and binding commit", async () => {
    const original = await attached()
    const folderPath = path.join(root, "moved")
    await fs.rename(original.workspace.rootPath, folderPath)
    prepareRuntime.mockImplementationOnce(async () => {
      await fs.rename(folderPath, `${folderPath}-original`)
      await fs.mkdir(folderPath)
      await fs.writeFile(path.join(folderPath, "different.txt"), "replacement")
    })
    expect(await catalog((c) => c.projectLifecycle.repair({ operationId: "changed_after_prepare", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId, folderPath }, hooks))).toMatchObject({ success: false })
    expect(await catalog((c) => c.getById(original.workspace.workspaceId))).toMatchObject({ rootPath: original.workspace.rootPath, workspaceRevision: 1 })
    expect(await fs.readdir(folderPath)).toEqual(["different.txt"])
    await restart()
    expect(await catalog((c) => c.projectLifecycle.resumeRepair("changed_after_prepare", hooks))).toMatchObject({ success: false, error: expect.stringContaining("repair folder changed") })
  })

  it("replays a committed binding without incrementing revision when its completion receipt was lost", async () => {
    const original = await attached()
    const folderPath = path.join(root, "moved")
    await fs.rename(original.workspace.rootPath, folderPath)
    const repaired = value(await catalog((c) => c.projectLifecycle.repair({ operationId: "lost_reply", projectId: original.project.projectId, workspaceId: original.workspace.workspaceId, folderPath }, hooks)))
    await runtime.runPromise(Effect.flatMap(SqlClient.SqlClient, (sql) => sql`UPDATE project_operations SET state = 'running', stage = 'binding_committed' WHERE operation_id = 'lost_reply'`))
    await restart()
    expect(value(await catalog((c) => c.projectLifecycle.resumeRepair("lost_reply", hooks))).workspace).toMatchObject({ workspaceId: repaired.workspace.workspaceId, workspaceRevision: 2 })
    expect(await catalog((c) => c.projects.getOperation("lost_reply"))).toMatchObject({ state: "completed" })
  })

  it("keeps missing managed bindings when another project is created in the same parent", async () => {
    const original = value(await catalog((c) => c.projectLifecycle.create({ operationId: "first", name: "First", slug: "first", parentFolder: path.join(root, "projects") })))
    await fs.rename(original.workspace.rootPath, path.join(root, "original-moved"))
    await catalog((c) => c.verify(original.workspace.workspaceId))
    value(await catalog((c) => c.projectLifecycle.create({ operationId: "second", name: "Second", slug: "second", parentFolder: path.join(root, "projects") })))
    const compatibility = await catalog((c) => c.createForProject({ projectId: "compatibility_project", slug: "compatibility", rootPathOverride: path.join(root, "projects") }))
    expect(compatibility.success).toBe(true)
    expect(await catalog((c) => c.getById(original.workspace.workspaceId))).toMatchObject({ workspaceId: original.workspace.workspaceId, verificationStatus: "missing" })
    expect(await catalog((c) => c.getLane(original.workspace.workspaceId))).not.toBeNull()
  })
})

describe("bounded startup reconciliation", () => {
  it("completes original attachment intents, preserves uncertain folders, and skips explicit repairs/network effects", async () => {
    const folder = path.join(root, "pending")
    await fs.mkdir(folder)
    const stat = await fs.stat(folder)
    const project = value(await catalog((c) => c.projects.createEntry({ operationId: "pending_attach", kind: "attach", name: "Pending", slug: "pending", details: { sourceFolder: folder, sourceDevice: String(stat.dev), sourceInode: String(stat.ino), sourceBirthtime: String(stat.birthtimeMs) } })))
    value(await catalog((c) => c.projects.beginOperation({ operationId: "network", projectId: project.projectId, kind: "github_repo", details: { githubOwner: "owner", githubName: "repo" } })))
    value(await catalog((c) => c.projects.beginOperation({ operationId: "manual_repair", projectId: project.projectId, kind: "repair", details: { workspaceId: "not_bound" } })))
    await restart()
    expect(await catalog((c) => reconcileLocalProjectOperations({ projects: c.projects, lifecycle: c.projectLifecycle }))).toBe(1)
    expect(await catalog((c) => c.projects.getOperation("pending_attach"))).toMatchObject({ state: "completed" })
    expect(await catalog((c) => c.projects.getOperation("network"))).toMatchObject({ state: "pending" })
    expect(await catalog((c) => c.projects.getOperation("manual_repair"))).toMatchObject({ state: "pending" })
    expect(await fs.readdir(folder)).toEqual([])
  })
})
