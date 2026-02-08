import type { Id } from '../../../convex/_generated/dataModel'
import { Badge } from '@/components/ui/badge'
import { useProjectDiffStatus } from '@/hooks/useProjectDiffStatus'
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

export function ProjectDiffBadge({
  projectId,
  projectSlug,
  localPath,
  lastSyncAt,
  className,
}: ProjectDiffBadgeProps) {
  const diffStatus = useProjectDiffStatus({
    projectId,
    projectSlug,
    localPath,
    lastSyncAt,
  })

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
            !hasConflicts && "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:text-white dark:hover:bg-blue-700",
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
