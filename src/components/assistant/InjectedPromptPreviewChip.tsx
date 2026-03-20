import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AlertTriangle, MousePointer2, Terminal, X } from 'lucide-react'

import type { InjectedPromptPreview } from '@/components/assistant/injectedPromptCompaction'

interface InjectedPromptPreviewChipProps {
  preview: InjectedPromptPreview
  className?: string
  onRemove?: () => void
}

const PREVIEW_ICON_MAP = {
  inspector: MousePointer2,
  terminal: Terminal,
  problem: AlertTriangle,
} as const

const PREVIEW_FALLBACK_LABEL = {
  inspector: 'Inspected element',
  terminal: 'Terminal output',
  problem: 'Problem',
} as const

export function InjectedPromptPreviewChip({
  preview,
  className,
  onRemove,
}: InjectedPromptPreviewChipProps) {
  const Icon = PREVIEW_ICON_MAP[preview.kind]
  const secondaryText =
    preview.pillText?.trim() ||
    preview.snippet?.trim() ||
    preview.subtitle?.trim() ||
    PREVIEW_FALLBACK_LABEL[preview.kind]

  return (
    <div
      className={cn(
        'group inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-border/60 bg-secondary/55 px-2.5 py-1.5',
        className
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium leading-4 text-foreground">
          {preview.title}
        </div>
        <div className="truncate text-[10px] leading-4 text-muted-foreground">
          {secondaryText}
        </div>
      </div>
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-5 w-5 shrink-0 rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          onClick={onRemove}
          aria-label="Remove context"
        >
          <X className="size-3" />
        </Button>
      ) : null}
    </div>
  )
}
