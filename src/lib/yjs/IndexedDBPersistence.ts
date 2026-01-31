import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'

/**
 * YjsIndexedDBProvider - Persists Y.Doc state to IndexedDB.
 *
 * This enables offline-first editing by:
 * 1. Surviving app crashes and restarts (Y.Doc is in-memory by default)
 * 2. Preserving edits made while offline
 * 3. Allowing faster startup by loading local state before Convex
 *
 * The Y.Doc is automatically synced to IndexedDB on every change,
 * and restored from IndexedDB on initialization.
 */
export class YjsIndexedDBProvider {
  private persistence: IndexeddbPersistence
  private synced = false
  private syncPromise: Promise<void> | null = null

  constructor(projectId: string, doc: Y.Doc) {
    // Use a unique key per project to avoid conflicts
    this.persistence = new IndexeddbPersistence(`cozea-yjs-${projectId}`, doc)

    this.syncPromise = new Promise((resolve) => {
      this.persistence.on('synced', () => {
        this.synced = true
        console.log(`[IndexedDB] Y.Doc synced for project ${projectId}`)
        resolve()
      })
    })
  }

  /**
   * Wait for IndexedDB to load existing state into the Y.Doc.
   * Should be called before applying Convex snapshot to avoid conflicts.
   */
  async waitForSync(): Promise<void> {
    if (this.synced) return
    return this.syncPromise ?? Promise.resolve()
  }

  /**
   * Check if the Y.Doc has been restored from IndexedDB.
   */
  get isSynced(): boolean {
    return this.synced
  }

  /**
   * Clear all local data for this project.
   * Useful for testing or when user wants a fresh start.
   */
  async clearLocalData(): Promise<void> {
    await this.persistence.clearData()
  }

  /**
   * Clean up resources when done with this provider.
   */
  destroy(): void {
    this.persistence.destroy()
  }
}
