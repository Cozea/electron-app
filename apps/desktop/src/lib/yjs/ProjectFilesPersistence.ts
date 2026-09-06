import * as Y from 'yjs'
import type { ConvexReactClient } from 'convex/react'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { api } from '../../../../../convex/_generated/api'
import { clearActiveCheckpointGroup, ensureActiveCheckpointGroup } from './checkpointGroups'
import { extractAttributionOrigin, isRemoteYjsOrigin, resolveYjsOriginKind } from './origins'

type ChangeOrigin = 'user' | 'agent' | 'remote' | 'init'

interface ChangeAttributionMetadata {
  origin: ChangeOrigin
  sourceOrigin?: string
  actorType?: 'user' | 'agent' | 'system'
  actorId?: string
  terminalId?: string
  terminalTitle?: string
  terminalKind?: string
  commandId?: string
  commandText?: string
  runId?: string
  sessionKey?: string
  laneId?: string
  workspaceId?: string
  gitCwd?: string
  timestamp?: number
}

interface PendingChange {
  content: string
  previousContent: string
  attribution: ChangeAttributionMetadata
  previousLineCount: number
}

interface PendingDelete {
  previousContent: string
  attribution: ChangeAttributionMetadata
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
 * ProjectFilesPersistence - Persists Yjs file changes to activity logs and shared snapshots.
 *
 * This provider tracks local Yjs edits/deletes, logs them for the activity feed,
 * Cozea collaboration durability is handled by Yjs websocket sync and snapshots.
 */
export class ProjectFilesPersistence {
  private filesMap: Y.Map<Y.Text>
  private projectId: Id<"projects">
  private workspaceId: string | null
  private principalId: Id<"devicePrincipals">
  private displayName: string
  private convex: ConvexReactClient
  private pendingChanges: Map<string, PendingChange> = new Map()
  private pendingDeletes: Map<string, PendingDelete> = new Map()
  private previousContents: Map<string, string> = new Map()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private debounceMs = 1000

  constructor(
    filesMap: Y.Map<Y.Text>,
    projectId: Id<"projects">,
    workspaceId: string | null,
    convex: ConvexReactClient,
    principalId: Id<"devicePrincipals">,
    displayName: string = 'Unknown'
  ) {
    this.filesMap = filesMap
    this.projectId = projectId
    this.workspaceId = workspaceId
    this.convex = convex
    this.principalId = principalId
    this.displayName = displayName

    // Initialize previous contents for existing files
    for (const [path, text] of filesMap.entries()) {
      this.previousContents.set(path, text.toString())
    }

    // Listen to changes on the files map
    this.filesMap.observeDeep(this.handleFilesChange)
  }

