import path from 'node:path'

import type { IpcMain, WebContents } from 'electron'

import type { GitDirtyStateSnapshot } from '../../shared/electronApiTypes'
import { getHeadDiffStats } from '../gitCheckpoints'

const GIT_DIRTY_STATE_CHANGED_CHANNEL = 'sync:gitDirtyStateChanged'
const INVALIDATION_DEBOUNCE_MS = 250
const FALLBACK_REFRESH_MS = 10_000

interface GitDirtySubscription {
  sender: WebContents
  authorName?: string
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

export class GitDirtyStateService {
  private static instance: GitDirtyStateService | null = null

  private readonly subscriptionsByProjectPath = new Map<string, Map<number, GitDirtySubscription>>()
  private readonly snapshotsByProjectPath = new Map<string, GitDirtyStateSnapshot>()
  private readonly pendingRefreshTimers = new Map<string, NodeJS.Timeout>()
  private readonly inflightRefreshes = new Map<string, Promise<GitDirtyStateSnapshot>>()
  private fallbackRefreshTimer: NodeJS.Timeout | null = null

  static getInstance(): GitDirtyStateService {
    if (!GitDirtyStateService.instance) {
      GitDirtyStateService.instance = new GitDirtyStateService()
    }
    return GitDirtyStateService.instance
  }

  registerIpcHandlers(ipcMain: IpcMain): void {
    ipcMain.handle(
      'sync:subscribeGitDirtyState',
      async (event, options: { projectPath: string; authorName?: string }) => {
        return await this.subscribe(event.sender, options)
      },
    )

    ipcMain.handle(
      'sync:unsubscribeGitDirtyState',
      async (event, options: { projectPath: string }) => {
        this.unsubscribe(event.sender, options.projectPath)
        return { success: true }
      },
    )
  }

  async subscribe(
    sender: WebContents,
    options: { projectPath: string; authorName?: string },
  ): Promise<GitDirtyStateSnapshot> {
    const projectPath = normalizeProjectPath(options.projectPath)
    let subscribers = this.subscriptionsByProjectPath.get(projectPath)
    if (!subscribers) {
      subscribers = new Map()
      this.subscriptionsByProjectPath.set(projectPath, subscribers)
    }

    subscribers.set(sender.id, {
      sender,
      authorName: options.authorName?.trim() || undefined,
    })

    sender.once('destroyed', () => {
      this.unsubscribeSender(sender.id)
    })

    this.ensureFallbackRefreshTimer()

    const snapshot = await this.refreshProjectPath(projectPath)
    this.publishSnapshot(projectPath, snapshot)
    return snapshot
  }

  unsubscribe(sender: WebContents, projectPath: string): void {
    const normalizedProjectPath = normalizeProjectPath(projectPath)
    const subscribers = this.subscriptionsByProjectPath.get(normalizedProjectPath)
    if (!subscribers) {
      this.maybeStopFallbackRefreshTimer()
      return
    }

    subscribers.delete(sender.id)
    if (subscribers.size === 0) {
      this.subscriptionsByProjectPath.delete(normalizedProjectPath)
      this.snapshotsByProjectPath.delete(normalizedProjectPath)
      const pendingTimer = this.pendingRefreshTimers.get(normalizedProjectPath)
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        this.pendingRefreshTimers.delete(normalizedProjectPath)
      }
    }

    this.maybeStopFallbackRefreshTimer()
  }

  invalidateProjectPath(projectPath: string): void {
    const normalizedProjectPath = normalizeProjectPath(projectPath)
    if (!this.subscriptionsByProjectPath.has(normalizedProjectPath)) {
      return
    }
    this.scheduleRefresh(normalizedProjectPath, INVALIDATION_DEBOUNCE_MS)
  }

  invalidateFilePath(filePath: string): void {
    for (const projectPath of this.subscriptionsByProjectPath.keys()) {
      if (!pathIsWithinRoot(filePath, projectPath)) {
        continue
      }
      this.scheduleRefresh(projectPath, INVALIDATION_DEBOUNCE_MS)
    }
  }

