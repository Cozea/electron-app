import { type ReactNode, useState } from 'react'
import { ChevronDown, X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CollapsibleItemProps {
  title: string
  summary?: string
  children: ReactNode
  onRemove?: () => void
  defaultOpen?: boolean
}

export function CollapsibleItem({
  title,
  summary,
  children,
  onRemove,
  defaultOpen = false,
}: CollapsibleItemProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border border-sidebar-border/70 rounded-md overflow-hidden bg-background/30">
      <div
        className="flex items-center gap-2 h-7 px-2 cursor-pointer hover:bg-sidebar-accent/70 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <ChevronDown
          className={cn(
            'h-3 w-3 text-sidebar-foreground/60 transition-transform shrink-0',
            !isOpen && '-rotate-90'
          )}
        />
        <span className="text-[11px] font-medium truncate flex-1">{title}</span>
        {summary && !isOpen && (
          <span className="text-[10px] text-sidebar-foreground/60 truncate max-w-[100px]">
            {summary}
          </span>
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md hover:bg-destructive/10 hover:text-destructive shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      {isOpen && (
        <div className="px-2 pb-2 pt-2 space-y-2 border-t border-sidebar-border/60 bg-sidebar-accent/20">
          {children}
        </div>
      )}
    </div>
  )
}

interface CollapsibleSectionProps {
  title: string
  icon?: ReactNode
  children: ReactNode
  onAdd?: () => void
  defaultOpen?: boolean
}

export function CollapsibleSection({
  title,
  icon,
  children,
  onAdd,
  defaultOpen = false,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-sidebar-border">
      <div className="flex items-center gap-1 px-2 h-8">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 min-w-0 text-[11px] font-medium text-sidebar-foreground hover:bg-sidebar-accent/70 rounded-md px-2 h-7 transition-colors"
          onClick={() => setIsOpen(!isOpen)}
        >
          <ChevronDown
            className={cn(
              'h-3 w-3 text-sidebar-foreground/60 transition-transform shrink-0',
              !isOpen && '-rotate-90'
            )}
          />
          {icon && <span className="text-sidebar-foreground/80 shrink-0">{icon}</span>}
          <span className="truncate">{title}</span>
        </button>
        {onAdd && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={onAdd}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {isOpen && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          {children}
        </div>
      )}
    </div>
  )
}

// Pre-built section for box-shadow
interface BoxShadowItemProps {
  value: string
  onChange: (value: string) => void
  onRemove: () => void
}

function parseBoxShadow(value: string): {
  x: number
  y: number
  blur: number
  spread: number
  color: string
} {
  // Parse "0px 4px 12px 0px rgba(0,0,0,0.15)" format
  const match = value.match(
    /(-?\d+)px\s+(-?\d+)px\s+(\d+)px\s+(-?\d+)px\s+(rgba?\([^)]+\)|#[0-9a-fA-F]+|\w+)/
  )
  if (match) {
    return {
      x: parseInt(match[1]),
      y: parseInt(match[2]),
      blur: parseInt(match[3]),
      spread: parseInt(match[4]),
      color: match[5],
    }
  }
  return { x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0,0,0,0.15)' }
}

export function BoxShadowItem({ value, onChange, onRemove }: BoxShadowItemProps) {
  const parsed = parseBoxShadow(value)

  const buildShadow = (updates: Partial<typeof parsed>) => {
    const next = { ...parsed, ...updates }
    return `${next.x}px ${next.y}px ${next.blur}px ${next.spread}px ${next.color}`
  }

  return (
    <CollapsibleItem title="box-shadow" summary={value} onRemove={onRemove} defaultOpen>
      <div className="grid grid-cols-4 gap-1.5">
        <div className="space-y-0.5">
          <label className="text-[10px] text-muted-foreground">X</label>
          <input
            type="number"
            value={parsed.x}
            onChange={(e) => onChange(buildShadow({ x: parseInt(e.target.value) || 0 }))}
            className="w-full h-7 text-[11px] text-center px-1.5 bg-background/70 border border-sidebar-border/70 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[10px] text-muted-foreground">Y</label>
          <input
            type="number"
            value={parsed.y}
            onChange={(e) => onChange(buildShadow({ y: parseInt(e.target.value) || 0 }))}
            className="w-full h-7 text-[11px] text-center px-1.5 bg-background/70 border border-sidebar-border/70 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[10px] text-muted-foreground">Blur</label>
          <input
            type="number"
            min={0}
            value={parsed.blur}
            onChange={(e) => onChange(buildShadow({ blur: parseInt(e.target.value) || 0 }))}
            className="w-full h-7 text-[11px] text-center px-1.5 bg-background/70 border border-sidebar-border/70 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[10px] text-muted-foreground">Spread</label>
          <input
            type="number"
            value={parsed.spread}
            onChange={(e) => onChange(buildShadow({ spread: parseInt(e.target.value) || 0 }))}
            className="w-full h-7 text-[11px] text-center px-1.5 bg-background/70 border border-sidebar-border/70 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <label className="text-[10px] text-muted-foreground w-10">Color</label>
        <input
          type="text"
          value={parsed.color}
          onChange={(e) => onChange(buildShadow({ color: e.target.value }))}
          className="flex-1 h-7 text-[11px] px-2 bg-background/70 border border-sidebar-border/70 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
        />
      </div>
    </CollapsibleItem>
  )
}

// Pre-built section for transform
interface TransformItemProps {
  type: 'translate' | 'rotate' | 'scale'
  value: string
  onChange: (value: string) => void
  onRemove: () => void
}

export function TransformItem({ type, value, onChange, onRemove }: TransformItemProps) {
  if (type === 'translate') {
    const match = value.match(/translate\((-?\d+)px,\s*(-?\d+)px\)/)
    const x = match ? parseInt(match[1]) : 0
    const y = match ? parseInt(match[2]) : 0

    return (
      <CollapsibleItem title="translate" summary={value} onRemove={onRemove} defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">X</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={x}
                onChange={(e) => onChange(`translate(${e.target.value}px, ${y}px)`)}
                className="w-full h-7 text-[11px] text-center px-1.5 bg-background/70 border border-sidebar-border/70 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
              />
              <span className="text-[10px] text-muted-foreground">px</span>
            </div>
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Y</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={y}
                onChange={(e) => onChange(`translate(${x}px, ${e.target.value}px)`)}
                className="w-full h-7 text-[11px] text-center px-1.5 bg-background/70 border border-sidebar-border/70 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
              />
              <span className="text-[10px] text-muted-foreground">px</span>
            </div>
          </div>
        </div>
      </CollapsibleItem>
    )
  }

  if (type === 'rotate') {
    const match = value.match(/rotate\((-?\d+)deg\)/)
    const deg = match ? parseInt(match[1]) : 0

    return (
      <CollapsibleItem title="rotate" summary={value} onRemove={onRemove} defaultOpen>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={deg}
            onChange={(e) => onChange(`rotate(${e.target.value}deg)`)}
            className="w-20 h-7 text-[11px] text-center px-1.5 bg-background/70 border border-sidebar-border/70 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
          />
          <span className="text-[10px] text-muted-foreground">deg</span>
        </div>
      </CollapsibleItem>
    )
  }

  if (type === 'scale') {
    const match = value.match(/scale\(([\d.]+),?\s*([\d.]+)?\)/)
    const x = match ? parseFloat(match[1]) : 1
    const y = match ? parseFloat(match[2] || match[1]) : 1

    return (
      <CollapsibleItem title="scale" summary={value} onRemove={onRemove} defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">X</label>
            <input
              type="number"
              step={0.1}
              value={x}
              onChange={(e) => onChange(`scale(${e.target.value}, ${y})`)}
              className="w-full h-7 text-[11px] text-center px-1.5 bg-background/70 border border-sidebar-border/70 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Y</label>
            <input
              type="number"
              step={0.1}
              value={y}
              onChange={(e) => onChange(`scale(${x}, ${e.target.value})`)}
              className="w-full h-7 text-[11px] text-center px-1.5 bg-background/70 border border-sidebar-border/70 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
            />
          </div>
        </div>
      </CollapsibleItem>
    )
  }

  return null
}

// Pre-built section for transition
interface TransitionItemProps {
  value: string
  onChange: (value: string) => void
  onRemove: () => void
}

export function TransitionItem({ value, onChange, onRemove }: TransitionItemProps) {
  // Parse "all 300ms ease 0ms" format
  const parts = value.split(/\s+/)
  const property = parts[0] || 'all'
  const duration = parts[1] || '300ms'
  const timing = parts[2] || 'ease'
  const delay = parts[3] || '0ms'

  const build = (updates: { property?: string; duration?: string; timing?: string; delay?: string }) => {
    return `${updates.property ?? property} ${updates.duration ?? duration} ${updates.timing ?? timing} ${updates.delay ?? delay}`
  }

  return (
    <CollapsibleItem title="transition" summary={value} onRemove={onRemove} defaultOpen>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground w-14">Property</label>
          <select
            value={property}
            onChange={(e) => onChange(build({ property: e.target.value }))}
            className="flex-1 h-7 text-[11px] px-2 bg-background/70 border border-sidebar-border/70 rounded-md focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
          >
            <option value="all">all</option>
            <option value="opacity">opacity</option>
            <option value="transform">transform</option>
            <option value="background">background</option>
            <option value="color">color</option>
            <option value="border">border</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground w-14">Duration</label>
          <input
            type="text"
            value={duration}
            onChange={(e) => onChange(build({ duration: e.target.value }))}
            className="flex-1 h-7 text-[11px] px-2 bg-background/70 border border-sidebar-border/70 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
            placeholder="300ms"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground w-14">Timing</label>
          <select
            value={timing}
            onChange={(e) => onChange(build({ timing: e.target.value }))}
            className="flex-1 h-7 text-[11px] px-2 bg-background/70 border border-sidebar-border/70 rounded-md focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
          >
            <option value="ease">ease</option>
            <option value="linear">linear</option>
            <option value="ease-in">ease-in</option>
            <option value="ease-out">ease-out</option>
            <option value="ease-in-out">ease-in-out</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground w-14">Delay</label>
          <input
            type="text"
            value={delay}
            onChange={(e) => onChange(build({ delay: e.target.value }))}
            className="flex-1 h-7 text-[11px] px-2 bg-background/70 border border-sidebar-border/70 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
            placeholder="0ms"
          />
        </div>
      </div>
    </CollapsibleItem>
  )
}
