import { useEffect, useCallback } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * Traffic light states for file locks.
 */
export type TrafficLight = 'green' | 'yellow' | 'red'

/**
 * Lock information returned by the hook.
 */
export interface FileLockState {
  /** Traffic light color: green (free), yellow (human editing), red (agent working) */
  trafficLight: TrafficLight
  /** Whether the file is currently locked */
  isLocked: boolean
  /** Whether it's locked by someone other than the current user */
  isLockedByOther: boolean
  /** Whether an agent has the lock (red light) */
  isAgentLocked: boolean
  /** Name of who holds the lock */
  lockedByName: string | null
  /** Task description (for agent locks) */
  taskDescription: string | null
  /** When the lock expires (for agent locks) */
  expiresAt: number | null
}

/**
 * useFileLock - Hook for managing file locks in the collaborative editor.
 *
 * Returns the current lock state and functions to acquire/release locks.
 * Automatically sends heartbeats while editing to keep the lock alive.
 *
 * @param projectId - The project ID
 * @param filePath - The file path (relative to project root)
 * @param userId - The current user's ID
 * @param isEditing - Whether the user is actively editing this file
 */
export function useFileLock(
  projectId: Id<'projects'> | null,
  filePath: string | null,
  userId: Id<'users'> | null,
  isEditing: boolean = false
) {
  const lock = useQuery(
    api.projectFileLocks.getLock,
    projectId && filePath ? { projectId, filePath } : 'skip'
  )

  const acquireLockMutation = useMutation(api.projectFileLocks.acquireLock)
  const releaseLockMutation = useMutation(api.projectFileLocks.releaseLock)

  // Acquire lock when editing starts
  const acquireLock = useCallback(async () => {
    if (!projectId || !filePath || !userId) return false

    const result = await acquireLockMutation({
      projectId,
      filePath,
      userId,
      ttlMs: 30_000, // 30 second timeout
    })

    return result.acquired
  }, [projectId, filePath, userId, acquireLockMutation])

  // Release lock when editing stops
  const releaseLock = useCallback(async () => {
    if (!projectId || !filePath || !userId) return false

    const result = await releaseLockMutation({
      projectId,
      filePath,
      userId,
    })

    return result.released
  }, [projectId, filePath, userId, releaseLockMutation])

  // Auto-acquire lock when editing starts
  useEffect(() => {
    if (!isEditing || !projectId || !filePath || !userId) return

    // Acquire lock
    acquireLock()

    // Send heartbeats to keep lock alive
    const heartbeatInterval = setInterval(() => {
      acquireLock() // Re-acquiring extends the TTL
    }, 20_000) // Every 20 seconds

    return () => {
      clearInterval(heartbeatInterval)
      // Release lock when component unmounts or editing stops
      releaseLock()
    }
  }, [isEditing, projectId, filePath, userId, acquireLock, releaseLock])

  // Compute lock state
  const state: FileLockState = {
    trafficLight: (lock?.trafficLight as TrafficLight) ?? 'green',
    isLocked: lock?.status === 'locked',
    isLockedByOther: lock?.status === 'locked' && lock.lockedBy !== userId,
    isAgentLocked: lock?.status === 'locked' && !!lock.agentId,
    lockedByName: lock?.lockedByUser?.name ?? lock?.agentName ?? null,
    taskDescription: lock?.taskDescription ?? null,
    expiresAt: lock?.expiresAt ?? null,
  }

  return {
    ...state,
    lock,
    acquireLock,
    releaseLock,
  }
}

/**
 * useProjectLocks - Hook to get all file locks for a project.
 *
 * Useful for displaying lock status in file trees or editor tabs.
 */
export function useProjectLocks(projectId: Id<'projects'> | null) {
  const locks = useQuery(
    api.projectFileLocks.getProjectLocks,
    projectId ? { projectId } : 'skip'
  )

  // Create a map for quick lookups
  type LockEntry = NonNullable<typeof locks>[number]
  const locksByPath = new Map<string, LockEntry>()
  if (locks) {
    for (const lock of locks) {
      locksByPath.set(lock.filePath, lock)
    }
  }

  const getTrafficLight = (filePath: string): TrafficLight => {
    const lock = locksByPath.get(filePath)
    if (!lock || lock.status === 'free') return 'green'
    if (lock.agentId) return 'red'
    return 'yellow'
  }

  return {
    locks: locks ?? [],
    locksByPath,
    getTrafficLight,
  }
}
