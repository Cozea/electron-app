import { useCallback, useEffect, useRef } from 'react'

import type { Id } from '../../convex/_generated/dataModel'
import { buildCozeaGitAuthHeader, buildCozeaGitRemoteUrl } from '@/lib/git/cozeaRemote'
import {
  GIT_STATUS_EVENT_NAME,
  type GitStatusEventDetail,
} from '@/lib/git/gitStatusEvents'
import {
  useProjectDiffStore,
  type ProjectDiffStatus,
} from '@/stores/useProjectDiffStore'
import { scheduleTask } from '@/lib/scheduler'

const MIN_FULL_REFRESH_INTERVAL = 30 * 1000
const GIT_CHECK_TIMEOUT_MS = 20 * 1000
const INITIAL_CHECK_MAX_STAGGER_MS = 1200
const inFlightBySlug = new Set<string>()

function hashString(input: string): number {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0
  }
  return hash
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function isProjectDiffDebugEnabled(): boolean {
  if (!import.meta.env.DEV) return false

  try {
    return window.localStorage.getItem('projectDiffDebug') === '1'
  } catch {
    return false
  }
}

function logProjectDiffDebug(event: string, payload: Record<string, unknown>): void {
  if (!isProjectDiffDebugEnabled()) return
  console.info(`[ProjectDiffStatus][Debug] ${event}`, payload)
}

function isNonRepoStateError(message: string): boolean {
  return (
    /not a git repository/i.test(message) ||
    /project path is not a git repository/i.test(message) ||
    /remote branch .* not found/i.test(message) ||
    /remote head refers to nonexistent ref/i.test(message)
  )
}

async function resolveGitExtraHeader(): Promise<string | undefined> {
  try {
    const session = await window.electronAPI.auth.getSession()
    return buildCozeaGitAuthHeader(session?.accessToken)
  } catch (error) {
    console.warn('[ProjectDiffStatus] Failed to resolve git auth header:', error)
    return undefined
  }
}

interface UseProjectDiffStatusOptions {
  projectId: Id<'projects'>
  projectSlug: string
  localPath: string | null
  lastSyncAt?: number
  initialRefreshMode?: 'remote' | 'local' | 'none'
}