  private unsubscribeSender(senderId: number): void {
    for (const [projectPath, subscribers] of this.subscriptionsByProjectPath.entries()) {
      subscribers.delete(senderId)
      if (subscribers.size > 0) {
        continue
      }

      this.subscriptionsByProjectPath.delete(projectPath)
      this.snapshotsByProjectPath.delete(projectPath)
      const pendingTimer = this.pendingRefreshTimers.get(projectPath)
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        this.pendingRefreshTimers.delete(projectPath)
      }
    }

    this.maybeStopFallbackRefreshTimer()
  }

  private ensureFallbackRefreshTimer(): void {
    if (this.fallbackRefreshTimer) {
      return
    }

    this.fallbackRefreshTimer = setInterval(() => {
      for (const projectPath of this.subscriptionsByProjectPath.keys()) {
        this.scheduleRefresh(projectPath, 0)
      }
    }, FALLBACK_REFRESH_MS)
  }

  private maybeStopFallbackRefreshTimer(): void {
    if (this.subscriptionsByProjectPath.size > 0 || !this.fallbackRefreshTimer) {
      return
    }
    clearInterval(this.fallbackRefreshTimer)
    this.fallbackRefreshTimer = null
  }

  private scheduleRefresh(projectPath: string, delayMs: number): void {
    const existingTimer = this.pendingRefreshTimers.get(projectPath)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const timer = setTimeout(() => {
      this.pendingRefreshTimers.delete(projectPath)
      void this.refreshProjectPath(projectPath)
        .then((snapshot) => {
          this.publishSnapshot(projectPath, snapshot)
        })
        .catch(() => {
          // Ignore background refresh errors. The last published snapshot remains valid.
        })
    }, delayMs)

    this.pendingRefreshTimers.set(projectPath, timer)
  }

  private publishSnapshot(projectPath: string, snapshot: GitDirtyStateSnapshot): void {
    const subscribers = this.subscriptionsByProjectPath.get(projectPath)
    if (!subscribers) {
      return
    }

    for (const [senderId, subscription] of Array.from(subscribers.entries())) {
      const { sender } = subscription
      if (sender.isDestroyed()) {
        subscribers.delete(senderId)
        continue
      }
      sender.send(GIT_DIRTY_STATE_CHANGED_CHANNEL, snapshot)
    }

    if (subscribers.size === 0) {
      this.subscriptionsByProjectPath.delete(projectPath)
      this.snapshotsByProjectPath.delete(projectPath)
      this.maybeStopFallbackRefreshTimer()
    }
  }

  private async refreshProjectPath(projectPath: string): Promise<GitDirtyStateSnapshot> {
    const inflight = this.inflightRefreshes.get(projectPath)
    if (inflight) {
      return await inflight
    }

    const refreshPromise = (async () => {
      const subscribers = this.subscriptionsByProjectPath.get(projectPath)
      const authorName = Array.from(subscribers?.values() ?? [])
        .map((subscription) => subscription.authorName)
        .find((value): value is string => Boolean(value && value.trim().length > 0))

      try {
        const result = await getHeadDiffStats(projectPath, authorName ?? 'Cozea')
        const snapshot: GitDirtyStateSnapshot = {
          projectPath,
          additions: result.additions,
          deletions: result.deletions,
          changedFiles: result.changedFiles,
          computedAt: Date.now(),
          error: result.success ? undefined : result.error ?? 'Failed to compute git dirty state',
        }
        this.snapshotsByProjectPath.set(projectPath, snapshot)
        return snapshot
      } catch (error) {
        const snapshot: GitDirtyStateSnapshot = {
          projectPath,
          additions: 0,
          deletions: 0,
          changedFiles: 0,
          computedAt: Date.now(),
          error: error instanceof Error ? error.message : 'Failed to compute git dirty state',
        }
        this.snapshotsByProjectPath.set(projectPath, snapshot)
        return snapshot
      } finally {
        this.inflightRefreshes.delete(projectPath)
      }
    })()

    this.inflightRefreshes.set(projectPath, refreshPromise)
    return await refreshPromise
  }
}
