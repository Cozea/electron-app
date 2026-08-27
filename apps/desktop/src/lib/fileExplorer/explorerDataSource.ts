/**
 * ExplorerDataSource - async data source for tree component
 *
 * Provides the interface for tree components to fetch children on demand.
 * Handles sorting (directories first, then alphabetical).
 */

import { ExplorerItem } from './explorerModel'
import { FileService } from './fileService'
import type { CancellationToken } from './fileService'

export class ExplorerDataSource {
  private fileService: FileService

  constructor(fileService: FileService) {
    this.fileService = fileService
  }

  /**
   * Get children for a tree node
   * Called when a tree node is expanded
   */
  async getChildren(
    element: ExplorerItem,
    token?: CancellationToken
  ): Promise<ExplorerItem[]> {
    // Fast path: already resolved, return cached children
    if (element.isDirectoryResolved) {
      return element.sortedChildren
    }

    // Slow path: fetch from disk
    return this.fileService.resolve(element, token)
  }

  /**
   * Check if an element has children (used for expand indicator)
   */
  hasChildren(element: ExplorerItem): boolean {
    return element.isDirectory
  }

  /**
   * Get the parent of an element
   */
  getParent(element: ExplorerItem): ExplorerItem | null {
    return element.parent
  }

  /**
   * Refresh a specific element and its children
   */
  async refresh(
    element: ExplorerItem,
    token?: CancellationToken
  ): Promise<ExplorerItem[]> {
    // Clear existing children
    element.clearChildren()

    // Re-fetch from disk
    return this.fileService.resolve(element, token)
  }
}
