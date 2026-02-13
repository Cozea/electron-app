import { useEffect } from "react"
import type { Id } from "../../convex/_generated/dataModel"
import {
  useProjectDiffStore,
  type ProjectDiffStatus,
} from "@/stores/useProjectDiffStore"

const MIN_CHECK_INTERVAL = 30 * 1000

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
  const { diffs, setDiffStatus, setChecking } = useProjectDiffStore()
  const diffStatus = diffs[projectSlug]

  useEffect(() => {
    async function checkDiff() {
      if (!localPath) return

      if (diffStatus?.isChecking) return
      const lastChecked = diffStatus?.lastChecked ?? 0
      if (Date.now() - lastChecked < MIN_CHECK_INTERVAL) return

      setChecking(projectSlug, true)

      try {
        const exists = await window.electronAPI.project.pathExists(localPath)
        if (!exists) {
          setDiffStatus(projectSlug, {
            downloads: 0,
            uploads: 0,
            conflicts: 0,
          })
          return
        }

        const bootstrap = await window.electronAPI.sync.gitReplicaBootstrap({
          projectId: String(projectId),
          projectPath: localPath,
        })
        if (!bootstrap.success) {
          throw new Error(bootstrap.error || "Failed to bootstrap replica")
        }

        const plan = await window.electronAPI.sync.gitReplicaPlan({
          projectId: String(projectId),
          projectPath: localPath,
        })
        if (!plan.success) {
          throw new Error(plan.error || "Failed to compute replica plan")
        }
        setDiffStatus(projectSlug, {
          downloads: plan.downloads.length,
          uploads: plan.uploads.length + plan.cloudDeletes.length,
          conflicts: plan.conflicts.length,
        })
      } catch (error) {
        console.error(`[ProjectDiffStatus] Error checking ${projectSlug}:`, error)
        setDiffStatus(projectSlug, {
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
    }

    void checkDiff()
  }, [localPath, projectId, projectSlug, lastSyncAt, diffStatus?.isChecking, diffStatus?.lastChecked, setChecking, setDiffStatus])

  return diffStatus
}
