import { useEffect } from "react"
import type { Id } from "../../convex/_generated/dataModel"
import { useAuth, type RefreshTokenStatus } from "@/contexts/AuthContext"
import { isBootstrapOnlyLocalPath } from "@/features/projects/lib/localWorkspaceState"
import { isReplicaSyncEntitlementError } from "@/features/projects/lib/replicaErrorPresentation"
import {
  useProjectDiffStore,
  type ProjectDiffStatus,
} from "@/stores/useProjectDiffStore"

const MIN_CHECK_INTERVAL = 30 * 1000
const REPLICA_AUTH_COOLDOWN_MS = 60 * 1000
const REPLICA_TRANSIENT_COOLDOWN_MS = 90 * 1000
const REPLICA_ACCESS_DENIED_COOLDOWN_MS = 60 * 1000
const REPLICA_ENTITLEMENT_COOLDOWN_MS = 60 * 1000
const INTERACTIVE_LOGIN_COOLDOWN_MS = 2 * 60 * 1000
const REPLICA_CHECK_TIMEOUT_MS = 20 * 1000
const AUTH_RECOVERY_TIMEOUT_MS = 12 * 1000
const INITIAL_CHECK_MAX_STAGGER_MS = 1200
const inFlightBySlug = new Set<string>()
const replicaAccessDeniedProjects = new Map<string, number>()
const replicaEntitlementBlockedProjects = new Map<string, number>()
let replicaAuthBlockedUntil = 0
let hasLoggedReplicaAuthCooldown = false
let replicaTransientBlockedUntil = 0
let hasLoggedReplicaTransientCooldown = false
let authRecoveryPromise: Promise<"refreshed" | "retryable" | "login_started" | "failed"> | null = null
let lastInteractiveLoginAt = 0

type DiffCheckStage = 'pathExists' | 'bootstrap' | 'plan'

interface ProjectDiffErrorDetails {
  name: string
  message: string
  stack?: string
}

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

function describeProjectDiffError(error: unknown): ProjectDiffErrorDetails {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Unknown error',
      stack: error.stack,
    }
  }

  return {
    name: typeof error === 'string' ? 'Error' : 'UnknownError',
    message: typeof error === 'string' ? error : String(error),
  }
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

function getReplicaAccessDeniedUntil(projectSlug: string): number | null {
  const deniedUntil = replicaAccessDeniedProjects.get(projectSlug)
  if (!deniedUntil) {
    return null
  }

  if (deniedUntil <= Date.now()) {
    replicaAccessDeniedProjects.delete(projectSlug)
    return null
  }

  return deniedUntil
}

function getReplicaEntitlementBlockedUntil(projectSlug: string): number | null {
  const blockedUntil = replicaEntitlementBlockedProjects.get(projectSlug)
  if (!blockedUntil) {
    return null
  }

  if (blockedUntil <= Date.now()) {
    replicaEntitlementBlockedProjects.delete(projectSlug)
    return null
  }

  return blockedUntil
}

