import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import DiffMatchPatch from 'diff-match-patch'

/**
 * Rename entry tracked in Yjs for sync.
 */
export interface RenameEntry {
  from: string
  to: string
  timestamp: number
  isDirectory: boolean
}

export class YjsProjectDoc {
  readonly doc: Y.Doc
  readonly files: Y.Map<Y.Text>
  readonly awareness: Awareness
  /**
   * Track renames for sync to other clients.
   * Key is a unique ID, value is the rename info.
   */
  readonly renames: Y.Map<RenameEntry>
  private dmp = new DiffMatchPatch()

  /**
   * Track deleted paths to prevent resurrection.
   * When a file is deleted, we add it here so getFileText won't recreate it.
   * This prevents the bug where a late-arriving edit recreates a deleted file.
   */
  private deletedPaths = new Set<string>()

  private normalizePath(pathValue: string): string | null {
    if (typeof pathValue !== 'string') return null
    const trimmed = pathValue.trim()
    if (!trimmed) return null

    const slashNormalized = trimmed.replace(/\\/g, '/')
    if (slashNormalized.startsWith('/')) return null
    if (/^[a-zA-Z]:\//.test(slashNormalized)) return null

    const segments = slashNormalized
      .split('/')
      .filter((segment) => segment.length > 0 && segment !== '.')

    if (segments.length === 0) return null
    for (const segment of segments) {
      if (segment === '..') return null
      if (segment.includes('\0')) return null
    }

    return segments.join('/')
  }

  constructor(projectId: string) {
    this.doc = new Y.Doc({ guid: projectId })
    this.files = this.doc.getMap('files')
    this.renames = this.doc.getMap('renames')
    this.awareness = new Awareness(this.doc)
  }

  /**
   * Get or create a Y.Text for a file path.
   * Returns null if the file has been deleted to prevent resurrection.
   */
  getFileText(path: string): Y.Text | null {
    const normalizedPath = this.normalizePath(path)
    if (!normalizedPath) return null

    // Don't resurrect deleted files
    if (this.deletedPaths.has(normalizedPath)) {
      return null
    }

    if (!this.files.has(normalizedPath)) {
      this.files.set(normalizedPath, new Y.Text())
    }
    return this.files.get(normalizedPath)!
  }

  /**
   * Get an existing file's Y.Text without creating it.
   * Use this when you want to check if a file exists.
   */
  getExistingFileText(path: string): Y.Text | null {
    const normalizedPath = this.normalizePath(path)
    if (!normalizedPath) return null
    if (this.deletedPaths.has(normalizedPath)) {
      return null
    }
    return this.files.get(normalizedPath) ?? null
  }

  /**
   * Check if a file exists (not deleted and has content).
   */
  hasFile(path: string): boolean {
    const normalizedPath = this.normalizePath(path)
    if (!normalizedPath) return false
    return !this.deletedPaths.has(normalizedPath) && this.files.has(normalizedPath)
  }

  /**
   * Clear the deleted status for a path.
   * Call this when a remote creates a file that was locally deleted,
   * allowing the remote creation to take effect.
   */
  clearDeletedStatus(path: string): void {
    const normalizedPath = this.normalizePath(path)
    if (!normalizedPath) return
    this.deletedPaths.delete(normalizedPath)
  }

  /**
   * Check if a path is marked as deleted.
   */
  isDeleted(path: string): boolean {
    const normalizedPath = this.normalizePath(path)
    if (!normalizedPath) return false
    return this.deletedPaths.has(normalizedPath)
  }

  initializeFile(path: string, content: string): void {
    const normalizedPath = this.normalizePath(path)
    if (!normalizedPath) return
    const yText = this.getFileText(normalizedPath)
    if (!yText) return
    this.doc.transact(() => {
      yText.delete(0, yText.length)
      yText.insert(0, content)
    }, 'init')
  }

  /**
   * Apply external changes (from agents or sync) using diff-based updates.
   * This preserves CRDT history and allows concurrent edits to merge properly,
   * instead of nuking all content and replacing it.
   */
  applyExternalChange(path: string, newContent: string, origin: string = 'agent'): void {
    const normalizedPath = this.normalizePath(path)
    if (!normalizedPath) return
    const yText = this.getFileText(normalizedPath)
    if (!yText) return
    const currentContent = yText.toString()
    if (currentContent === newContent) return

    // Compute minimal diffs to preserve CRDT structure
    const diffs = this.dmp.diff_main(currentContent, newContent)
    this.dmp.diff_cleanupSemantic(diffs)

    this.doc.transact(() => {
      let index = 0
      for (const [op, text] of diffs) {
        if (op === 0) {
          // DIFF_EQUAL - move cursor forward
          index += text.length
        } else if (op === -1) {
          // DIFF_DELETE - remove text at current position
          yText.delete(index, text.length)
        } else if (op === 1) {
          // DIFF_INSERT - insert text at current position
          yText.insert(index, text)
          index += text.length
        }
      }
    }, origin)
  }

  /**
   * Delete a file or directory path.
   * Marks the path as deleted to prevent resurrection from late-arriving edits.
   */
  deletePath(path: string, origin: string = 'agent'): void {
    const normalizedPath = this.normalizePath(path)
    if (!normalizedPath) return

    const prefix = `${normalizedPath}/`
    const keys = Array.from(this.files.keys())
    const keysToDelete = keys.filter((key) => key === normalizedPath || key.startsWith(prefix))
    if (keysToDelete.length === 0) return

    this.doc.transact(() => {
      for (const key of keysToDelete) {
        // Mark as deleted to prevent resurrection
        this.deletedPaths.add(key)
        this.files.delete(key)
      }
    }, origin)
  }

  /**
   * Restore a deleted file (undo deletion).
   * Use when user explicitly wants to restore or when remote recreates.
   */
  restorePath(path: string): void {
    const normalizedPath = this.normalizePath(path)
    if (!normalizedPath) return
    this.deletedPaths.delete(normalizedPath)
  }

  /**
   * Rename a file, preserving its Y.Text (and thus CRDT history).
   * This is better than delete+create because:
   * - CRDT history is preserved for undo/redo
   * - No conflict if someone is editing the file
   * - Activity log can track the rename
   */
  renamePath(oldPath: string, newPath: string, origin: string = 'user'): boolean {
    const fromPath = this.normalizePath(oldPath)
    const targetPath = this.normalizePath(newPath)
    if (!fromPath || !targetPath) return false
    const yText = this.files.get(fromPath)
    if (!yText) return false

    // Can't rename to existing file
    if (this.files.has(targetPath)) return false

    this.doc.transact(() => {
      // Move the Y.Text to new path (preserves CRDT history)
      this.files.set(targetPath, yText)
      this.files.delete(fromPath)

      // Update deleted paths tracking if needed
      if (this.deletedPaths.has(fromPath)) {
        this.deletedPaths.delete(fromPath)
        this.deletedPaths.add(targetPath)
      }

      // Track the rename for sync to other clients
      this.renames.set(crypto.randomUUID(), {
        from: fromPath,
        to: targetPath,
        timestamp: Date.now(),
        isDirectory: false,
      })
    }, origin)

    return true
  }

  /**
   * Rename a directory, moving all files under it.
   * Preserves Y.Text instances for each file.
   */
  renameDirectory(oldPath: string, newPath: string, origin: string = 'user'): boolean {
    const fromPath = this.normalizePath(oldPath)
    const targetPath = this.normalizePath(newPath)
    if (!fromPath || !targetPath) return false

    const prefix = `${fromPath}/`
    const keys = Array.from(this.files.keys())
    const filesToRename = keys.filter((k) => k === fromPath || k.startsWith(prefix))

    if (filesToRename.length === 0) return false

    // Check for conflicts
    for (const oldFilePath of filesToRename) {
      const newFilePath = targetPath + oldFilePath.slice(fromPath.length)
      if (this.files.has(newFilePath) && !filesToRename.includes(newFilePath)) {
        return false // Would overwrite a file not in the rename set
      }
    }

    this.doc.transact(() => {
      for (const oldFilePath of filesToRename) {
        const newFilePath = targetPath + oldFilePath.slice(fromPath.length)
        const yText = this.files.get(oldFilePath)!
        this.files.set(newFilePath, yText)
        this.files.delete(oldFilePath)

        // Update deleted paths tracking
        if (this.deletedPaths.has(oldFilePath)) {
          this.deletedPaths.delete(oldFilePath)
          this.deletedPaths.add(newFilePath)
        }
      }

      // Track the directory rename for sync
      this.renames.set(crypto.randomUUID(), {
        from: fromPath,
        to: targetPath,
        timestamp: Date.now(),
        isDirectory: true,
      })
    }, origin)

    return true
  }

  /**
   * Clear processed renames (call after syncing to disk/remote).
   */
  clearRename(renameId: string): void {
    this.renames.delete(renameId)
  }

  destroy(): void {
    this.awareness.destroy()
    this.doc.destroy()
  }
}
