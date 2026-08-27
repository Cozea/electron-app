import { useEffect, useRef } from 'react'
import * as Y from 'yjs'
import type { Id } from '../../../../convex/_generated/dataModel'
import { SyncCoordinator } from '@/lib/sync/SyncCoordinator'
import type { YjsProjectDoc, RenameEntry } from '@/lib/yjs/YjsProjectDoc'
import { normalizeProjectFilePath } from '@/lib/sync/pathNormalization'
import { extractRemoteYjsOrigin, type RemoteYjsOrigin } from '@/lib/yjs/origins'

/**
 * useYjsFileWriteback - Writes remote Yjs changes back to local disk.
 *
 * When another user's agent edits a file, the change arrives via Yjs.
 * This hook ensures those changes are written to the local filesystem
 * even if the file isn't open in a visible editor.
 *
 * Also handles:
 * - File/folder renames from other users
 * - File deletions from other users
 *
 * This enables "vibe coding" where users don't need to have files open
 * to receive changes from collaborators.
 */
export function useYjsFileWriteback(
  yjsDoc: YjsProjectDoc | null,
  workspaceId: string | null,
  _gitCwd: string | null,
  projectId: Id<'projects'> | null,
  userId: Id<'users'> | null
): void {
  const pendingWritesRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const DEBOUNCE_MS = 500 // Wait 500ms after last change before writing

  useEffect(() => {
    if (!yjsDoc || !workspaceId || !projectId) return

    const syncCoordinator = new SyncCoordinator({
      projectId,
      actorId: 'remote',
      actorType: 'system',
      source: 'remote',
    })

    // Track which files we're observing
    const observedFiles = new Map<string, () => void>()
    const pendingDeletes = new Set<string>()
    const pendingCheckpointTimers = new Map<string, ReturnType<typeof setTimeout>>()
    let deleteDebounceTimer: ReturnType<typeof setTimeout> | null = null

    const normalizeFilePath = (filePath: string): string | null => {
      const normalized = normalizeProjectFilePath(filePath)
      return normalized.length > 0 ? normalized : null
    }

    const scheduleCheckpointCapture = (origin: RemoteYjsOrigin | null) => {
      const checkpointGroupId = origin?.checkpointGroupId?.trim()
      if (!checkpointGroupId) return

      const existing = pendingCheckpointTimers.get(checkpointGroupId)
      if (existing) {
        clearTimeout(existing)
      }

      const timer = setTimeout(() => {
        pendingCheckpointTimers.delete(checkpointGroupId)
        if (!workspaceId) {
          return
        }
        void window.electronAPI.workspaceSync.gitCaptureCheckpoint({
          workspaceId,
          checkpointId: checkpointGroupId,
          authorName: 'Remote collaborator',
        }).catch((error) => {
          console.warn(`[YjsWriteback] Failed to capture remote checkpoint ${checkpointGroupId}:`, error)
        })
      }, DEBOUNCE_MS + 50)

      pendingCheckpointTimers.set(checkpointGroupId, timer)
    }

    // Write a file to disk
    const writeFileToDisk = async (filePath: string, content: string) => {
      const normalizedPath = normalizeFilePath(filePath)
      if (!normalizedPath) return
      try {
        const result = await window.electronAPI.project.writeFile({
          workspaceId,
          filePath: normalizedPath,
          content,
          origin: 'remote',
        })
        if (!result.success) {
          throw new Error(result.error ?? 'Write failed')
        }
        console.log(`[YjsWriteback] Wrote remote change: ${normalizedPath}`)
      } catch (err) {
        console.error(`[YjsWriteback] Failed to write ${normalizedPath}:`, err)
      }
    }

    // Schedule a debounced write
    const scheduleWrite = (filePath: string, content: string) => {
      // Clear any pending write for this file
      const existing = pendingWritesRef.current.get(filePath)
      if (existing) {
        clearTimeout(existing)
      }

      // Schedule new write
      const timeout = setTimeout(() => {
        writeFileToDisk(filePath, content)
        pendingWritesRef.current.delete(filePath)
      }, DEBOUNCE_MS)

      pendingWritesRef.current.set(filePath, timeout)
    }

    const flushDeletes = async () => {
      const paths = Array.from(pendingDeletes)
      pendingDeletes.clear()
      deleteDebounceTimer = null

      if (paths.length === 0) return

      try {
        await window.electronAPI.workspaceSync.deleteFiles({
          workspaceId,
          paths,
        })
        console.log(`[YjsWriteback] Deleted remote files: ${paths.join(', ')}`)
      } catch (err) {
        console.error('[YjsWriteback] Failed to delete remote files:', err)
      }
    }

    const scheduleDelete = (filePath: string) => {
      const normalizedPath = normalizeFilePath(filePath)
      if (!normalizedPath) return

      pendingDeletes.add(normalizedPath)
      if (deleteDebounceTimer) clearTimeout(deleteDebounceTimer)
      deleteDebounceTimer = setTimeout(() => {
        void flushDeletes()
      }, DEBOUNCE_MS)
    }

    // Observe a single file's Y.Text
    const observeFile = (filePath: string) => {
      const normalizedPath = normalizeFilePath(filePath)
      if (!normalizedPath) return

      if (observedFiles.has(normalizedPath)) return

      const yText = yjsDoc.files.get(filePath)
      if (!yText) return

      const handler = (_event: unknown, transaction: { origin: unknown }) => {
        // Only write back changes from remote (not our own agent/init)
        // 'remote' origin = came from another user via Convex
        const remoteOrigin = extractRemoteYjsOrigin(transaction.origin)
        if (remoteOrigin) {
          const content = yText.toString()
          scheduleWrite(normalizedPath, content)
          scheduleCheckpointCapture(remoteOrigin)
        }
      }

      yText.observe(handler)
      observedFiles.set(normalizedPath, () => yText.unobserve(handler))
    }

    // Observe the files map for new files being added
    const filesMapHandler = (event: Y.YEvent<Y.Map<Y.Text>>, transaction: Y.Transaction) => {
      for (const rawPath of event.keysChanged) {
        const normalizedPath = normalizeFilePath(rawPath)
        if (!normalizedPath) continue

        if (!yjsDoc.files.has(rawPath)) {
          // Stop observing deleted files
          const unobserve = observedFiles.get(normalizedPath)
          if (unobserve) {
            unobserve()
            observedFiles.delete(normalizedPath)
          }

          // Cancel pending writes for deleted files
          const pending = pendingWritesRef.current.get(normalizedPath)
          if (pending) {
            clearTimeout(pending)
            pendingWritesRef.current.delete(normalizedPath)
          }

          // Only delete from disk for remote changes
          const remoteOrigin = extractRemoteYjsOrigin(transaction.origin)
          if (remoteOrigin) {
            scheduleDelete(normalizedPath)
            scheduleCheckpointCapture(remoteOrigin)
          }

          continue
        }

        // add / update
        observeFile(rawPath)

        // If a file was created remotely, we may have missed the initial content change.
        const remoteOrigin = extractRemoteYjsOrigin(transaction.origin)
        if (remoteOrigin) {
          const yText = yjsDoc.files.get(rawPath)
          if (yText) {
            scheduleWrite(normalizedPath, yText.toString())
          }
          scheduleCheckpointCapture(remoteOrigin)
        }
      }
    }

    // Handle renames from remote users
    const renameFileToDisk = async (from: string, to: string, _isDirectory: boolean) => {
      const normalizedFrom = normalizeFilePath(from)
      const normalizedTo = normalizeFilePath(to)
      if (!normalizedFrom || !normalizedTo) return

      try {
        const result = await window.electronAPI.project.renameFile({
          workspaceId,
          oldPath: normalizedFrom,
          newPath: normalizedTo,
          origin: 'remote',
        })
        if (!result.success) {
          throw new Error(result.error ?? 'Rename failed')
        }
        await syncCoordinator.enqueueOp({
          kind: 'rename',
          path: normalizedTo,
          source: 'remote',
          actorType: 'system',
          actorId: 'remote',
          isBinary: false,
          size: 0,
          idempotencyKey: `remote:rename:${normalizedFrom}:${normalizedTo}`,
        })
        console.log(`[YjsWriteback] Renamed: ${normalizedFrom} -> ${normalizedTo}`)
      } catch (err) {
        console.error(`[YjsWriteback] Failed to rename ${normalizedFrom} -> ${normalizedTo}:`, err)
      }
    }

    // Observe the renames map for remote renames
    const renamesMapHandler = (event: Y.YEvent<Y.Map<RenameEntry>>, transaction: Y.Transaction) => {
      // Only process remote renames
      const remoteOrigin = extractRemoteYjsOrigin(transaction.origin)
      if (!remoteOrigin) return

      for (const renameId of event.keysChanged) {
        const rename = yjsDoc.renames.get(renameId)
        if (!rename) continue

        renameFileToDisk(rename.from, rename.to, rename.isDirectory)
        scheduleCheckpointCapture(remoteOrigin)
        // Clear the rename after processing to prevent re-processing
        // (do this async to not block the observer)
        setTimeout(() => yjsDoc.clearRename(renameId), 100)
      }
    }

    // Start observing existing files
    for (const [filePath] of yjsDoc.files.entries()) {
      observeFile(filePath)
    }

    // Observe for new files
    yjsDoc.files.observe(filesMapHandler)

    // Observe for renames
    yjsDoc.renames.observe(renamesMapHandler)

    const pendingWrites = pendingWritesRef.current

    return () => {
      // Cleanup: unobserve all files
      for (const unobserve of observedFiles.values()) {
        unobserve()
      }
      observedFiles.clear()

      // Cleanup: cancel pending writes
      for (const timeout of pendingWrites.values()) {
        clearTimeout(timeout)
      }
      pendingWrites.clear()

      // Cleanup: cancel pending deletes
      if (deleteDebounceTimer) clearTimeout(deleteDebounceTimer)
      pendingDeletes.clear()
      for (const timeout of pendingCheckpointTimers.values()) {
        clearTimeout(timeout)
      }
      pendingCheckpointTimers.clear()

      // Unobserve files map
      yjsDoc.files.unobserve(filesMapHandler)

      // Unobserve renames map
      yjsDoc.renames.unobserve(renamesMapHandler)
    }
  }, [projectId, workspaceId, userId, yjsDoc])
}
