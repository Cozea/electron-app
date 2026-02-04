import { useEffect, useRef } from 'react'
import * as Y from 'yjs'
import type { YjsProjectDoc, RenameEntry } from '@/lib/yjs/YjsProjectDoc'

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
  projectPath: string | null
): void {
  const pendingWritesRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const hasHydratedInitialFilesRef = useRef(false)
  const DEBOUNCE_MS = 500 // Wait 500ms after last change before writing

  useEffect(() => {
    if (!yjsDoc || !projectPath) return

    let cancelled = false

    // Track which files we're observing
    const observedFiles = new Map<string, () => void>()
    const pendingDeletes = new Set<string>()
    let deleteDebounceTimer: ReturnType<typeof setTimeout> | null = null

    // Write a file to disk
    const writeFileToDisk = async (filePath: string, content: string) => {
      try {
        await window.electronAPI.project.writeFile({
          projectPath,
          filePath,
          content,
        })
        console.log(`[YjsWriteback] Wrote remote change: ${filePath}`)
      } catch (err) {
        console.error(`[YjsWriteback] Failed to write ${filePath}:`, err)
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
        console.log(`[YjsWriteback] Deleted remote files: ${paths.join(', ')}`)
      } catch (err) {
        console.error('[YjsWriteback] Failed to delete remote files:', err)
      }
    }

    const scheduleDelete = (filePath: string) => {
      pendingDeletes.add(filePath)
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

        const filesToWrite = Array.from(yjsDoc.files.entries()).map(([path, yText]) => ({
          path,
          content: yText.toString(),
          encoding: 'utf8' as const,
        }))

        if (filesToWrite.length === 0) return

        await window.electronAPI.sync.writeFiles({
          projectPath,
          files: filesToWrite,
        })

        if (!cancelled) {
          console.log(`[YjsWriteback] Hydrated ${filesToWrite.length} files from Yjs snapshot`)
        }
      } catch (err) {
        console.warn('[YjsWriteback] Initial hydration failed:', err)
      }
    }

    // Observe a single file's Y.Text
    const observeFile = (filePath: string) => {
      if (observedFiles.has(filePath)) return

      const yText = yjsDoc.files.get(filePath)
      if (!yText) return

      const handler = (_event: unknown, transaction: { origin: string | null }) => {
        // Only write back changes from remote (not our own agent/init)
        // 'remote' origin = came from another user via Convex
        if (transaction.origin === 'remote') {
          const content = yText.toString()
          scheduleWrite(filePath, content)
        }
      }

      yText.observe(handler)
      observedFiles.set(filePath, () => yText.unobserve(handler))
    }

    // Observe the files map for new files being added
    const filesMapHandler = (event: Y.YMapEvent<Y.Text>, transaction: Y.Transaction) => {
      for (const [filePath, change] of event.changes.keys.entries()) {
        if (change.action === 'delete') {
          // Stop observing deleted files
          const unobserve = observedFiles.get(filePath)
          if (unobserve) {
            unobserve()
            observedFiles.delete(filePath)
          }

          // Cancel pending writes for deleted files
          const pending = pendingWritesRef.current.get(filePath)
          if (pending) {
            clearTimeout(pending)
            pendingWritesRef.current.delete(filePath)
          }

          // Only delete from disk for remote changes
          if (transaction.origin === 'remote') {
            scheduleDelete(filePath)
          }

          continue
        }

        // add / update
        observeFile(filePath)

        // If a file was created remotely, we may have missed the initial content change.
        if (transaction.origin === 'remote') {
          const yText = yjsDoc.files.get(filePath)
          if (yText) {
            scheduleWrite(filePath, yText.toString())
          }
        }
      }
    }

    // Handle renames from remote users
    const renameFileToDisk = async (from: string, to: string, _isDirectory: boolean) => {
      try {
        await window.electronAPI.project.renameFile({
          projectPath,
          oldPath: from,
          newPath: to,
        })
        console.log(`[YjsWriteback] Renamed: ${from} -> ${to}`)
      } catch (err) {
        console.error(`[YjsWriteback] Failed to rename ${from} -> ${to}:`, err)
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

      // Unobserve files map
      yjsDoc.files.unobserve(filesMapHandler)

      // Unobserve renames map
      yjsDoc.renames.unobserve(renamesMapHandler)
    }
  }, [yjsDoc, projectPath])
}
