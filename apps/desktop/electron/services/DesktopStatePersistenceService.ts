import { app } from 'electron'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  isDesktopStateNamespace, isLegacyDesktopDomain, validateDesktopStateRecord,
  type DesktopStateNamespace, type DesktopStateRecord, type PersistenceCommitResult,
  type PersistenceLoadResult, type PersistenceFlushResult, type LegacyMigrationResult,
} from '../../../../shared/desktopPersistenceTypes'

interface PendingRequest { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
export class DesktopStatePersistenceService {
  private worker: Worker | null = null
  private requestSequence = 0
  private pending = new Map<number, PendingRequest>()
  private acceptedWatermark = 0
  private committedWatermark = 0
  private operations: Promise<unknown> = Promise.resolve()
  private failed = new Map<string, { watermark: number; error: string }>()
  private readonly userDataPath: string
  private readonly workerPath: string
  constructor(userDataPath = app.getPath('userData'), workerPath = path.join(__dirname, 'desktop-state-persistence.js')) {
    this.userDataPath = userDataPath
    this.workerPath = workerPath
  }
  private getWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(this.workerPath, { workerData: { userDataPath: this.userDataPath }, execArgv: [] })
    this.worker = worker
    worker.on('message', (message: { id: number; success: boolean; result?: unknown; error?: string }) => {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.success) pending.resolve(message.result)
      else pending.reject(new Error(message.error ?? 'Persistence worker failed'))
      if (!this.pending.size) worker.unref()
    })
    const fail = (error: Error) => {
      if (this.worker !== worker) return
      this.worker = null
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error) }
      this.pending.clear()
    }
    worker.on('error', fail)
    worker.on('exit', code => fail(new Error(`Persistence worker exited (${code})`)))
    return worker
  }
  private request<T>(action: string, payload: object): Promise<T> {
    const worker = this.getWorker()
    const id = ++this.requestSequence
    worker.ref()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Persistence ${action} timed out; commit is not acknowledged`))
        // Terminate before retrying so an old worker cannot race a replacement writer.
        void worker.terminate()
      }, 30_000)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
      try { worker.postMessage({ id, action, payload }) } catch (error) {
        clearTimeout(timer); this.pending.delete(id); reject(error)
      }
    })
  }
  private validateNamespace(namespace: DesktopStateNamespace, isRenderer: boolean): void {
    if (!isDesktopStateNamespace(namespace) || (isRenderer && namespace === 'sessionRegistry')) throw new Error('Namespace not accessible')
  }
  load(namespace: DesktopStateNamespace, keys?: string[], isRenderer = true): Promise<PersistenceLoadResult> {
    this.validateNamespace(namespace, isRenderer)
    if (keys && (keys.length > 256 || keys.some(key => typeof key !== 'string' || !key || key.length > 8192))) throw new Error('Invalid record keys')
    return this.request('load', { namespace, keys })
  }
  commit(records: DesktopStateRecord[], isRenderer = true): Promise<PersistenceCommitResult> {
    if (!Array.isArray(records) || !records.length || records.length > 16 || records.some(record => !validateDesktopStateRecord(record))) throw new Error('Invalid desktop record batch')
    for (const record of records) this.validateNamespace(record.namespace, isRenderer)
    const watermark = ++this.acceptedWatermark
    const operation = this.operations.catch(() => undefined).then(async () => {
      try {
        // The single main writer assigns durable per-record versions. Renderer counters
        // are only local dirty-queue versions and cannot overwrite another writer.
        const assigned: DesktopStateRecord[] = []
        for (const record of records) {
          const stored = await this.request<PersistenceLoadResult>('load', { namespace: record.namespace, keys: [record.key] })
          assigned.push({ ...record, recordRevision: (stored.records[0]?.recordRevision ?? 0) + 1 })
        }
        const result = await this.request<PersistenceCommitResult>('commit', { records: assigned })
        if (result.status !== 'committed') throw new Error(result.errorMessage ?? 'Record commit failed')
        for (const record of records) this.failed.delete(JSON.stringify([record.namespace, record.key]))
        this.committedWatermark = watermark
        return { ...result, watermark }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        for (const record of records) this.failed.set(JSON.stringify([record.namespace, record.key]), { watermark, error: message })
        throw error
      }
    })
    this.operations = operation
    return operation
  }
  async flush(targetRevision = this.acceptedWatermark): Promise<PersistenceFlushResult> {
    if (!Number.isSafeInteger(targetRevision) || targetRevision < 0 || targetRevision > this.acceptedWatermark) throw new Error('Unknown persistence watermark')
    await this.operations.catch(() => undefined)
    const failures = [...this.failed.values()].filter(failure => failure.watermark <= targetRevision)
    if (failures.length) return { status: 'error', flushedRevision: this.committedWatermark, errorMessage: failures.map(failure => failure.error).join('; ') }
    const result = await this.request<PersistenceFlushResult>('flush', {})
    return { ...result, flushedRevision: this.committedWatermark }
  }
  migrateLegacy(domain: string, rawPayload: string): Promise<LegacyMigrationResult> {
    if (!isLegacyDesktopDomain(domain) || typeof rawPayload !== 'string' || rawPayload.length > 128 * 1024 * 1024) throw new Error('Invalid legacy import')
    const operation = this.operations.catch(() => undefined).then(() => this.request<LegacyMigrationResult>('migrateLegacy', { domain, rawPayload }))
    this.operations = operation
    return operation
  }
  getWorkerThreadId(): number | null { return this.worker?.threadId ?? null }
  async dispose(): Promise<void> { const worker = this.worker; if (worker) await worker.terminate() }
}
let instance: DesktopStatePersistenceService | null = null
export function getDesktopStatePersistenceService(userDataPath?: string): DesktopStatePersistenceService {
  return instance ??= new DesktopStatePersistenceService(userDataPath)
}
