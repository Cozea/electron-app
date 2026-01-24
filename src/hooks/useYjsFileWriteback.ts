import { useEffect, useRef } from 'react'
import type { YjsProjectDoc } from '@/lib/yjs/YjsProjectDoc'

/**
 * useYjsFileWriteback - Writes remote Yjs changes back to local disk.
 *
 * When another user's agent edits a file, the change arrives via Yjs.
 * This hook ensures those changes are written to the local filesystem
 * even if the file isn't open in Monaco editor.
 *
 * This enables "vibe coding" where users don't need to have files open
 * to receive changes from collaborators.
 */
export function useYjsFileWriteback(
  yjsDoc: YjsProjectDoc | null,
  projectPath: string | null
): void {
  const pendingWritesRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const DEBOUNCE_MS = 500 // Wait 500ms after last change before writing

  useEffect(() => {
    if (!yjsDoc || !projectPath) return

    // Track which files we're observing
    const observedFiles = new Map<string, () => void>()

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

    // Observe a single file's Y.Text
    const observeFile = (filePath: string) => {
      if (observedFiles.has(filePath)) return

      const yText = yjsDoc.files.get(filePath)
      if (!yText) return

      const handler = (event: unknown, transaction: { origin: string | null }) => {
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
    const filesMapHandler = (event: { keysChanged: Set<string> }) => {
      for (const key of event.keysChanged) {
        observeFile(key)
      }
    }

    // Start observing existing files
    for (const [filePath] of yjsDoc.files.entries()) {
      observeFile(filePath)
    }

    // Observe for new files
    yjsDoc.files.observe(filesMapHandler)

    return () => {
      // Cleanup: unobserve all files
      for (const unobserve of observedFiles.values()) {
        unobserve()
      }
      observedFiles.clear()

      // Cleanup: cancel pending writes
      for (const timeout of pendingWritesRef.current.values()) {
        clearTimeout(timeout)
      }
      pendingWritesRef.current.clear()

      // Unobserve files map
      yjsDoc.files.unobserve(filesMapHandler)
    }
  }, [yjsDoc, projectPath])
}
