import { useEffect, useRef } from 'react'
import { useConvex } from 'convex/react'
import type { Id } from '../../../../convex/_generated/dataModel'
import type { FileChangeAttribution } from '../../../../shared/electronApiTypes'
import { BinaryFileSync, isBinaryFile } from '@/lib/sync/BinaryFileSync'

function relativePathFromExternalEvent(data: {
  filePath: string
  workspaceId?: string
  relativePath?: string
}, workspaceId: string): string | null {
  if (data.workspaceId) {
    if (data.workspaceId !== workspaceId) return null
    return data.relativePath?.replace(/\\/g, '/').replace(/^\/+/, '') ?? null
  }

  if (!data.filePath.startsWith(workspaceId)) return null
  return data.filePath
    .slice(workspaceId.length)
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/')
}

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
  workspaceId: string | null,
  principalId: Id<'devicePrincipals'> | null
): { pendingUploads: number } {
  const convex = useConvex()
  const binarySyncRef = useRef<BinaryFileSync | null>(null)

  // Initialize BinaryFileSync
  useEffect(() => {
    if (!projectId || !workspaceId || !principalId) {
      binarySyncRef.current = null
      return
    }

    binarySyncRef.current = new BinaryFileSync(projectId, workspaceId, convex, principalId)

    // Process any queued uploads from previous sessions
    void binarySyncRef.current.processQueue()

    return () => {
      binarySyncRef.current?.destroy()
      binarySyncRef.current = null
    }
  }, [convex, projectId, workspaceId, principalId])

  // Handle local binary file changes
  useEffect(() => {
    if (!workspaceId || !binarySyncRef.current) return

    const handleExternalFileChange = (data: {
      filePath: string
      workspaceId?: string
      relativePath?: string
      origin?: string | FileChangeAttribution
      isBinary: boolean
      sizeBytes: number
      isDirectory?: boolean
    }) => {
      if (data.isDirectory) return
      const relativePath = relativePathFromExternalEvent(data, workspaceId)
      if (!relativePath) return

      // Only handle binary files
      if (!data.isBinary && !isBinaryFile(relativePath)) return

      // Don't re-upload files we just downloaded
      if (
        data.origin === 'remote' ||
        data.origin === 'sync' ||
        (data.origin && typeof data.origin === 'object' && data.origin.origin === 'remote')
      ) {
        return
      }

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
  }, [workspaceId])

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

  return {
    pendingUploads: 0,
  }
}
