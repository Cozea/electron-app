import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * Binary file extensions that should be synced via Convex storage
 * instead of Yjs text-based CRDT.
 */
const BINARY_EXTENSIONS = new Set([
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff',
  // Video
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  // Audio
  'mp3', 'wav', 'ogg', 'flac', 'm4a',
  // Documents
  'pdf',
  // Archives
  'zip', 'tar', 'gz', '7z', 'rar',
  // Fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // Other binary
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
 * Get MIME type for a file path.
 */
function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const mimeTypes: Record<string, string> = {
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    bmp: 'image/bmp',
    // Video
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    // Documents
    pdf: 'application/pdf',
    // Archives
    zip: 'application/zip',
    // Fonts
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    // Default
  }
  return mimeTypes[ext] ?? 'application/octet-stream'
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
 * BinaryFileSync - Syncs binary files (images, videos, etc.) via Convex storage.
 *
 * Binary files are excluded from Yjs text-based sync because:
 * 1. They can't be meaningfully merged as CRDTs
 * 2. They're often large and would bloat the Y.Doc
 * 3. They don't benefit from character-level conflict resolution
 *
 * Instead, we upload them directly to Convex storage and sync metadata.
 */
export class BinaryFileSync {
  private projectId: Id<'projects'>
  private projectPath: string
  private convex: ConvexReactClient
  private userId: Id<'users'>

  constructor(
    projectId: Id<'projects'>,
    projectPath: string,
    convex: ConvexReactClient,
    userId: Id<'users'>
  ) {
    this.projectId = projectId
    this.projectPath = projectPath
    this.convex = convex
    this.userId = userId
  }

  /**
   * Upload a binary file to Convex storage.
   * Returns the storage ID for reference.
   */
  async uploadBinaryFile(relativePath: string): Promise<string | null> {
    try {
      // Read the file as base64 from Electron
      const result = await window.electronAPI.project.readFileBase64({
        projectPath: this.projectPath,
        filePath: relativePath,
      })

      if (!result.success || !result.base64) {
        console.error(`[BinaryFileSync] Failed to read file: ${relativePath}`)
        return null
      }

      // Convert base64 to Blob
      const byteString = atob(result.base64)
      const bytes = new Uint8Array(byteString.length)
      for (let i = 0; i < byteString.length; i++) {
        bytes[i] = byteString.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: getMimeType(relativePath) })

      // Get upload URL from Convex
      const uploadUrl = await this.convex.mutation(
        api.projectFiles.generateUploadUrl,
        { projectId: this.projectId }
      )

      // Upload the file
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': blob.type },
        body: blob,
      })

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`)
      }

      const { storageId } = (await response.json()) as { storageId: Id<'_storage'> }

      // Save metadata to projectFiles
      await this.convex.mutation(api.projectFiles.saveFile, {
        projectId: this.projectId,
        userId: this.userId,
        storageId,
        fileName: relativePath.split('/').pop() || relativePath,
        filePath: relativePath,
        fileType: blob.type,
        sizeBytes: blob.size,
        checksum: '', // Binary files don't need content hash
      })

      console.log(`[BinaryFileSync] Uploaded: ${relativePath}`)
      return storageId
    } catch (err) {
      console.error(`[BinaryFileSync] Upload failed for ${relativePath}:`, err)
      // Queue for retry
      this.enqueueUpload(relativePath)
      return null
    }
  }

  /**
   * Download a binary file from Convex storage to local disk.
   */
  async downloadBinaryFile(
    relativePath: string,
    storageId: Id<'_storage'>
  ): Promise<boolean> {
    try {
      // Get download URL
      const url = await this.convex.query(api.projectFiles.getFileUrl, {
        storageId,
      })

      if (!url) {
        console.error(`[BinaryFileSync] No URL for storage ID: ${storageId}`)
        return false
      }

      // Download the file
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const base64 = btoa(
        String.fromCharCode(...new Uint8Array(arrayBuffer))
      )

      // Write to local disk via Electron
      const result = await window.electronAPI.project.writeFile({
        projectPath: this.projectPath,
        filePath: relativePath,
        content: base64,
      })

      if (!result.success) {
        throw new Error(result.error ?? 'Write failed')
      }

      console.log(`[BinaryFileSync] Downloaded: ${relativePath}`)
      return true
    } catch (err) {
      console.error(`[BinaryFileSync] Download failed for ${relativePath}:`, err)
      return false
    }
  }

  /**
   * Queue a failed upload for retry when online.
   */
  private enqueueUpload(filePath: string): void {
    const queue = this.loadUploadQueue()

    // Don't add duplicates
    if (queue.some((q) => q.filePath === filePath && q.projectId === this.projectId)) {
      return
    }

    queue.push({
      id: crypto.randomUUID(),
      projectId: this.projectId,
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

    for (const item of queue) {
      // Only process items for this project
      if (item.projectId !== this.projectId) {
        remaining.push(item)
        continue
      }

      const result = await this.uploadBinaryFile(item.filePath)
      if (!result) {
        item.attempts++
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
    return queue.filter((q) => q.projectId === this.projectId).length
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
