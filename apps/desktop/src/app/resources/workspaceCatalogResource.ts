import type { WorkspaceCatalogSnapshot, WorkspaceCatalogSnapshotEntry } from '@shared/workspaceTypes'

interface CatalogAPI {
  getCatalogSnapshot(): Promise<WorkspaceCatalogSnapshot>
  onCatalogSnapshotChanged(listener: (snapshot: WorkspaceCatalogSnapshot) => void): () => void
}

type Observer = (next: WorkspaceCatalogSnapshot, previous: WorkspaceCatalogSnapshot | null) => void

/** One push-first, retryable catalog mirror shared by hover, routes and sidebar. */
export class WorkspaceCatalogResource {
  private readonly getAPI: () => CatalogAPI | undefined
  private snapshot: WorkspaceCatalogSnapshot | null = null
  private initialFetch: Promise<WorkspaceCatalogSnapshot> | null = null
  private initialFetchDone = false
  private unsubscribePush: (() => void) | null = null
  private listeners = new Set<() => void>()
  private observers = new Set<Observer>()

  constructor(getAPI: () => CatalogAPI | undefined = () => typeof window === 'undefined' ? undefined : window.electronAPI?.workspace) {
    this.getAPI = getAPI
  }

  read = (): WorkspaceCatalogSnapshot | null => this.snapshot

  observe(observer: Observer): () => void {
    this.observers.add(observer)
    return () => { this.observers.delete(observer) }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    void this.ensure().catch(error => console.warn('[WorkspaceCatalog] Read failed; a later demand can retry', error))
    return () => { this.listeners.delete(listener) }
  }

  ensure(): Promise<WorkspaceCatalogSnapshot> {
    if (this.initialFetchDone && this.snapshot) return Promise.resolve(this.snapshot)
    if (this.initialFetch) return this.initialFetch
    const api = this.getAPI()
    if (!api?.getCatalogSnapshot || !api.onCatalogSnapshotChanged) return Promise.reject(new Error('Workspace catalog API unavailable'))
    // The listener is in place before any initial response can arrive.
    if (!this.unsubscribePush) this.unsubscribePush = api.onCatalogSnapshotChanged(next => this.apply(next))
    const attempt = Promise.resolve().then(() => api.getCatalogSnapshot()).then(next => {
      this.apply(next)
      this.initialFetchDone = true
      return this.snapshot!
    })
    this.initialFetch = attempt
    void attempt.then(
      () => { if (this.initialFetch === attempt) this.initialFetch = null },
      () => { if (this.initialFetch === attempt) this.initialFetch = null },
    )
    return attempt
  }

  private apply(next: WorkspaceCatalogSnapshot): void {
    const previous = this.snapshot
    if (previous && next.revision <= previous.revision) return
    const entries: Record<string, WorkspaceCatalogSnapshotEntry> = {}
    for (const [key, entry] of Object.entries(next.entries)) {
      const old = previous?.entries[key]
      entries[key] = old && JSON.stringify(old) === JSON.stringify(entry) ? old : entry
    }
    this.snapshot = { ...next, entries }
    for (const observer of this.observers) observer(this.snapshot, previous)
    for (const listener of this.listeners) listener()
  }

  dispose(): void {
    this.unsubscribePush?.()
    this.unsubscribePush = null
    this.listeners.clear()
    this.observers.clear()
  }
}

export const workspaceCatalogResource = new WorkspaceCatalogResource()
