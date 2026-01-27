import { useEffect } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useProjectDiffStore } from '@/stores/useProjectDiffStore'
import { computeSyncPlan } from '@/lib/sync/syncEngine'
import type { CloudFileEntry, LocalFileEntry } from '@/lib/sync/types'
import { cn } from '@/lib/utils'

import { ArrowDown, ArrowUp } from 'lucide-react'

// Constants
const MIN_CHECK_INTERVAL = 30 * 1000

// Helper hook reusing the exact logic from ProjectDiffBadge
function useSyncStatus(
    projectId: Id<"projects">,
    projectSlug: string,
    localPath: string | null,
    lastSyncAt?: number
) {
    const { diffs, setDiffStatus, setChecking } = useProjectDiffStore()
    const diffStatus = diffs[projectSlug]

    // Get cloud manifest
    const cloudManifest = useQuery(
        api.projectFiles.getManifestForProject,
        { projectId }
    )

    useEffect(() => {
        async function checkDiff() {
            if (!localPath || cloudManifest === undefined) return
            if (diffStatus?.isChecking) return

            const lastChecked = diffStatus?.lastChecked ?? 0
            if (Date.now() - lastChecked < MIN_CHECK_INTERVAL) return

            setChecking(projectSlug, true)

            try {
                const exists = await window.electronAPI.project.exists(projectSlug)

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
                })

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

                const plan = computeSyncPlan(localFiles, cloudFiles, lastSyncAt)

                setDiffStatus(projectSlug, {
                    downloads: plan.downloads.length,
                    uploads: plan.uploads.length + plan.cloudDeletes.length,
                    conflicts: plan.conflicts.length,
                })
            } catch (error) {
                console.error(`[ProjectSyncStats] Error checking ${projectSlug}:`, error)
                setDiffStatus(projectSlug, {
                    error: error instanceof Error ? error.message : 'Unknown error',
                })
            }
        }

        checkDiff()
    }, [cloudManifest, localPath, projectSlug, lastSyncAt])

    return diffStatus
}

interface ProjectSyncStatsProps {
    projectId: Id<"projects">
    projectSlug: string
    localPath: string | null
    lastSyncAt?: number
    className?: string
}

export function ProjectSyncStats({
    projectId,
    projectSlug,
    localPath,
    lastSyncAt,
    className
}: ProjectSyncStatsProps) {
    const status = useSyncStatus(projectId, projectSlug, localPath, lastSyncAt)

    if (!status || status.isChecking) return <div className={cn("w-20", className)} /> // Empty placeholder

    // Only render if we have counts (or 0s usually imply synced)
    // If "no changes", do we show 0? The design implies "up and down counts".
    // Let's show empty placeholders dashes if 0 for cleaner look or 0s.
    // User asked "show the up an down counts". I'll show 0 if synced? Or maybe just grayed out.
    // Let's just show counts if > 0.

    return (
        <div className={cn("flex items-center gap-4 text-xs font-medium text-muted-foreground w-20", className)}>
            {(status.downloads > 0 || status.uploads > 0 || status.conflicts > 0) ? (
                <>
                    <div className="flex items-center gap-1 min-w-[32px]">
                        <ArrowDown className={cn("h-3 w-3", status.downloads > 0 ? "text-blue-500" : "text-muted-foreground/30")} />
                        <span className={status.downloads > 0 ? "text-foreground" : "text-muted-foreground/50"}>{status.downloads}</span>
                    </div>
                    <div className="flex items-center gap-1 min-w-[32px]">
                        <ArrowUp className={cn("h-3 w-3", status.uploads > 0 ? "text-green-500" : "text-muted-foreground/30")} />
                        <span className={status.uploads > 0 ? "text-foreground" : "text-muted-foreground/50"}>{status.uploads}</span>
                    </div>
                </>
            ) : (
                <div className="flex items-center gap-4 opacity-30">
                    <div className="flex items-center gap-1">
                        <ArrowDown className="h-3 w-3" />
                        <span>0</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <ArrowUp className="h-3 w-3" />
                        <span>0</span>
                    </div>
                </div>
            )}
        </div>
    )
}
