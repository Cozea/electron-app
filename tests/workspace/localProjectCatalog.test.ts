import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Layer from "effect/Layer"
import * as SqlClient from "@effect/sql/SqlClient"

import type { Id } from "../../convex/_generated/dataModel"
import { createDeviceIdentityKey } from "../../shared/deviceIdentity"
import type { LocalProjectId, LocalProjectResult } from "../../shared/localProjectTypes"
import type { LocalProjectCatalogInterface } from "../../apps/desktop/electron/workspaces/LocalProjectCatalog"
import { WorkspaceCatalog, WorkspaceCatalogLive, type WorkspaceCatalogInterface } from "../../apps/desktop/electron/workspaces/WorkspaceCatalog"
import { WorkspaceCatalogMemoryLayer, makeWorkspaceCatalogLayer } from "../../apps/desktop/electron/workspaces/WorkspaceCatalogLayer"
import { layer as makeSqliteLayer } from "../../apps/desktop/electron/workspaces/SqliteClient"
import { runMigrations } from "../../apps/desktop/electron/workspaces/Migrations"

vi.mock("../../apps/desktop/electron/gitRuntime.ts", () => ({
  runGitCommand: vi.fn(async () => ({ success: true, exitCode: 0, stdout: "", stderr: "" })),
}))

type Runtime = ManagedRuntime.ManagedRuntime<WorkspaceCatalog | SqlClient.SqlClient, unknown>
let runtime: Runtime
let root: string

function catalog<A>(f: (catalog: WorkspaceCatalogInterface) => Effect.Effect<A>): Promise<A> {
  return runtime.runPromise(Effect.flatMap(Effect.service(WorkspaceCatalog), f))
}

function projects<A>(f: (catalog: LocalProjectCatalogInterface) => Effect.Effect<A>): Promise<A> {
  return catalog((c) => f(c.projects))
}

function value<A>(result: LocalProjectResult<A>): A {
  if (!result.success) throw new Error(result.error)
  return result.value
}

const createRequest = { operationId: "create_attempt_one", name: "My project", slug: "my-project" }

beforeEach(async () => {
  runtime = ManagedRuntime.make(WorkspaceCatalogMemoryLayer) as Runtime
  root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-local-project-test-"))
})

afterEach(async () => {
  await runtime.dispose()
  await fs.rm(root, { recursive: true, force: true })
})