async function recoverReplicaAuth(
  refreshToken: () => Promise<RefreshTokenStatus>,
  login: () => Promise<void>
): Promise<"refreshed" | "retryable" | "login_started" | "failed"> {
  if (authRecoveryPromise) {
    return authRecoveryPromise
  }

  authRecoveryPromise = (async () => {
    try {
      const refreshStatus = await withTimeout(
        refreshToken(),
        AUTH_RECOVERY_TIMEOUT_MS,
        'Auth refresh timed out'
      )
      if (refreshStatus === "refreshed") {
        replicaAuthBlockedUntil = 0
        hasLoggedReplicaAuthCooldown = false
        return "refreshed"
      }

      if (refreshStatus === "retryable") {
        return "retryable"
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
    const isAccessDeniedError = (message: string): boolean =>
      /not a member of this project/i.test(message) ||
      (/\b403\b/.test(message) && /member/i.test(message))
    const isTransientReplicaError = (message: string): boolean =>
      /\b5\d{2}\b/.test(message) ||
      /unexpected eof while reading/i.test(message) ||
      /varnish/i.test(message) ||
      /timed out/i.test(message) ||
      /aborterror/i.test(message)

    async function checkDiff(force = false) {
      if (!localPath) return
      const deniedUntil = getReplicaAccessDeniedUntil(projectSlug)
      if (deniedUntil) {
        logProjectDiffDebug('check:skipped_access_denied', {
          projectId: String(projectId),
          projectSlug,
          deniedUntil,
        })
        return
      }
      const entitlementBlockedUntil = getReplicaEntitlementBlockedUntil(projectSlug)
      if (entitlementBlockedUntil) {
        logProjectDiffDebug('check:skipped_entitlement_blocked', {
          projectId: String(projectId),
          projectSlug,
          blockedUntil: entitlementBlockedUntil,
        })
        return
      }

      if (Date.now() < replicaAuthBlockedUntil) return
      if (Date.now() < replicaTransientBlockedUntil) return

      const currentStatus = useProjectDiffStore.getState().diffs[projectSlug]
      if (currentStatus?.isChecking) return
      if (inFlightBySlug.has(projectSlug)) return

      const lastChecked = currentStatus?.lastChecked ?? 0
      if (!force && Date.now() - lastChecked < MIN_CHECK_INTERVAL) return

      inFlightBySlug.add(projectSlug)
      setChecking(projectSlug, true)

      const runDiffCheck = async () => {
        let stage: DiffCheckStage = 'pathExists'
        logProjectDiffDebug('check:start', {
          projectId: String(projectId),
          projectSlug,
          localPath,
          force,
        })

        const exists = await withTimeout(
          window.electronAPI.project.pathExists(localPath),
          REPLICA_CHECK_TIMEOUT_MS,
          'Project path check timed out'
        )
        logProjectDiffDebug('pathExists:result', {
          projectId: String(projectId),
          projectSlug,
          localPath,
          exists,
        })
        if (cancelled) return

        if (!exists) {
          setDiffStatus(projectSlug, {
            downloads: 0,
            uploads: 0,
            conflicts: 0,
          })
          return
        }

        stage = 'bootstrap'
        const bootstrap = await withTimeout(
          window.electronAPI.sync.gitReplicaBootstrap({
            projectId: String(projectId),
            projectPath: localPath,
          }),
          REPLICA_CHECK_TIMEOUT_MS,
          'Replica bootstrap timed out'
        )
        logProjectDiffDebug('bootstrap:result', {
          projectId: String(projectId),
          projectSlug,
          success: bootstrap.success,
          error: bootstrap.error,
        })
        if (cancelled) return

        if (!bootstrap.success) {
          throw new Error(bootstrap.error || "Failed to bootstrap replica")
        }

        stage = 'plan'
        const plan = await withTimeout(
          window.electronAPI.sync.gitReplicaPlan({
            projectId: String(projectId),
            projectPath: localPath,
          }),
          REPLICA_CHECK_TIMEOUT_MS,
          'Replica plan timed out'
        )
        logProjectDiffDebug('plan:result', {
          projectId: String(projectId),
          projectSlug,
          success: plan.success,
          error: plan.error,
          downloads: plan.downloads.length,
          uploads: plan.uploads.length,
          conflicts: plan.conflicts.length,
          cloudDeletes: plan.cloudDeletes.length,
          localDeletes: plan.localDeletes.length,
        })
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
        replicaTransientBlockedUntil = 0
        hasLoggedReplicaTransientCooldown = false
        logProjectDiffDebug('check:success', {
          projectId: String(projectId),
          projectSlug,
          stage,
        })
      }

      try {
        await runDiffCheck()
      } catch (error) {
        if (cancelled) return

        const errorDetails = describeProjectDiffError(error)
        let message = errorDetails.message
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

        if (isAccessDeniedError(message)) {
          const deniedUntil = Date.now() + REPLICA_ACCESS_DENIED_COOLDOWN_MS
          replicaAccessDeniedProjects.set(projectSlug, deniedUntil)
          console.warn(
            `[ProjectDiffStatus] Replica access denied for ${projectSlug}; pausing checks for ${Math.round(
              REPLICA_ACCESS_DENIED_COOLDOWN_MS / 1000
            )}s.`
          )
          setDiffStatus(projectSlug, {
            downloads: 0,
            uploads: 0,
            conflicts: 0,
            error: message,
          })
          return
        }

        if (isReplicaSyncEntitlementError(error)) {
          const blockedUntil = Date.now() + REPLICA_ENTITLEMENT_COOLDOWN_MS
          replicaEntitlementBlockedProjects.set(projectSlug, blockedUntil)
          console.info(
            `[ProjectDiffStatus] Replica sync blocked by entitlement for ${projectSlug}; pausing checks for ${Math.round(
              REPLICA_ENTITLEMENT_COOLDOWN_MS / 1000
            )}s.`
          )
          setDiffStatus(projectSlug, {
            downloads: 0,
            uploads: 0,
            conflicts: 0,
          })
          return
        }

        if (isTransientReplicaError(message)) {
          replicaTransientBlockedUntil = Date.now() + REPLICA_TRANSIENT_COOLDOWN_MS
          if (!hasLoggedReplicaTransientCooldown) {
            console.warn(
              `[ProjectDiffStatus] Replica API transient failure; pausing checks for ${Math.round(
                REPLICA_TRANSIENT_COOLDOWN_MS / 1000
              )}s.`
            )
            hasLoggedReplicaTransientCooldown = true
          }
          setDiffStatus(projectSlug, {
            downloads: 0,
            uploads: 0,
            conflicts: 0,
            error: message,
          })
          return
        }

        console.error(`[ProjectDiffStatus] Error checking ${projectSlug}:`, {
          projectId: String(projectId),
          projectSlug,
          localPath,
          error: errorDetails,
        })
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
