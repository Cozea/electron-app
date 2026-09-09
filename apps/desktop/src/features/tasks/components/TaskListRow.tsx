import { useState } from 'react';
import { getDeadlineMeta } from '@/features/tasks/model/taskBoardModel';
import type { BoardItem, TaskTranslator } from '@/features/tasks/model/taskBoardModel';
import { openProjectFileInExternalEditor } from '@/features/settings/model/externalEditorPreference';
import { type TaskOverlayLocationState, type TaskOverlayPayload } from '@/features/tasks/model/taskFocusOverlay';
import { useViewTransitionNavigate } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { asHugeIcon } from '@/lib/icons/asHugeIcon';
import { getFileIcon } from '@/lib/fileExplorer/fileIcons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChevronDoubleCloseIcon as __ChevronDownHugeIcon, Clock01Icon as __Clock3HugeIcon, ComputerActivityIcon as __AppWindowHugeIcon, SquareArrowDownRightIcon as __ArrowUpRightHugeIcon } from '@hugeicons/core-free-icons';

const Clock3 = asHugeIcon(__Clock3HugeIcon)

export function TaskListRow({
  item,
  projectId,
  workspaceId,
  onToggleMarker,
  t,
}: {
  item: BoardItem
  projectId: string
  workspaceId: string | null
  onToggleMarker: (item: BoardItem, markerId: string) => void
  t: TaskTranslator
}) {
  const navigate = useViewTransitionNavigate()
  const [isOpen, setIsOpen] = useState(item.status !== 'done')
  const deadlineMeta = getDeadlineMeta(item.deadlineTimestamp, t)
  const fileIconName = item.context.title.split('/').filter(Boolean).pop() ?? item.context.title
  const taskOverlay: TaskOverlayPayload = {
    projectId,
    storageId: item.storageId,
    source: item.source,
    title: item.title,
    description: item.description,
    context: {
      kind: item.context.kind,
      value: item.context.value,
      label: item.context.label,
      title: item.context.title,
    },
    markers: item.markers,
  }
  const navigationState: TaskOverlayLocationState = {
    taskOverlay,
  }

  async function openContext(): Promise<void> {
    if (item.context.kind === 'file') {
      const result = await openProjectFileInExternalEditor({
        filePath: item.context.value,
        workspaceId,
      })
      if (!result.success) {
        console.error('[TasksPage] Failed to open file in external editor', result.error)
      }
      return
    }

    if (!item.context.href) return
    navigate(item.context.href, { state: navigationState })
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border-b border-border/50 py-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <CollapsibleTrigger render={
          <button
            type="button"
            className="group flex min-w-0 flex-1 items-start gap-3 text-left"
            aria-label={`${isOpen ? t('tasks.action.collapse') : t('tasks.action.expand')} task ${item.title}`}
          >
            <HugeiconsIcon icon={__ChevronDownHugeIcon}
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-[transform,opacity] duration-200 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100',
                !isOpen && '-rotate-90',
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <h3 className="truncate text-[15px] font-normal leading-5 text-foreground">
                  {item.title}
                </h3>

                <span className={cn('inline-flex items-center gap-1.5', deadlineMeta.className)} title={deadlineMeta.label}>
                  <Clock3 className="h-3.5 w-3.5" />
                  {deadlineMeta.label}
                </span>

                <span title={item.context.title} className="inline-flex min-w-0 items-center gap-1.5">
                  {item.context.kind === 'file' ? (
                    getFileIcon(fileIconName, { className: 'h-3.5 w-3.5' })
                  ) : (
                    <HugeiconsIcon icon={__AppWindowHugeIcon} className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{item.context.label}</span>
                </span>

                <span className="truncate">
                  {item.claimants.length > 0
                    ? t('tasks.assignee.assignedTo').replace('{names}', item.claimants.map((claimant) => claimant.name).join(', '))
                    : t('tasks.assignee.unassigned')}
                </span>
              </div>
            </div>
          </button>
        } />

        <Button
          variant="ghost"
          size="icon-sm"
          className="-mr-1 -mt-1 shrink-0"
          onClick={(event) => {
            event.stopPropagation()
            void openContext()
          }}
          aria-label={`Open ${item.context.title}`}
        >
          <HugeiconsIcon icon={__ArrowUpRightHugeIcon} className="h-4 w-4" />
        </Button>
      </div>

      <CollapsibleContent>
        <div className="space-y-3 pl-7 pt-3">
          {item.description ? (
            <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
          ) : null}

          <ul className="space-y-2">
            {item.markers.map((marker) => (
              <li key={marker.id}>
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    checked={marker.checked}
                    onCheckedChange={() => onToggleMarker(item, marker.id)}
                    aria-label={marker.label}
                  />
                  <span
                    className={cn(
                      'text-sm leading-6',
                      marker.checked ? 'text-muted-foreground line-through' : 'text-foreground',
                    )}
                  >
                    {marker.label}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
