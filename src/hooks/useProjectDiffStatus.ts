import { useEffect } from 'react'

import type { Id } from '../../convex/_generated/dataModel'
import { buildCozeaGitAuthHeader, buildCozeaGitRemoteUrl } from '@/lib/git/cozeaRemote'
import {
  useProjectDiffStore,
  type ProjectDiffStatus,
} from '@/stores/useProjectDiffStore'

const MIN_CHECK_INTERVAL = 30 * 1000
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
}

export function useProjectDiffStatus({
  projectId,
  projectSlug,
  localPath,
  lastSyncAt,
}: UseProjectDiffStatusOptions): ProjectDiffStatus | undefined {
  const diffStatus = useProjectDiffStore((state) => state.diffs[projectSlug])
  const setDiffStatus = useProjectDiffStore((state) => state.setDiffStatus)
  const setChecking = useProjectDiffStore((state) => state.setChecking)

  useEffect(() => {
    let cancelled = false

    async function checkDiff(force = false) {
      if (!localPath) return

      const currentStatus = useProjectDiffStore.getState().diffs[projectSlug]
      if (currentStatus?.isChecking) return
      if (inFlightBySlug.has(projectSlug)) return

      const lastChecked = currentStatus?.lastChecked ?? 0
      if (!force && Date.now() - lastChecked < MIN_CHECK_INTERVAL) return

      inFlightBySlug.add(projectSlug)
      setChecking(projectSlug, true)

      try {
        logProjectDiffDebug('check:start', {
          projectId: String(projectId),
          projectSlug,
          localPath,
          force,
        })

        const exists = await withTimeout(
          window.electronAPI.project.pathExists(localPath),
          GIT_CHECK_TIMEOUT_MS,
          'Git path check timed out'
        )
        if (cancelled) return

        if (!exists) {
          setDiffStatus(projectSlug, {
            downloads: 0,
            uploads: 0,
            conflicts: 0,
            error: undefined,
          })
          return
        }

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
        if (cancelled) return

        if (!fetchResult.success) {
          throw new Error(fetchResult.error || 'Failed to fetch latest project changes')
        }

        const statusResult = await withTimeout(
          window.electronAPI.sync.gitStatus({
            projectPath: localPath,
            branch: 'main',
          }),
          GIT_CHECK_TIMEOUT_MS,
          'Git status timed out'
        )
        if (cancelled) return

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
        })
      } catch (error) {
        if (cancelled) return

        const message = error instanceof Error ? error.message : 'Unknown error'
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
    }

    const initialDelayMs = hashString(projectSlug) % INITIAL_CHECK_MAX_STAGGER_MS
    const initialTimerId = window.setTimeout(() => {
      void checkDiff(true)
    }, initialDelayMs)
    const intervalId = window.setInterval(() => {
      void checkDiff(false)
    }, MIN_CHECK_INTERVAL)

    return () => {
      cancelled = true
      window.clearTimeout(initialTimerId)
      window.clearInterval(intervalId)
    }
  }, [lastSyncAt, localPath, projectId, projectSlug, setChecking, setDiffStatus])

  return diffStatus
}
