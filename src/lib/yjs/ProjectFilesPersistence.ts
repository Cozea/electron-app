import * as Y from 'yjs'
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { XXHashAPI } from 'xxhash-wasm'

/**
 * ProjectFilesPersistence - Persists Yjs file changes to projectFiles table.
 *
 * When the Yjs document changes, this provider debounces writes and
 * uploads the updated file content with computed checksums to Convex.
 *
 * IMPORTANT: Only persists LOCAL changes (user edits, agent writes).
 * Ignores remote changes and snapshot loading to avoid:
 * - Infinite loops (remote change → persist → sync detects change → download)
 * - Unnecessary timestamp updates that make sync think files changed
 */
export class ProjectFilesPersistence {
  private filesMap: Y.Map<Y.Text>
  private projectId: Id<"projects">
  private convex: ConvexReactClient
  private hasher: XXHashAPI
  private pendingChanges: Map<string, string> = new Map()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private debounceMs = 1000

  constructor(
    filesMap: Y.Map<Y.Text>,
    projectId: Id<"projects">,
    convex: ConvexReactClient,
    hasher: XXHashAPI
  ) {
    this.filesMap = filesMap
    this.projectId = projectId
    this.convex = convex
    this.hasher = hasher

    // Listen to changes on the files map
    this.filesMap.observeDeep(this.handleFilesChange)
  }

  private handleFilesChange = (events: Y.YEvent<any>[], transaction: Y.Transaction) => {
    // Skip changes from remote sources or snapshot loading
    // These are already persisted on the server - no need to re-persist
    // and doing so would update timestamps causing sync to see "changes"
    const origin = transaction.origin
    if (origin === 'remote' || origin === 'snapshot') {
      return
    }

    for (const event of events) {
      if (event.target instanceof Y.Text) {
        const path = this.getPathForYText(event.target)
        if (path) {
          this.pendingChanges.set(path, event.target.toString())
        }
      }
    }

    // Only schedule persist if there are actual local changes
    if (this.pendingChanges.size > 0) {
      this.schedulePersist()
    }
  }

  private getPathForYText(yText: Y.Text): string | null {
    for (const [path, text] of this.filesMap.entries()) {
      if (text === yText) return path
    }
    return null
  }

  private schedulePersist() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.persistChanges(), this.debounceMs)
  }

  private async persistChanges() {
    const changes = new Map(this.pendingChanges)
    this.pendingChanges.clear()

    for (const [path, content] of changes) {
      const checksum = await this.computeHash(content)
      try {
        await this.convex.mutation(api.projectFiles.saveFileContent, {
          projectId: this.projectId,
          path,
          content,
          checksum,
          mtime: Date.now(),
        })
      } catch (error) {
        console.error(`[ProjectFilesPersistence] Failed to save ${path}:`, error)
      }
    }
  }

  private async computeHash(content: string): Promise<string> {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(content)
    return this.hasher.h64Raw(bytes).toString(16).padStart(16, '0')
  }

  destroy() {
    this.filesMap.unobserveDeep(this.handleFilesChange)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
  }
}
