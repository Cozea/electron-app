import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { dispatchGitStatusEvent } from '@/lib/git/gitStatusEvents'
import {
  resolveEffectiveProjectGitBranch,
  resolveProjectGitRemoteConfig,
  resolveProjectGitSyncPolicy,
  type ProjectGitRuntimeSourceControlLike,
} from '@/lib/git/projectGitRuntime'

interface GitSyncMetadataResult {
  projectId: Id<'projects'>
  organizationId: Id<'organizations'>
  syncMode: 'git'
  gitRepository?: {
    provider?: string
    url?: string
    defaultBranch?: string | null
  } | null
  gitSyncState?: {
    accessState?: 'unknown' | 'pending' | 'granted' | 'missing' | 'error'
    lastFetchedCommit?: string
    lastPushedCommit?: string
    lastFetchAt?: number
    lastPushAt?: number
    errorMessage?: string
  } | null
  sourceControl?: ProjectGitRuntimeSourceControlLike | null
  updatedAt: number
}

interface GitDurabilityCoordinatorOptions {
  projectId: Id<'projects'>
  projectPath: string
  convex: ConvexReactClient
  userId: Id<'users'>
}

const SHARED_COORDINATORS = new Map<string, GitDurabilityCoordinator>()
const DEFAULT_DEBOUNCE_MS = 5000
const RETRY_BASE_DELAY_MS = 5000
const RETRY_MAX_DELAY_MS = 60000

function buildCoordinatorKey(options: GitDurabilityCoordinatorOptions): string {
  return `${options.projectId}:${options.userId}:${options.projectPath}`
}

export class GitDurabilityCoordinator {
  private static hooksInstalled = false

  static acquireShared(options: GitDurabilityCoordinatorOptions): GitDurabilityCoordinator {
    const key = buildCoordinatorKey(options)
    const existing = SHARED_COORDINATORS.get(key)
    if (existing) {
      existing.refCount += 1
      return existing
    }

    const coordinator = new GitDurabilityCoordinator(options)
    SHARED_COORDINATORS.set(key, coordinator)
    GitDurabilityCoordinator.installFlushHooks()
    return coordinator
  }