describe("durable local project authority", () => {
  it("converges simultaneous retries on one identity", async () => {
    const attempts = await Promise.all(Array.from({ length: 4 }, () => projects((p) => p.createEntry(createRequest))))
    expect(new Set(attempts.map((result) => value(result).projectId)).size).toBe(1)
    expect(await projects((p) => p.list())).toHaveLength(1)
  })

  it("rolls back the project row when committing its operation intent fails", async () => {
    await runtime.runPromise(Effect.flatMap(Effect.service(SqlClient.SqlClient), (sql) => sql`
      CREATE TRIGGER reject_test_operation BEFORE INSERT ON project_operations
      BEGIN SELECT RAISE(ABORT, 'fixture journal failure'); END
    `))
    await expect(projects((p) => p.createEntry(createRequest))).rejects.toThrow()
    expect(await projects((p) => p.list())).toEqual([])
    expect(await projects((p) => p.getOperation(createRequest.operationId))).toBeNull()
  })

  it("upgrades an existing catalog once without rekeying or touching attached files", async () => {
    await runtime.dispose()
    const filename = path.join(root, "upgrade.sqlite")
    runtime = ManagedRuntime.make(WorkspaceCatalogLive.pipe(Layer.provideMerge(makeSqliteLayer({
      filename, transformResultNames: (name) => name.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()),
    })))) as Runtime
    await runtime.runPromise(runMigrations({ toMigrationInclusive: 3 }))
    const folder = path.join(root, "original-source")
    await fs.mkdir(folder)
    await fs.writeFile(path.join(folder, "keep.txt"), "original")
    const before = await fs.stat(folder)
    const binding = await catalog((c) => c.attachExistingFolder({ projectId: "legacy_shared_id", folderPath: folder }))
    expect(binding.success).toBe(true)
    await catalog((c) => c.upsertProjectsCache("legacy_shared_id", { name: "Known name", slug: "known-name" }))
    await catalog((c) => c.upsertProjectsCache("cached_without_folder", { name: "Needs attachment", slug: "unbound" }))
    const workspaceBefore = await catalog((c) => c.listForProject("legacy_shared_id"))
    await runtime.dispose()

    runtime = ManagedRuntime.make(makeWorkspaceCatalogLayer(filename)) as Runtime
    const migrated = await projects((p) => p.list())
    expect(migrated).toHaveLength(2)
    expect(migrated.find((p) => p.projectId === "legacy_shared_id")).toMatchObject({
      name: "Known name", slug: "known-name", cloudProjectId: "legacy_shared_id",
      sharedIdentityKey: null, sharedObservedAt: null,
    })
    expect(migrated.find((p) => p.projectId === "cached_without_folder")?.name).toBe("Needs attachment")
    expect(await catalog((c) => c.listForProject("legacy_shared_id"))).toEqual(workspaceBefore)
    expect((await fs.stat(folder)).ino).toBe(before.ino)
    expect(await fs.readFile(path.join(folder, "keep.txt"), "utf8")).toBe("original")
    await runtime.dispose()
    runtime = ManagedRuntime.make(makeWorkspaceCatalogLayer(filename)) as Runtime
    expect(await projects((p) => p.list())).toEqual(migrated)
  })

  it("allocates one local identity and operation without a cloud association", async () => {
    const first = value(await projects((p) => p.createEntry(createRequest)))
    const retry = value(await projects((p) => p.createEntry(createRequest)))
    expect(first.projectId).toMatch(/^lpj_[0-9a-f]{32}$/)
    expect(retry.projectId).toBe(first.projectId)
    expect(first).toMatchObject({ name: "My project", cloudProjectId: null, hidden: false, status: "provisioning" })
    expect(await projects((p) => p.list())).toHaveLength(1)
    expect(await projects((p) => p.listRecoverableOperations())).toMatchObject([
      { operationId: createRequest.operationId, projectId: first.projectId, state: "pending", stage: "requested", revision: 1 },
    ])
    expect(await projects((p) => p.createEntry({ ...createRequest, name: "Different request" }))).toMatchObject({ success: false })
    expect(await fs.readdir(root)).toEqual([])
  })

  it("keeps local name and hide choices independent of observed shared metadata", async () => {
    const project = value(await projects((p) => p.createEntry(createRequest)))
    await projects((p) => p.updateMetadata({ projectId: project.projectId, localName: "Personal alias", hidden: true }))
    const shared = value(await projects((p) => p.observeShared({
      projectId: project.projectId, cloudProjectId: "shared_project_one" as Id<"projects">,
      name: "Shared name", slug: "shared-name", status: "active",
      identityKey: createDeviceIdentityKey(new Uint8Array(16)),
    })))
    expect(shared).toMatchObject({ projectId: project.projectId, name: "Personal alias", hidden: true, sharedName: "Shared name" })
    expect(await projects((p) => p.list())).toHaveLength(1)
    const reset = value(await projects((p) => p.updateMetadata({ projectId: project.projectId, localName: null, hidden: false })))
    expect(reset.name).toBe("Shared name")
    expect(reset.slug).toBe("my-project")
    expect(await projects((p) => p.observeShared({
      projectId: project.projectId, cloudProjectId: "different_shared_project" as Id<"projects">,
      name: "Other", slug: "other", status: "active", identityKey: shared.sharedIdentityKey!,
    }))).toMatchObject({ success: false })
    expect((await projects((p) => p.get(project.projectId)))?.cloudProjectId).toBe("shared_project_one")
  })

  it("rejects invalid metadata and identity-shaped cloud projection claims", async () => {
    const project = value(await projects((p) => p.createEntry(createRequest)))
    expect(await projects((p) => p.updateMetadata({ projectId: project.projectId, localName: " " }))).toMatchObject({ success: false })
    expect(await projects((p) => p.observeShared({
      projectId: project.projectId, cloudProjectId: project.projectId as unknown as Id<"projects">,
      name: "Shared", slug: "shared", status: "active", identityKey: createDeviceIdentityKey(new Uint8Array(16)),
    }))).toMatchObject({ success: false })
    expect((await projects((p) => p.get(project.projectId)))?.cloudProjectId).toBeNull()
  })

  it("groups compatibility workspaces without changing their IDs, markers or ownership", async () => {
    const projectId = "historical_cloud_project"
    const folders = [path.join(root, "source"), path.join(root, "second-checkout")]
    for (const folder of folders) await fs.mkdir(folder)
    await fs.writeFile(path.join(folders[0], "source.txt"), "keep source")
    const first = await catalog((c) => c.attachExistingFolder({ projectId, folderPath: folders[0] }))
    const second = await catalog((c) => c.attachExistingFolder({ projectId, folderPath: folders[1] }))
    expect(first.success && second.success).toBe(true)
    const before = await catalog((c) => c.listForProject(projectId))
    const local = await projects((p) => p.list())
    expect(local).toHaveLength(1)
    expect(local[0]).toMatchObject({ projectId, cloudProjectId: projectId, name: "second-checkout", sharedObservedAt: null })
    expect(await catalog((c) => c.listForProject(projectId))).toEqual(before)
    expect(before.map((w) => w.storageOwnership)).toEqual(["attached", "attached"])
    expect(await fs.readFile(path.join(folders[0], "source.txt"), "utf8")).toBe("keep source")
    for (const folder of folders) expect(await fs.readdir(folder)).not.toContain(".cozea")
    expect(await projects((p) => p.list())).toEqual(local)
  })

  it("does not forget removal intent or reactivate a removed project on a late response", async () => {
    const project = value(await projects((p) => p.createEntry(createRequest)))
    const folder = path.join(root, "attached")
    await fs.mkdir(folder)
    const attachment = await catalog((c) => c.attachExistingFolder({ projectId: project.projectId, folderPath: folder }))
    expect(attachment.success).toBe(true)
    expect(await projects((p) => p.setStatus(project.projectId, "removed"))).toMatchObject({ success: false })
    await catalog((c) => c.forget(attachment.workspace!.workspaceId))
    expect(value(await projects((p) => p.setStatus(project.projectId, "removed"))).status).toBe("removed")
    expect(await projects((p) => p.setStatus(project.projectId, "active"))).toMatchObject({ success: false })
    expect(await projects((p) => p.list())).toEqual([])
    expect(await projects((p) => p.createEntry(createRequest))).toMatchObject({ success: false })
    expect(await fs.stat(folder)).toBeTruthy()
  })

  it("resumes the same creation after a durable stage transition and process restart", async () => {
    await runtime.dispose()
    const filename = path.join(root, "catalog.sqlite")
    runtime = ManagedRuntime.make(makeWorkspaceCatalogLayer(filename)) as Runtime
    const project = value(await projects((p) => p.createEntry(createRequest)))
    const prepared = value(await projects((p) => p.advanceOperation({
      operationId: createRequest.operationId, expectedRevision: 1, state: "running", stage: "prepared",
      details: { destinationFolder: path.join(root, "intended-folder") },
    })))
    await runtime.dispose()
    runtime = ManagedRuntime.make(makeWorkspaceCatalogLayer(filename)) as Runtime
    expect(value(await projects((p) => p.createEntry(createRequest))).projectId).toBe(project.projectId)
    expect(await projects((p) => p.getOperation(createRequest.operationId))).toEqual(prepared)
    expect(await projects((p) => p.list())).toHaveLength(1)
  })
})

