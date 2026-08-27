import path from 'node:path'

import type { WebContents } from 'electron'

import type { GitChangesSnapshot, GitChangesScope, GitDirtyStateSnapshot } from '../../shared/electronApiTypes'
import { invalidateVcsStatus } from '../substrate/vcs/statusInvalidation'
import { VcsStatusBroadcaster } from '../substrate/vcs/VcsStatusBroadcaster'

/**
 * IPC fan-out for Changes UI subscriptions. Refresh logic lives in
 * {@link VcsStatusBroadcaster} (Phase 4c — no background poll).
 */

const GIT_CHANGES_UPDATED_CHANNEL = 'workspaceSync:gitChangesUpdated'
const GIT_DIRTY_STATE_CHANGED_CHANNEL = 'workspaceSync:gitDirtyStateChanged'

interface GitChangesSubscription {
  sender: WebContents
  scope: GitChangesScope
  workspaceId: string
}

interface GitDirtyStateSubscription {
  sender: WebContents
  workspaceId: string
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

function buildCacheKey(projectPath: string, scope: GitChangesScope): string {
  return `${projectPath}\0${scope}`
}

export class GitChangesBroadcaster {
  private static instance: GitChangesBroadcaster | null = null

  private readonly subscriptionsByKey = new Map<string, Map<number, GitChangesSubscription>>()
  private readonly destroyedListenerSenders = new Set<number>()
  private readonly statusBroadcaster = VcsStatusBroadcaster.getInstance()
  private unsubscribeStatusStream: (() => void) | null = null

  private readonly dirtyStateSubsByPath = new Map<string, Map<number, GitDirtyStateSubscription>>()
  private readonly workspaceIdByPath = new Map<string, string>()

  static getInstance(): GitChangesBroadcaster {
    if (!GitChangesBroadcaster.instance) {
      GitChangesBroadcaster.instance = new GitChangesBroadcaster()
    }
    return GitChangesBroadcaster.instance
  }

  private constructor() {
    this.unsubscribeStatusStream = this.statusBroadcaster.subscribe((projectPath, scope, snapshot) => {
      const key = buildCacheKey(projectPath, scope)
      this.publishSnapshot(key, snapshot)
      if (scope === 'current') {
        this.publishDirtyStateForPath(projectPath, snapshot)
      }
    })
  }

  async subscribe(
    sender: WebContents,
    options: { projectPath: string; scope: GitChangesScope; workspaceId?: string },
  ): Promise<GitChangesSnapshot> {
    const projectPath = normalizeProjectPath(options.projectPath)
    if (options.workspaceId) {
      this.workspaceIdByPath.set(projectPath, options.workspaceId)
      this.statusBroadcaster.registerWorkspaceId(projectPath, options.workspaceId)
    }
    const key = buildCacheKey(projectPath, options.scope)
    let subscribers = this.subscriptionsByKey.get(key)
    if (!subscribers) {
      subscribers = new Map()
      this.subscriptionsByKey.set(key, subscribers)
    }

    subscribers.set(sender.id, {
      sender,
      scope: options.scope,
      workspaceId: options.workspaceId ?? projectPath,
    })

    if (!this.destroyedListenerSenders.has(sender.id)) {
      this.destroyedListenerSenders.add(sender.id)
      sender.once('destroyed', () => {
        this.destroyedListenerSenders.delete(sender.id)
        this.unsubscribeSender(sender.id)
      })
    }

    const snapshot = await this.statusBroadcaster.refresh(projectPath, options.scope)
    this.publishSnapshot(key, snapshot)
    return snapshot
  }

  unsubscribe(sender: WebContents, projectPath: string, scope: GitChangesScope): void {
    const normalizedProjectPath = normalizeProjectPath(projectPath)
    const key = buildCacheKey(normalizedProjectPath, scope)
    const subscribers = this.subscriptionsByKey.get(key)
    if (!subscribers) {
      return
    }

    subscribers.delete(sender.id)
    if (subscribers.size === 0) {
      this.subscriptionsByKey.delete(key)
    }
  }