export function useProjectDiffStatus({
  projectId,
  projectSlug,
  localPath,
  lastSyncAt,
  initialRefreshMode = 'remote',
}: UseProjectDiffStatusOptions): ProjectDiffStatus | undefined {
  const diffStatus = useProjectDiffStore((state) => state.diffs[projectSlug])
  const setDiffStatus = useProjectDiffStore((state) => state.setDiffStatus)
  const setChecking = useProjectDiffStore((state) => state.setChecking)
  const initialRefreshKeyRef = useRef<string | null>(null)
  const localRefreshKeyRef = useRef<string | null>(null)

  const checkDiff = useCallback(async (
    options?: {
      force?: boolean
      fetchRemote?: boolean
    }
  ) => {
    if (!localPath) return

    const force = options?.force ?? false
    const fetchRemote = options?.fetchRemote ?? true
    const currentStatus = useProjectDiffStore.getState().diffs[projectSlug]
    if (currentStatus?.isChecking) return
    if (inFlightBySlug.has(projectSlug)) return

    const lastChecked = currentStatus?.lastChecked ?? 0
    if (fetchRemote && !force && Date.now() - lastChecked < MIN_FULL_REFRESH_INTERVAL) {
      return
    }

    inFlightBySlug.add(projectSlug)
    setChecking(projectSlug, true)

    try {
      logProjectDiffDebug('check:start', {
        projectId: String(projectId),
        projectSlug,
        localPath,
        force,
        fetchRemote,
      })

      const exists = await withTimeout(
        window.electronAPI.project.pathExists(localPath),
        GIT_CHECK_TIMEOUT_MS,
        'Git path check timed out'
      )

      if (!exists) {
        setDiffStatus(projectSlug, {
          downloads: 0,
          uploads: 0,
          conflicts: 0,
          error: undefined,
        })
        return
      }

      if (fetchRemote) {
        const extraHeader = await resolveGitExtraHeader()
        const repoUrl = buildCozeaGitRemoteUrl(String(projectId))
        const fetchResult = await withTimeout(
          window.electronAPI.sync.gitFetchMain({
            projectPath: localPath,
            branch: 'main',
            repoUrl,
            extraHeader,
          }),
          GIT_CHECK_TIMEOUT_MS,
          'Git fetch timed out'
        )

        if (!fetchResult.success) {
          throw new Error(fetchResult.error || 'Failed to fetch latest project changes')
        }
      }

      const statusResult = await withTimeout(
        window.electronAPI.sync.gitStatus({
          projectPath: localPath,
          branch: 'main',
        }),
        GIT_CHECK_TIMEOUT_MS,
        'Git status timed out'
      )

      if (!statusResult.success) {
        throw new Error(statusResult.error || 'Failed to read local git status')
      }

      if (!statusResult.repoExists || !statusResult.isRepo) {
        setDiffStatus(projectSlug, {
          downloads: 0,
          uploads: 0,
          conflicts: 0,
          error: undefined,
        })
        return
      }

      const conflicts =
        statusResult.hasConflicts
          ? Math.max(1, (statusResult.changedPaths ?? []).length)
          : 0

      setDiffStatus(projectSlug, {
        downloads: Math.max(0, statusResult.behind ?? 0),
        uploads: Math.max(0, statusResult.ahead ?? 0),
        conflicts,
        error: undefined,
      })

      logProjectDiffDebug('check:success', {
        projectId: String(projectId),
        projectSlug,
        downloads: statusResult.behind ?? 0,
        uploads: statusResult.ahead ?? 0,
        conflicts,
        fetchRemote,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (isNonRepoStateError(message)) {
        logProjectDiffDebug('check:non_repo_state', {
          projectId: String(projectId),
          projectSlug,
          localPath,
          error: message,
        })
        setDiffStatus(projectSlug, {
          downloads: 0,
          uploads: 0,
          conflicts: 0,
          error: undefined,
        })
        return
      }
      console.error(`[ProjectDiffStatus] Error checking ${projectSlug}:`, {
        projectId: String(projectId),
        projectSlug,
        localPath,
        error: message,
      })
      setDiffStatus(projectSlug, {
        downloads: 0,
        uploads: 0,
        conflicts: 0,
        error: message,
      })
    } finally {
      setChecking(projectSlug, false)
      inFlightBySlug.delete(projectSlug)
    }
  }, [localPath, projectId, projectSlug, setChecking, setDiffStatus])

  useEffect(() => {
    const initialRefreshKey = localPath ? `${projectSlug}:${localPath}` : null
    if (!initialRefreshKey) {
      initialRefreshKeyRef.current = null
      localRefreshKeyRef.current = null
      return
    }

    if (initialRefreshKeyRef.current === initialRefreshKey) {
      return
    }

    initialRefreshKeyRef.current = initialRefreshKey
    localRefreshKeyRef.current = `${initialRefreshKey}:${lastSyncAt ?? 0}`

    if (initialRefreshMode === 'none') {
      return
    }

    const initialDelayMs = hashString(projectSlug) % INITIAL_CHECK_MAX_STAGGER_MS
    const initialTimerId = window.setTimeout(() => {
      void scheduleTask(
        () =>
          checkDiff({
            force: true,
            fetchRemote: initialRefreshMode === 'remote',
          }),
        'background'
      )
    }, initialDelayMs)

    return () => {
      window.clearTimeout(initialTimerId)
    }
  }, [checkDiff, initialRefreshMode, lastSyncAt, localPath, projectSlug])

  useEffect(() => {
    const handleFocusRefresh = () => {
      void scheduleTask(() => checkDiff({ fetchRemote: true }), 'background')
    }

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        void scheduleTask(() => checkDiff({ fetchRemote: true }), 'background')
      }
    }

    const handleGitStatusEvent = (event: Event) => {
      const detail = (event as CustomEvent<GitStatusEventDetail>).detail
      if (!detail || detail.projectId !== String(projectId)) {
        return
      }
      void scheduleTask(() => checkDiff({ force: true, fetchRemote: false }), 'background')
    }

    window.addEventListener('focus', handleFocusRefresh)
    window.addEventListener('online', handleFocusRefresh)
    window.addEventListener(GIT_STATUS_EVENT_NAME, handleGitStatusEvent as EventListener)
    document.addEventListener('visibilitychange', handleVisibilityRefresh)

    return () => {
      window.removeEventListener('focus', handleFocusRefresh)
      window.removeEventListener('online', handleFocusRefresh)
      window.removeEventListener(GIT_STATUS_EVENT_NAME, handleGitStatusEvent as EventListener)
      document.removeEventListener('visibilitychange', handleVisibilityRefresh)
    }
  }, [checkDiff, projectId])

  useEffect(() => {
    const localRefreshKey = localPath ? `${projectSlug}:${localPath}:${lastSyncAt ?? 0}` : null
    if (!localRefreshKey) {
      localRefreshKeyRef.current = null
      return
    }

    if (localRefreshKeyRef.current === null) {
      localRefreshKeyRef.current = localRefreshKey
      return
    }

    if (localRefreshKeyRef.current === localRefreshKey) {
      return
    }

    localRefreshKeyRef.current = localRefreshKey
    const localDelayMs = hashString(localRefreshKey) % Math.max(1, Math.floor(INITIAL_CHECK_MAX_STAGGER_MS / 2))
    const refreshTimerId = window.setTimeout(() => {
      void scheduleTask(() => checkDiff({ force: true, fetchRemote: false }), 'background')
    }, localDelayMs)

    return () => {
      window.clearTimeout(refreshTimerId)
    }
  }, [checkDiff, lastSyncAt, localPath, projectSlug])

  return diffStatus
}