  private static installFlushHooks(): void {
    if (GitDurabilityCoordinator.hooksInstalled || typeof window === 'undefined') {
      return
    }
    GitDurabilityCoordinator.hooksInstalled = true

    const flushAll = () => {
      for (const coordinator of SHARED_COORDINATORS.values()) {
        void coordinator.flushNow()
      }
    }

    window.addEventListener('beforeunload', flushAll)
    window.addEventListener('pagehide', flushAll)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushAll()
      }
    })
    window.addEventListener('online', flushAll)
  }

  private readonly projectId: Id<'projects'>
  private readonly projectPath: string
  private readonly convex: ConvexReactClient
  private readonly userId: Id<'users'>

  private refCount = 1
  private pendingReasons = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushInFlight: Promise<void> | null = null
  private needsAnotherFlush = false
  private retryAttempt = 0
  private destroyed = false

  private constructor(options: GitDurabilityCoordinatorOptions) {
    this.projectId = options.projectId
    this.projectPath = options.projectPath
    this.convex = options.convex
    this.userId = options.userId
  }

  release(): void {
    this.refCount -= 1
    if (this.refCount > 0) {
      return
    }

    this.destroyed = true
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    void this.flushNow()
    SHARED_COORDINATORS.delete(buildCoordinatorKey({
      projectId: this.projectId,
      projectPath: this.projectPath,
      convex: this.convex,
      userId: this.userId,
    }))
  }

  scheduleSync(reason: string): void {
    if (this.destroyed) return
    this.pendingReasons.add(reason)
    dispatchGitStatusEvent({
      projectId: String(this.projectId),
      projectPath: this.projectPath,
      kind: 'dirty',
    })
    this.scheduleFlush(DEFAULT_DEBOUNCE_MS)
  }

  async flushNow(force = false): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    if (this.flushInFlight) {
      this.needsAnotherFlush = true
      await this.flushInFlight
      return
    }

    if (this.pendingReasons.size === 0) {
      return
    }

    const metadata = await this.convex.query(api.projects.getGitSyncMetadata, {
      projectId: this.projectId,
      userId: this.userId,
    }) as GitSyncMetadataResult | null

    if (!metadata || metadata.syncMode !== 'git') {
      return
    }

    if (!force && resolveProjectGitSyncPolicy(metadata.sourceControl) === 'manual') {
      return
    }

    const reasons = Array.from(this.pendingReasons)
    this.pendingReasons.clear()

    this.flushInFlight = this.runSync(reasons, metadata)
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Git durability sync failed'
        console.warn('[GitDurabilityCoordinator] Sync failed:', {
          projectId: String(this.projectId),
          projectPath: this.projectPath,
          reasons,
          error: message,
        })
        for (const reason of reasons) {
          this.pendingReasons.add(reason)
        }
        this.retryAttempt += 1
        this.scheduleFlush(Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (this.retryAttempt - 1)))
      })
      .finally(() => {
        this.flushInFlight = null
        if (this.needsAnotherFlush && this.pendingReasons.size > 0) {
          this.needsAnotherFlush = false
          void this.flushNow()
          return
        }
        this.needsAnotherFlush = false
      })

    await this.flushInFlight
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flushNow()
    }, delayMs)
  }

  private async runSync(
    reasons: string[],
    metadata: GitSyncMetadataResult
  ): Promise<void> {
    const {
      branch: configuredBranch,
      repoUrl,
      provider,
      accessToken,
      usesExistingRemote,
    } = await resolveProjectGitRemoteConfig({
      convex: this.convex,
      project: metadata,
      userId: this.userId,
    })

    if (!repoUrl && !usesExistingRemote) {
      return
    }

    const branch = await resolveEffectiveProjectGitBranch({
      projectPath: this.projectPath,
      fallbackBranch: configuredBranch,
      usesExistingRemote,
    })

    const ensureResult = await window.electronAPI.sync.gitEnsureRepo({
      projectPath: this.projectPath,
      branch,
      repoUrl,
    })
    if (!ensureResult.success) {
      throw new Error(ensureResult.error || 'Failed to prepare local git repository')
    }

    let status = await window.electronAPI.sync.gitStatus({
      projectPath: this.projectPath,
      branch,
    })
    if (!status.success || !status.isRepo) {
      throw new Error(status.error || 'Failed to read git status')
    }
    if (status.hasConflicts) {
      throw new Error('Local git conflicts must be resolved before automatic sync can continue.')
    }

    if (status.hasStagedChanges || status.hasUnstagedChanges || status.hasUntrackedChanges) {
      const commitResult = await window.electronAPI.sync.gitCommitAll({
        projectPath: this.projectPath,
        message: 'auto: sync workspace',
      })
      if (!commitResult.success) {
        throw new Error(commitResult.error || 'Failed to create automatic git sync commit')
      }
    }

    const fetchResult = await window.electronAPI.sync.gitFetchMain({
      projectPath: this.projectPath,
      branch,
      repoUrl,
      provider,
      accessToken,
    })
    if (!fetchResult.success) {
      throw new Error(fetchResult.error || 'Failed to fetch latest remote git state')
    }

    status = await window.electronAPI.sync.gitStatus({
      projectPath: this.projectPath,
      branch,
    })
    if (!status.success || !status.isRepo) {
      throw new Error(status.error || 'Failed to verify git status after fetch')
    }
    if (status.hasConflicts) {
      throw new Error('Local git conflicts must be resolved before automatic sync can continue.')
    }

    if (status.behind && status.behind > 0) {
      const pullResult = await window.electronAPI.sync.gitPullMain({
        projectPath: this.projectPath,
        branch,
        repoUrl,
        strategy: 'merge',
        provider,
        accessToken,
      })
      if (!pullResult.success) {
        throw new Error(pullResult.error || 'Failed to pull latest remote git state')
      }
      if (pullResult.hadConflicts) {
        throw new Error('Git merge conflicts must be resolved before automatic sync can continue.')
      }
    }

    status = await window.electronAPI.sync.gitStatus({
      projectPath: this.projectPath,
      branch,
    })
    if (!status.success || !status.isRepo) {
      throw new Error(status.error || 'Failed to verify git status after pull')
    }
    if (status.hasConflicts) {
      throw new Error('Git merge conflicts must be resolved before automatic sync can continue.')
    }

    if (status.ahead && status.ahead > 0) {
      const pushResult = await window.electronAPI.sync.gitPushMain({
        projectPath: this.projectPath,
        branch,
        repoUrl,
        provider,
        accessToken,
      })
      if (!pushResult.success) {
        throw new Error(pushResult.error || 'Failed to push latest project changes')
      }

      await this.updateMetadata({
        lastFetchedCommit: fetchResult.headCommit,
        lastPushedCommit: pushResult.headCommit,
      })
    } else {
      await this.updateMetadata({
        lastFetchedCommit: fetchResult.headCommit,
      })
    }

    this.retryAttempt = 0
    dispatchGitStatusEvent({
      projectId: String(this.projectId),
      projectPath: this.projectPath,
      kind: 'synced',
    })
    console.log('[GitDurabilityCoordinator] Synced project via git', {
      projectId: String(this.projectId),
      projectPath: this.projectPath,
      reasons,
      branch,
    })
  }

  private async updateMetadata(args: {
    lastFetchedCommit?: string
    lastPushedCommit?: string
  }): Promise<void> {
    try {
      await this.convex.mutation(api.projects.updateGitSyncMetadata, {
        projectId: this.projectId,
        userId: this.userId,
        gitSyncState: {
          accessState: 'granted',
          lastFetchedCommit: args.lastFetchedCommit,
          lastPushedCommit: args.lastPushedCommit,
          lastFetchAt: args.lastFetchedCommit ? Date.now() : undefined,
          lastPushAt: args.lastPushedCommit ? Date.now() : undefined,
          errorMessage: undefined,
        },
      })
    } catch (error) {
      console.warn('[GitDurabilityCoordinator] Failed to update git sync metadata:', error)
    }
  }
}
