import { memo } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ai-elements/loader'

import {
  Check,
  Circle,
  AlertCircle,
  Square,
  RotateCcw,
  FolderOpen,
  Download,
  Sparkles,
  Trash,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import type { BuildTask } from './BuildTaskList'
import { useState } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

interface BuilderControlsPillProps {
  // Status
  statusMessage: string
  isAIGenerating: boolean
  isAIComplete: boolean
  hasError: boolean
  isPulling: boolean
  // Build tasks
  buildTasks: BuildTask[]
  // Actions
  onStop?: () => void
  onRetry?: () => void
  onOpenProject?: () => void
  onStartBuild?: () => void
  onCancelProject?: () => void
  className?: string
}

export const BuilderControlsPill = memo(function BuilderControlsPill({
  statusMessage,
  isAIGenerating,
  isAIComplete,
  hasError,
  isPulling,
  buildTasks,
  onStop,
  onRetry,
  onOpenProject,
  onStartBuild,
  onCancelProject,
  className,
}: BuilderControlsPillProps) {
  const [isTasksExpanded, setIsTasksExpanded] = useState(false)

  // Calculate progress from tasks
  const completedCount = buildTasks.filter(t => t.status === 'completed').length
  const totalCount = buildTasks.length
  const inProgressTask = buildTasks.find(t => t.status === 'in_progress')

  // Determine which status icon to show
  const renderStatusIcon = () => {
    if (isPulling) {
      return (
        <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
          <Download className="h-3 w-3 text-blue-500 animate-pulse" />
        </div>
      )
    }
    if (hasError) {
      return (
        <div className="w-6 h-6 rounded-full bg-destructive/20 flex items-center justify-center">
          <AlertCircle className="h-3 w-3 text-destructive" />
        </div>
      )
    }
    if (isAIComplete) {
      return (
        <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <Check className="h-3 w-3 text-emerald-500" />
        </div>
      )
    }
    if (isAIGenerating) {
      return (
        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
          <Loader className="h-3 w-3 text-primary" />
        </div>
      )
    }
    return (
      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
        <Circle className="h-3 w-3 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'mx-auto w-full max-w-2xl rounded-2xl border bg-content-surface backdrop-blur-sm shadow-lg',
        className
      )}
    >
      <Collapsible open={isTasksExpanded} onOpenChange={setIsTasksExpanded}>
        {/* Main pill content */}
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Status icon */}
          {renderStatusIcon()}

          {/* Status message and progress */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">
                {isPulling ? 'Syncing from cloud...' : (inProgressTask?.activeForm || statusMessage)}
              </span>
              {totalCount > 0 && (
                <span className="shrink-0 rounded-full border border-border/60 bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                  {completedCount}/{totalCount}
                </span>
              )}
            </div>
          </div>

          {/* Expand tasks button */}
          {totalCount > 0 && (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                {isTasksExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronUp className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {isAIGenerating && !hasError && !isPulling && onStop && (
              <Button variant="outline" size="sm" onClick={onStop} className="h-8 gap-1.5">
                <Square className="h-3 w-3" />
                Stop
              </Button>
            )}

            {isAIComplete && !isPulling && !isAIGenerating && (
              <>
                {onOpenProject && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onOpenProject}
                    className="h-8 gap-1.5 rounded-full"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Open
                  </Button>
                )}
              </>
            )}

            {hasError && !isPulling && (
              <>
                {onRetry && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onRetry}
                    className="h-8 gap-1.5 rounded-full"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                )}
                {onCancelProject && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={onCancelProject}
                    className="h-8 gap-1.5 rounded-full"
                  >
                    <Trash className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                )}
              </>
            )}

            {!isAIGenerating && !isAIComplete && !hasError && !isPulling && onStartBuild && (
              <Button size="sm" onClick={onStartBuild} className="h-8 gap-1.5">
                <Sparkles className="h-3 w-3" />
                Start Build
              </Button>
            )}
          </div>
        </div>

        {/* Expanded tasks list */}
        <CollapsibleContent>
          <div className="app-scrollbar border-t px-4 py-3 space-y-2 max-h-48 overflow-y-auto">
            {buildTasks.map((task, index) => (
              <div
                key={`${task.content}-${index}`}
                className={cn(
                  'flex items-center gap-2 text-sm py-1.5 px-2 rounded-md',
                  task.status === 'in_progress' && 'bg-blue-500/10',
                  task.status === 'completed' && 'bg-emerald-500/10',
                  task.status === 'pending' && 'bg-muted/30'
                )}
              >
                {task.status === 'pending' && (
                  <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                {task.status === 'in_progress' && (
                  <Loader className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                )}
                {task.status === 'completed' && (
                  <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                )}
                <span
                  className={cn(
                    'truncate',
                    task.status === 'pending' && 'text-muted-foreground',
                    task.status === 'in_progress' && 'text-foreground font-medium',
                    task.status === 'completed' && 'text-muted-foreground'
                  )}
                >
                  {task.status === 'in_progress' ? task.activeForm : task.content}
                </span>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
})
