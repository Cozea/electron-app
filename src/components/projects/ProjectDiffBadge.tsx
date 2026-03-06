import type { Id } from '../../../convex/_generated/dataModel'
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
  size?: 'default' | 'compact'
  className?: string
}

export function ProjectDiffBadge({
  projectId,
  projectSlug,
  localPath,
  lastSyncAt,
  size = 'default',
  className,
}: ProjectDiffBadgeProps) {
  const diffStatus = useProjectDiffStatus({
    projectId,
    projectSlug,
    localPath,
    lastSyncAt,
  })

  // Don't show anything if the diff status has not been hydrated yet.
  if (!diffStatus) return null

  // Show loading indicator if checking
  if (diffStatus.isChecking) {
    return (
        <div
        className={cn("flex items-center justify-center text-muted-foreground/70", className)}
      >
        <Loader2 className={cn(size === 'compact' ? 'h-3 w-3 animate-spin' : 'h-3.5 w-3.5 animate-spin')} />
      </div>
    )
  }

  const totalChanges = diffStatus.downloads + diffStatus.uploads + diffStatus.conflicts

  // Don't show if no changes
  if (totalChanges === 0) return null

  const hasDownloads = diffStatus.downloads > 0
  const hasUploads = diffStatus.uploads > 0
  const hasConflicts = diffStatus.conflicts > 0
  const iconClassName = size === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5'
  const countClassName = size === 'compact' ? 'text-[11px] leading-none' : 'text-xs leading-none'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            size === 'compact'
              ? "flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
              : "flex items-center gap-2 text-sm font-medium text-muted-foreground",
            className
          )}
        >
          {hasDownloads && (
            <span className="flex items-center gap-0.5">
              <ArrowDown className={cn(iconClassName, 'text-blue-500')} />
              <span className={countClassName}>{diffStatus.downloads}</span>
            </span>
          )}
          {hasUploads && (
            <span className="flex items-center gap-0.5">
              <ArrowUp className={cn(iconClassName, 'text-green-500')} />
              <span className={countClassName}>{diffStatus.uploads}</span>
            </span>
          )}
          {hasConflicts && (
            <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className={iconClassName} />
              <span className={countClassName}>{diffStatus.conflicts}</span>
            </span>
          )}
        </div>
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
