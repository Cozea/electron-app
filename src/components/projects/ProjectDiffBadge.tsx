import { useEffect, useRef } from 'react'

import type { Id } from '../../../convex/_generated/dataModel'
import { useProjectDiffStatus } from '@/hooks/useProjectDiffStatus'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ArrowDown, ArrowUp, AlertTriangle } from 'lucide-react'

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

  const lastRenderableStatusRef = useRef<{
    downloads: number
    uploads: number
    conflicts: number
  } | null>(null)
  const wasVisibleRef = useRef(false)

  const currentTotalChanges = diffStatus
    ? diffStatus.downloads + diffStatus.uploads + diffStatus.conflicts
    : 0

  if (diffStatus && !diffStatus.isChecking) {
    if (currentTotalChanges > 0) {
      lastRenderableStatusRef.current = {
        downloads: diffStatus.downloads,
        uploads: diffStatus.uploads,
        conflicts: diffStatus.conflicts,
      }
    } else {
      lastRenderableStatusRef.current = null
    }
  }

  const visibleStatus = !diffStatus
    ? null
    : diffStatus.isChecking
      ? lastRenderableStatusRef.current
      : currentTotalChanges > 0
        ? {
            downloads: diffStatus.downloads,
            uploads: diffStatus.uploads,
            conflicts: diffStatus.conflicts,
          }
        : null

  const isVisible = visibleStatus !== null
  const shouldAnimateIn = isVisible && !wasVisibleRef.current

  useEffect(() => {
    wasVisibleRef.current = isVisible
  }, [isVisible])

  const iconClassName = size === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5'
  const countClassName = size === 'compact' ? 'text-[11px] leading-none' : 'text-xs leading-none'

  const content = visibleStatus ? (
    <>
      {visibleStatus.downloads > 0 && (
        <span className="flex items-center gap-0.5">
          <ArrowDown className={cn(iconClassName, 'text-blue-500')} />
          <span className={countClassName}>{visibleStatus.downloads}</span>
        </span>
      )}
      {visibleStatus.uploads > 0 && (
        <span className="flex items-center gap-0.5">
          <ArrowUp className={cn(iconClassName, 'text-green-500')} />
          <span className={countClassName}>{visibleStatus.uploads}</span>
        </span>
      )}
      {visibleStatus.conflicts > 0 && (
        <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
          <AlertTriangle className={iconClassName} />
          <span className={countClassName}>{visibleStatus.conflicts}</span>
        </span>
      )}
    </>
  ) : null

  if (!visibleStatus) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            size === 'compact'
              ? "flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
              : "flex items-center gap-2 text-sm font-medium text-muted-foreground",
            shouldAnimateIn && "cozea-diff-badge-enter",
            className
          )}
        >
          {content}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex flex-col gap-1">
        <p className="font-medium">Pending sync changes</p>
        {visibleStatus.downloads > 0 && (
          <div className="flex items-center gap-1 text-xs">
            <ArrowDown className="h-3 w-3 text-blue-500" />
            <span>{visibleStatus.downloads} to download</span>
          </div>
        )}
        {visibleStatus.uploads > 0 && (
          <div className="flex items-center gap-1 text-xs">
            <ArrowUp className="h-3 w-3 text-green-500" />
            <span>{visibleStatus.uploads} to upload</span>
          </div>
        )}
        {visibleStatus.conflicts > 0 && (
          <div className="flex items-center gap-1 text-xs">
            <AlertTriangle className="h-3 w-3 text-orange-500" />
            <span>{visibleStatus.conflicts} conflicts</span>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
