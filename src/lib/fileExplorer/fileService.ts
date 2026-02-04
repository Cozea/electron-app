/**
 * FileService - handles filesystem operations via Electron IPC
 *
 * Features:
 * - Pattern-based file filtering (node_modules, .git, etc.)
 * - Cancellation token support
 * - Directory resolution with lazy loading
 */

import { ExplorerItem } from './explorerModel'
import type { ExplorerItemData } from './explorerModel'

export interface FileServiceOptions {
  excludePatterns?: string[]      // Patterns to exclude (simple matching)
  respectGitignore?: boolean      // Parse .gitignore files (future)
  maxDepth?: number               // Maximum recursion depth
}

export interface CancellationToken {
  isCancellationRequested: boolean
  onCancellationRequested: (listener: () => void) => void
}

// Default patterns to exclude (empty = show everything)
const DEFAULT_EXCLUDE_PATTERNS: string[] = []

export class FileService {
  private readonly excludePatterns: Set<string>

  constructor(options: FileServiceOptions = {}) {
    this.excludePatterns = new Set(
      options.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS
    )
  }

  /**
   * Read directory contents via Electron IPC
   */
  async readDirectory(
    path: string,
    token?: CancellationToken
  ): Promise<ExplorerItemData[]> {
    if (token?.isCancellationRequested) {
      throw new Error('Cancelled')
    }

    try {
      const entries = await window.electronAPI.fs.readDir(path)

      // Filter out excluded patterns and map to ExplorerItemData
      const filtered = entries
        .filter(entry => !this.isExcluded(entry.name))
        .map(entry => ({
          resource: entry.path,
          name: entry.name,
          isDirectory: entry.type === 'directory',
          mtime: entry.modifiedAt ? new Date(entry.modifiedAt).getTime() : undefined,
          size: entry.size,
        }))

      return filtered
    } catch (error) {
      console.error(`[FileService] Failed to read directory: ${path}`, error)
      throw error
    }
  }

  /**
   * Resolve a directory and populate its children (one level)
   */
  async resolve(
    item: ExplorerItem,
    token?: CancellationToken
  ): Promise<ExplorerItem[]> {
    if (!item.isDirectory) {
      return []
    }

    // Return cached children if already resolved
    if (item.isDirectoryResolved) {
      return item.sortedChildren
    }

    const entries = await this.readDirectory(item.resource, token)

    const children: ExplorerItem[] = []
    for (const entry of entries) {
      const child = new ExplorerItem(entry)
      item.addChild(child)
      children.push(child)
    }

    item.markResolved()
    return item.sortedChildren
  }

  /**
   * Check if a file/folder name should be excluded
   */
  private isExcluded(name: string): boolean {
    // Check against exclude patterns (exact match)
    return this.excludePatterns.has(name)
  }

  /**
   * Add an exclude pattern
   */
  addExcludePattern(pattern: string): void {
    this.excludePatterns.add(pattern)
  }

  /**
   * Remove an exclude pattern
   */
  removeExcludePattern(pattern: string): void {
    this.excludePatterns.delete(pattern)
  }

  /**
   * Get current exclude patterns
   */
  getExcludePatterns(): string[] {
    return Array.from(this.excludePatterns)
  }
}

/**
 * Create a cancellation token source
 */
export function createCancellationTokenSource(): {
  token: CancellationToken
  cancel: () => void
} {
  let isCancelled = false
  const listeners: (() => void)[] = []

  return {
    token: {
      get isCancellationRequested() {
        return isCancelled
      },
      onCancellationRequested(listener: () => void) {
        listeners.push(listener)
      },
    },
    cancel() {
      isCancelled = true
      listeners.forEach(listener => listener())
    },
  }
}
