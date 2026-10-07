import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as SqlClient from "@effect/sql/SqlClient"

import type { LocalProjectResult } from "../../shared/localProjectTypes"
import { WorkspaceCatalog, type WorkspaceCatalogInterface } from "../../apps/desktop/electron/workspaces/WorkspaceCatalog"
import { makeWorkspaceCatalogLayer } from "../../apps/desktop/electron/workspaces/WorkspaceCatalogLayer"
import { writeWorkspaceMarker } from "../../apps/desktop/electron/workspaces/markers"
import { runGitCommand } from "../../apps/desktop/electron/gitRuntime"

vi.mock("../../apps/desktop/electron/gitRuntime.ts", () => ({
  runGitCommand: vi.fn(async () => ({ success: true, exitCode: 0, stdout: "", stderr: "" })),
}))

type Runtime = ManagedRuntime.ManagedRuntime<WorkspaceCatalog | SqlClient.SqlClient, unknown>
let runtime: Runtime
let root: string
let filename: string
let parent: string

function catalog<A>(f: (catalog: WorkspaceCatalogInterface) => Effect.Effect<A>): Promise<A> {
  return runtime.runPromise(Effect.flatMap(Effect.service(WorkspaceCatalog), f))
}
function value<A>(result: LocalProjectResult<A>): A {
  if (!result.success) throw new Error(result.error)
  return result.value
}
function create(operationId = "create_local_one") {
  return catalog((c) => c.projectLifecycle.create({ operationId, name: "Personal project", slug: "personal-project", parentFolder: parent }))
}
async function restart() {
  await runtime.dispose()
  runtime = ManagedRuntime.make(makeWorkspaceCatalogLayer(filename)) as Runtime
}

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "cozea-project-lifecycle-")))
  filename = path.join(root, "catalog.sqlite")
  parent = path.join(root, "projects")
  runtime = ManagedRuntime.make(makeWorkspaceCatalogLayer(filename)) as Runtime
  vi.mocked(runGitCommand).mockReset().mockResolvedValue({ success: true, exitCode: 0, stdout: "", stderr: "", executablePath: "git", source: "system" })
})
afterEach(async () => {
  await runtime.dispose()
  await fs.rm(root, { recursive: true, force: true })
})

