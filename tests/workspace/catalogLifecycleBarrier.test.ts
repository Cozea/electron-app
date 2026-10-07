import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as SqlClient from "@effect/sql/SqlClient"
import { WorkspaceCatalog, type WorkspaceCatalogInterface } from "../../apps/desktop/electron/workspaces/WorkspaceCatalog"
import { makeWorkspaceCatalogLayer } from "../../apps/desktop/electron/workspaces/WorkspaceCatalogLayer"

const bridge = vi.hoisted(() => ({ run: null as null | ((eff: unknown) => Promise<unknown>), send: vi.fn() }))
vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: bridge.send } }] } }))
vi.mock("../../apps/desktop/electron/workspaces/WorkspaceCatalogRuntime.ts", () => ({
  waitForWorkspaceCatalogRuntime: async () => ({ runPromise: (eff: unknown) => bridge.run!(eff) }),
}))
vi.mock("../../apps/desktop/electron/gitRuntime.ts", () => ({
  runGitCommand: vi.fn(async () => ({ success: true, stdout: "", stderr: "", exitCode: 0 })),
}))
type Runtime = ManagedRuntime.ManagedRuntime<WorkspaceCatalog | SqlClient.SqlClient, unknown>
let runtime: Runtime
let root: string
let snapshots: typeof import("../../apps/desktop/electron/workspaces/CatalogSnapshot")
function catalog<A>(action: (catalog: WorkspaceCatalogInterface) => Effect.Effect<A>) {
  return runtime.runPromise(Effect.flatMap(Effect.service(WorkspaceCatalog), action))
}
beforeEach(async () => {
  vi.resetModules()
  root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-snapshot-barrier-"))
  runtime = ManagedRuntime.make(makeWorkspaceCatalogLayer(path.join(root, "catalog.sqlite"))) as Runtime
  bridge.run = (eff) => runtime.runPromise(eff as Effect.Effect<unknown, unknown, WorkspaceCatalog | SqlClient.SqlClient>)
  bridge.send.mockClear()
  snapshots = await import("../../apps/desktop/electron/workspaces/CatalogSnapshot")
})
afterEach(async () => { snapshots.stopCatalogSnapshotService(); await runtime.dispose(); await fs.rm(root, { recursive: true, force: true }) })

describe("catalog lifecycle reply barrier", () => {
  it("publishes the saved local name and hide value before the next preference action", async () => {
    const created = await catalog((c) => c.projectLifecycle.create({ operationId: "metadata_barrier", name: "Local", slug: "local", parentFolder: path.join(root, "projects") }))
    if (!created.success) throw new Error(created.error)
    await snapshots.flushCatalogSnapshotAfterMutation()
    for (const hidden of [true, false]) {
      const updated = await catalog((c) => c.projects.updateMetadata({ projectId: created.value.project.projectId, localName: "Personal name", hidden }))
      if (!updated.success) throw new Error(updated.error)
      const snapshot = await snapshots.flushCatalogSnapshotAfterMutation()
      expect(snapshot.projects?.[updated.value.projectId]).toMatchObject({ localName: "Personal name", hidden, cloudProjectId: null })
      expect(snapshot.entries[updated.value.projectId].workspace.workspaceId).toBe(created.value.workspace.workspaceId)
      expect(bridge.send.mock.lastCall?.[1]).toBe(snapshot)
    }
  })

  it("publishes a committed local entry and workspace before resolving", async () => {
    await snapshots.getCatalogSnapshot()
    const result = await catalog((c) => c.projectLifecycle.create({ operationId: "create_barrier", name: "Local", slug: "local", parentFolder: path.join(root, "projects") }))
    if (!result.success) throw new Error(result.error)
    const snapshot = await snapshots.flushCatalogSnapshotAfterMutation()
    expect(snapshot.projects?.[result.value.project.projectId]).toMatchObject({ name: "Local", cloudProjectId: null })
    expect(snapshot.entries[result.value.project.projectId].workspace.workspaceId).toBe(result.value.workspace.workspaceId)
    expect(bridge.send.mock.lastCall?.[1]).toBe(snapshot)
  })

  it("waits for a new read when an earlier snapshot SELECT predates the mutation", async () => {
    let release!: () => void, captured!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const ready = new Promise<void>((resolve) => { captured = resolve })
    const normal = bridge.run!
    let selects = 0
    bridge.run = async (eff) => {
      const result = await normal(eff)
      if (++selects <= 2) {
        if (selects === 2) captured()
        await gate
      }
      return result
    }
    const old = snapshots.getCatalogSnapshot()
    await ready
    const result = await catalog((c) => c.projectLifecycle.create({ operationId: "racing_create", name: "After SELECT", slug: "after", parentFolder: path.join(root, "projects") }))
    if (!result.success) throw new Error(result.error)
    let resolved = false
    const barrier = snapshots.flushCatalogSnapshotAfterMutation().then((snapshot) => { resolved = true; return snapshot })
    await Promise.resolve()
    expect(resolved).toBe(false)
    release()
    expect((await old).projects).toEqual({})
    const current = await barrier
    expect(current.projects?.[result.value.project.projectId]).toMatchObject({ name: "After SELECT" })
    expect(bridge.send.mock.lastCall?.[1]).toBe(current)
  })
})
