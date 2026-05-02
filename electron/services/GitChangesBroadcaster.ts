import path from 'node:path'

import type { IpcMain, WebContents } from 'electron'

import type { GitChangesSnapshot, GitChangesScope } from '../../shared/electronApiTypes'
import { CheckpointWorkerClient } from './CheckpointWorkerClient'

const GIT_CHANGES_UPDATED_CHANNEL = 'sync:gitChangesUpdated'
const INVALIDATION_DEBOUNCE_MS = 250
const FALLBACK_REFRESH_MS = 10_000

interface GitChangesSubscription {
  sender: WebContents
  scope: GitChangesScope
}

function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath)
}

function pathIsWithinRoot(filePath: string, rootPath: string): boolean {
  try {
    const normalizedFilePath = path.resolve(filePath)
    const normalizedRootPath = path.resolve(rootPath)
    if (normalizedFilePath === normalizedRootPath) return true
    const relative = path.relative(normalizedRootPath, normalizedFilePath)
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  } catch {
    return false
  }
}

function buildCacheKey(projectPath: string, scope: GitChangesScope): string {
  return `${projectPath}\0${scope}`
}

export class GitChangesBroadcaster {
  private static instance: GitChangesBroadcaster | null = null

  private readonly subscriptionsByKey = new Map<string, Map<number, GitChangesSubscription>>()
  private readonly snapshotsByKey = new Map<string, GitChangesSnapshot>()
  private readonly pendingRefreshTimers = new Map<string, NodeJS.Timeout>()
  private readonly inflightRefreshes = new Map<string, Promise<GitChangesSnapshot>>()
  private readonly destroyedListenerSenders = new Set<number>()
  private fallbackRefreshTimer: NodeJS.Timeout | null = null

  static getInstance(): GitChangesBroadcaster {
    if (!GitChangesBroadcaster.instance) {
      GitChangesBroadcaster.instance = new GitChangesBroadcaster()
    }
    return GitChangesBroadcaster.instance
  }

  registerIpcHandlers(ipcMain: IpcMain): void {
    ipcMain.handle(
      'sync:subscribeGitChanges',
      async (event, options: { projectPath: string; scope: GitChangesScope }) => {
        return await this.subscribe(event.sender, options)
      },
    )

    ipcMain.handle(
      'sync:unsubscribeGitChanges',
      async (event, options: { projectPath: string; scope: GitChangesScope }) => {
        this.unsubscribe(event.sender, options.projectPath, options.scope)
        return { success: true }
      },
    )
  }

  async subscribe(
    sender: WebContents,
    options: { projectPath: string; scope: GitChangesScope },
  ): Promise<GitChangesSnapshot> {
    const projectPath = normalizeProjectPath(options.projectPath)
    const key = buildCacheKey(projectPath, options.scope)
    let subscribers = this.subscriptionsByKey.get(key)
    if (!subscribers) {
      subscribers = new Map()
      this.subscriptionsByKey.set(key, subscribers)
    }

    subscribers.set(sender.id, {
      sender,
      scope: options.scope,
    })

    if (!this.destroyedListenerSenders.has(sender.id)) {
      this.destroyedListenerSenders.add(sender.id)
      sender.once('destroyed', () => {
        this.destroyedListenerSenders.delete(sender.id)
        this.unsubscribeSender(sender.id)
      })
    }

    this.ensureFallbackRefreshTimer()

    const snapshot = await this.refreshKey(projectPath, options.scope)
    this.publishSnapshot(key, snapshot)
    return snapshot
  }

  unsubscribe(sender: WebContents, projectPath: string, scope: GitChangesScope): void {
    const normalizedProjectPath = normalizeProjectPath(projectPath)
    const key = buildCacheKey(normalizedProjectPath, scope)
    const subscribers = this.subscriptionsByKey.get(key)
    if (!subscribers) {
      this.maybeStopFallbackRefreshTimer()
      return
    }

    subscribers.delete(sender.id)
    if (subscribers.size === 0) {
      this.subscriptionsByKey.delete(key)
      this.snapshotsByKey.delete(key)
      const pendingTimer = this.pendingRefreshTimers.get(key)
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        this.pendingRefreshTimers.delete(key)
      }
    }

