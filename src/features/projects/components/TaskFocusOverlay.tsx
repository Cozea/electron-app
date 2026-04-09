import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { ChevronDownIcon as ChevronDown, XMarkIcon as X } from "@heroicons/react/24/outline"
import type { Id } from '../../../../convex/_generated/dataModel'
import { api } from '../../../../convex/_generated/api'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import {
  applyTaskOverlayCheckedMarkerIds,
  getSyntheticOverlaySource,
  type TaskOverlayMarker,
  type TaskOverlayPayload,
} from '@/features/projects/lib/taskFocusOverlay'

interface TaskFocusOverlayProps {
  task: TaskOverlayPayload | null | undefined
  presentation?: 'overlay' | 'docked'
  onDismiss?: (() => void) | null
  className?: string
}

export function TaskFocusOverlay({
  task,
  presentation = 'overlay',
  onDismiss = null,
  className,
}: TaskFocusOverlayProps) {
  const { convexUserId } = useAuth()
  const [isOpen, setIsOpen] = useState(true)
  const [isDismissed, setIsDismissed] = useState(false)
  const updateManualTask = useMutation(api.projectTasks.setManualTaskCheckedMarkers)
  const updateSharedTask = useMutation(api.projectTasks.setSharedTaskCheckedMarkers)
  const overlayState = useQuery(
    api.projectTasks.getOverlayTaskState,
    task && convexUserId
      ? {
          projectId: task.projectId as Id<'projects'>,
          viewerUserId: convexUserId,
          source: task.source,
          storageId: task.storageId,
        }
      : 'skip',
  )
  const [markers, setMarkers] = useState<TaskOverlayMarker[]>(() =>
    applyTaskOverlayCheckedMarkerIds(task, overlayState?.checkedMarkerIds),
  )

  useEffect(() => {
    setIsOpen(true)
    setIsDismissed(false)
  }, [task])

  useEffect(() => {
    setMarkers(applyTaskOverlayCheckedMarkerIds(task, overlayState?.checkedMarkerIds))
  }, [task, overlayState?.checkedMarkerIds])

  if (!task || isDismissed) return null
  const activeTask = task

  const checkedCount = markers.filter((marker) => marker.checked).length

  function handleToggleMarker(markerId: string): void {
    if (!convexUserId) return

    const previousMarkers = markers
    const nextMarkers = markers.map((marker) =>
      marker.id === markerId
        ? {
            ...marker,
            checked: !marker.checked,
          }
        : marker,
    )
    const checkedMarkerIds = nextMarkers
      .filter((marker) => marker.checked)
      .map((marker) => marker.id)

    setMarkers(nextMarkers)

    const persist = async () => {
      try {
        if (activeTask.source === 'manual') {
          await updateManualTask({
            projectId: activeTask.projectId as Id<'projects'>,
            actorUserId: convexUserId,
            taskKey: activeTask.storageId,
            checkedMarkerIds,
          })
          return
        }

        const source = getSyntheticOverlaySource(activeTask.source)
        if (!source) return

        await updateSharedTask({
          projectId: activeTask.projectId as Id<'projects'>,
          actorUserId: convexUserId,
          source,
          storageId: activeTask.storageId,
          totalMarkerCount: activeTask.markers.length,
          checkedMarkerIds,
          taskTitle: activeTask.title,
          taskContext: activeTask.context,
        })
      } catch {
        setMarkers(previousMarkers)
      }
    }

    void persist()
  }

  function handleDismiss(): void {
    setIsDismissed(true)
    onDismiss?.()
  }

  return (
    <div
      className={cn(
        presentation === 'overlay'
          ? 'pointer-events-auto absolute bottom-4 right-4 z-20 w-[320px] max-w-[calc(100%-2rem)] border border-border bg-card p-3'
          : 'w-full border border-border bg-card p-3',
        className,
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-medium text-muted-foreground">Task</p>
              <span className="inline-flex h-5 min-w-5 items-center justify-center bg-secondary px-1.5 text-[10px] tabular-nums text-secondary-foreground">
                {checkedCount}/{markers.length}
              </span>
            </div>
            <h3 className="truncate text-sm font-medium text-foreground">{activeTask.title}</h3>
          </div>

          <div className="flex items-center gap-1">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="group shrink-0">
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-[transform,opacity] duration-200 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100',
                    !isOpen && '-rotate-90',
                  )}
                />
              </Button>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={handleDismiss}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          <div className="space-y-3">
            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
              {activeTask.description}
            </p>

            <div className="space-y-1">
              {markers.map((marker) => (
                <label
                  key={marker.id}
                  className="flex cursor-pointer items-center gap-3 px-1 py-1.5 transition-colors hover:bg-muted/50"
                >
                  <Checkbox
                    checked={marker.checked}
                    onCheckedChange={() => handleToggleMarker(marker.id)}
                    aria-label={marker.label}
                  />
                  <span
                    className={cn(
                      'text-sm',
                      marker.checked
                        ? 'text-muted-foreground line-through'
                        : 'text-foreground',
                    )}
                  >
                    {marker.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
