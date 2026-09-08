import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))
import { DesktopStatePersistenceService } from '../../../apps/desktop/electron/services/DesktopStatePersistenceService'

describe('real persistence worker transport', () => {
  let root: string
  let service: DesktopStatePersistenceService
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cozea-worker-'))
    const entry = path.join(root, 'worker.cjs')
    execFileSync('bun', ['build', 'apps/desktop/electron/workers/desktopStatePersistenceWorker.ts', '--target=node', '--format=cjs', `--outfile=${entry}`], { stdio: 'pipe' })
    service = new DesktopStatePersistenceService(root, entry)
  }, 30_000)
  afterAll(async () => { await service?.dispose(); if (root) await fs.rm(root, { recursive: true, force: true }) })
  it('loads and commits through an actual worker and uses operation watermarks', async () => {
    expect((await service.load('workbenchLayout', ['scope'])).records).toEqual([])
    expect(service.getWorkerThreadId()).toBeGreaterThan(0)
    const result = await service.commit([{ schemaVersion: 1, namespace: 'workbenchLayout', key: 'scope', recordRevision: 100, updatedAt: Date.now(), data: { layout: { grid: {}, panels: {} }, layoutResetKey: 0 } }])
    expect(result.status).toBe('committed')
    expect(result.committedRevisions.scope).toBe(1)
    expect((await service.flush(result.watermark)).status).toBe('flushed')
    expect((await service.load('workbenchLayout', ['scope'])).records[0].recordRevision).toBe(1)
  })
  it('rejects renderer access to the main-only session registry', () => {
    expect(() => service.load('sessionRegistry')).toThrow('Namespace not accessible')
  })
})
