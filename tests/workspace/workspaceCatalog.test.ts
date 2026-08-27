import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as Effect from 'effect/Effect'
import * as ManagedRuntime from 'effect/ManagedRuntime'

// gitRuntime imports `electron`; the catalog only touches it in
// createForProject/cloneForProject which these tests do not exercise.
vi.mock('../../apps/desktop/electron/gitRuntime.ts', () => ({
  runGitCommand: vi.fn(async () => ({
    success: true,
    exitCode: 0,
    stdout: '',
    stderr: '',
    executablePath: 'git',
    source: 'system',
  })),
}))

import {
  WorkspaceCatalog,
  type WorkspaceCatalogInterface,
} from '../../apps/desktop/electron/workspaces/WorkspaceCatalog.ts'
import { WorkspaceCatalogMemoryLayer } from '../../apps/desktop/electron/workspaces/WorkspaceCatalogLayer.ts'

type CatalogRuntime = ManagedRuntime.ManagedRuntime<WorkspaceCatalog, unknown>

let runtime: CatalogRuntime
let tmpRoot: string

function call<A>(f: (catalog: WorkspaceCatalogInterface) => Effect.Effect<A, unknown, never>): Promise<A> {
  return runtime.runPromise(
    Effect.flatMap(Effect.service(WorkspaceCatalog), f) as Effect.Effect<A, never, WorkspaceCatalog>,
  )
}

async function makeProjectDir(name: string): Promise<string> {
  const dir = path.join(tmpRoot, name)
  await fs.mkdir(dir, { recursive: true })
  return fs.realpath(dir)
}

async function readMarker(dir: string): Promise<{ workspaceId: string; projectId: string } | null> {
  try {
    const raw = await fs.readFile(path.join(dir, '.cozea', 'workspace.json'), 'utf-8')
    return JSON.parse(raw) as { workspaceId: string; projectId: string }
  } catch {
    return null
  }
}

async function writeMarker(dir: string, marker: { workspaceId: string; projectId: string }): Promise<void> {
  const markerDir = path.join(dir, '.cozea')
  await fs.mkdir(markerDir, { recursive: true })
  await fs.writeFile(
    path.join(markerDir, 'workspace.json'),
    JSON.stringify({ version: 1, createdBy: 'cozea', createdAt: Date.now(), ...marker }, null, 2),
    'utf-8',
  )
}

beforeEach(async () => {
  runtime = ManagedRuntime.make(WorkspaceCatalogMemoryLayer) as CatalogRuntime
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cozea-catalog-test-'))
})

afterEach(async () => {
  await runtime.dispose()
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('WorkspaceCatalog.bindExistingFolder', () => {
  it('binds a folder, writes a marker, and re-binding is a no-op returning the same workspace', async () => {
    const dir = await makeProjectDir('alpha')

    const first = await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dir }))
    expect(first.success).toBe(true)
    expect(first.workspace?.workspaceId).toBeTruthy()

    const marker = await readMarker(dir)
    expect(marker?.workspaceId).toBe(first.workspace!.workspaceId)
    expect(marker?.projectId).toBe('proj_a')

    const second = await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dir }))
    expect(second.success).toBe(true)
    expect(second.workspace?.workspaceId).toBe(first.workspace!.workspaceId)

    const all = await call((c) => c.listForProject('proj_a'))
    expect(all).toHaveLength(1)
  })

  it('forget removes the marker so the folder can be re-imported without a conflict', async () => {
    const dir = await makeProjectDir('beta')

    const first = await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dir }))
    expect(first.success).toBe(true)

    await call((c) => c.forget(first.workspace!.workspaceId))
    expect(await readMarker(dir)).toBeNull()

    const again = await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dir }))
    expect(again.success).toBe(true)
    expect(again.conflicts).toBeUndefined()
  })

  it('adopts the workspace id from a same-project marker (catalog reset survival)', async () => {
    const dir = await makeProjectDir('gamma')
    await writeMarker(dir, { workspaceId: 'lws_durable42', projectId: 'proj_a' })

    const result = await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dir }))
    expect(result.success).toBe(true)
    expect(result.workspace?.workspaceId).toBe('lws_durable42')
  })

  it('heals a drifted marker back to the catalog row instead of looping on conflicts', async () => {
    const dir = await makeProjectDir('delta')

    const first = await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dir }))
    const boundId = first.workspace!.workspaceId

    // Simulate a marker that no longer matches its row.
    await writeMarker(dir, { workspaceId: 'lws_drifted', projectId: 'proj_a' })

    const second = await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dir }))
    expect(second.success).toBe(true)
    expect(second.workspace?.workspaceId).toBe(boundId)

    const healed = await readMarker(dir)
    expect(healed?.workspaceId).toBe(boundId)

    const resolution = await call((c) =>
      c.resolveProject({ projectId: 'proj_a', projectSlug: null }),
    )
    expect(resolution.status).toBe('ready')
  })

  // Divergence pending a product decision: this asserts the pre-existing
  // "silently repoint the row to the folder's new path" behavior, while the
  // current catalog reports a marker_mismatch conflict so the move surfaces in
  // the conflicts UI instead. Unskip once we settle which one ships.
  it.skip('repoints the existing row when the folder moved (marker adoption, revision bump)', async () => {
    const dirA = await makeProjectDir('epsilon')

    const first = await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dirA }))
    const boundId = first.workspace!.workspaceId
    expect(first.workspace?.workspaceRevision).toBe(1)

    const dirB = path.join(tmpRoot, 'epsilon-moved')
    await fs.rename(dirA, dirB)

    const second = await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dirB }))
    expect(second.success).toBe(true)
    expect(second.workspace?.workspaceId).toBe(boundId)
    expect(second.workspace?.workspaceRevision).toBe(2)
    expect(second.workspace?.projectRootPath).toBe(await fs.realpath(dirB))

    const all = await call((c) => c.listForProject('proj_a'))
    expect(all).toHaveLength(1)
  })

  it('rejects binding a folder already bound to another project with a duplicate_path conflict', async () => {
    const dir = await makeProjectDir('zeta')

    const first = await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dir }))
    expect(first.success).toBe(true)

    const second = await call((c) => c.bindExistingFolder({ projectId: 'proj_b', folderPath: dir }))
    expect(second.success).toBe(false)
    expect(second.conflicts?.[0]?.reason).toBe('duplicate_path')
    expect(second.conflicts?.[0]?.existingProjectId).toBe('proj_a')
  })

  // Divergence pending a product decision: the current catalog only conflicts
  // when the foreign marker is still tracked in the catalog, and treats an
  // orphaned marker (deleted project or reset catalog) as stale and safe to
  // clear. This asserts the stricter "never clear a foreign marker" policy.
  it.skip("rejects a folder carrying another project's marker with a marker_mismatch conflict", async () => {
    const dir = await makeProjectDir('eta')
    await writeMarker(dir, { workspaceId: 'lws_other', projectId: 'proj_other' })

    const result = await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dir }))
    expect(result.success).toBe(false)
    expect(result.conflicts?.[0]?.reason).toBe('marker_mismatch')
    expect(result.conflicts?.[0]?.existingProjectId).toBe('proj_other')
  })

  it('keeps exactly one active workspace per project', async () => {
    const dirA = await makeProjectDir('theta-a')
    const dirB = await makeProjectDir('theta-b')

    await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dirA }))
    const second = await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dirB }))

    const all = await call((c) => c.listForProject('proj_a'))
    expect(all).toHaveLength(2)
    const active = all.filter((w) => Number(w.isActive) === 1)
    expect(active).toHaveLength(1)
    expect(active[0]?.workspaceId).toBe(second.workspace?.workspaceId)
  })
})

