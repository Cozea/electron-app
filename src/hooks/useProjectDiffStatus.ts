import { useEffect } from "react"
import type { Id } from "../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { isBootstrapOnlyLocalPath } from "@/features/projects/lib/localWorkspaceState"
import {
  useProjectDiffStore,
  type ProjectDiffStatus,
} from "@/stores/useProjectDiffStore"

const MIN_CHECK_INTERVAL = 30 * 1000
const REPLICA_AUTH_COOLDOWN_MS = 60 * 1000
const INTERACTIVE_LOGIN_COOLDOWN_MS = 2 * 60 * 1000
const REPLICA_CHECK_TIMEOUT_MS = 20 * 1000
const AUTH_RECOVERY_TIMEOUT_MS = 12 * 1000
const INITIAL_CHECK_MAX_STAGGER_MS = 1200
const inFlightBySlug = new Set<string>()
let replicaAuthBlockedUntil = 0
let hasLoggedReplicaAuthCooldown = false
let authRecoveryPromise: Promise<"refreshed" | "login_started" | "failed"> | null = null
let lastInteractiveLoginAt = 0

function hashString(input: string): number {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0
  }
  return hash
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function recoverReplicaAuth(
  refreshToken: () => Promise<boolean>,
  login: () => Promise<void>
): Promise<"refreshed" | "login_started" | "failed"> {
  if (authRecoveryPromise) {
    return authRecoveryPromise
  }

  authRecoveryPromise = (async () => {
    try {
      const refreshed = await withTimeout(
        refreshToken(),
        AUTH_RECOVERY_TIMEOUT_MS,
        'Auth refresh timed out'
      )
      if (refreshed) {
        replicaAuthBlockedUntil = 0
        hasLoggedReplicaAuthCooldown = false
        return "refreshed"
      }

      const now = Date.now()
      if (now - lastInteractiveLoginAt < INTERACTIVE_LOGIN_COOLDOWN_MS) {
        return "failed"
      }

      lastInteractiveLoginAt = now
      await withTimeout(
        login(),
        AUTH_RECOVERY_TIMEOUT_MS,
        'Auth login launch timed out'
      )
      return "login_started"
    } catch (error) {
      console.error("[ProjectDiffStatus] Auth recovery failed:", error)
      return "failed"
    } finally {
      authRecoveryPromise = null
    }
  })()

  return authRecoveryPromise
}

interface UseProjectDiffStatusOptions {
  projectId: Id<"projects">
  projectSlug: string
  localPath: string | null
  lastSyncAt?: number
}

/**
 * Shared background diff checker for project cards/rows/badges.
 * Keeps one reconciliation implementation for lightweight status surfaces.
 */
export function useProjectDiffStatus({
  projectId,
  projectSlug,
  localPath,
  lastSyncAt,
}: UseProjectDiffStatusOptions): ProjectDiffStatus | undefined {
  const { refreshToken, login } = useAuth()
  const diffStatus = useProjectDiffStore((state) => state.diffs[projectSlug])
  const setDiffStatus = useProjectDiffStore((state) => state.setDiffStatus)
  const setChecking = useProjectDiffStore((state) => state.setChecking)

  useEffect(() => {
    let cancelled = false

    const isUnauthorizedError = (message: string): boolean =>
      /\b401\b/.test(message) || /unauthorized/i.test(message)

    async function checkDiff(force = false) {
      if (!localPath) return

      if (Date.now() < replicaAuthBlockedUntil) return

      const currentStatus = useProjectDiffStore.getState().diffs[projectSlug]
      if (currentStatus?.isChecking) return
      if (inFlightBySlug.has(projectSlug)) return

      const lastChecked = currentStatus?.lastChecked ?? 0
      if (!force && Date.now() - lastChecked < MIN_CHECK_INTERVAL) return

      inFlightBySlug.add(projectSlug)
      setChecking(projectSlug, true)

      const runDiffCheck = async () => {
        const exists = await withTimeout(
          window.electronAPI.project.pathExists(localPath),
          REPLICA_CHECK_TIMEOUT_MS,
          'Project path check timed out'
        )
        if (cancelled) return

        if (!exists) {
          setDiffStatus(projectSlug, {
            downloads: 0,
            uploads: 0,
            conflicts: 0,
          })
          return
        }

        const bootstrap = await withTimeout(
          window.electronAPI.sync.gitReplicaBootstrap({
            projectId: String(projectId),
            projectPath: localPath,
          }),
          REPLICA_CHECK_TIMEOUT_MS,
          'Replica bootstrap timed out'
        )
        if (cancelled) return

        if (!bootstrap.success) {
          throw new Error(bootstrap.error || "Failed to bootstrap replica")
        }

        const plan = await withTimeout(
          window.electronAPI.sync.gitReplicaPlan({
            projectId: String(projectId),
            projectPath: localPath,
          }),
          REPLICA_CHECK_TIMEOUT_MS,
          'Replica plan timed out'
        )
        if (cancelled) return

        if (!plan.success) {
          throw new Error(plan.error || "Failed to compute replica plan")
        }
        const nonBootstrapUploadCount = plan.uploads.filter(
          (entry) => !isBootstrapOnlyLocalPath(entry.path)
        ).length
        const localWipeLikePattern =
          nonBootstrapUploadCount === 0 &&
          plan.localDeletes.length === 0 &&
          plan.conflicts.length === 0 &&
          (plan.autoMerged?.length ?? 0) === 0 &&
          plan.cloudDeletes.length > 0

        setDiffStatus(projectSlug, {
          downloads: localWipeLikePattern
            ? plan.downloads.length + plan.cloudDeletes.length
            : plan.downloads.length,
          uploads: localWipeLikePattern
            ? 0
            : nonBootstrapUploadCount + plan.cloudDeletes.length,
          conflicts: plan.conflicts.length,
        })
        hasLoggedReplicaAuthCooldown = false
      }

      try {
        await runDiffCheck()
      } catch (error) {
        if (cancelled) return

        let message = error instanceof Error ? error.message : "Unknown error"
        if (isUnauthorizedError(message)) {
          const recoveryResult = await recoverReplicaAuth(refreshToken, login)
          if (cancelled) return

          if (recoveryResult === "refreshed") {
            try {
              await runDiffCheck()
              return
            } catch (retryError) {
              if (cancelled) return
              message = retryError instanceof Error ? retryError.message : "Unknown error"
            }
          }

          if (!hasLoggedReplicaAuthCooldown) {
            console.warn("[ProjectDiffStatus] Replica API unauthorized; attempted auth recovery and will retry shortly.")
            hasLoggedReplicaAuthCooldown = true
          }

          replicaAuthBlockedUntil = Date.now() + REPLICA_AUTH_COOLDOWN_MS
          setDiffStatus(projectSlug, {
            downloads: 0,
            uploads: 0,
            conflicts: 0,
            error: message,
          })
          return
        }

        console.error(`[ProjectDiffStatus] Error checking ${projectSlug}:`, error)
        setDiffStatus(projectSlug, {
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
  }, [localPath, projectId, projectSlug, lastSyncAt, login, refreshToken, setChecking, setDiffStatus])

  return diffStatus
}
