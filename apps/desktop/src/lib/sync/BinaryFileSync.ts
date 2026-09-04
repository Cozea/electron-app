import type { ConvexReactClient } from 'convex/react'
import type { Id } from '../../../../../convex/_generated/dataModel'

/**
 * Binary files are intentionally outside the Yjs text transport. In
 * collaboration v2 they become shared only after an explicit Git commit and
 * push, unless a future opt-in encrypted live-transfer layer is added.
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

export const BINARY_SYNC_REQUIRES_GIT_PUSH = 'requires-git-push' as const

export type BinaryFileSyncResult = typeof BINARY_SYNC_REQUIRES_GIT_PUSH

interface LegacyQueuedBinaryUpload {
  projectId?: string
  filePath?: string
}

const LEGACY_UPLOAD_QUEUE_KEY = 'cozea:binary-upload-queue'

export function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return BINARY_EXTENSIONS.has(ext)
}

/**
 * Compatibility surface for callers that still observe binary filesystem
 * changes.
 *
 * The former implementation returned the literal string `queued` without
 * reading or uploading the file. That made the product report a successful
 * synchronization path that did not exist. The current implementation is
 * deliberately honest: the file remains local until a user explicitly commits
 * and pushes it through Git.
 */
export class BinaryFileSync {
  private readonly projectId: Id<'projects'>
  private readonly warnedPaths = new Set<string>()

  constructor(
    projectId: Id<'projects'>,
    _projectPath: string,
    _convex: ConvexReactClient,
    _userId: Id<'users'>,
  ) {
    this.projectId = projectId
  }

  destroy(): void {
    this.warnedPaths.clear()
  }

  async uploadBinaryFile(relativePath: string): Promise<BinaryFileSyncResult> {
    const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').trim()
    if (normalizedPath && !this.warnedPaths.has(normalizedPath)) {
      this.warnedPaths.add(normalizedPath)
      console.warn(
        `[BinaryFileSync] ${normalizedPath} remains local. ` +
          'Binary collaboration requires an explicit Git commit and push.',
      )
    }

    return BINARY_SYNC_REQUIRES_GIT_PUSH
  }

  /**
   * Clear entries produced by the former no-op upload queue. Retaining or
   * retrying them would imply that an upload could eventually occur.
   */
  async processQueue(): Promise<void> {
    try {
      const raw = localStorage.getItem(LEGACY_UPLOAD_QUEUE_KEY)
      if (!raw) return

      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) {
        localStorage.removeItem(LEGACY_UPLOAD_QUEUE_KEY)
        return
      }

      const projectId = String(this.projectId)
      const retained = parsed.filter((entry): entry is LegacyQueuedBinaryUpload => {
        return !entry || typeof entry !== 'object' ||
          (entry as LegacyQueuedBinaryUpload).projectId !== projectId
      })

      if (retained.length === parsed.length) return

      if (retained.length === 0) {
        localStorage.removeItem(LEGACY_UPLOAD_QUEUE_KEY)
      } else {
        localStorage.setItem(LEGACY_UPLOAD_QUEUE_KEY, JSON.stringify(retained))
      }

      console.warn(
        '[BinaryFileSync] Removed legacy binary upload entries because no binary upload transport exists.',
      )
    } catch (error) {
      console.warn('[BinaryFileSync] Failed to clear the legacy binary upload queue:', error)
    }
  }

  getPendingCount(): number {
    return 0
  }
}
