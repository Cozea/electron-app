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

const STATES: Array<{ value: StyleState; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: ':hover', label: 'hover' },
  { value: ':active', label: 'active' },
  { value: ':focus', label: 'focus' },
]

export function StyleStateSelector({ value, onChange, className }: StyleStateSelectorProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 p-0.5 rounded-md border w-full',
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
                  'flex-1 flex items-center justify-center gap-1 min-w-0 px-2 h-7 text-[11px] font-medium rounded-sm transition-colors',
                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  isSelected && 'bg-background shadow-sm text-foreground',
                  !isSelected && 'text-sidebar-foreground/70'
                )}
              >
                {state.label}
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
