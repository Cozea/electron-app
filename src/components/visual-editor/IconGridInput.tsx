import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useVisualEditorStore, type ElementStyles } from '@/stores/useVisualEditorStore'
import type { IconGridOption } from './iconOptions'

interface IconGridInputProps {
  label: string
  property: keyof ElementStyles
  options: IconGridOption[]
  columns?: number
  onPreview: (prop: keyof ElementStyles, value: string) => void
}

export function IconGridInput({
  label,
  property,
  options,
  columns = 4,
  onPreview,
}: IconGridInputProps) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const currentValue = getPendingOrOriginal(property) || ''

  const handleSelect = (value: string) => {
    updatePendingChange(property, value)
    onPreview(property, value)
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-medium text-sidebar-foreground/80">
        {label}
      </Label>
      <div
        className="grid gap-0.5 rounded-md p-0.5 border bg-sidebar-accent/60 border-sidebar-border/70"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {options.map((option) => {
          const isSelected = currentValue === option.value
          const Icon = option.icon
          return (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    'flex items-center justify-center h-7 rounded-sm transition-colors',
                    'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    isSelected && 'bg-background shadow-sm text-foreground',
                    !isSelected && 'text-sidebar-foreground/70'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {option.tooltip}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
