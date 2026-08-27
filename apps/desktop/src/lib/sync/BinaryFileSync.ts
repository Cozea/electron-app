import type { ConvexReactClient } from 'convex/react'
import type { Id } from '../../../../../convex/_generated/dataModel'

/**
 * Binary file extensions that should be synced via LFS-like blob storage
 * instead of text-based Yjs CRDT.
 */
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff',
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  'mp3', 'wav', 'ogg', 'flac', 'm4a',
  'pdf',
  'zip', 'tar', 'gz', '7z', 'rar',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'wasm', 'exe', 'dll', 'so', 'dylib',
])

/**
 * Check if a file should be treated as binary based on its extension.
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return BINARY_EXTENSIONS.has(ext)
}

/**
 * Queued binary file upload for offline retry.
 */
interface QueuedBinaryUpload {
  id: string
  projectId: string
  filePath: string
  timestamp: number
  attempts: number
}

const UPLOAD_QUEUE_KEY = 'cozea:binary-upload-queue'
const MAX_RETRIES = 3

/**
 * BinaryFileSync - Tracks binary file changes for later Cozea-native durability.
 */
export class BinaryFileSync {
  private projectId: Id<'projects'>

  constructor(
    projectId: Id<'projects'>,
    _projectPath: string,
    _convex: ConvexReactClient,
    _userId: Id<'users'>
  ) {
    this.projectId = projectId
  }

  destroy(): void {
  }

  /**
   * Schedule Git durability for a changed binary file.
   */
  async uploadBinaryFile(relativePath: string): Promise<string | null> {
    try {
      console.log(`[BinaryFileSync] Observed binary change: ${relativePath}`)
      return 'queued'
    } catch (err) {
      console.error(`[BinaryFileSync] Upload failed for ${relativePath}:`, err)
      this.enqueueUpload(relativePath)
      return null
    }
  }

  /**
   * Queue a failed upload for retry when online.
   */
  private enqueueUpload(filePath: string): void {
    const queue = this.loadUploadQueue()
    const projectId = String(this.projectId)

    if (queue.some((q) => q.filePath === filePath && q.projectId === projectId)) {
      return
    }

    queue.push({
      id: crypto.randomUUID(),
      projectId,
      filePath,
      timestamp: Date.now(),
      attempts: 0,
    })

    this.saveUploadQueue(queue)
    console.log(`[BinaryFileSync] Queued upload for retry: ${filePath}`)
  }

  /**
   * Process queued uploads (call when online).
   */
  async processQueue(): Promise<void> {
    const queue = this.loadUploadQueue()
    const remaining: QueuedBinaryUpload[] = []
    const projectId = String(this.projectId)

    for (const item of queue) {
      if (item.projectId !== projectId) {
        remaining.push(item)
        continue
      }

      const result = await this.uploadBinaryFile(item.filePath)
      if (!result) {
        item.attempts += 1
        if (item.attempts < MAX_RETRIES) {
          remaining.push(item)
        } else {
          console.error(
            `[BinaryFileSync] Dropping upload after ${MAX_RETRIES} retries: ${item.filePath}`
          )
        }
      }
    }

    this.saveUploadQueue(remaining)
  }

  /**
   * Get count of pending uploads.
   */
  getPendingCount(): number {
    const queue = this.loadUploadQueue()
    const projectId = String(this.projectId)
    return queue.filter((q) => q.projectId === projectId).length
  }

  private loadUploadQueue(): QueuedBinaryUpload[] {
    try {
      const raw = localStorage.getItem(UPLOAD_QUEUE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  }

  private saveUploadQueue(queue: QueuedBinaryUpload[]): void {
    try {
      localStorage.setItem(UPLOAD_QUEUE_KEY, JSON.stringify(queue))
    } catch (err) {
      console.error('[BinaryFileSync] Failed to save upload queue:', err)
    }
  }
}
