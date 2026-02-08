import type { Id } from '../../../../convex/_generated/dataModel'
import { useProjectDiffStatus } from '@/hooks/useProjectDiffStatus'
import { cn } from '@/lib/utils'

import { ArrowDown, ArrowUp } from 'lucide-react'

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
    const status = useProjectDiffStatus({
        projectId,
        projectSlug,
        localPath,
        lastSyncAt,
    })

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
