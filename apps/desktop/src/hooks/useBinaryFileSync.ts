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
 * Compatibility observer for binary file changes.
 *
 * Binary files are deliberately not put into the Yjs text transport. The
 * current collaboration-v2 policy leaves them local until a user explicitly
 * commits and pushes through Git. This hook detects those changes so the
 * limitation is visible and clears records from the former no-op upload queue;
 * it does not claim to upload or synchronize bytes.
 */
export function useBinaryFileSync(
  projectId: Id<'projects'> | null,
  workspaceId: string | null,
  userId: Id<'users'> | null,
): { pendingUploads: number } {
  const convex = useConvex()
  const binarySyncRef = useRef<BinaryFileSync | null>(null)

  useEffect(() => {
    if (!projectId || !workspaceId || !userId) {
      binarySyncRef.current = null
      return
    }

    const binarySync = new BinaryFileSync(projectId, workspaceId, convex, userId)
    binarySyncRef.current = binarySync
    void binarySync.processQueue()

    return () => {
      binarySync.destroy()
      if (binarySyncRef.current === binarySync) {
        binarySyncRef.current = null
      }
    }
  }, [convex, projectId, workspaceId, userId])

  useEffect(() => {
    if (!workspaceId) return

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
      if (!data.isBinary && !isBinaryFile(relativePath)) return

      if (
        data.origin === 'remote' ||
        data.origin === 'sync' ||
        (data.origin && typeof data.origin === 'object' && data.origin.origin === 'remote')
      ) {
        return
      }

      void binarySyncRef.current?.uploadBinaryFile(relativePath)
    }

    return window.electronAPI.yjs.onExternalFileMetaChange(handleExternalFileChange)
  }, [workspaceId])

  return {
    pendingUploads: 0,
  }
}