describe("project operation reconciliation", () => {
  it("rejects a reused operation ID with different intent, including a different project", async () => {
    const a = value(await projects((p) => p.createEntry(createRequest)))
    const b = value(await projects((p) => p.createEntry({ ...createRequest, operationId: "create_two" })))
    const request = { operationId: "attach_one", projectId: a.projectId, kind: "attach" as const, details: { sourceFolder: root, name: "A" } }
    const first = value(await projects((p) => p.beginOperation(request)))
    expect(value(await projects((p) => p.beginOperation({ ...request, details: { name: "A", sourceFolder: root } })))).toEqual(first)
    expect(await projects((p) => p.beginOperation({ ...request, projectId: b.projectId }))).toMatchObject({ success: false })
    expect(await projects((p) => p.beginOperation({ ...request, details: { sourceFolder: "different" } }))).toMatchObject({ success: false })
  })

  it("keeps immutable resource evidence and rejects backward/stale transitions", async () => {
    value(await projects((p) => p.createEntry(createRequest)))
    const prepared = value(await projects((p) => p.advanceOperation({
      operationId: createRequest.operationId, expectedRevision: 1, state: "running", stage: "prepared",
      details: { destinationFolder: root },
    })))
    expect(await projects((p) => p.advanceOperation({
      operationId: prepared.operationId, expectedRevision: prepared.revision, state: "running", stage: "requested",
    }))).toMatchObject({ success: false })
    expect(await projects((p) => p.advanceOperation({
      operationId: prepared.operationId, expectedRevision: prepared.revision, state: "running", details: { destinationFolder: "changed" },
    }))).toMatchObject({ success: false })
    const applied = value(await projects((p) => p.advanceOperation({
      operationId: prepared.operationId, expectedRevision: prepared.revision, state: "running", stage: "effect_applied",
      details: { destinationFolder: undefined, workspaceId: "workspace_kept" },
    })))
    expect(applied.details.destinationFolder).toBe(root)
    const unknown = value(await projects((p) => p.advanceOperation({
      operationId: applied.operationId, expectedRevision: applied.revision, state: "unknown", lastError: "Response lost",
    })))
    const completed = value(await projects((p) => p.advanceOperation({
      operationId: unknown.operationId, expectedRevision: unknown.revision, state: "completed",
    })))
    expect(completed).toMatchObject({ state: "completed", stage: "completed", lastError: null })
    expect(await projects((p) => p.advanceOperation({
      operationId: applied.operationId, expectedRevision: applied.revision, state: "failed", lastError: "Late timeout",
    }))).toMatchObject({ success: false })
    expect(await projects((p) => p.advanceOperation({
      operationId: completed.operationId, expectedRevision: completed.revision, state: "failed",
    }))).toMatchObject({ success: false })
    expect(await projects((p) => p.listRecoverableOperations())).toEqual([])
    expect(await projects((p) => p.getOperation(completed.operationId))).toEqual(completed)
  })

  it("validates operation bounds before committing intent", async () => {
    const project = value(await projects((p) => p.createEntry(createRequest)))
    expect(await projects((p) => p.beginOperation({
      operationId: "bad_path", projectId: project.projectId, kind: "attach", details: { sourceFolder: "x".repeat(4097) },
    }))).toMatchObject({ success: false })
    expect(await projects((p) => p.beginOperation({
      operationId: "missing_project", projectId: "nonexistent" as LocalProjectId, kind: "share", details: {},
    }))).toMatchObject({ success: false })
    expect(await projects((p) => p.getOperation("bad_path"))).toBeNull()
  })
})