  private handleFilesChange = (events: Y.YEvent<any>[], transaction: Y.Transaction) => {
    // Skip non-user-edit transactions (remote sync, snapshot/state-vector hydration, local init hydration).
    // These are already persisted on the server - no need to re-persist
    // and doing so would update timestamps causing sync to see "changes"
    const origin = transaction.origin
    if (
      isRemoteYjsOrigin(origin) ||
      origin === 'snapshot' ||
      origin === 'sync' ||
      origin === 'state-vector' ||
      origin === 'init'
    ) {
      return
    }

    // Determine the change origin type
    const extractedAttribution = extractAttributionOrigin(origin)
    const resolvedOriginKind = resolveYjsOriginKind(origin)
    const changeAttribution: ChangeAttributionMetadata = {
      origin:
        resolvedOriginKind === 'agent'
          ? 'agent'
          : resolvedOriginKind === 'init'
            ? 'init'
            : resolvedOriginKind === 'remote'
              ? 'remote'
              : 'user',
      sourceOrigin: extractedAttribution?.sourceOrigin,
      actorType: extractedAttribution?.actorType,
      actorId: extractedAttribution?.actorId,
      terminalId: extractedAttribution?.terminalId,
      terminalTitle: extractedAttribution?.terminalTitle,
      terminalKind: extractedAttribution?.terminalKind,
      commandId: extractedAttribution?.commandId,
      commandText: extractedAttribution?.commandText,
      runId: extractedAttribution?.runId,
      sessionKey: extractedAttribution?.sessionKey,
      laneId: extractedAttribution?.laneId,
      workspaceId: extractedAttribution?.workspaceId,
      gitCwd: extractedAttribution?.gitCwd,
      timestamp: extractedAttribution?.timestamp,
    }

    for (const event of events) {
      if (event.target === this.filesMap) {
        // Handle file deletions from the map
        for (const path of event.keysChanged) {
          if (this.filesMap.has(path)) continue

          const previousContent = this.previousContents.get(path) || ''
          const previousLineCount = this.countLines(previousContent)

          // Deletion wins over any pending edit in the same debounce window
          this.pendingChanges.delete(path)

          this.pendingDeletes.set(path, {
            previousContent,
            attribution: changeAttribution,
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
            attribution: changeAttribution,
            previousLineCount,
          })
        }
      }
    }

    // Only schedule persist if there are actual local changes/deletes
    if (this.pendingChanges.size > 0 || this.pendingDeletes.size > 0) {
      ensureActiveCheckpointGroup(String(this.projectId))
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
    const checkpointGroupId =
      changes.size > 0 || deletes.size > 0
        ? ensureActiveCheckpointGroup(String(this.projectId))
        : null
    let loggedActivity = false

    try {
      // Persist deletions first
      if (deletes.size > 0) {
        for (const [path, info] of deletes) {
          if (shouldExcludeActivityPath(path)) {
            this.previousContents.delete(path)
            continue
          }

          const { attribution, previousLineCount } = info
          try {
            await this.convex.mutation(api.activity.logFileChange, {
              projectId: this.projectId,
              principalId: this.principalId,
              filePath: path,
              changeType: 'delete',
              additions: 0,
              deletions: previousLineCount,
              totalLines: 0,
              origin: attribution.origin,
              sourceOrigin: attribution.sourceOrigin,
              actorType: attribution.actorType,
              actorId: attribution.actorId,
              displayName: this.displayName,
              terminalId: attribution.terminalId,
              terminalTitle: attribution.terminalTitle,
              terminalKind: attribution.terminalKind,
              commandId: attribution.commandId,
              commandText: attribution.commandText,
              runId: attribution.runId,
              sessionKey: attribution.sessionKey,
              laneId: attribution.laneId,
              workspaceId: attribution.workspaceId,
              gitCwd: attribution.gitCwd,
              changeTimestamp: attribution.timestamp,
              checkpointGroupId: checkpointGroupId ?? undefined,
            })
            loggedActivity = true
            await this.convex.mutation(api.fileTombstones.createTombstone, {
              projectId: this.projectId,
              filePath: path,
              deletedByAgent: attribution.origin === 'agent' ? this.displayName : undefined,
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
        if (shouldExcludeActivityPath(path)) {
          this.previousContents.set(path, change.content)
          continue
        }

        const { content, previousContent, attribution, previousLineCount } = change
        // Ignore no-op writes to avoid noisy feed events and redundant uploads.
        if (content === previousContent) continue

        const currentLineCount = this.countLines(content)

        // Calculate additions and deletions
        const isNewFile = previousLineCount === 0
        const additions = isNewFile ? currentLineCount : Math.max(0, currentLineCount - previousLineCount)
        const deletions = isNewFile ? 0 : Math.max(0, previousLineCount - currentLineCount)

        try {
          await this.convex.mutation(api.activity.logFileChange, {
            projectId: this.projectId,
            principalId: this.principalId,
            filePath: path,
            changeType: isNewFile ? 'create' : 'modify',
            additions,
            deletions,
            totalLines: currentLineCount,
            origin: attribution.origin,
            sourceOrigin: attribution.sourceOrigin,
            actorType: attribution.actorType,
            actorId: attribution.actorId,
            displayName: this.displayName,
            terminalId: attribution.terminalId,
            terminalTitle: attribution.terminalTitle,
            terminalKind: attribution.terminalKind,
            commandId: attribution.commandId,
            commandText: attribution.commandText,
            runId: attribution.runId,
            sessionKey: attribution.sessionKey,
            laneId: attribution.laneId,
            workspaceId: attribution.workspaceId,
            gitCwd: attribution.gitCwd,
            changeTimestamp: attribution.timestamp,
            checkpointGroupId: checkpointGroupId ?? undefined,
          })
          loggedActivity = true
          await this.convex.mutation(api.fileTombstones.removeTombstone, {
            projectId: this.projectId,
            filePath: path,
          })

          // Update previous content for next diff
          this.previousContents.set(path, content)
        } catch (error) {
          console.error(`[ProjectFilesPersistence] Failed to log change for ${path}:`, error)
        }
      }

      if (
        loggedActivity &&
        checkpointGroupId &&
        this.workspaceId &&
        window.electronAPI?.workspaceSync?.gitCaptureCheckpoint
      ) {
        const captureResult = await window.electronAPI.workspaceSync.gitCaptureCheckpoint({
          workspaceId: this.workspaceId,
          checkpointId: checkpointGroupId,
          authorName: this.displayName,
        })
        if (!captureResult.success) {
          console.error('[ProjectFilesPersistence] Failed to capture checkpoint:', captureResult.error)
        }
      }
    } finally {
      if (checkpointGroupId) {
        clearActiveCheckpointGroup(String(this.projectId), checkpointGroupId)
      }
    }
  }

  destroy() {
    if (this.pendingChanges.size > 0 || this.pendingDeletes.size > 0) {
      void this.persistChanges()
    }
    this.filesMap.unobserveDeep(this.handleFilesChange)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
  }
}
