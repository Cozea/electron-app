import * as Y from 'yjs'
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

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

const EXCLUDED_ACTIVITY_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.vercel',
  'dist',
  'build',
  'out',
  'coverage',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.pnpm-store',
  '.yarn',
  'tmp',
  'temp',
  'logs',
  'vendor',
  'target',
  '__pycache__',
])

const EXCLUDED_ACTIVITY_FILE_SUFFIXES = [
  '.log',
  '.tmp',
  '.temp',
  '.swp',
  '.swo',
  '.pid',
  'prisma/dev.db',
  'prisma/dev.db-wal',
  'prisma/dev.db-shm',
  '.tsbuildinfo',
  '.eslintcache',
]

function shouldExcludeActivityPath(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+/, '').trim().toLowerCase()
  if (!normalizedPath) return false

  const parts = normalizedPath.split('/')
  if (parts.some((segment) => EXCLUDED_ACTIVITY_DIRECTORIES.has(segment))) {
    return true
  }

  return EXCLUDED_ACTIVITY_FILE_SUFFIXES.some((suffix) => (
    normalizedPath.endsWith(suffix) || normalizedPath.endsWith(`/${suffix}`)
  ))
}

/**
 * ProjectFilesPersistence - Persists Yjs file changes to activity logs and replica snapshots.
 *
 * This provider tracks local Yjs edits/deletes, logs them for the activity feed,
 * and enqueues a Git replica snapshot so the secondary sync lane converges.
 */
export class ProjectFilesPersistence {
  private filesMap: Y.Map<Y.Text>
  private projectId: Id<"projects">
  private projectPath: string | null
  private userId: Id<"users">
  private userName: string
  private convex: ConvexReactClient
  private pendingChanges: Map<string, PendingChange> = new Map()
  private pendingDeletes: Map<string, PendingDelete> = new Map()
  private previousContents: Map<string, string> = new Map()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private debounceMs = 1000

  constructor(
    filesMap: Y.Map<Y.Text>,
    projectId: Id<"projects">,
    projectPath: string | null,
    convex: ConvexReactClient,
    userId: Id<"users">,
    userName: string = 'Unknown'
  ) {
    this.filesMap = filesMap
    this.projectId = projectId
    this.projectPath = projectPath
    this.convex = convex
    this.userId = userId
    this.userName = userName

    // Initialize previous contents for existing files
    for (const [path, text] of filesMap.entries()) {
      this.previousContents.set(path, text.toString())
    }

    // Listen to changes on the files map
    this.filesMap.observeDeep(this.handleFilesChange)
  }

  private handleFilesChange = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => {
    // Skip non-user-edit transactions (remote sync, snapshot/state-vector hydration, local init hydration).
    // These are already persisted on the server - no need to re-persist
    // and doing so would update timestamps causing sync to see "changes"
    const origin = transaction.origin
    if (
      origin === 'remote' ||
      origin === 'snapshot' ||
      origin === 'sync' ||
      origin === 'state-vector' ||
      origin === 'init'
    ) {
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

          const nextContent = event.target.toString()
          if (nextContent === previousContent) continue

          this.pendingChanges.set(path, {
            content: nextContent,
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

  private mergeSnapshotSource(current: ChangeOrigin | null, next: ChangeOrigin): ChangeOrigin {
    if (current === 'agent' || next === 'agent') return 'agent'
    if (current === 'remote' || next === 'remote') return 'remote'
    if (current === 'init' || next === 'init') return 'init'
    return 'user'
  }

  private toSnapshotSource(origin: ChangeOrigin): 'user' | 'agent' | 'external' {
    if (origin === 'agent') return 'agent'
    if (origin === 'remote') return 'external'
    return 'user'
  }

  private async enqueueReplicaSnapshot(source: ChangeOrigin, reason: string): Promise<void> {
    if (!this.projectPath) {
      return
    }

    try {
      await window.electronAPI.sync.gitReplicaEnqueueSnapshot({
        projectId: this.projectId,
        projectPath: this.projectPath,
        source: this.toSnapshotSource(source),
        reason,
      })
    } catch (error) {
      console.warn('[ProjectFilesPersistence] Failed to enqueue replica snapshot:', error)
    }
  }

  private async persistChanges() {
    const changes = new Map(this.pendingChanges)
    this.pendingChanges.clear()
    const deletes = new Map(this.pendingDeletes)
    this.pendingDeletes.clear()
    let hasMaterialChanges = false
    let snapshotSource: ChangeOrigin | null = null

    // Persist deletions first
    if (deletes.size > 0) {
      for (const [path, info] of deletes) {
        if (shouldExcludeActivityPath(path)) {
          this.previousContents.delete(path)
          continue
        }

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
          await this.convex.mutation(api.fileTombstones.createTombstone, {
            projectId: this.projectId,
            filePath: path,
            deletedBy: this.userId,
            deletedByAgent: origin === 'agent' ? this.userName : undefined,
          })
        } catch (error) {
          console.error(`[ProjectFilesPersistence] Failed to log delete for ${path}:`, error)
        }

        this.previousContents.delete(path)
        hasMaterialChanges = true
        snapshotSource = this.mergeSnapshotSource(snapshotSource, origin)
      }
    }

    for (const [path, change] of changes) {
      // A delete may have happened after we captured `changes`
      if (deletes.has(path)) continue
      if (shouldExcludeActivityPath(path)) {
        this.previousContents.set(path, change.content)
        continue
      }

      const { content, previousContent, origin, previousLineCount } = change
      // Ignore no-op writes to avoid noisy feed events and redundant uploads.
      if (content === previousContent) continue

      const currentLineCount = this.countLines(content)

      // Calculate additions and deletions
      const isNewFile = previousLineCount === 0
      const additions = isNewFile ? currentLineCount : Math.max(0, currentLineCount - previousLineCount)
      const deletions = isNewFile ? 0 : Math.max(0, previousLineCount - currentLineCount)

      try {
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
        await this.convex.mutation(api.fileTombstones.removeTombstone, {
          projectId: this.projectId,
          filePath: path,
        })

        // Update previous content for next diff
        this.previousContents.set(path, content)
        hasMaterialChanges = true
        snapshotSource = this.mergeSnapshotSource(snapshotSource, origin)
      } catch (error) {
        console.error(`[ProjectFilesPersistence] Failed to log change for ${path}:`, error)
      }
    }

    if (hasMaterialChanges && snapshotSource) {
      await this.enqueueReplicaSnapshot(
        snapshotSource,
        `yjs-batch: upserts=${changes.size}, deletes=${deletes.size}`
      )
    }
  }

  destroy() {
    this.filesMap.unobserveDeep(this.handleFilesChange)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
  }
}
