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

// Default patterns to exclude
const DEFAULT_EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.DS_Store',
  '.cache',
  '.turbo',
  '.vercel',
  '.output',
  'out',
]

// Files that start with . but should be shown
const ALLOWED_DOT_FILES = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.gitignore',
  '.prettierrc',
  '.eslintrc',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
]

export class FileService {
  private readonly excludePatterns: Set<string>
  private readonly respectGitignore: boolean
  private readonly maxDepth: number

  constructor(options: FileServiceOptions = {}) {
    this.excludePatterns = new Set(
      options.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS
    )
    this.respectGitignore = options.respectGitignore ?? false
    this.maxDepth = options.maxDepth ?? 50
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
      console.log('[FileService] readDirectory called with path:', path)
      const entries = await window.electronAPI.fs.readDir(path)
      console.log('[FileService] IPC returned entries:', entries.length, entries.map(e => e.name))

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

      console.log('[FileService] After filtering:', filtered.length, filtered.map(e => e.name))
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
    if (this.excludePatterns.has(name)) {
      return true
    }

    // Handle dot files
    if (name.startsWith('.')) {
      // Allow specific dot files
      if (ALLOWED_DOT_FILES.some(allowed =>
        name === allowed || name.startsWith(allowed)
      )) {
        return false
      }
      // Exclude other dot files/folders
      return true
    }

    return false
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
