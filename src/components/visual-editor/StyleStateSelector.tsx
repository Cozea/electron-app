import { Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export type StyleState = 'default' | ':hover' | ':active' | ':focus'

interface StyleStateSelectorProps {
  value: StyleState
  onChange: (state: StyleState) => void
  className?: string
}

const STATES: Array<{ value: StyleState; label: string; hasEdit?: boolean }> = [
  { value: 'default', label: 'Default' },
  { value: ':hover', label: ':hover', hasEdit: true },
  { value: ':active', label: ':active', hasEdit: true },
  { value: ':focus', label: ':focus', hasEdit: true },
]

export function StyleStateSelector({ value, onChange, className }: StyleStateSelectorProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 p-0.5 rounded-md border',
        'bg-sidebar-accent/60 border-sidebar-border/70',
        className
      )}
    >
      {STATES.map((state) => {
        const isSelected = value === state.value
        return (
          <Tooltip key={state.value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onChange(state.value)}
                className={cn(
                  'flex items-center gap-1 px-2 h-7 text-[11px] font-medium rounded-sm transition-colors',
                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  isSelected && 'bg-background shadow-sm text-foreground',
                  !isSelected && 'text-sidebar-foreground/70'
                )}
              >
                {state.label}
                {state.hasEdit && isSelected && (
                  <Pencil className="h-2.5 w-2.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {state.value === 'default'
                ? 'Default element styles'
                : `Styles when element is ${state.value.slice(1)}`}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
