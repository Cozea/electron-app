import { useEffect, useRef } from 'react'
import { useConvex } from 'convex/react'
import * as Y from 'yjs'
import type { Id } from '../../convex/_generated/dataModel'
import { SyncCoordinator } from '@/lib/sync/SyncCoordinator'
import { GitDurabilityCoordinator } from '@/lib/git/GitDurabilityCoordinator'
import type { YjsProjectDoc, RenameEntry } from '@/lib/yjs/YjsProjectDoc'
import { normalizeProjectFilePath } from '@/lib/sync/pathNormalization'

/**
 * useYjsFileWriteback - Writes remote Yjs changes back to local disk.
 *
 * When another user's agent edits a file, the change arrives via Yjs.
 * This hook ensures those changes are written to the local filesystem
 * even if the file isn't open in Monaco editor.
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
  projectPath: string | null,
  projectId: Id<'projects'> | null,
  userId: Id<'users'> | null
): void {
  const convex = useConvex()
  const pendingWritesRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const hasHydratedInitialFilesRef = useRef(false)
  const DEBOUNCE_MS = 500 // Wait 500ms after last change before writing

  useEffect(() => {
    if (!yjsDoc || !projectPath || !projectId) return

    let cancelled = false
    const syncCoordinator = new SyncCoordinator({
      projectId,
      actorId: 'remote',
      actorType: 'system',
      source: 'remote',
    })
    const gitDurabilityCoordinator = userId
      ? GitDurabilityCoordinator.acquireShared({
          projectId,
          projectPath,
          convex,
          userId,
        })
      : null

    // Track which files we're observing
    const observedFiles = new Map<string, () => void>()
    const pendingDeletes = new Set<string>()
    let deleteDebounceTimer: ReturnType<typeof setTimeout> | null = null

    const normalizeFilePath = (filePath: string): string | null => {
      const normalized = normalizeProjectFilePath(filePath)
      return normalized.length > 0 ? normalized : null
    }

    // Write a file to disk
    const writeFileToDisk = async (filePath: string, content: string) => {
      const normalizedPath = normalizeFilePath(filePath)
      if (!normalizedPath) return
      try {
        const result = await window.electronAPI.project.writeFile({
          projectPath,
          filePath: normalizedPath,
          content,
          origin: 'remote',
        })
        if (!result.success) {
          throw new Error(result.error ?? 'Write failed')
        }
        gitDurabilityCoordinator?.scheduleSync(`remote-write:${normalizedPath}`)
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
        await window.electronAPI.sync.deleteFiles({
          projectPath,
          paths,
        })
        gitDurabilityCoordinator?.scheduleSync(`remote-delete:${paths.join(',')}`)
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

    const hydrateLocalDiskIfEmpty = async () => {
      if (hasHydratedInitialFilesRef.current) return
      hasHydratedInitialFilesRef.current = true

      try {
        const listResult = await window.electronAPI.project.listFiles({ projectPath })
        if (!listResult.success) return

        const existingPaths = (listResult.files ?? [])
          .map((f) => f.path.replace(/\\/g, '/'))
          .filter((p) => p !== '.gitignore' && p !== '.env.example')

        // If the folder is effectively empty (often only `.gitignore` exists on first run),
        // hydrate from Yjs so the user actually sees the project files.
        if (existingPaths.length > 0) return
        if (yjsDoc.files.size === 0) return

        const filesToWrite = Array.from(yjsDoc.files.entries())
          .map(([path, yText]) => {
            const normalizedPath = normalizeFilePath(path)
            if (!normalizedPath) return null
            return {
              path: normalizedPath,
              content: yText.toString(),
              encoding: 'utf8' as const,
            }
          })
          .filter((file): file is { path: string; content: string; encoding: 'utf8' } => file !== null)

        if (filesToWrite.length === 0) return

        await window.electronAPI.sync.writeFiles({
          projectPath,
          files: filesToWrite,
        })
        gitDurabilityCoordinator?.scheduleSync(`remote-hydrate:${filesToWrite.length}`)

        if (!cancelled) {
          console.log(`[YjsWriteback] Hydrated ${filesToWrite.length} files from Yjs snapshot`)
        }
      } catch (err) {
        console.warn('[YjsWriteback] Initial hydration failed:', err)
      }
    }

    // Observe a single file's Y.Text
    const observeFile = (filePath: string) => {
      const normalizedPath = normalizeFilePath(filePath)
      if (!normalizedPath) return

      if (observedFiles.has(normalizedPath)) return

      const yText = yjsDoc.files.get(filePath)
      if (!yText) return

      const handler = (_event: unknown, transaction: { origin: string | null }) => {
        // Only write back changes from remote (not our own agent/init)
        // 'remote' origin = came from another user via Convex
        if (transaction.origin === 'remote') {
          const content = yText.toString()
          scheduleWrite(normalizedPath, content)
        }
      }

      yText.observe(handler)
      observedFiles.set(normalizedPath, () => yText.unobserve(handler))
    }

    // Observe the files map for new files being added
    const filesMapHandler = (event: Y.YMapEvent<Y.Text>, transaction: Y.Transaction) => {
      for (const [rawPath, change] of event.changes.keys.entries()) {
        const normalizedPath = normalizeFilePath(rawPath)
        if (!normalizedPath) continue

        if (change.action === 'delete') {
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
          if (transaction.origin === 'remote') {
            scheduleDelete(normalizedPath)
          }

          continue
        }

        // add / update
        observeFile(rawPath)

        // If a file was created remotely, we may have missed the initial content change.
        if (transaction.origin === 'remote') {
          const yText = yjsDoc.files.get(rawPath)
          if (yText) {
            scheduleWrite(normalizedPath, yText.toString())
          }
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
          projectPath,
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
        gitDurabilityCoordinator?.scheduleSync(`remote-rename:${normalizedFrom}:${normalizedTo}`)
        console.log(`[YjsWriteback] Renamed: ${normalizedFrom} -> ${normalizedTo}`)
      } catch (err) {
        console.error(`[YjsWriteback] Failed to rename ${normalizedFrom} -> ${normalizedTo}:`, err)
      }
    }

    // Observe the renames map for remote renames
    const renamesMapHandler = (event: Y.YMapEvent<RenameEntry>, transaction: Y.Transaction) => {
      // Only process remote renames
      if (transaction.origin !== 'remote') return

      for (const [renameId, change] of event.changes.keys.entries()) {
        if (change.action === 'add') {
          const rename = yjsDoc.renames.get(renameId)
          if (rename) {
            renameFileToDisk(rename.from, rename.to, rename.isDirectory)
            // Clear the rename after processing to prevent re-processing
            // (do this async to not block the observer)
            setTimeout(() => yjsDoc.clearRename(renameId), 100)
          }
        }
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

    // One-time initial hydration for empty local folders
    void hydrateLocalDiskIfEmpty()

    const pendingWrites = pendingWritesRef.current

    return () => {
      cancelled = true
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
      gitDurabilityCoordinator?.release()

      // Unobserve files map
      yjsDoc.files.unobserve(filesMapHandler)

      // Unobserve renames map
      yjsDoc.renames.unobserve(renamesMapHandler)
    }
  }, [convex, projectId, projectPath, userId, yjsDoc])
}
