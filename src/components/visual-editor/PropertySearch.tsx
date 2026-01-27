import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PropertySearchProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

export function PropertySearch({ value, onChange, className }: PropertySearchProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sidebar-foreground/60 pointer-events-none" />
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search property..."
        className="h-7 pl-7 pr-7 text-[11px] bg-background/70 border-sidebar-border/70 focus-visible:ring-sidebar-ring/40"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-0.5 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => onChange('')}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}
