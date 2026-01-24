import { useEffect } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Badge } from '@/components/ui/badge'
import { useProjectDiffStore } from '@/stores/useProjectDiffStore'
import { computeSyncPlan } from '@/lib/sync/syncEngine'
import type { CloudFileEntry, LocalFileEntry } from '@/lib/sync/types'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ArrowDown, ArrowUp, AlertTriangle, Loader2 } from 'lucide-react'

interface ProjectDiffBadgeProps {
  projectId: Id<"projects">
  projectSlug: string
  localPath: string | null
  lastSyncAt?: number
  className?: string
}

// Minimum time between checks: 30 seconds
const MIN_CHECK_INTERVAL = 30 * 1000

export function ProjectDiffBadge({
  projectId,
  projectSlug,
  localPath,
  lastSyncAt,
  className,
}: ProjectDiffBadgeProps) {
  const { diffs, setDiffStatus, setChecking } = useProjectDiffStore()
  const diffStatus = diffs[projectSlug]

  // Get cloud manifest
  const cloudManifest = useQuery(
    api.projectFiles.getManifestForProject,
    { projectId }
  )

  // Check for diffs when component mounts or data changes
  useEffect(() => {
    async function checkDiff() {
      if (!localPath || cloudManifest === undefined) return

      // Skip if already checking
      if (diffStatus?.isChecking) return

      // Skip if checked recently
      const lastChecked = diffStatus?.lastChecked ?? 0
      if (Date.now() - lastChecked < MIN_CHECK_INTERVAL) return

      setChecking(projectSlug, true)

      try {
        // Check if local folder exists
        const exists = await window.electronAPI.project.exists(projectSlug)

        if (!exists) {
          // No local folder - all cloud files need to be downloaded
          setDiffStatus(projectSlug, {
            downloads: cloudManifest.length,
            uploads: 0,
            conflicts: 0,
          })
          return
        }

        // Get local manifest
        const localResult = await window.electronAPI.sync.getLocalManifest({
          projectPath: localPath,
        })

        // Convert to sync format
        const localFiles: LocalFileEntry[] = localResult.manifest
        const cloudFiles: CloudFileEntry[] = cloudManifest.map((f) => ({
          _id: f._id,
          path: f.path,
          hash: f.hash,
          size: f.size,
          version: f.version,
          storageId: f.storageId,
          uploadedAt: f.uploadedAt,
        }))

        // Compute sync plan
        const plan = computeSyncPlan(localFiles, cloudFiles, lastSyncAt)

        setDiffStatus(projectSlug, {
          downloads: plan.downloads.length,
          uploads: plan.uploads.length + plan.cloudDeletes.length,
          conflicts: plan.conflicts.length,
        })
      } catch (error) {
        console.error(`[DiffBadge] Error checking ${projectSlug}:`, error)
        setDiffStatus(projectSlug, {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    checkDiff()
  }, [cloudManifest, localPath, projectSlug, lastSyncAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Don't show anything if no diff status or checking
  if (!diffStatus) return null

  // Show loading indicator if checking
  if (diffStatus.isChecking) {
    return (
      <Badge
        variant="secondary"
        className={cn("flex size-5 items-center justify-center rounded-full p-0", className)}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
      </Badge>
    )
  }

  const totalChanges = diffStatus.downloads + diffStatus.uploads + diffStatus.conflicts

  // Don't show if no changes
  if (totalChanges === 0) return null

  // Determine badge variant based on changes
  const hasConflicts = diffStatus.conflicts > 0
  const variant = hasConflicts ? 'destructive' : 'default'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={variant}
          className={cn(
            "flex size-6 items-center justify-center rounded-full p-0 text-xs font-medium",
            !hasConflicts && "bg-blue-600 hover:bg-blue-700",
            className
          )}
        >
          {totalChanges}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex flex-col gap-1">
        <p className="font-medium">Pending sync changes</p>
        {diffStatus.downloads > 0 && (
          <div className="flex items-center gap-1 text-xs">
            <ArrowDown className="h-3 w-3 text-blue-500" />
            <span>{diffStatus.downloads} to download</span>
          </div>
        )}
        {diffStatus.uploads > 0 && (
          <div className="flex items-center gap-1 text-xs">
            <ArrowUp className="h-3 w-3 text-green-500" />
            <span>{diffStatus.uploads} to upload</span>
          </div>
        )}
        {diffStatus.conflicts > 0 && (
          <div className="flex items-center gap-1 text-xs">
            <AlertTriangle className="h-3 w-3 text-orange-500" />
            <span>{diffStatus.conflicts} conflicts</span>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
