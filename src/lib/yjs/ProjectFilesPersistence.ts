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

interface PendingDelete {
  previousContent: string
  origin: ChangeOrigin
  previousLineCount: number
}

/**
 * ProjectFilesPersistence - Persists Yjs file changes to projectFiles table.
 *
 * When the Yjs document changes, this provider debounces writes and
 * uploads the updated file content with computed checksums to Convex storage.
 * It then creates a new `projectFiles` version (superseding the previous active version).
 *
 * IMPORTANT: Only persists LOCAL changes (user edits, agent writes).
 * Ignores remote changes and snapshot loading to avoid:
 * - Infinite loops (remote change → persist → sync detects change → download)
 * - Unnecessary timestamp updates that make sync think files changed
 */
export class ProjectFilesPersistence {
  private filesMap: Y.Map<Y.Text>
  private projectId: Id<"projects">
  private userId: Id<"users">
  private userName: string
  private convex: ConvexReactClient
  private hasher: XXHashAPI
  private pendingChanges: Map<string, PendingChange> = new Map()
  private pendingDeletes: Map<string, PendingDelete> = new Map()
  private previousContents: Map<string, string> = new Map()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private debounceMs = 1000

  constructor(
    filesMap: Y.Map<Y.Text>,
    projectId: Id<"projects">,
    convex: ConvexReactClient,
    hasher: XXHashAPI,
    userId: Id<"users">,
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
    if (origin === 'remote' || origin === 'snapshot' || origin === 'sync') {
      return
    }

    // Determine the change origin type
    const changeOrigin: ChangeOrigin =
      origin === 'agent' ? 'agent' : origin === 'init' ? 'init' : 'user'

    for (const event of events) {
      if (event.target === this.filesMap) {
        // Handle file deletions from the map
        for (const [path, change] of event.changes.keys.entries()) {
          if (change.action !== 'delete') continue

          const previousContent = this.previousContents.get(path) || ''
          const previousLineCount = this.countLines(previousContent)

          // Deletion wins over any pending edit in the same debounce window
          this.pendingChanges.delete(path)

          this.pendingDeletes.set(path, {
            previousContent,
            origin: changeOrigin,
            previousLineCount,
          })
        }
      }

      if (event.target instanceof Y.Text) {
        const path = this.getPathForYText(event.target)
        if (path) {
          // If the file is being deleted, don't persist a write for it.
          if (this.pendingDeletes.has(path)) continue

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

    // Only schedule persist if there are actual local changes/deletes
    if (this.pendingChanges.size > 0 || this.pendingDeletes.size > 0) {
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
    const deletes = new Map(this.pendingDeletes)
    this.pendingDeletes.clear()

    // Persist deletions first
    if (deletes.size > 0) {
      const paths = Array.from(deletes.keys())
      try {
        await this.convex.mutation(api.projectFiles.markFilesDeleted, {
          projectId: this.projectId,
          filePaths: paths,
        })
      } catch (error) {
        console.error('[ProjectFilesPersistence] Failed to mark files deleted:', error)
      }

      for (const [path, info] of deletes) {
        const { previousContent, origin, previousLineCount } = info
        try {
          await this.convex.mutation(api.activity.logFileChange, {
            projectId: this.projectId,
            userId: this.userId,
            filePath: path,
            changeType: 'delete',
            oldContent: previousContent,
            newContent: '',
            additions: 0,
            deletions: previousLineCount,
            totalLines: 0,
            origin,
            userName: this.userName,
          })
        } catch (error) {
          console.error(`[ProjectFilesPersistence] Failed to log delete for ${path}:`, error)
        }

        this.previousContents.delete(path)
      }
    }

    for (const [path, change] of changes) {
      // A delete may have happened after we captured `changes`
      if (deletes.has(path)) continue

      const { content, previousContent, origin, previousLineCount } = change
      const checksum = await this.computeHash(content)
      const currentLineCount = this.countLines(content)

      // Calculate additions and deletions
      const isNewFile = previousLineCount === 0
      const additions = isNewFile ? currentLineCount : Math.max(0, currentLineCount - previousLineCount)
      const deletions = isNewFile ? 0 : Math.max(0, previousLineCount - currentLineCount)

      try {
        const uploadUrl = await this.convex.mutation(api.projectFiles.generateUploadUrl, {
          projectId: this.projectId,
        })

        const mimeType = getMimeTypeForText(path)
        const blob = new Blob([content], { type: mimeType })

        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': mimeType },
          body: blob,
        })

        if (!response.ok) {
          throw new Error(`Upload failed (${response.status})`)
        }

        const json = (await response.json()) as { storageId: Id<"_storage"> }
        const storageId = json.storageId

        await this.convex.mutation(api.projectFiles.saveFile, {
          projectId: this.projectId,
          userId: this.userId,
          storageId,
          fileName: path.split('/').pop() || path,
          filePath: path,
          fileType: mimeType,
          sizeBytes: blob.size,
          checksum,
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

function getMimeTypeForText(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'text/typescript',
    tsx: 'text/typescript',
    js: 'application/javascript',
    jsx: 'application/javascript',
    json: 'application/json',
    css: 'text/css',
    scss: 'text/scss',
    html: 'text/html',
    htm: 'text/html',
    md: 'text/markdown',
    txt: 'text/plain',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    xml: 'text/xml',
    svg: 'image/svg+xml',
  }
  return map[ext] ?? 'text/plain'
}
