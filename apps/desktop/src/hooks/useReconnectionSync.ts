import { useEffect, useRef, useCallback, useState } from 'react'
import { useConvex } from 'convex/react'
import type { Id } from '../../convex/_generated/dataModel'
import type { YjsProjectDoc } from '@/lib/yjs/YjsProjectDoc'
import { ReconnectionProtocol, type DeleteConflict } from '@/lib/yjs/ReconnectionProtocol'

// Re-export for consumers
export type { DeleteConflict }

/**
 * useReconnectionSync - Automatically syncs Y.Doc when connection is restored.
 *
 * This hook:
 * 1. Listens for 'online' events (network restored)
 * 2. Triggers sync protocol to merge local and remote changes
 * 3. Runs once on mount to handle app restart scenarios
 * 4. Detects and exposes delete-vs-edit conflicts for UI resolution
 *
 * @param projectId - The project ID
 * @param yjsDoc - The Yjs project document
 * @returns Object with deleteConflicts and resolveConflict function
 */
export function useReconnectionSync(
  projectId: Id<'projects'> | null,
  yjsDoc: YjsProjectDoc | null
): {
  deleteConflicts: DeleteConflict[]
  resolveConflict: (filePath: string, keepLocal: boolean) => Promise<void>
} {
  const convex = useConvex()
  const isSyncingRef = useRef(false)
  const hasSyncedOnMountRef = useRef(false)
  const [deleteConflicts, setDeleteConflicts] = useState<DeleteConflict[]>([])

  const performSync = useCallback(async () => {
    if (!projectId || !yjsDoc || isSyncingRef.current) return

    isSyncingRef.current = true

    try {
      const protocol = new ReconnectionProtocol(
        yjsDoc.doc,
        projectId,
        convex
      )

      const result = await protocol.performSync()

      if (result.success) {
        // console.log(
        //   `[useReconnectionSync] Sync complete: ${result.sentUpdates} sent, ${result.receivedUpdates} received`
        // )

        // Expose any delete conflicts for UI resolution
        if (result.deleteConflicts.length > 0) {
          console.warn(
            `[useReconnectionSync] ${result.deleteConflicts.length} delete conflicts detected`
          )
          setDeleteConflicts(result.deleteConflicts)
        }
      } else {
        console.error('[useReconnectionSync] Sync failed:', result.error)
      }
    } finally {
      isSyncingRef.current = false
    }
  }, [projectId, yjsDoc, convex])

  // Identity-stable across yjsDoc/conflict-list changes: this callback flows
  // into the Yjs context value, which is republished store-wide — a dep-driven
  // rebuild here re-rendered every sync/yjs consumer on each connect step.
  const resolveConflictInputsRef = useRef({ projectId, yjsDoc, deleteConflicts })
  resolveConflictInputsRef.current = { projectId, yjsDoc, deleteConflicts }

  /**
   * Resolve a delete conflict.
   * @param filePath - The conflicted file path
   * @param keepLocal - If true, restore the file with local content. If false, accept deletion.
   */
  const resolveConflict = useCallback(
    async (filePath: string, keepLocal: boolean) => {
      const { projectId, yjsDoc, deleteConflicts } = resolveConflictInputsRef.current
      if (!projectId || !yjsDoc) return

      const conflict = deleteConflicts.find((c) => c.filePath === filePath)
      if (!conflict) return

      if (keepLocal) {
        // User wants to keep their local version - recreate the file
        // The file already exists in Yjs, so we just need to remove the tombstone
        // and let ProjectFilesPersistence sync it back to Convex
        yjsDoc.clearDeletedStatus(filePath)

        // Force a change to trigger persistence (touch the file)
        const yText = yjsDoc.getFileText(filePath)
        if (yText) {
          // Trigger a no-op transaction to mark the file as needing sync
          yjsDoc.doc.transact(() => {
            // The file content is already correct, just trigger the observer
          }, 'conflict-resolution')
        }
      } else {
        // User accepts deletion - remove from local Yjs
        yjsDoc.deletePath(filePath, 'conflict-resolution')
      }

      // Remove from conflicts list
      setDeleteConflicts((prev) => prev.filter((c) => c.filePath !== filePath))
    },
    []
  )

  // Sync when coming back online
  useEffect(() => {
    if (!projectId || !yjsDoc) return

    const handleOnline = () => {
      // console.log('[useReconnectionSync] Network online, triggering sync...')
      performSync()
    }

    window.addEventListener('online', handleOnline)

    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [projectId, yjsDoc, performSync])

  // Sync once on mount (handles app restart scenarios)
  useEffect(() => {
    if (!projectId || !yjsDoc || hasSyncedOnMountRef.current) return

    // Only sync on mount if we're online
    if (navigator.onLine) {
      hasSyncedOnMountRef.current = true
      // Delay slightly to let other initialization complete
      const timer = setTimeout(() => {
        // console.log('[useReconnectionSync] Initial sync on mount...')
        performSync()
      }, 1000)

      return () => clearTimeout(timer)
    }
  }, [projectId, yjsDoc, performSync])

  return {
    deleteConflicts,
    resolveConflict,
  }
}
