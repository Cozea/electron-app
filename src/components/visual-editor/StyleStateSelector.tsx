import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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
  const selectedState = STATES.find((state) => state.value === value)

  return (
    <Select value={value} onValueChange={(next) => onChange(next as StyleState)}>
      <SelectTrigger
        className={cn(
          'h-9 w-full bg-secondary/80 border-none rounded-2xl pl-4 pr-2 text-[11px] font-medium text-sidebar-foreground focus:ring-sidebar-ring/40',
          className
        )}
      >
        <SelectValue>{selectedState?.label ?? 'Default'}</SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-[9rem]">
        {STATES.map((state) => (
          <SelectItem key={state.value} value={state.value} className="text-[11px]">
            {state.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
