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
    // Don't resurrect deleted files
    if (this.deletedPaths.has(path)) {
      return null
    }

    if (!this.files.has(path)) {
      this.files.set(path, new Y.Text())
    }
    return this.files.get(path)!
  }

  /**
   * Get an existing file's Y.Text without creating it.
   * Use this when you want to check if a file exists.
   */
  getExistingFileText(path: string): Y.Text | null {
    if (this.deletedPaths.has(path)) {
      return null
    }
    return this.files.get(path) ?? null
  }

  /**
   * Check if a file exists (not deleted and has content).
   */
  hasFile(path: string): boolean {
    return !this.deletedPaths.has(path) && this.files.has(path)
  }

  /**
   * Clear the deleted status for a path.
   * Call this when a remote creates a file that was locally deleted,
   * allowing the remote creation to take effect.
   */
  clearDeletedStatus(path: string): void {
    this.deletedPaths.delete(path)
  }

  /**
   * Check if a path is marked as deleted.
   */
  isDeleted(path: string): boolean {
    return this.deletedPaths.has(path)
  }

  initializeFile(path: string, content: string): void {
    const yText = this.getFileText(path)
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
    const yText = this.getFileText(path)
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
    const prefix = `${path}/`
    const keys = Array.from(this.files.keys())
    const keysToDelete = keys.filter((key) => key === path || key.startsWith(prefix))
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
    this.deletedPaths.delete(path)
  }

  /**
   * Rename a file, preserving its Y.Text (and thus CRDT history).
   * This is better than delete+create because:
   * - CRDT history is preserved for undo/redo
   * - No conflict if someone is editing the file
   * - Activity log can track the rename
   */
  renamePath(oldPath: string, newPath: string, origin: string = 'user'): boolean {
    const yText = this.files.get(oldPath)
    if (!yText) return false

    // Can't rename to existing file
    if (this.files.has(newPath)) return false

    this.doc.transact(() => {
      // Move the Y.Text to new path (preserves CRDT history)
      this.files.set(newPath, yText)
      this.files.delete(oldPath)

      // Update deleted paths tracking if needed
      if (this.deletedPaths.has(oldPath)) {
        this.deletedPaths.delete(oldPath)
        this.deletedPaths.add(newPath)
      }

      // Track the rename for sync to other clients
      this.renames.set(crypto.randomUUID(), {
        from: oldPath,
        to: newPath,
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
    const prefix = `${oldPath}/`
    const keys = Array.from(this.files.keys())
    const filesToRename = keys.filter((k) => k === oldPath || k.startsWith(prefix))

    if (filesToRename.length === 0) return false

    // Check for conflicts
    for (const oldFilePath of filesToRename) {
      const newFilePath = newPath + oldFilePath.slice(oldPath.length)
      if (this.files.has(newFilePath) && !filesToRename.includes(newFilePath)) {
        return false // Would overwrite a file not in the rename set
      }
    }

    this.doc.transact(() => {
      for (const oldFilePath of filesToRename) {
        const newFilePath = newPath + oldFilePath.slice(oldPath.length)
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
        from: oldPath,
        to: newPath,
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