describe("journal-backed local project folder lifecycle", () => {
  it("creates offline and converges simultaneous retries without another folder", async () => {
    const attempts = await Promise.all([create(), create(), create()])
    const first = value(attempts[0])
    expect(attempts.map((result) => value(result).project.projectId)).toEqual(Array(3).fill(first.project.projectId))
    expect(first.project).toMatchObject({ status: "active", cloudProjectId: null })
    expect(first.workspace).toMatchObject({ storageOwnership: "managed", markerPolicy: "required", projectRootPath: path.join(parent, "personal-project") })
    expect(await fs.readdir(parent)).toEqual(["personal-project"])
    expect(await fs.readFile(path.join(first.workspace.projectRootPath, ".gitignore"), "utf8")).toBe("node_modules/\n.env\n")
    expect(await catalog((c) => c.projects.getOperation("create_local_one"))).toMatchObject({ state: "completed", stage: "completed" })
    await restart()
    expect(value(await create()).workspace.workspaceId).toBe(first.workspace.workspaceId)
    expect(await fs.readdir(parent)).toEqual(["personal-project"])
  })

  it("allocates distinct folders for independent requests with the same name", async () => {
    const attempts = await Promise.all([create("first_request"), create("second_request")])
    expect(new Set(attempts.map((result) => value(result).project.projectId)).size).toBe(2)
    expect((await fs.readdir(parent)).sort()).toEqual(["personal-project", "personal-project-2"])
  })

  it("preserves the absent path of a moved binding when allocating another project", async () => {
    const original = value(await create("original"))
    const moved = path.join(root, "moved-original")
    await fs.rename(original.workspace.rootPath, moved)
    await restart()
    const next = value(await create("next"))
    expect(next.workspace.projectRootPath).toBe(path.join(parent, "personal-project-2"))
    expect(await catalog((c) => c.getById(original.workspace.workspaceId))).toMatchObject({ projectRootPath: original.workspace.rootPath })
    expect(await fs.readFile(path.join(moved, ".gitignore"), "utf8")).toBe("node_modules/\n.env\n")
    expect(await fs.readdir(parent)).toEqual(["personal-project-2"])
  })

  it("does not claim an absent folder already reserved by an interrupted creation", async () => {
    const registered = value(await create("root_registration"))
    const reserved = path.join(parent, "reserved")
    value(await catalog((c) => c.projects.createEntry({ operationId: "waiting", name: "Reserved", slug: "reserved", details: { parentFolder: parent } })))
    value(await catalog((c) => c.projects.advanceOperation({ operationId: "waiting", expectedRevision: 1, state: "running", stage: "prepared", details: {
      destinationFolder: reserved, workspaceId: "reserved_workspace", managedRootId: registered.workspace.managedRootId!,
    } })))
    await restart()
    const next = value(await catalog((c) => c.projectLifecycle.create({ operationId: "next", name: "Reserved", slug: "reserved", parentFolder: parent })))
    expect(next.workspace.projectRootPath).toBe(path.join(parent, "reserved-2"))
    expect(await fs.readdir(parent)).not.toContain("reserved")
    expect(await catalog((c) => c.projects.getOperation("waiting"))).toMatchObject({ state: "running", details: { destinationFolder: reserved } })
  })

  it("resumes a failed Git initialization in the reserved folder after restart", async () => {
    vi.mocked(runGitCommand).mockResolvedValueOnce({ success: false, exitCode: 1, stdout: "", stderr: "Git temporarily unavailable", executablePath: "git", source: "system" })
    expect(await create()).toMatchObject({ success: false, error: "Git temporarily unavailable" })
    const before = (await catalog((c) => c.projects.list()))[0]
    expect(before.status).toBe("provisioning")
    expect(await catalog((c) => c.projects.getOperation("create_local_one"))).toMatchObject({ state: "unknown", stage: "prepared" })
    await restart()
    const result = value(await catalog((c) => c.projectLifecycle.resume("create_local_one")))
    expect(result.project.projectId).toBe(before.projectId)
    expect(result.project.status).toBe("active")
    expect(await fs.readdir(parent)).toEqual(["personal-project"])
  })

  it("preserves an uncertain reserved folder and never invents another destination on retry", async () => {
    await fs.mkdir(parent)
    const project = value(await catalog((c) => c.projects.createEntry({ operationId: "uncertain_creation", name: "Project", slug: "project", details: { parentFolder: parent, initGit: true } })))
    // Prepare the durable receipt through a successful root registration, then
    // simulate an interrupted mkdir before its ownership marker was written.
    const other = value(await create("root_registration"))
    const folder = path.join(parent, "reserved")
    await fs.mkdir(folder)
    await fs.writeFile(path.join(folder, "keep.txt"), "unclaimed data")
    value(await catalog((c) => c.projects.advanceOperation({
      operationId: "uncertain_creation", expectedRevision: 1, state: "running", stage: "prepared",
      details: { destinationFolder: folder, workspaceId: "reserved_workspace", managedRootId: other.workspace.managedRootId! },
    })))
    await restart()
    expect(await catalog((c) => c.projectLifecycle.resume("uncertain_creation"))).toMatchObject({ success: false, error: expect.stringContaining("ownership marker") })
    expect(await catalog((c) => c.projectLifecycle.resume("uncertain_creation"))).toMatchObject({ success: false })
    expect(await fs.readFile(path.join(folder, "keep.txt"), "utf8")).toBe("unclaimed data")
    expect(await catalog((c) => c.listForProject(project.projectId))).toEqual([])
    expect((await fs.readdir(parent)).sort()).toEqual(["personal-project", "reserved"])
  })

  it("recovers a committed binding when the operation's completion receipt was lost", async () => {
    const folder = path.join(root, "attached")
    await fs.mkdir(folder)
    const stat = await fs.stat(folder)
    const project = value(await catalog((c) => c.projects.createEntry({
      operationId: "interrupted_attach", kind: "attach", name: "Attached", slug: "attached",
      details: { sourceFolder: folder, sourceDevice: String(stat.dev), sourceInode: String(stat.ino), sourceBirthtime: String(stat.birthtimeMs) },
    })))
    const bound = await catalog((c) => c.attachExistingFolder({ projectId: project.projectId, folderPath: folder }))
    await restart()
    const result = value(await catalog((c) => c.projectLifecycle.open({ operationId: "new_attempt", folderPath: folder, name: "Another name", slug: "another" })))
    expect(result.project.projectId).toBe(project.projectId)
    expect(result.workspace.workspaceId).toBe(bound.workspace?.workspaceId)
    expect(await catalog((c) => c.projects.getOperation("interrupted_attach"))).toMatchObject({ state: "completed" })
    expect(await catalog((c) => c.projects.getOperation("new_attempt"))).toBeNull()
    expect(await catalog((c) => c.projects.list())).toHaveLength(1)
  })

  it("opens the canonical original folder once and leaves non-Git source untouched", async () => {
    const folder = path.join(root, "source")
    const alias = path.join(root, "source-alias")
    await fs.mkdir(folder)
    await fs.writeFile(path.join(folder, "keep.txt"), "source contents")
    await fs.symlink(folder, alias)
    const before = await fs.stat(folder)
    const first = value(await catalog((c) => c.projectLifecycle.open({ operationId: "attach_one", folderPath: alias, name: "Source", slug: "source" })))
    const repeated = value(await catalog((c) => c.projectLifecycle.open({ operationId: "attach_two", folderPath: folder, name: "Renamed request", slug: "renamed" })))
    expect(first.workspace).toMatchObject({ projectRootPath: folder, storageOwnership: "attached", markerPolicy: "none", managedRootId: null })
    expect(repeated).toMatchObject({ project: { projectId: first.project.projectId, name: "Source" }, reusedExisting: true })
    expect((await fs.stat(folder)).ino).toBe(before.ino)
    expect(await fs.readdir(folder)).toEqual(["keep.txt"])
    expect(await fs.readFile(path.join(folder, "keep.txt"), "utf8")).toBe("source contents")
    expect(vi.mocked(runGitCommand)).not.toHaveBeenCalled()
    expect(await catalog((c) => c.projects.list())).toHaveLength(1)
  })

  it("reuses a pending attachment before any binding exists after restart", async () => {
    const folder = path.join(root, "pending-source")
    await fs.mkdir(folder)
    await fs.writeFile(path.join(folder, "keep.txt"), "source")
    const stat = await fs.stat(folder)
    const project = value(await catalog((c) => c.projects.createEntry({
      operationId: "pending_attach", kind: "attach", name: "Original", slug: "original",
      details: { sourceFolder: folder, sourceDevice: String(stat.dev), sourceInode: String(stat.ino), sourceBirthtime: String(stat.birthtimeMs) },
    })))
    await restart()
    const opened = value(await catalog((c) => c.projectLifecycle.open({
      operationId: "retry_attach", folderPath: folder, name: "Changed request", slug: "changed",
    })))
    expect(opened.project).toMatchObject({ projectId: project.projectId, name: "Original", cloudProjectId: null })
    expect(await catalog((c) => c.projects.getOperation("retry_attach"))).toBeNull()
    expect(await catalog((c) => c.projects.list())).toHaveLength(1)
    expect(await fs.readdir(folder)).toEqual(["keep.txt"])
  })

  it("rejects a replaced source folder rather than attaching new contents during recovery", async () => {
    const folder = path.join(root, "source")
    await fs.mkdir(folder)
    const stat = await fs.stat(folder)
    const project = value(await catalog((c) => c.projects.createEntry({
      operationId: "source_replaced", kind: "attach", name: "Source", slug: "source",
      details: { sourceFolder: folder, sourceDevice: String(stat.dev), sourceInode: String(stat.ino), sourceBirthtime: String(stat.birthtimeMs) },
    })))
    await fs.rename(folder, `${folder}-original`)
    await fs.mkdir(folder)
    await fs.writeFile(path.join(folder, "different.txt"), "new contents")
    await restart()
    expect(await catalog((c) => c.projectLifecycle.resume("source_replaced"))).toMatchObject({ success: false, error: expect.stringContaining("source folder changed") })
    expect(await catalog((c) => c.projectLifecycle.open({ operationId: "replacement_retry",
      name: "New contents", slug: "new-contents", folderPath: folder }))).toMatchObject({ success: false })
    expect(await catalog((c) => c.projects.getOperation("replacement_retry"))).toBeNull()
    expect(await catalog((c) => c.listForProject(project.projectId))).toEqual([])
    expect(await fs.readdir(folder)).toEqual(["different.txt"])
  })

  it("resumes ownership-proven creation without overwriting an existing gitignore", async () => {
    const rootEntry = value(await create("root_entry"))
    const project = value(await catalog((c) => c.projects.createEntry({ operationId: "marker_recovery", name: "Recovered", slug: "recovered", details: { parentFolder: parent, initGit: true } })))
    const folder = path.join(parent, "recovered")
    await fs.mkdir(folder)
    await fs.writeFile(path.join(folder, ".gitignore"), "custom\n")
    await writeWorkspaceMarker(folder, { version: 1, projectId: project.projectId, workspaceId: "recovered_workspace", createdBy: "cozea", createdAt: Date.now() })
    value(await catalog((c) => c.projects.advanceOperation({ operationId: "marker_recovery", expectedRevision: 1, state: "running", stage: "prepared", details: { destinationFolder: folder, workspaceId: "recovered_workspace", managedRootId: rootEntry.workspace.managedRootId! } })))
    await restart()
    const recovered = value(await catalog((c) => c.projectLifecycle.resume("marker_recovery")))
    expect(recovered.workspace.workspaceId).toBe("recovered_workspace")
    expect(await fs.readFile(path.join(folder, ".gitignore"), "utf8")).toBe("custom\n")
    expect(await catalog((c) => c.getManagedDeletionTarget("recovered_workspace"))).not.toBeNull()
  })

  it("rejects malformed intent before allocating a project or folder", async () => {
    expect(await catalog((c) => c.projectLifecycle.create({ operationId: "bad_slug", name: "Project", slug: "../escape", parentFolder: parent }))).toMatchObject({ success: false })
    expect(await catalog((c) => c.projectLifecycle.create({ operationId: "bad_parent", name: "Project", slug: "project", parentFolder: "relative" }))).toMatchObject({ success: false })
    expect(await catalog((c) => c.projectLifecycle.open({ operationId: "missing_source", folderPath: path.join(root, "missing"), name: "Project", slug: "project" }))).toMatchObject({ success: false })
    expect(await catalog((c) => c.projects.list())).toEqual([])
    expect(await fs.readdir(root)).not.toContain("projects")
  })

  it("does not accept a completed create receipt after its ownership marker disappeared", async () => {
    const result = value(await create())
    await fs.rename(path.join(result.workspace.projectRootPath, ".cozea"), path.join(result.workspace.projectRootPath, "marker-backup"))
    await restart()
    expect(await create()).toMatchObject({ success: false, error: expect.stringContaining("ownership changed") })
    expect(await fs.readdir(parent)).toEqual(["personal-project"])
    expect(await catalog((c) => c.projects.getOperation("create_local_one"))).toMatchObject({ state: "completed" })
  })

  it("does not recreate a folder missing after its recorded filesystem effect", async () => {
    const rootEntry = value(await create("existing_root"))
    value(await catalog((c) => c.projects.createEntry({ operationId: "effect_lost", name: "Lost", slug: "lost", details: { parentFolder: parent, initGit: true } })))
    const folder = path.join(parent, "lost")
    value(await catalog((c) => c.projects.advanceOperation({ operationId: "effect_lost", expectedRevision: 1, state: "running", stage: "effect_applied", details: { destinationFolder: folder, workspaceId: "lost_workspace", managedRootId: rootEntry.workspace.managedRootId! } })))
    await restart()
    expect(await catalog((c) => c.projectLifecycle.resume("effect_lost"))).toMatchObject({ success: false })
    expect(await fs.readdir(parent)).toEqual(["personal-project"])
    expect(await catalog((c) => c.projects.getOperation("effect_lost"))).toMatchObject({ state: "unknown", stage: "effect_applied" })
  })
})
