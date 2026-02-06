import type { Id } from '../../../convex/_generated/dataModel'

/**
 * Checkpoint data for a single file.
 */
export interface FileCheckpoint {
  /** File content at last sync */
  content: string
  /** Content hash for quick comparison */
  hash: string
  /** When this file was synced */
  syncedAt: number
}

/**
 * Schema for stored checkpoint data.
 * Stored in IndexedDB for persistence across sessions.
 */
interface StoredCheckpointV1 {
  version: 1
  projectId: string
  syncedAt: number
  files: Record<string, FileCheckpoint>
}

const DB_NAME = 'cozea-sync-checkpoints'
const DB_VERSION = 1
const STORE_NAME = 'checkpoints'

/**
 * Maximum file size to checkpoint (1MB).
 * Larger files are skipped to save storage.
 */
const MAX_CHECKPOINT_SIZE = 1024 * 1024

/**
 * SyncCheckpointStore - Persists file content snapshots for 3-way merge.
 *
 * When opening a project, if both local and cloud have modified a file
 * since the last sync, we need the "common ancestor" (base) content to
 * perform a Git-like 3-way merge.
 *
 * Uses IndexedDB because:
 * 1. localStorage has ~5MB limit, too small for project files
 * 2. IndexedDB is async and won't block UI
 * 3. IndexedDB supports larger storage (browser-dependent, usually 50MB+)
 */
export class SyncCheckpointStore {
  private db: IDBDatabase | null = null
  private dbPromise: Promise<IDBDatabase> | null = null

  /**
   * Initialize the IndexedDB database.
   */
  private async getDb(): Promise<IDBDatabase> {
    if (this.db) return this.db
    if (this.dbPromise) return this.dbPromise

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'projectId' })
        }
      }
    })

    return this.dbPromise
  }

  /**
   * Save checkpoint for all files after a successful sync.
   *
   * @param projectId - The project ID
   * @param files - Map of file path to content and hash
   */
  async saveCheckpoint(
    projectId: Id<'projects'>,
    files: Map<string, { content: string; hash: string }>
  ): Promise<void> {
    try {
      const db = await this.getDb()
      const now = Date.now()

      const checkpoint: StoredCheckpointV1 = {
        version: 1,
        projectId,
        syncedAt: now,
        files: {},
      }

      for (const [path, { content, hash }] of files) {
        // Skip files larger than threshold
        if (content.length > MAX_CHECKPOINT_SIZE) {
          console.log(`[SyncCheckpoint] Skipping large file: ${path} (${content.length} bytes)`)
          continue
        }

        checkpoint.files[path] = {
          content,
          hash,
          syncedAt: now,
        }
      }

      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const request = store.put(checkpoint)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          console.log(`[SyncCheckpoint] Saved checkpoint for ${Object.keys(checkpoint.files).length} files`)
          resolve()
        }
      })
    } catch (err) {
      console.warn('[SyncCheckpoint] Failed to save checkpoint:', err)
      // Non-fatal - 3-way merge will fall back to timestamp-based resolution
    }
  }

  /**
   * Load checkpoint for a project.
   *
   * @param projectId - The project ID
   * @returns The stored checkpoint or null if not found
   */
  async loadCheckpoint(projectId: Id<'projects'>): Promise<StoredCheckpointV1 | null> {
    try {
      const db = await this.getDb()

      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const request = store.get(projectId)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const result = request.result
          if (result && isStoredCheckpointV1(result)) {
            resolve(result)
          } else {
            resolve(null)
          }
        }
      })
    } catch (err) {
      console.warn('[SyncCheckpoint] Failed to load checkpoint:', err)
      return null
    }
  }

  /**
   * Get base content for a specific file.
   *
   * @param projectId - The project ID
   * @param filePath - The file path
   * @returns The file checkpoint or null if not found
   */
  async getFileCheckpoint(
    projectId: Id<'projects'>,
    filePath: string
  ): Promise<FileCheckpoint | null> {
    const checkpoint = await this.loadCheckpoint(projectId)
    return checkpoint?.files[filePath] ?? null
  }

  /**
   * Get checkpoint map for all files in a project.
   *
   * @param projectId - The project ID
   * @returns Map of file path to checkpoint data
   */
  async getCheckpointMap(
    projectId: Id<'projects'>
  ): Promise<Record<string, FileCheckpoint>> {
    const checkpoint = await this.loadCheckpoint(projectId)
    return checkpoint?.files ?? {}
  }

  /**
   * Update checkpoint for specific files (after resolving individual files).
   *
   * @param projectId - The project ID
   * @param updates - Map of file path to new content and hash
   */
  async updateFileCheckpoints(
    projectId: Id<'projects'>,
    updates: Map<string, { content: string; hash: string }>
  ): Promise<void> {
    try {
      const checkpoint = await this.loadCheckpoint(projectId)
      if (!checkpoint) {
        // Create new checkpoint if none exists
        await this.saveCheckpoint(projectId, updates)
        return
      }

      const now = Date.now()
      for (const [path, { content, hash }] of updates) {
        if (content.length > MAX_CHECKPOINT_SIZE) continue
        checkpoint.files[path] = { content, hash, syncedAt: now }
      }
      checkpoint.syncedAt = now

      const db = await this.getDb()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const request = store.put(checkpoint)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })
    } catch (err) {
      console.warn('[SyncCheckpoint] Failed to update file checkpoints:', err)
    }
  }

  /**
   * Remove checkpoint for deleted files.
   *
   * @param projectId - The project ID
   * @param filePaths - Array of file paths to remove
   */
  async removeFileCheckpoints(
    projectId: Id<'projects'>,
    filePaths: string[]
  ): Promise<void> {
    try {
      const checkpoint = await this.loadCheckpoint(projectId)
      if (!checkpoint) return

      for (const path of filePaths) {
        delete checkpoint.files[path]
      }

      const db = await this.getDb()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const request = store.put(checkpoint)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })
    } catch (err) {
      console.warn('[SyncCheckpoint] Failed to remove file checkpoints:', err)
    }
  }

  /**
   * Clear all checkpoints for a project.
   *
   * @param projectId - The project ID
   */
  async clearProjectCheckpoints(projectId: Id<'projects'>): Promise<void> {
    try {
      const db = await this.getDb()

      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const request = store.delete(projectId)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })
    } catch (err) {
      console.warn('[SyncCheckpoint] Failed to clear project checkpoints:', err)
    }
  }
}

/**
 * Type guard for StoredCheckpointV1.
 */
function isStoredCheckpointV1(value: unknown): value is StoredCheckpointV1 {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.version === 1 &&
    typeof record.projectId === 'string' &&
    typeof record.syncedAt === 'number' &&
    typeof record.files === 'object'
  )
}

// Singleton instance
export const syncCheckpointStore = new SyncCheckpointStore()
