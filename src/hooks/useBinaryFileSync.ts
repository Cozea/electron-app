import { useEffect, useRef, useCallback } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { BinaryFileSync, isBinaryFile } from '@/lib/sync/BinaryFileSync'
import type { ConvexReactClient } from 'convex/react'

/**
 * useBinaryFileSync - Syncs binary files (images, videos, etc.) via Convex storage.
 *
 * This hook:
 * 1. Listens for local binary file changes via Electron file watcher
 * 2. Uploads changed binary files to Convex storage
 * 3. Downloads remote binary file changes to local disk
 * 4. Processes queued uploads when connection is restored
 *
 * Binary files are synced separately from text files because:
 * - They can't be meaningfully merged as CRDTs
 * - They're often large and would bloat the Y.Doc
 * - Last-write-wins is acceptable for binary files
 */
export function useBinaryFileSync(
  projectId: Id<'projects'> | null,
  projectPath: string | null,
  userId: Id<'users'> | null,
  convex: ConvexReactClient
): { pendingUploads: number } {
  const binarySyncRef = useRef<BinaryFileSync | null>(null)
  const processedStorageIdsRef = useRef<Set<string>>(new Set())

  // Subscribe to project files to detect remote binary file changes
  const projectFiles = useQuery(
    api.projectFiles.listForProject,
    projectId ? { projectId } : 'skip'
  )

  // Initialize BinaryFileSync
  useEffect(() => {
    if (!projectId || !projectPath || !userId) {
      binarySyncRef.current = null
      return
    }

    binarySyncRef.current = new BinaryFileSync(
      projectId,
      projectPath,
      convex,
      userId
    )

    // Process any queued uploads from previous sessions
    binarySyncRef.current.processQueue()
  }, [projectId, projectPath, userId, convex])

  // Handle local binary file changes
  useEffect(() => {
    if (!projectPath || !binarySyncRef.current) return

    const handleExternalFileChange = (data: {
      filePath: string
      origin?: string
      isBinary: boolean
      sizeBytes: number
    }) => {
      if (!data.filePath.startsWith(projectPath)) return
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

  // Handle remote binary file changes
  useEffect(() => {
    if (!projectFiles || !binarySyncRef.current) return

    const binaryFiles = projectFiles.filter((file) => isBinaryFile(file.filePath))

    for (const file of binaryFiles) {
      const storageId = file.storageId as Id<'_storage'>

      // Skip if we've already processed this version
      if (processedStorageIdsRef.current.has(storageId)) continue

      // Download the file
      console.log(`[BinaryFileSync] Remote binary file detected: ${file.filePath}`)
      binarySyncRef.current.downloadBinaryFile(file.filePath, storageId)
      processedStorageIdsRef.current.add(storageId)
    }
  }, [projectFiles])

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
