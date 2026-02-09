import { useEffect } from "react"
import { useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { computeSyncPlan } from "@/lib/sync/syncEngine"
import type { CloudFileEntry, LocalFileEntry } from "@/lib/sync/types"
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

  const cloudManifest = useQuery(api.projectFiles.getManifestForProject, {
    projectId,
  })

  useEffect(() => {
    async function checkDiff() {
      if (!localPath || cloudManifest === undefined) return

      if (diffStatus?.isChecking) return
      const lastChecked = diffStatus?.lastChecked ?? 0
      if (Date.now() - lastChecked < MIN_CHECK_INTERVAL) return

      setChecking(projectSlug, true)

      try {
        const exists = await window.electronAPI.project.pathExists(localPath)
        if (!exists) {
          setDiffStatus(projectSlug, {
            downloads: cloudManifest.length,
            uploads: 0,
            conflicts: 0,
          })
          return
        }

        const localResult = await window.electronAPI.sync.getLocalManifest({
          projectPath: localPath,
          debugSource: `project-diff-status:${projectSlug}`,
        })

        const localFiles: LocalFileEntry[] = localResult.manifest
        const cloudFiles: CloudFileEntry[] = cloudManifest.map((entry) => ({
          _id: entry._id,
          path: entry.path,
          hash: entry.hash,
          size: entry.size,
          version: entry.version,
          storageId: entry.storageId,
          uploadedAt: entry.uploadedAt,
        }))

        const plan = computeSyncPlan(localFiles, cloudFiles, lastSyncAt)
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
  }, [cloudManifest, localPath, projectSlug, lastSyncAt, diffStatus?.isChecking, diffStatus?.lastChecked, setChecking, setDiffStatus])

  return diffStatus
}