    this.maybeStopFallbackRefreshTimer()
  }

  invalidateProjectPath(projectPath: string): void {
    const normalizedProjectPath = normalizeProjectPath(projectPath)
    for (const scope of ['current', 'branch'] as const) {
      const key = buildCacheKey(normalizedProjectPath, scope)
      if (!this.subscriptionsByKey.has(key)) {
        continue
      }
      this.scheduleRefresh(normalizedProjectPath, scope, INVALIDATION_DEBOUNCE_MS)
    }
  }

  invalidateFilePath(filePath: string): void {
    // Project paths are embedded in keys
    for (const key of this.subscriptionsByKey.keys()) {
      const projectPath = key.split('\0')[0]
      const scope = key.split('\0')[1] as GitChangesScope
      if (!pathIsWithinRoot(filePath, projectPath)) {
        continue
      }
      this.scheduleRefresh(projectPath, scope, INVALIDATION_DEBOUNCE_MS)
    }
  }

  private unsubscribeSender(senderId: number): void {
    for (const [key, subscribers] of this.subscriptionsByKey.entries()) {
      subscribers.delete(senderId)
      if (subscribers.size > 0) {
        continue
      }

      this.subscriptionsByKey.delete(key)
      this.snapshotsByKey.delete(key)
      const pendingTimer = this.pendingRefreshTimers.get(key)
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        this.pendingRefreshTimers.delete(key)
      }
    }

    this.maybeStopFallbackRefreshTimer()
  }

  private ensureFallbackRefreshTimer(): void {
    if (this.fallbackRefreshTimer) {
      return
    }

    this.fallbackRefreshTimer = setInterval(() => {
      for (const key of this.subscriptionsByKey.keys()) {
        const projectPath = key.split('\0')[0]
        const scope = key.split('\0')[1] as GitChangesScope
        this.scheduleRefresh(projectPath, scope, 0)
      }
    }, FALLBACK_REFRESH_MS)
  }

  private maybeStopFallbackRefreshTimer(): void {
    if (this.subscriptionsByKey.size > 0 || !this.fallbackRefreshTimer) {
      return
    }
    clearInterval(this.fallbackRefreshTimer)
    this.fallbackRefreshTimer = null
  }

  private scheduleRefresh(projectPath: string, scope: GitChangesScope, delayMs: number): void {
    const key = buildCacheKey(projectPath, scope)
    const existingTimer = this.pendingRefreshTimers.get(key)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const timer = setTimeout(() => {
      this.pendingRefreshTimers.delete(key)
      void this.refreshKey(projectPath, scope)
        .then((snapshot) => {
          this.publishSnapshot(key, snapshot)
        })
        .catch(() => {
          // Ignore background refresh errors. The last published snapshot remains valid.
        })
    }, delayMs)

    this.pendingRefreshTimers.set(key, timer)
  }

  private publishSnapshot(key: string, snapshot: GitChangesSnapshot): void {
    const subscribers = this.subscriptionsByKey.get(key)
    if (!subscribers) {
      return
    }

    for (const [senderId, subscription] of Array.from(subscribers.entries())) {
      const { sender } = subscription
      if (sender.isDestroyed()) {
        subscribers.delete(senderId)
        continue
      }
      sender.send(GIT_CHANGES_UPDATED_CHANNEL, snapshot)
    }

    if (subscribers.size === 0) {
      this.subscriptionsByKey.delete(key)
      this.snapshotsByKey.delete(key)
      this.maybeStopFallbackRefreshTimer()
    }
  }

  private async refreshKey(projectPath: string, scope: GitChangesScope): Promise<GitChangesSnapshot> {
    const key = buildCacheKey(projectPath, scope)
    const inflight = this.inflightRefreshes.get(key)
    if (inflight) {
      return await inflight
    }

    const refreshPromise = (async () => {
      try {
        const [result, statsResult] = await Promise.all([
          CheckpointWorkerClient.getInstance().readChanges({
            cwd: projectPath,
            scope,
            authorName: 'Cozea', // Assuming Cozea for now, we can pass it later if needed
          }),
          scope === 'current'
            ? CheckpointWorkerClient.getInstance().getHeadDiffStats({ cwd: projectPath, authorName: 'Cozea' })
            : Promise.resolve({ success: true as const, additions: 0, deletions: 0, changedFiles: 0, error: undefined })
        ])
        
        const cacheKey = `${key}:${Date.now()}` // Uniqueish cacheKey

        const snapshot: GitChangesSnapshot = {
          projectPath,
          scope,
          cacheKey,
          files: result.success ? result.files : [],
          patch: result.success ? (result.diff ?? '') : '',
          loaded: true,
          error: result.success ? null : (result.error ?? 'Failed to compute git changes'),
          baseRef: result.baseRef,
          headRef: result.headRef,
          additions: statsResult.success ? statsResult.additions : 0,
          deletions: statsResult.success ? statsResult.deletions : 0,
        }
        
        const existing = this.snapshotsByKey.get(key)
        if (existing && existing.patch === snapshot.patch && existing.error === snapshot.error && existing.additions === snapshot.additions && existing.deletions === snapshot.deletions) {
           // No actual changes, keep previous cacheKey so React doesn't re-render
           snapshot.cacheKey = existing.cacheKey
        }
        
        this.snapshotsByKey.set(key, snapshot)
        return snapshot
      } catch (error) {
        const snapshot: GitChangesSnapshot = {
          projectPath,
          scope,
          cacheKey: `${key}:${Date.now()}`,
          files: [],
          patch: '',
          loaded: true,
          error: error instanceof Error ? error.message : 'Failed to compute git changes',
          additions: 0,
          deletions: 0,
        }
        const existing = this.snapshotsByKey.get(key)
        if (existing && existing.patch === snapshot.patch && existing.error === snapshot.error && existing.additions === snapshot.additions && existing.deletions === snapshot.deletions) {
           snapshot.cacheKey = existing.cacheKey
        }
        this.snapshotsByKey.set(key, snapshot)
        return snapshot
      } finally {
        this.inflightRefreshes.delete(key)
      }
    })()

    this.inflightRefreshes.set(key, refreshPromise)
    return await refreshPromise
  }
}
