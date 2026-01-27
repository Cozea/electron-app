import * as Y from 'yjs'
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { XXHashAPI } from 'xxhash-wasm'

type ChangeOrigin = 'user' | 'agent' | 'remote' | 'init'

interface PendingChange {
  content: string
  previousContent: string
  origin: ChangeOrigin
  previousLineCount: number
}

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
  private userId: Id<"users"> | undefined
  private userName: string
  private convex: ConvexReactClient
  private hasher: XXHashAPI
  private pendingChanges: Map<string, PendingChange> = new Map()
  private previousContents: Map<string, string> = new Map()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private debounceMs = 1000

  constructor(
    filesMap: Y.Map<Y.Text>,
    projectId: Id<"projects">,
    convex: ConvexReactClient,
    hasher: XXHashAPI,
    userId?: Id<"users">,
    userName: string = 'Unknown'
  ) {
    this.filesMap = filesMap
    this.projectId = projectId
    this.convex = convex
    this.hasher = hasher
    this.userId = userId
    this.userName = userName

    // Initialize previous contents for existing files
    for (const [path, text] of filesMap.entries()) {
      this.previousContents.set(path, text.toString())
    }

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

    // Determine the change origin type
    const changeOrigin: ChangeOrigin = origin === 'agent' ? 'agent' : 'user'

    for (const event of events) {
      if (event.target instanceof Y.Text) {
        const path = this.getPathForYText(event.target)
        if (path) {
          const previousContent = this.previousContents.get(path) || ''
          const previousLineCount = this.countLines(previousContent)

          this.pendingChanges.set(path, {
            content: event.target.toString(),
            previousContent: previousContent,
            origin: changeOrigin,
            previousLineCount,
          })
        }
      }
    }

    // Only schedule persist if there are actual local changes
    if (this.pendingChanges.size > 0) {
      this.schedulePersist()
    }
  }

  private countLines(content: string): number {
    if (!content) return 0
    return content.split('\n').length
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

    for (const [path, change] of changes) {
      const { content, previousContent, origin, previousLineCount } = change
      const checksum = await this.computeHash(content)
      const currentLineCount = this.countLines(content)

      // Calculate additions and deletions
      const isNewFile = previousLineCount === 0
      const additions = isNewFile ? currentLineCount : Math.max(0, currentLineCount - previousLineCount)
      const deletions = isNewFile ? 0 : Math.max(0, previousLineCount - currentLineCount)

      try {
        // Save file content
        await this.convex.mutation(api.projectFiles.saveFileContent, {
          projectId: this.projectId,
          path,
          content,
          checksum,
          mtime: Date.now(),
        })

        // Log the activity with content for diff viewing
        await this.convex.mutation(api.activity.logFileChange, {
          projectId: this.projectId,
          userId: this.userId,
          filePath: path,
          changeType: isNewFile ? 'create' : 'modify',
          oldContent: previousContent,
          newContent: content,
          additions,
          deletions,
          totalLines: currentLineCount,
          origin,
          userName: this.userName,
        })

        // Update previous content for next diff
        this.previousContents.set(path, content)
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
