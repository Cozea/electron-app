import { useEffect, useRef, useCallback } from 'react'
import { useConvex } from 'convex/react'
import type { Id } from '../../convex/_generated/dataModel'
import { BinaryFileSync, isBinaryFile } from '@/lib/sync/BinaryFileSync'

/**
 * useBinaryFileSync - Syncs binary files (images, videos, etc.) via replica LFS APIs.
 *
 * This hook:
 * 1. Listens for local binary file changes via Electron file watcher
 * 2. Uploads changed binary files to replica object storage
 * 3. Enqueues a Git replica snapshot for reconciliation
 * 4. Processes queued uploads when connection is restored
 *
 * Binary files are synced separately from text files because:
 * - They can't be meaningfully merged as CRDTs
 * - They're often large and would bloat the Y.Doc
 * - Conflict handling is done at replica merge/apply stage
 */
export function useBinaryFileSync(
  projectId: Id<'projects'> | null,
  projectPath: string | null,
  userId: Id<'users'> | null
): { pendingUploads: number } {
  const convex = useConvex()
  const binarySyncRef = useRef<BinaryFileSync | null>(null)

  // Initialize BinaryFileSync
  useEffect(() => {
    if (!projectId || !projectPath || !userId) {
      binarySyncRef.current = null
      return
    }

    binarySyncRef.current = new BinaryFileSync(projectId, projectPath, convex, userId)

    // Process any queued uploads from previous sessions
    void binarySyncRef.current.processQueue()

    return () => {
      binarySyncRef.current?.destroy()
      binarySyncRef.current = null
    }
  }, [convex, projectId, projectPath, userId])

  // Handle local binary file changes
  useEffect(() => {
    if (!projectPath || !binarySyncRef.current) return

    const handleExternalFileChange = (data: {
      filePath: string
      origin?: string
      isBinary: boolean
      sizeBytes: number
      isDirectory?: boolean
    }) => {
      if (!data.filePath.startsWith(projectPath)) return
      if (data.isDirectory) return
      const relativePath = data.filePath
        .slice(projectPath.length)
        .replace(/^[/\\]+/, '')
        .replace(/\\/g, '/')

      // Only handle binary files
      if (!data.isBinary && !isBinaryFile(relativePath)) return

      // Don't re-upload files we just downloaded
      if (data.origin === 'remote' || data.origin === 'sync') return

      console.log(`[BinaryFileSync] Local binary file changed: ${relativePath}`)
      binarySyncRef.current?.uploadBinaryFile(relativePath)
    }

    // Subscribe to local file changes via Electron
    const unsubscribe = window.electronAPI.yjs.onExternalFileMetaChange(
      handleExternalFileChange
    )

    return () => {
      unsubscribe()
    }
  }, [projectPath])

  // Handle reconnection - process queued uploads
  useEffect(() => {
    const handleOnline = () => {
      console.log('[BinaryFileSync] Online, processing upload queue...')
      binarySyncRef.current?.processQueue()
    }

    window.addEventListener('online', handleOnline)

    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  const getPendingUploads = useCallback(() => {
    return binarySyncRef.current?.getPendingCount() ?? 0
  }, [])

  return {
    pendingUploads: getPendingUploads(),
  }
}