  invalidateProjectPath(projectPath: string): void {
    this.statusBroadcaster.invalidateProjectPath(normalizeProjectPath(projectPath))
  }

  invalidateViaSubstrateBus(projectPath: string): void {
    invalidateVcsStatus(normalizeProjectPath(projectPath), 'all')
  }

  invalidateFilePath(filePath: string): void {
    for (const key of this.subscriptionsByKey.keys()) {
      const projectPath = key.split('\0')[0]
      const scope = key.split('\0')[1] as GitChangesScope
      if (!pathIsWithinRoot(filePath, projectPath)) {
        continue
      }
      this.statusBroadcaster.invalidateProjectPath(projectPath)
      void scope
    }
  }

  private unsubscribeSender(senderId: number): void {
    for (const [key, subscribers] of this.subscriptionsByKey.entries()) {
      subscribers.delete(senderId)
      if (subscribers.size === 0) {
        this.subscriptionsByKey.delete(key)
      }
    }
  }

  private publishSnapshot(key: string, snapshot: GitChangesSnapshot): void {
    const subscribers = this.subscriptionsByKey.get(key)
    if (!subscribers) {
      return
    }

    for (const [senderId, subscription] of Array.from(subscribers.entries())) {
      const { sender, workspaceId } = subscription
      if (sender.isDestroyed()) {
        subscribers.delete(senderId)
        continue
      }
      sender.send(GIT_CHANGES_UPDATED_CHANNEL, { ...snapshot, workspaceId })
    }

    if (subscribers.size === 0) {
      this.subscriptionsByKey.delete(key)
    }
  }

  async subscribeGitDirtyState(
    sender: WebContents,
    options: { projectPath: string; workspaceId?: string; authorName?: string },
  ): Promise<GitDirtyStateSnapshot> {
    const projectPath = normalizeProjectPath(options.projectPath)
    const workspaceId = options.workspaceId ?? this.workspaceIdByPath.get(projectPath) ?? projectPath

    if (!this.dirtyStateSubsByPath.has(projectPath)) {
      this.dirtyStateSubsByPath.set(projectPath, new Map())
    }
    this.dirtyStateSubsByPath.get(projectPath)!.set(sender.id, {
      sender,
      workspaceId,
      authorName: options.authorName,
    })

    const snapshot = await this.statusBroadcaster.refresh(projectPath, 'current')
    return this.buildDirtyStateSnapshot(workspaceId, snapshot)
  }

  unsubscribeGitDirtyState(sender: WebContents, projectPath: string): void {
    const normalizedPath = normalizeProjectPath(projectPath)
    const subs = this.dirtyStateSubsByPath.get(normalizedPath)
    if (!subs) return
    subs.delete(sender.id)
    if (subs.size === 0) {
      this.dirtyStateSubsByPath.delete(normalizedPath)
    }
  }

  private buildDirtyStateSnapshot(workspaceId: string, changesSnapshot: GitChangesSnapshot): GitDirtyStateSnapshot {
    return {
      workspaceId,
      additions: changesSnapshot.additions,
      deletions: changesSnapshot.deletions,
      changedFiles: changesSnapshot.files.length,
      computedAt: Date.now(),
      error: changesSnapshot.error ?? undefined,
    }
  }

  private publishDirtyStateForPath(projectPath: string, changesSnapshot: GitChangesSnapshot): void {
    const subs = this.dirtyStateSubsByPath.get(projectPath)
    if (!subs || subs.size === 0) return

    for (const [senderId, sub] of Array.from(subs.entries())) {
      if (sub.sender.isDestroyed()) {
        subs.delete(senderId)
        continue
      }
      sub.sender.send(GIT_DIRTY_STATE_CHANGED_CHANNEL, this.buildDirtyStateSnapshot(sub.workspaceId, changesSnapshot))
    }
  }

  /** @internal test helper */
  disposeForTests(): void {
    this.unsubscribeStatusStream?.()
    this.unsubscribeStatusStream = null
  }
}