describe('WorkspaceCatalog.resolveProject', () => {
  it('resolves a bound project to ready with a default lane', async () => {
    const dir = await makeProjectDir('iota')
    await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dir }))

    const resolution = await call((c) =>
      c.resolveProject({ projectId: 'proj_a', projectSlug: null }),
    )
    expect(resolution.status).toBe('ready')
    if (resolution.status === 'ready') {
      expect(resolution.lane.laneId).toBeTruthy()
      expect(resolution.workspace.verificationStatus).toBe('verified')
    }
  })

  it('creates exactly one default lane under concurrent resolution', async () => {
    const dir = await makeProjectDir('kappa')
    await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dir }))

    const [a, b] = await Promise.all([
      call((c) => c.resolveProject({ projectId: 'proj_a', projectSlug: null })),
      call((c) => c.resolveProject({ projectId: 'proj_a', projectSlug: null })),
    ])

    expect(a.status).toBe('ready')
    expect(b.status).toBe('ready')
    if (a.status === 'ready' && b.status === 'ready') {
      expect(a.lane.laneId).toBe(b.lane.laneId)
    }
  })

  it('reports missing-binding for unknown projects', async () => {
    const resolution = await call((c) =>
      c.resolveProject({ projectId: 'proj_unknown', projectSlug: null }),
    )
    expect(resolution.status).toBe('missing-binding')
  })

  it('verify reports a null workspace for unknown ids instead of lying', async () => {
    const result = await call((c) => c.verify('lws_missing'))
    expect(result.status).toBe('missing')
    expect(result.workspace).toBeNull()
  })
})

describe('WorkspaceCatalog.buildSnapshotEntries', () => {
  it('returns one entry per project with the active workspace and lane', async () => {
    const dirA = await makeProjectDir('lambda-a')
    const dirB = await makeProjectDir('lambda-b')

    await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dirA }))
    await call((c) => c.bindExistingFolder({ projectId: 'proj_b', folderPath: dirB }))
    // Resolution creates the default lane for proj_a only.
    await call((c) => c.resolveProject({ projectId: 'proj_a', projectSlug: null }))

    const entries = await call((c) => c.buildSnapshotEntries())
    const byProject = new Map(entries.map((entry) => [entry.projectId, entry]))

    expect(byProject.size).toBe(2)
    expect(byProject.get('proj_a')?.status).toBe('ready')
    expect(byProject.get('proj_a')?.lane?.laneId).toBeTruthy()
    expect(byProject.get('proj_a')?.runtimeIdentity?.workspaceId).toBe(
      byProject.get('proj_a')?.workspace.workspaceId,
    )
    expect(byProject.get('proj_b')?.status).toBe('ready')
    expect(byProject.get('proj_b')?.lane).toBeNull()
  })

  it('marks workspaces broken once verification fails (deleted folder)', async () => {
    const dir = await makeProjectDir('mu')
    const bound = await call((c) => c.bindExistingFolder({ projectId: 'proj_a', folderPath: dir }))

    await fs.rm(dir, { recursive: true, force: true })
    await call((c) => c.verify(bound.workspace!.workspaceId))

    const entries = await call((c) => c.buildSnapshotEntries())
    const entry = entries.find((e) => e.projectId === 'proj_a')
    expect(entry?.status).toBe('broken')
    expect(entry?.reason).toBeTruthy()
  })
})
