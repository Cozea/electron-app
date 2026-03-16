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
 className?: string
}

function normalizeOptionValue(property: keyof ElementStyles, value: string): string {
 if (property === 'textAlign') {
 if (value === 'start') return 'left'
 if (value === 'end') return 'right'
 if (value === '-webkit-center') return 'center'
 }

 return value
}

export function IconGridInput({
 label,
 property,
 options,
 columns = 4,
 onPreview,
 className,
}: IconGridInputProps) {
 const { pendingChanges, selectedElement, updatePendingChange } = useVisualEditorStore()
 const rawValue = property in pendingChanges ? pendingChanges[property] : selectedElement?.computedStyles?.[property]
 const currentValue = normalizeOptionValue(property, rawValue || '')

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
 className={cn("grid rounded-2xl h-9 bg-secondary/80 overflow-hidden", className)}
 style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
 >
 {options.map((option) => {
 const isSelected = currentValue === normalizeOptionValue(property, option.value)
 const Icon = option.icon
 return (
 <Tooltip key={option.value}>
 <TooltipTrigger asChild>
 <button
 type="button"
 onClick={() => handleSelect(option.value)}
 className={cn(
 'flex items-center justify-center h-full transition-colors first:rounded-l-2xl last:rounded-r-2xl',
 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
 isSelected && 'bg-primary text-primary-foreground',
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
