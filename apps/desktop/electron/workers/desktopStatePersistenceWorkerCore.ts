import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  isDesktopStateNamespace, isLegacyDesktopDomain, isPlainRecord, validateDesktopStateRecord,
  type DesktopStateNamespace, type DesktopStateRecord, type PersistenceCommitResult,
  type PersistenceLoadResult, type PersistenceFlushResult, type LegacyMigrationResult,
} from '../../../../shared/desktopPersistenceTypes'

export interface WorkerCoreOptions { userDataPath: string }
const MAX_QUERY_BYTES = 1024 * 1024
const MAX_RECORD_BYTES = 32 * 1024 * 1024
const MAX_MIGRATION_BYTES = 128 * 1024 * 1024
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT' }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/** Only instantiated in the dedicated worker (or isolated filesystem unit tests). */
export class DesktopStatePersistenceWorkerCore {
  private readonly baseDir: string
  private readonly ready: Promise<void>
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly migrations = new Map<string, Promise<LegacyMigrationResult>>()
  private readonly writes = new Set<Promise<unknown>>()
  private readonly failedKeys = new Map<string, string>()
  private completedOperations = 0
  constructor(options: WorkerCoreOptions) {
    this.baseDir = path.join(options.userDataPath, 'desktop-state-v2')
    this.ready = Promise.all(['records', 'backups', 'quarantine', 'migration-markers'].map(name =>
      fs.mkdir(path.join(this.baseDir, name), { recursive: true, mode: 0o700 }))).then(() => undefined)
  }
  getRecordHash(namespace: DesktopStateNamespace, key: string): string {
    return createHash('sha256').update(JSON.stringify([namespace, key])).digest('hex')
  }
  private recordPath(hash: string): string { return path.join(this.baseDir, 'records', `rec_${hash}.json`) }
  private async readFile(file: string): Promise<DesktopStateRecord | null> {
    let raw: string
    try { raw = await fs.readFile(file, 'utf8') } catch (error) { if (missing(error)) return null; throw error }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!validateDesktopStateRecord(parsed)) throw new Error('Invalid desktop-state envelope')
      // Support previous hash filenames on import, but never trust their embedded key blindly.
      return parsed
    } catch (error) {
      const quarantine = path.join(this.baseDir, 'quarantine', `${Date.now()}-${randomUUID()}.json`)
      await fs.copyFile(file, quarantine)
      // Keep original in place so corruption is NOT mistaken for absence on a retry.
      throw new Error(`Desktop state needs recovery (${path.basename(file)}): ${errorText(error)}`)
    }
  }
  private async readRecord(namespace: DesktopStateNamespace, key: string): Promise<DesktopStateRecord | null> {
    const hash = this.getRecordHash(namespace, key)
    let rec = await this.readFile(this.recordPath(hash))
    if (!rec) {
      // Compatibility with files written by the reviewed, never-launched implementation.
      const oldHash = createHash('sha256').update(`${namespace}::${key}`).digest('hex')
      rec = await this.readFile(this.recordPath(oldHash))
    }
    if (rec && (rec.namespace !== namespace || rec.key !== key)) throw new Error('Desktop state key mismatch')
    return rec
  }
  async load(namespace: DesktopStateNamespace, keys?: string[]): Promise<PersistenceLoadResult> {
    if (!isDesktopStateNamespace(namespace)) throw new Error('Invalid namespace')
    if (keys && (keys.length > 256 || keys.some(key => typeof key !== 'string' || !key || key.length > 8192))) throw new Error('Invalid record keys')
    await this.ready
    const records: DesktopStateRecord[] = []
    if (keys !== undefined) {
      for (const key of keys) { const rec = await this.readRecord(namespace, key); if (rec) records.push(rec) }
    } else {
      const latest = new Map<string, DesktopStateRecord>()
      for (const file of await fs.readdir(path.join(this.baseDir, 'records'))) {
        if (!/^rec_[a-f0-9]{64}\.json$/.test(file)) continue
        const rec = await this.readFile(path.join(this.baseDir, 'records', file))
        if (rec?.namespace !== namespace) continue
        const old = latest.get(rec.key)
        if (!old || rec.recordRevision > old.recordRevision) latest.set(rec.key, rec)
      }
      records.push(...latest.values())
    }
    return { records }
  }
  private async atomicWrite(file: string, content: string): Promise<void> {
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temporary, 'wx', 0o600)
      try { await handle.writeFile(content, 'utf8'); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, file)
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined)
      throw error
    }
  }
  async commit(records: DesktopStateRecord[]): Promise<PersistenceCommitResult> {
    if (!Array.isArray(records) || records.length > 16 || records.some(record => !validateDesktopStateRecord(record))) throw new Error('Invalid record batch')
    await this.ready
    const committedRevisions: Record<string, number> = Object.create(null) as Record<string, number>
    // Validate and encode the entire batch before starting its first write.
    let encoded: { record: DesktopStateRecord; json: string }[]
    try { encoded = records.map(record => {
      const json = JSON.stringify(record)
      const bytes = Buffer.byteLength(json)
      if (bytes > MAX_RECORD_BYTES) throw new Error(`Desktop state record exceeds supported transport size: ${record.namespace}`)
      if (record.namespace === 'queryCache' && bytes > MAX_QUERY_BYTES) throw new Error(`Query cache entry exceeds 1 MiB limit for key: ${record.key}`)
      return { record, json }
    }) } catch (error) { return { status: 'error', committedRevisions, errorMessage: errorText(error) } }
    try {
      for (const { record, json } of encoded) {
        const hash = this.getRecordHash(record.namespace, record.key)
        const previous = this.queues.get(hash) ?? Promise.resolve()
        const task = previous.catch(() => undefined).then(async () => {
          const existing = await this.readRecord(record.namespace, record.key)
          if (existing && existing.recordRevision >= record.recordRevision) {
            if (existing.recordRevision === record.recordRevision && JSON.stringify(existing.data) !== JSON.stringify(record.data)) throw new Error('Conflicting equal record revision')
            committedRevisions[record.key] = existing.recordRevision
          } else {
            await this.atomicWrite(this.recordPath(hash), json)
            committedRevisions[record.key] = record.recordRevision
          }
          this.failedKeys.delete(hash)
        })
        this.queues.set(hash, task)
        this.writes.add(task)
        const cleanup = () => { this.writes.delete(task); if (this.queues.get(hash) === task) this.queues.delete(hash) }
        // Both handlers consume errors; never leave a rejected finally() promise dangling.
        void task.then(cleanup, cleanup)
        try { await task } catch (error) { this.failedKeys.set(hash, errorText(error)); throw error }
      }
      this.completedOperations++
      return { status: 'committed', committedRevisions }
    } catch (error) { return { status: 'error', committedRevisions, errorMessage: errorText(error) } }
  }
  async flush(_targetRevision?: number): Promise<PersistenceFlushResult> {
    await this.ready
    while (this.writes.size) await Promise.allSettled(this.writes)
    if (this.failedKeys.size) return { status: 'error', flushedRevision: this.completedOperations, errorMessage: [...this.failedKeys.values()].join('; ') }
    return { status: 'flushed', flushedRevision: this.completedOperations }
  }
  async migrateLegacyDomain(domain: string, rawPayload: string): Promise<LegacyMigrationResult> {
    await this.ready
    if (!isLegacyDesktopDomain(domain)) throw new Error('Unsupported legacy migration domain')
    if (typeof rawPayload !== 'string' || Buffer.byteLength(rawPayload) > MAX_MIGRATION_BYTES) throw new Error('Legacy payload exceeds limit')
    const pending = this.migrations.get(domain)
    if (pending) return pending
    const task = this.importLegacy(domain, rawPayload)
    this.migrations.set(domain, task)
    void task.then(() => this.migrations.delete(domain), () => this.migrations.delete(domain))
    return task
  }
  private async importLegacy(domain: string, rawPayload: string): Promise<LegacyMigrationResult> {
    await this.ready
    const sourceHash = createHash('sha256').update(rawPayload).digest('hex')
    const domainHash = createHash('sha256').update(domain).digest('hex')
    // v3 also imports layouts embedded in older Zustand model envelopes.
    const markerPath = path.join(this.baseDir, 'migration-markers', `v3-${domainHash}-${sourceHash}.json`)
    try { return JSON.parse(await fs.readFile(markerPath, 'utf8')) as LegacyMigrationResult } catch (error) { if (!missing(error)) throw error }
    const backupPath = path.join(this.baseDir, 'backups', `${domainHash}-${sourceHash}.json`)
    await this.atomicWrite(backupPath, rawPayload)
    let importedCount = 0
    let quarantinedCount = 0
    let parsed: unknown
    try { parsed = JSON.parse(rawPayload) } catch { parsed = null; quarantinedCount++ }
    const root = isPlainRecord(parsed) ? parsed : null
    let collection: Record<string, unknown> | null = null
    let namespace: DesktopStateNamespace = 'workbenchLayout'
    if (root && domain === 'cozea:project-workbench-layouts') {
      collection = isPlainRecord(root.layouts) ? root.layouts : null
    } else if (root && domain === 'cozea:project-workbench') {
      namespace = 'workbenchModel'
      const state = isPlainRecord(root.state) ? root.state : root
      const candidates = state.workbenches ?? state.projects
      collection = isPlainRecord(candidates) ? candidates : null
    }
    // Unscoped legacy cloud query data is backed up but never given a new principal.
    if (root && domain !== 'cozea-query-cache' && !collection) quarantinedCount++
    for (const [key, data] of Object.entries(collection ?? {})) {
      const hasLayout = isPlainRecord(data) && isPlainRecord(data.layout) && 'grid' in data.layout && 'panels' in data.layout && Number.isInteger(data.layoutResetKey)
      const validModel = namespace === 'workbenchModel' && isPlainRecord(data) && isPlainRecord(data.tiles) && Array.isArray(data.order) && typeof data.projectId === 'string'
      if ((!hasLayout && !validModel) || key.length > 8192 || !key.includes('::')) { quarantinedCount++; continue }
      const candidates: Array<{ namespace: DesktopStateNamespace; data: unknown }> = []
      if (validModel) candidates.push({ namespace: 'workbenchModel', data })
      if (hasLayout) candidates.push({ namespace: 'workbenchLayout', data: { layout: data.layout, layoutResetKey: data.layoutResetKey } })
      for (const candidate of candidates) {
        const existing = await this.readRecord(candidate.namespace, key)
        // Dedicated layout-domain migration runs first. Embedded legacy layouts
        // only fill a missing record; neither can resurrect a durable tombstone.
        if (existing) continue
        const record: DesktopStateRecord = { schemaVersion: 1, namespace: candidate.namespace, key, recordRevision: 1, updatedAt: Date.now(), data: candidate.data }
        const result = await this.commit([record])
        if (result.status !== 'committed') throw new Error(result.errorMessage ?? 'Legacy import write failed')
        const verified = await this.readRecord(candidate.namespace, key)
        if (!verified || verified.recordRevision !== 1) throw new Error('Legacy import verification failed')
        importedCount++
      }
    }
    const result = { domain, importedCount, quarantinedCount, backupPath }
    await this.atomicWrite(markerPath, JSON.stringify(result))
    return result
  }
}
