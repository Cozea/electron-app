import type { DesktopStateNamespace, DesktopStateRecord, PersistenceCommitResult, PersistenceLoadResult, PersistenceFlushResult } from '@shared/desktopPersistenceTypes'
import { migrateLegacyDesktopState } from './migrateLegacyDesktopState'

export interface DesktopPersistenceAPI {
  load(options: { namespace: DesktopStateNamespace; keys?: string[] }): Promise<PersistenceLoadResult>
  commit(options: { records: DesktopStateRecord[] }): Promise<PersistenceCommitResult>
  flush(options?: { targetRevision?: number }): Promise<PersistenceFlushResult>
}
interface DirtyRecord { record: DesktopStateRecord; change: number }
interface LayoutRecordData { layout: unknown; layoutResetKey: number }
const fullKey = (namespace: DesktopStateNamespace, key: string) => JSON.stringify([namespace, key])
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0))

export class DesktopPersistenceClient {
  private records = new Map<string, DesktopStateRecord>()
  private dirty = new Map<string, DirtyRecord>()
  private localChanges = new Map<string, number>()
  private loads = new Map<string, Promise<void>>()
  private loaded = new Set<string>()
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private flushing: Promise<void> | null = null
  private changeSequence = 0
  private revision = 0
  private retryDelay = 500
  private lastError: Error | null = null
  private readonly getAPI: () => DesktopPersistenceAPI | null
  private readonly migrate: () => Promise<void>
  constructor(
    getAPI: () => DesktopPersistenceAPI | null = () => typeof window === 'undefined' ? null : window.electronAPI?.desktopPersistence ?? null,
    migrate: () => Promise<void> = migrateLegacyDesktopState,
  ) {
    this.getAPI = getAPI
    this.migrate = migrate
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getRevision = (): number => this.revision
  getError = (): Error | null => this.lastError
  private notify(): void { this.revision++; for (const listener of this.listeners) listener() }
  peek<T>(namespace: DesktopStateNamespace, key: string): T | undefined {
    const record = this.records.get(fullKey(namespace, key))
    return record && !record.deleted ? record.data as T : undefined
  }
  entries(namespace: DesktopStateNamespace): readonly DesktopStateRecord[] { return [...this.records.values()].filter(record => record.namespace === namespace && !record.deleted) }
  peekLayout(key: string, reset: number): unknown | null { const data = this.peek<LayoutRecordData>('workbenchLayout', key); return data?.layoutResetKey === reset ? data.layout : null }
  setLayoutInMemory(key: string, reset: number, layout: unknown): void { this.setInMemory('workbenchLayout', key, { layout, layoutResetKey: reset }) }
  peekModel(key: string): unknown | null { return this.peek('workbenchModel', key) ?? null }
  setModelInMemory(key: string, data: unknown): void { this.setInMemory('workbenchModel', key, data) }
  peekQuery(key: string): unknown | null { return this.peek('queryCache', key) ?? null }
  setQueryInMemory(key: string, data: unknown): void { this.setInMemory('queryCache', key, data) }
  private setInMemory(namespace: DesktopStateNamespace, key: string, data: unknown): void {
    const id = fullKey(namespace, key)
    const old = this.records.get(id)
    if (old && old.data === data && !old.deleted) return
    this.records.set(id, { schemaVersion: 1, namespace, key, recordRevision: old?.recordRevision ?? 1, updatedAt: Date.now(), data })
    this.localChanges.set(id, ++this.changeSequence)
    this.notify()
  }
  isHydrated(namespace: DesktopStateNamespace, key: string): boolean {
    return this.loaded.has(fullKey(namespace, key)) || this.loaded.has(fullKey(namespace, '*'))
  }
  hydrateNamespace(namespace: DesktopStateNamespace, keys?: string[]): Promise<void> {
    const sorted = keys ? [...new Set(keys)].sort() : undefined
    const loadId = JSON.stringify([namespace, sorted ?? '*'])
    if (sorted ? sorted.every(key => this.isHydrated(namespace, key)) : this.loaded.has(fullKey(namespace, '*'))) return Promise.resolve()
    const oldLoad = this.loads.get(loadId)
    if (oldLoad) return oldLoad
    const startChange = this.changeSequence
    const attempt = (async () => {
      const api = this.getAPI()
      if (!api) return // non-Electron unit consumers have no durable backing
      await this.migrate()
      const result = await api.load({ namespace, keys: sorted })
      for (const record of result.records) {
        const id = fullKey(namespace, record.key)
        if ((this.localChanges.get(id) ?? 0) > startChange || this.dirty.has(id)) continue
        const current = this.records.get(id)
        if (!current || record.recordRevision >= current.recordRevision) this.records.set(id, record)
      }
      for (const key of sorted ?? ['*']) this.loaded.add(fullKey(namespace, key))
      this.lastError = null
      this.notify()
    })()
    this.loads.set(loadId, attempt)
    void attempt.then(() => this.loads.delete(loadId), error => { this.loads.delete(loadId); this.lastError = error instanceof Error ? error : new Error(String(error)); this.notify() })
    return attempt
  }
  queueDirtyRecord<T>(namespace: DesktopStateNamespace, key: string, data: T, bindingRevision?: number): number {
    const id = fullKey(namespace, key)
    const change = ++this.changeSequence
    const record: DesktopStateRecord<T> = { schemaVersion: 1, namespace, key, recordRevision: change, updatedAt: Date.now(), bindingRevision, data }
    this.records.set(id, record)
    this.localChanges.set(id, change)
    this.dirty.set(id, { record, change })
    this.notify()
    this.schedule()
    return change
  }
  deleteRecord(namespace: DesktopStateNamespace, key: string): void {
    this.queueDirtyRecord(namespace, key, null)
    const id = fullKey(namespace, key)
    const pending = this.dirty.get(id)!
    pending.record = { ...pending.record, deleted: true }
    this.records.set(id, pending.record)
    this.notify()
  }
  clearLayoutsForProject(projectId: string): void {
    for (const record of this.entries('workbenchLayout')) if (record.key.startsWith(`${projectId}::`)) this.deleteRecord('workbenchLayout', record.key)
  }
  private schedule(delay = 500): void {
    if (this.timer || !this.getAPI()) return
    // Fixed deadline from first dirty record; ongoing activity cannot postpone it.
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush().catch(error => {
        this.lastError = error instanceof Error ? error : new Error(String(error))
        this.notify()
        this.retryDelay = Math.min(this.retryDelay * 2, 30_000)
        if (this.dirty.size) this.schedule(this.retryDelay)
      })
    }, delay)
  }
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.flushing) return this.flushing
    const attempt = this.drain()
    this.flushing = attempt
    void attempt.then(() => { if (this.flushing === attempt) this.flushing = null }, () => { if (this.flushing === attempt) this.flushing = null })
    return attempt
  }
  private async drain(): Promise<void> {
    const api = this.getAPI()
    if (!api) { if (this.dirty.size) throw new Error('Desktop persistence transport unavailable'); return }
    let watermark: number | undefined
    do {
      while (this.dirty.size) {
        const batch = [...this.dirty.entries()].slice(0, 16)
        const result = await api.commit({ records: batch.map(([, value]) => value.record) })
        if (result.status !== 'committed') throw new Error(result.errorMessage ?? 'Desktop state was not committed')
        watermark = result.watermark
        for (const [id, value] of batch) if (this.dirty.get(id)?.change === value.change) this.dirty.delete(id)
        if (this.dirty.size) await yieldTask()
      }
      const result = await api.flush({ targetRevision: watermark })
      if (result.status !== 'flushed') throw new Error(result.errorMessage ?? 'Desktop state flush failed')
      // Writes queued while the barrier was pending belong to this same flush.
    } while (this.dirty.size)
    this.retryDelay = 500
    this.lastError = null
    this.notify()
  }
}
export const desktopPersistenceClient = new DesktopPersistenceClient()
