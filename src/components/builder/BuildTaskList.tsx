import { CheckCircle2, Circle, Loader2, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

// Matches the build_tasks tool schema (following TodoWrite pattern)
export interface BuildTask {
  content: string      // Imperative form: "Create project structure"
  activeForm: string   // Present continuous: "Creating project structure"
  status: 'pending' | 'in_progress' | 'completed'
  files?: string[]     // Files created (populated when completed)
}

interface BuildTaskListProps {
  tasks: BuildTask[]
  className?: string
}

export function BuildTaskList({ tasks, className }: BuildTaskListProps) {
  if (tasks.length === 0) {
    return null
  }

  const completedCount = tasks.filter(t => t.status === 'completed').length
  const totalCount = tasks.length
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <div className={cn('space-y-3', className)}>
      {/* Progress summary */}
      <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
        <span>Build Progress</span>
        <span>{completedCount} / {totalCount} tasks ({progressPercent}%)</span>
      </div>

      {/* Task list */}
      <div className="space-y-2">
        {tasks.map((task, index) => (
          <Collapsible key={`${task.content}-${index}`}>
            <div className={cn(
              'flex items-center gap-3 p-3 rounded-lg border transition-colors',
              task.status === 'in_progress' && 'bg-blue-500/10 border-blue-500/30',
              task.status === 'completed' && 'bg-green-500/10 border-green-500/30',
              task.status === 'pending' && 'bg-muted/50 border-border',
            )}>
              {/* Status icon */}
              {task.status === 'pending' && (
                <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              )}
              {task.status === 'in_progress' && (
                <Loader2 className="h-5 w-5 text-blue-500 animate-spin flex-shrink-0" />
              )}
              {task.status === 'completed' && (
                <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              )}

              {/* Show activeForm when in_progress, content otherwise */}
              <span className={cn(
                'flex-1 font-medium text-sm',
                task.status === 'pending' && 'text-muted-foreground',
              )}>
                {task.status === 'in_progress' ? task.activeForm : task.content}
              </span>

              {/* Show file count if completed with files */}
              {task.status === 'completed' && task.files && task.files.length > 0 && (
                <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  {task.files.length} {task.files.length === 1 ? 'file' : 'files'}
                  <ChevronRight className="h-3 w-3 transition-transform duration-200 [[data-state=open]>&]:rotate-90" />
                </CollapsibleTrigger>
              )}
            </div>

            {/* Expandable file list */}
            {task.files && task.files.length > 0 && (
              <CollapsibleContent>
                <div className="ml-8 mt-1 space-y-1 pb-2">
                  {task.files.map((file) => (
                    <div
                      key={file}
                      className="text-xs text-muted-foreground font-mono pl-3 border-l border-green-500/30"
                    >
                      {file}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            )}
          </Collapsible>
        ))}
      </div>
    </div>
  )
}
