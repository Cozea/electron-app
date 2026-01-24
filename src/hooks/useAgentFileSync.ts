import { useEffect } from 'react'
import type { YjsProjectDoc } from '@/lib/yjs/YjsProjectDoc'

/**
 * useAgentFileSync - Bridges external file changes (from AI agents) to Yjs.
 *
 * When an AI agent writes to a file via Electron IPC, this hook receives
 * the notification and applies the change to the Y.Doc, which then
 * propagates to all connected editors via Yjs CRDT.
 */
export function useAgentFileSync(
  yjsDoc: YjsProjectDoc | null,
  projectPath: string | null
): void {
  useEffect(() => {
    if (!yjsDoc || !projectPath) return

    // Subscribe to external file changes from Electron main process
    const cleanup = window.electronAPI.yjs?.onExternalFileChange?.(
      ({ filePath, content }) => {
        // Check if this file belongs to our project
        if (!filePath.startsWith(projectPath)) return

        // Get relative path within project
        const relativePath = filePath.slice(projectPath.length + 1)
        // Normalize path separators
        const normalizedPath = relativePath.replace(/\\/g, '/')

        console.log(`[AgentSync] External file change: ${normalizedPath}`)

        // Apply the change to Yjs document
        yjsDoc.applyExternalChange(normalizedPath, content)
      }
    )

    return cleanup
  }, [yjsDoc, projectPath])
}
