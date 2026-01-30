import { useCallback, useState, useRef, useMemo, useEffect } from 'react'
import {
  LayoutGrid,
  Paintbrush,
  Type,
  Square,
  RotateCcw,
  X,
  Move,
  Layers,
  Zap,
  Code,
  MousePointer2,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  ChevronDown,
  ChevronUp,
  Settings2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useVisualEditorStore, type ElementStyles, type EditorTab, type StyleState } from '@/stores/useVisualEditorStore'
import { IconGridInput } from './IconGridInput'
import {
  FLEX_DIRECTION_OPTIONS,
  JUSTIFY_CONTENT_OPTIONS,
  ALIGN_ITEMS_OPTIONS,
  TEXT_ALIGN_OPTIONS,
} from './iconOptions'
import {
  InlineInput,
  InlineTextInput,
  InlineColorInput,
  InlineSelectInput,
  toHex,
} from './InlineInput'
import { CollapsibleSection, BoxShadowItem, TransitionItem } from './CollapsibleItem'
import { ColorPickerPopover } from './ColorPickerPopover'
import { StyleStateSelector } from './StyleStateSelector'
import { PropertySearch } from './PropertySearch'
import { matchesSearch } from './propertySearchUtils'

interface VisualEditorSidebarProps {
  onPreviewStyle: (styles: Partial<ElementStyles>) => void
  onPreviewText: (text: string) => void
  onApplyChanges: () => void
  onClose?: () => void
  className?: string
}

const MIN_PANEL_WIDTH = 240
const MAX_PANEL_WIDTH = 300
const DEFAULT_PANEL_WIDTH = 300

const FONT_OPTIONS = [
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'System UI', value: 'system-ui, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: 'Times New Roman, serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Roboto', value: 'Roboto, sans-serif' },
  { label: 'Open Sans', value: 'Open Sans, sans-serif' },
  { label: 'Lato', value: 'Lato, sans-serif' },
  { label: 'Montserrat', value: 'Montserrat, sans-serif' },
  { label: 'Poppins', value: 'Poppins, sans-serif' },
  { label: 'Source Sans Pro', value: 'Source Sans Pro, sans-serif' },
  { label: 'Playfair Display', value: 'Playfair Display, serif' },
  { label: 'Merriweather', value: 'Merriweather, serif' },
  { label: 'Monaco', value: 'Monaco, monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Courier New', value: 'Courier New, monospace' },
]

const TYPOGRAPHY_ELEMENTS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'label', 'li', 'td', 'th', 'strong', 'em', 'b', 'i', 'small', 'blockquote', 'code', 'pre']
const CONTAINER_ELEMENTS = ['div', 'section', 'article', 'aside', 'main', 'nav', 'header', 'footer', 'ul', 'ol', 'form', 'fieldset', 'figure', 'figcaption']
const TEXT_EDITABLE_ELEMENTS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'label', 'button', 'li', 'td', 'th', 'strong', 'em', 'b', 'i', 'small', 'blockquote']

function getRelevantSections(tagName: string | undefined): {
  showSize: boolean
  showLayout: boolean
  showText: boolean
  showContent: boolean
} {
  const tag = tagName?.toLowerCase() || ''

  if (TYPOGRAPHY_ELEMENTS.includes(tag)) {
    return { showSize: false, showLayout: false, showText: true, showContent: TEXT_EDITABLE_ELEMENTS.includes(tag) }
  }
  if (CONTAINER_ELEMENTS.includes(tag)) {
    return { showSize: true, showLayout: true, showText: false, showContent: false }
  }
  return { showSize: true, showLayout: true, showText: true, showContent: TEXT_EDITABLE_ELEMENTS.includes(tag) }
}

// Toggle button for text styling
function TextStyleToggle({
  icon: Icon,
  property,
  activeValue,
  inactiveValue,
  tooltip,
  onPreview,
}: {
  icon: typeof Bold
  property: keyof ElementStyles
  activeValue: string
  inactiveValue: string
  tooltip: string
  onPreview: (prop: keyof ElementStyles, value: string) => void
}) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const currentValue = getPendingOrOriginal(property) || ''
  const isActive = currentValue === activeValue || currentValue.includes(activeValue)

  const handleToggle = () => {
    const newValue = isActive ? inactiveValue : activeValue
    updatePendingChange(property, newValue)
    onPreview(property, newValue)
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      title={tooltip}
      className={cn(
        'flex items-center justify-center h-7 w-7 rounded-sm transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        isActive && 'bg-background shadow-sm text-foreground',
        !isActive && 'text-sidebar-foreground/70'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

// Font size input with up/down stepper arrows
const FONT_SIZE_MIN = 1
const FONT_SIZE_MAX = 200
const FONT_SIZE_STEP = 1

function FontSizeStepper({
  onPreview,
}: {
  onPreview: (prop: keyof ElementStyles, value: string) => void
}) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const raw = getPendingOrOriginal('fontSize') || ''
  const num = useMemo(() => {
    const match = raw.match(/^([\d.]+)/)
    const n = match ? parseFloat(match[1]) : 0
    return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n)) || FONT_SIZE_MIN
  }, [raw])

  const setValue = useCallback(
    (value: number) => {
      const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, value))
      const css = `${clamped}%`
      updatePendingChange('fontSize', css)
      onPreview('fontSize', css)
    },
    [onPreview, updatePendingChange]
  )

  return (
    <div className="flex items-center gap-0 flex-1 min-w-0 h-7">
      <Input
        type="text"
        value={num}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v)) setValue(v)
        }}
        className="h-full text-[11px] font-mono px-2 flex-1 min-w-0 text-right rounded-r-none border-r-0 bg-background/70 border-sidebar-border/70 focus-visible:ring-sidebar-ring/40"
      />
      <div className="flex flex-col shrink-0 h-full rounded-r-md border border-sidebar-border/70 border-l-0 bg-sidebar-accent/60 overflow-hidden">
        <button
          type="button"
          onClick={() => setValue(num + FONT_SIZE_STEP)}
          className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
          aria-label="Increase"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => setValue(num - FONT_SIZE_STEP)}
          className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors border-t border-sidebar-border/50"
          aria-label="Decrease"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

// Line height (Spacing) input with up/down stepper arrows
const LINE_HEIGHT_MIN = 0
const LINE_HEIGHT_MAX = 300
const LINE_HEIGHT_STEP = 1

function LineHeightStepper({
  onPreview,
}: {
  onPreview: (prop: keyof ElementStyles, value: string) => void
}) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const raw = getPendingOrOriginal('lineHeight') || ''
  const num = useMemo(() => {
    const match = raw.match(/^([\d.]+)/)
    const n = match ? parseFloat(match[1]) : 0
    return Math.min(LINE_HEIGHT_MAX, Math.max(LINE_HEIGHT_MIN, n))
  }, [raw])

  const setValue = useCallback(
    (value: number) => {
      const clamped = Math.min(LINE_HEIGHT_MAX, Math.max(LINE_HEIGHT_MIN, value))
      const css = `${clamped}%`
      updatePendingChange('lineHeight', css)
      onPreview('lineHeight', css)
    },
    [onPreview, updatePendingChange]
  )

  return (
    <div className="flex items-center gap-2 h-7">
      <Label className="text-[11px] text-sidebar-foreground/70 w-14 shrink-0 truncate">Spacing</Label>
      <div className="flex items-center gap-0 flex-1 min-w-0">
        <Input
          type="text"
          value={num}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (!Number.isNaN(v)) setValue(v)
          }}
          className="h-7 text-[11px] font-mono px-2 flex-1 min-w-0 text-right rounded-r-none border-r-0 bg-background/70 border-sidebar-border/70 focus-visible:ring-sidebar-ring/40"
        />
        <div className="flex flex-col shrink-0 h-7 rounded-r-md border border-sidebar-border/70 border-l-0 bg-sidebar-accent/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setValue(num + LINE_HEIGHT_STEP)}
            className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
            aria-label="Increase"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setValue(num - LINE_HEIGHT_STEP)}
            className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors border-t border-sidebar-border/50"
            aria-label="Decrease"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

// Fill: switchable Color / Image with corresponding controls
function FillControl({
  onPreview,
}: {
  onPreview: (prop: keyof ElementStyles, value: string) => void
}) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const [fillMode, setFillMode] = useState<'color' | 'image'>('color')

  // Color input state (hex buffer when editing)
  const bgColorRaw = getPendingOrOriginal('backgroundColor') || ''
  const hexValue = toHex(bgColorRaw)
  const [colorEditing, setColorEditing] = useState(false)
  const [colorBuffer, setColorBuffer] = useState(hexValue)
  useEffect(() => {
    if (!colorEditing) setColorBuffer(hexValue)
  }, [hexValue, colorEditing])

  const handleColorChange = useCallback(
    (hex: string) => {
      updatePendingChange('backgroundColor', hex)
      onPreview('backgroundColor', hex)
    },
    [onPreview, updatePendingChange]
  )

  return (
    <div className="space-y-2">
      <div className="flex w-full rounded-md border border-sidebar-border/70 bg-background/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setFillMode('color')}
          className={cn(
            'flex-1 min-w-0 py-1.5 text-[11px] transition-colors',
            fillMode === 'color'
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50'
          )}
        >
          Color
        </button>
        <button
          type="button"
          onClick={() => setFillMode('image')}
          className={cn(
            'flex-1 min-w-0 py-1.5 text-[11px] transition-colors',
            fillMode === 'image'
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50'
          )}
        >
          Image
        </button>
      </div>
      <div className="flex items-center gap-1.5 h-7">
        {fillMode === 'color' ? (
          <>
            <ColorPickerPopover
              value={hexValue}
              onChange={handleColorChange}
              trigger={
                <button
                  type="button"
                  className="w-7 h-7 rounded-md border border-muted-foreground/50 cursor-pointer bg-background/70 shrink-0 focus:outline-none focus:ring-2 focus:ring-sidebar-ring/40"
                  style={{ backgroundColor: hexValue }}
                  aria-label="Open color picker"
                />
              }
            />
            <Input
              type="text"
              value={colorEditing ? colorBuffer : hexValue}
              onChange={(e) => setColorBuffer(e.target.value)}
              onFocus={() => {
                setColorBuffer(hexValue)
                setColorEditing(true)
              }}
              onBlur={() => {
                setColorEditing(false)
                handleColorChange(toHex(colorBuffer.trim()))
              }}
              className="h-7 text-[11px] font-mono px-2 flex-1 min-w-0 bg-background/70 border-sidebar-border/70 focus-visible:ring-sidebar-ring/40"
              placeholder="#000000"
            />
          </>
        ) : (
          <Input
            type="text"
            value={getPendingOrOriginal('backgroundImage') || ''}
            onChange={(e) => {
              const v = e.target.value
              updatePendingChange('backgroundImage', v)
              onPreview('backgroundImage', v)
            }}
            className="h-7 text-[11px] font-mono px-2 flex-1 min-w-0 bg-background/70 border-sidebar-border/70 focus-visible:ring-sidebar-ring/40"
            placeholder="none / url(...)"
          />
        )}
      </div>
      {fillMode === 'image' && (
        <InlineSelectInput
          label="Size"
          property="backgroundSize"
          options={[
            { label: 'auto', value: 'auto' },
            { label: 'cover', value: 'cover' },
            { label: 'contain', value: 'contain' },
          ]}
          onPreview={onPreview}
        />
      )}
    </div>
  )
}

const SPACING_MAX = 500
const SPACING_STEP = 1

// Spacing control: 4 rows, each with label | slider | number input + up/down arrows on the right
function SpacingControl({
  label,
  propertyPrefix,
  onPreview,
}: {
  label: string
  propertyPrefix: 'padding' | 'margin'
  onPreview: (prop: keyof ElementStyles, value: string) => void
}) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()

  const sides = ['Top', 'Bottom', 'Left', 'Right'] as const
  const properties = sides.map(
    (side) => `${propertyPrefix}${side}` as keyof ElementStyles
  )

  const parseNumericValue = (value: string | undefined): number => {
    if (!value) return 0
    const match = value.match(/^([\d.]+)/)
    return match ? Math.min(SPACING_MAX, Math.max(0, parseFloat(match[1]))) : 0
  }

  const setValue = useCallback(
    (property: keyof ElementStyles, value: number) => {
      const clamped = Math.min(SPACING_MAX, Math.max(0, value))
      const cssValue = `${clamped}px`
      updatePendingChange(property, cssValue)
      onPreview(property, cssValue)
    },
    [onPreview, updatePendingChange]
  )

  return (
    <div className="space-y-2 min-w-0">
      <Label className="text-[11px] font-medium text-sidebar-foreground/80">
        {label}
      </Label>
      {sides.map((side, i) => {
        const prop = properties[i]
        const value = parseNumericValue(getPendingOrOriginal(prop))
        return (
          <div key={side} className="flex items-center gap-2 h-7 min-w-0">
            <Label className="text-[11px] text-sidebar-foreground/70 w-6 shrink-0 truncate">
              {side[0]}
            </Label>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className={SLIDER_WRAPPER_CLASS}>
                <input
                  type="range"
                  min={0}
                  max={SPACING_MAX}
                  value={value}
                  onChange={(e) => setValue(prop, parseFloat(e.target.value) || 0)}
                  className={SLIDER_THUMB_CLASS}
                />
              </div>
              <div className="flex items-center gap-0 shrink-0 w-[calc(3rem+2.5rem)]">
                <input
                  type="number"
                  min={0}
                  max={SPACING_MAX}
                  value={value}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    if (!Number.isNaN(v)) setValue(prop, Math.min(SPACING_MAX, Math.max(0, v)))
                  }}
                  className="h-7 text-[11px] font-mono px-2 w-12 text-center rounded-r-none border-r-0 bg-background/70 border border-sidebar-border/70 focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col shrink-0 h-7 rounded-r-md border border-sidebar-border/70 border-l-0 bg-sidebar-accent/60 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setValue(prop, value + SPACING_STEP)}
                    className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
                    aria-label="Increase"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setValue(prop, value - SPACING_STEP)}
                    className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors border-t border-sidebar-border/50"
                    aria-label="Decrease"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const BORDER_WIDTH_MAX = 50
const BORDER_WIDTH_STEP = 1

// Stroke width: number input + up/down arrows on the right
function StrokeWidthStepper({
  onPreview,
}: {
  onPreview: (prop: keyof ElementStyles, value: string) => void
}) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const raw = getPendingOrOriginal('borderWidth') || ''
  const num = useMemo(() => {
    const match = raw.match(/^([\d.]+)/)
    return match ? Math.min(BORDER_WIDTH_MAX, Math.max(0, parseFloat(match[1]))) : 0
  }, [raw])

  const setValue = useCallback(
    (value: number) => {
      const clamped = Math.min(BORDER_WIDTH_MAX, Math.max(0, value))
      const css = `${clamped}px`
      updatePendingChange('borderWidth', css)
      onPreview('borderWidth', css)
    },
    [onPreview, updatePendingChange]
  )

  return (
    <div className="flex items-center gap-2 h-7">
      <Label className="text-[11px] text-sidebar-foreground/70 w-14 shrink-0 truncate">Width</Label>
      <div className="flex items-center gap-0 flex-1 min-w-0">
        <Input
          type="number"
          min={0}
          max={BORDER_WIDTH_MAX}
          value={num}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (!Number.isNaN(v)) setValue(v)
          }}
          className="h-7 text-[11px] font-mono px-2 flex-1 min-w-0 text-right rounded-r-none border-r-0 bg-background/70 border-sidebar-border/70 focus-visible:ring-sidebar-ring/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <div className="flex flex-col shrink-0 h-7 rounded-r-md border border-sidebar-border/70 border-l-0 bg-sidebar-accent/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setValue(num + BORDER_WIDTH_STEP)}
            className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
            aria-label="Increase"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setValue(num - BORDER_WIDTH_STEP)}
            className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors border-t border-sidebar-border/50"
            aria-label="Decrease"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

// Opacity: number input (0–100%) + up/down arrows on the right
const OPACITY_MIN = 0
const OPACITY_MAX = 100
const OPACITY_STEP = 1

function OpacityStepper({
  onPreview,
}: {
  onPreview: (prop: keyof ElementStyles, value: string) => void
}) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const raw = getPendingOrOriginal('opacity') || ''
  const num = useMemo(() => {
    const match = raw.match(/^([\d.]+)/)
    if (match) {
      const v = parseFloat(match[1])
      // If value is 0–1 (decimal), convert to 0–100
      if (v >= 0 && v <= 1 && !raw.includes('%')) return Math.round(v * 100)
      return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, v))
    }
    return 100
  }, [raw])

  const setValue = useCallback(
    (value: number) => {
      const clamped = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, value))
      const css = `${clamped}%`
      updatePendingChange('opacity', css)
      onPreview('opacity', css)
    },
    [onPreview, updatePendingChange]
  )

  return (
    <div className="flex items-center gap-2 h-7">
      <Label className="text-[11px] text-sidebar-foreground/70 w-14 shrink-0 truncate">Opacity</Label>
      <div className="flex items-center gap-0 flex-1 min-w-0">
        <Input
          type="number"
          min={OPACITY_MIN}
          max={OPACITY_MAX}
          value={num}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (!Number.isNaN(v)) setValue(v)
          }}
          className="h-7 text-[11px] font-mono px-2 flex-1 min-w-0 text-right rounded-r-none border-r-0 bg-background/70 border-sidebar-border/70 focus-visible:ring-sidebar-ring/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <div className="flex flex-col shrink-0 h-7 rounded-r-md border border-sidebar-border/70 border-l-0 bg-sidebar-accent/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setValue(num + OPACITY_STEP)}
            className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
            aria-label="Increase opacity"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setValue(num - OPACITY_STEP)}
            className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors border-t border-sidebar-border/50"
            aria-label="Decrease opacity"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

// Stroke radius: slider + number input (value as %)
function StrokeRadiusSlider({
  onPreview,
}: {
  onPreview: (prop: keyof ElementStyles, value: string) => void
}) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const raw = getPendingOrOriginal('borderRadius') || ''
  const num = useMemo(() => {
    const match = raw.match(/^([\d.]+)/)
    return match ? Math.min(100, Math.max(0, parseFloat(match[1]))) : 0
  }, [raw])

  const setValue = useCallback(
    (value: number) => {
      const css = `${value}%`
      updatePendingChange('borderRadius', css)
      onPreview('borderRadius', css)
    },
    [onPreview, updatePendingChange]
  )

  const STEP = 1
  return (
    <div className="flex items-center gap-2 h-7 min-w-0">
      <Label className="text-[11px] text-sidebar-foreground/70 w-14 shrink-0 truncate">Radius</Label>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className={SLIDER_WRAPPER_CLASS}>
          <input
            type="range"
            min={0}
            max={100}
            value={num}
            onChange={(e) => setValue(parseFloat(e.target.value) || 0)}
            className={SLIDER_THUMB_CLASS}
          />
        </div>
        <div className="flex items-center gap-0 shrink-0 w-[calc(3rem+2.5rem)]">
          <input
            type="number"
            min={0}
            max={100}
            value={num}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (!Number.isNaN(v)) setValue(Math.min(100, Math.max(0, v)))
            }}
            className="h-7 text-[11px] font-mono px-2 w-12 text-center rounded-r-none border-r-0 bg-background/70 border border-sidebar-border/70 focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <div className="flex flex-col shrink-0 h-7 rounded-r-md border border-sidebar-border/70 border-l-0 bg-sidebar-accent/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setValue(Math.min(100, num + STEP))}
              className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
              aria-label="Increase"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setValue(Math.max(0, num - STEP))}
              className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors border-t border-sidebar-border/50"
              aria-label="Decrease"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Corner radius hidden under Advanced settings button
function StrokeAdvancedCornerRadius({
  onPreview,
}: {
  onPreview: (prop: keyof ElementStyles, value: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-1.5 mb-4">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 h-8 text-[11px] font-medium text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/70"
        onClick={() => setOpen((o) => !o)}
      >
        <Settings2 className="h-3.5 w-3.5 shrink-0" />
        Advanced settings
        <ChevronDown
          className={cn('h-3 w-3 shrink-0 ml-auto transition-transform', open && 'rotate-180')}
        />
      </Button>
      {open && (
        <div className="pl-1">
          <BorderRadiusControl onPreview={onPreview} />
        </div>
      )}
    </div>
  )
}

const SLIDER_WRAPPER_CLASS = 'flex-1 min-w-0'
const SLIDER_THUMB_CLASS =
  'w-full min-w-0 h-2 accent-sidebar-primary bg-sidebar-accent/60 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-sidebar-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-0'
const NUMBER_INPUT_CLASS =
  'w-12 h-7 text-[11px] text-center px-1.5 bg-background/70 border border-sidebar-border/70 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40 shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'

const CORNER_RADIUS_MAX = 100
const CORNER_RADIUS_STEP = 1

// Border radius control with 4 corners: each has slider + number input + up/down arrows on the right
function BorderRadiusControl({
  onPreview,
}: {
  onPreview: (prop: keyof ElementStyles, value: string) => void
}) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()

  const corners = [
    { label: 'TL', prop: 'borderTopLeftRadius' as keyof ElementStyles },
    { label: 'TR', prop: 'borderTopRightRadius' as keyof ElementStyles },
    { label: 'BL', prop: 'borderBottomLeftRadius' as keyof ElementStyles },
    { label: 'BR', prop: 'borderBottomRightRadius' as keyof ElementStyles },
  ]

  const parseNumericValue = (value: string | undefined): number => {
    if (!value) return 0
    const match = value.match(/^([\d.]+)/)
    return match ? Math.min(CORNER_RADIUS_MAX, Math.max(0, parseFloat(match[1]))) : 0
  }

  const setValue = useCallback(
    (property: keyof ElementStyles, value: number) => {
      const cssValue = `${value}%`
      updatePendingChange(property, cssValue)
      onPreview(property, cssValue)
    },
    [onPreview, updatePendingChange]
  )

  return (
    <div className="space-y-2 min-w-0">
      <Label className="text-[11px] font-medium text-sidebar-foreground/80">
        Corner Radius
      </Label>
      {corners.map((corner) => {
        const value = parseNumericValue(getPendingOrOriginal(corner.prop))
        return (
          <div key={corner.label} className="flex items-center gap-2 h-7 min-w-0">
            <Label className="text-[11px] text-sidebar-foreground/70 w-6 shrink-0 truncate">
              {corner.label}
            </Label>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className={SLIDER_WRAPPER_CLASS}>
                <input
                  type="range"
                  min={0}
                  max={CORNER_RADIUS_MAX}
                  value={value}
                  onChange={(e) => setValue(corner.prop, parseFloat(e.target.value) || 0)}
                  className={SLIDER_THUMB_CLASS}
                />
              </div>
              <div className="flex items-center gap-0 shrink-0 w-[calc(3rem+2.5rem)]">
                <input
                  type="number"
                  min={0}
                  max={CORNER_RADIUS_MAX}
                  value={value}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    if (!Number.isNaN(v)) setValue(corner.prop, Math.min(CORNER_RADIUS_MAX, Math.max(0, v)))
                  }}
                  className="h-7 text-[11px] font-mono px-2 w-12 text-center rounded-r-none border-r-0 bg-background/70 border border-sidebar-border/70 focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col shrink-0 h-7 rounded-r-md border border-sidebar-border/70 border-l-0 bg-sidebar-accent/60 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setValue(corner.prop, Math.min(CORNER_RADIUS_MAX, value + CORNER_RADIUS_STEP))}
                    className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
                    aria-label="Increase"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setValue(corner.prop, Math.max(0, value - CORNER_RADIUS_STEP))}
                    className="flex-1 min-h-0 flex items-center justify-center px-1.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors border-t border-sidebar-border/50"
                    aria-label="Decrease"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function VisualEditorSidebar({
  onPreviewStyle,
  onPreviewText,
  onApplyChanges,
  onClose,
  className,
}: VisualEditorSidebarProps) {
  const {
    isOpen,
    selectedElement,
    pendingChanges,
    pendingTextChange,
    styleState,
    activeTab,
    searchQuery,
    close,
    clearPendingChanges,
    updatePendingText,
    getPendingOrOriginalText,
    getPendingOrOriginal,
    updatePendingChange,
    setStyleState,
    setActiveTab,
    setSearchQuery,
  } = useVisualEditorStore()

  const handleClose = useCallback(() => {
    close()
    onClose?.()
  }, [close, onClose])

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const hasChanges = Object.keys(pendingChanges).length > 0 || pendingTextChange !== null

  const sections = useMemo(
    () => getRelevantSections(selectedElement?.tagName),
    [selectedElement?.tagName]
  )

  const handlePreview = useCallback(
    (property: keyof ElementStyles, value: string) => {
      onPreviewStyle({ [property]: value })
    },
    [onPreviewStyle]
  )

  const handleTextChange = useCallback(
    (text: string) => {
      updatePendingText(text)
      onPreviewText(text)
    },
    [updatePendingText, onPreviewText]
  )

  const handleReset = useCallback(() => {
    const originalText = selectedElement?.textContent ?? ''
    const changedProperties = Object.keys(pendingChanges) as Array<keyof ElementStyles>

    clearPendingChanges()

    if (changedProperties.length > 0) {
      const cleared = Object.fromEntries(changedProperties.map((p) => [p, ''])) as Partial<ElementStyles>
      onPreviewStyle(cleared)
    }

    if (pendingTextChange !== null) {
      onPreviewText(originalText)
    }
  }, [clearPendingChanges, onPreviewStyle, onPreviewText, pendingChanges, pendingTextChange, selectedElement?.textContent])

  const handleApply = useCallback(() => {
    onApplyChanges()
  }, [onApplyChanges])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setIsDragging(true)
    dragStartX.current = e.clientX
    dragStartWidth.current = panelWidth
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [panelWidth])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return
    const delta = dragStartX.current - e.clientX
    const newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, dragStartWidth.current + delta))
    setPanelWidth(newWidth)
  }, [isDragging])

  const handlePointerUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleDoubleClick = useCallback(() => {
    setPanelWidth(DEFAULT_PANEL_WIDTH)
  }, [])

  // Box shadow state for effects section
  const [boxShadows, setBoxShadows] = useState<string[]>([])
  const [transitions, setTransitions] = useState<string[]>([])

  const handleAddBoxShadow = useCallback(() => {
    const newShadow = '0px 4px 12px 0px rgba(0,0,0,0.15)'
    setBoxShadows((prev) => [...prev, newShadow])
    handlePreview('boxShadow', [...boxShadows, newShadow].join(', '))
  }, [boxShadows, handlePreview])

  const handleUpdateBoxShadow = useCallback((index: number, value: string) => {
    const updated = [...boxShadows]
    updated[index] = value
    setBoxShadows(updated)
    handlePreview('boxShadow', updated.join(', '))
  }, [boxShadows, handlePreview])

  const handleRemoveBoxShadow = useCallback((index: number) => {
    const updated = boxShadows.filter((_, i) => i !== index)
    setBoxShadows(updated)
    handlePreview('boxShadow', updated.join(', ') || 'none')
  }, [boxShadows, handlePreview])

  const handleAddTransition = useCallback(() => {
    const newTransition = 'all 300ms ease 0ms'
    setTransitions((prev) => [...prev, newTransition])
    handlePreview('transition', [...transitions, newTransition].join(', '))
  }, [transitions, handlePreview])

  const handleUpdateTransition = useCallback((index: number, value: string) => {
    const updated = [...transitions]
    updated[index] = value
    setTransitions(updated)
    handlePreview('transition', updated.join(', '))
  }, [transitions, handlePreview])

  const handleRemoveTransition = useCallback((index: number) => {
    const updated = transitions.filter((_, i) => i !== index)
    setTransitions(updated)
    handlePreview('transition', updated.join(', ') || 'none')
  }, [transitions, handlePreview])

  // Filter sections by search query
  const shouldShowSection = useCallback((sectionName: string) => {
    if (!searchQuery) return true
    return matchesSearch(sectionName, searchQuery)
  }, [searchQuery])

  return (
    <div
      className={cn(
        'flex flex-col bg-background text-sidebar-foreground overflow-hidden relative',
        !isDragging && 'transition-all duration-300 ease-in-out',
        className
      )}
      style={{
        width: isOpen ? panelWidth : 0,
        minWidth: isOpen ? panelWidth : 0,
        maxWidth: isOpen ? MAX_PANEL_WIDTH : 0,
        flexGrow: 0,
        flexShrink: 0,
        pointerEvents: isOpen ? 'auto' : 'none',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: isDragging ? 'none' : 'transform 300ms ease, width 300ms ease',
      }}
    >
      {isOpen && (
        <div
          className={cn(
            'absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-50',
            'hover:bg-sidebar-accent transition-colors',
            isDragging && 'bg-sidebar-border/80'
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          title="Drag to resize, double-click to reset"
        />
      )}

      <div
        className="flex flex-col h-full"
        style={{
          width: panelWidth,
          minWidth: panelWidth,
          maxWidth: MAX_PANEL_WIDTH,
          transition: isDragging ? 'none' : 'width 300ms ease',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-9 px-3 border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Paintbrush className="h-4 w-4 text-sidebar-primary shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] font-medium leading-none truncate">
                {selectedElement
                  ? `${selectedElement.tagName.toLowerCase()}${selectedElement.id ? `#${selectedElement.id}` : ''}`
                  : 'Visual Editor'}
              </div>
              {selectedElement && (
                <div className="text-[10px] text-muted-foreground leading-none truncate">
                  {selectedElement.className
                    ? `.${selectedElement.className.split(' ').slice(0, 3).join(' .')}`
                    : selectedElement.selector}
                </div>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Top-level Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EditorTab)} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="flex w-full min-w-0 h-9 bg-transparent rounded-none p-0 border-b border-sidebar-border">
            <TabsTrigger
              value="styling"
              className={cn(
                'relative flex-1 min-w-0 h-9 rounded-none bg-transparent shadow-none text-[11px] font-medium truncate',
                'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
                'data-[state=active]:bg-transparent data-[state=active]:text-sidebar-foreground data-[state=active]:shadow-none',
                "data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-3 data-[state=active]:after:right-3 data-[state=active]:after:h-px data-[state=active]:after:bg-sidebar-primary"
              )}
            >
              <Paintbrush className="h-3.5 w-3.5 mr-1.5 shrink-0" />
              <span className="truncate">Design</span>
            </TabsTrigger>
            <TabsTrigger
              value="events"
              className={cn(
                'relative flex-1 min-w-0 h-9 rounded-none bg-transparent shadow-none text-[11px] font-medium truncate',
                'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
                'data-[state=active]:bg-transparent data-[state=active]:text-sidebar-foreground data-[state=active]:shadow-none',
                "data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-3 data-[state=active]:after:right-3 data-[state=active]:after:h-px data-[state=active]:after:bg-sidebar-primary"
              )}
            >
              <Zap className="h-3.5 w-3.5 mr-1.5 shrink-0" />
              <span className="truncate">Effects</span>
            </TabsTrigger>
            <TabsTrigger
              value="attributes"
              className={cn(
                'relative flex-1 min-w-0 h-9 rounded-none bg-transparent shadow-none text-[11px] font-medium truncate',
                'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
                'data-[state=active]:bg-transparent data-[state=active]:text-sidebar-foreground data-[state=active]:shadow-none',
                "data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-3 data-[state=active]:after:right-3 data-[state=active]:after:h-px data-[state=active]:after:bg-sidebar-primary"
              )}
            >
              <Code className="h-3.5 w-3.5 mr-1.5 shrink-0" />
              <span className="truncate">Inspect</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="styling" className="flex-1 flex flex-col overflow-hidden m-0">
            {/* Style State Selector (row above search) */}
            <div className="px-3 pt-2 pb-1.5 border-b border-sidebar-border space-y-2 min-w-0">
              <div className="flex items-center w-full min-w-0">
                <StyleStateSelector
                  value={styleState}
                  onChange={(s) => setStyleState(s as StyleState)}
                  className="w-full"
                />
              </div>
              <div className="flex items-center min-w-0">
                <PropertySearch
                  value={searchQuery}
                  onChange={setSearchQuery}
                  className="flex-1 min-w-0"
                />
              </div>
            </div>

            <ScrollArea className="flex-1 min-w-0">
              <div className="pb-6 min-w-0 w-full">
                {sections.showContent && shouldShowSection('Content') && selectedElement?.textContent !== undefined && (
                  <CollapsibleSection
                    title="Content"
                    defaultOpen={false}
                    collapsible={false}
                  >
                    <textarea
                      className="w-full min-h-[70px] max-h-[160px] text-[11px] bg-muted/80 border border-sidebar-border/70 rounded-md px-2 py-2 resize-y focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
                      value={getPendingOrOriginalText()}
                      onChange={(e) => handleTextChange(e.target.value)}
                      placeholder="Enter text content…"
                    />
                  </CollapsibleSection>
                )}

                {sections.showText && shouldShowSection('Text') && (
                  <CollapsibleSection title="Text" icon={<Type className="h-3.5 w-3.5" />} defaultOpen>
                    <div className="space-y-2">
                      <div className="space-y-1.5">
                        <Label className="text-[11px] text-sidebar-foreground/70">Font</Label>
                        <Select
                          value={
                            (() => {
                              const v = getPendingOrOriginal('fontFamily') || ''
                              const found = FONT_OPTIONS.find((o) => o.value === v)
                              return found ? found.value : undefined
                            })()
                          }
                          onValueChange={(v) => {
                            updatePendingChange('fontFamily', v)
                            handlePreview('fontFamily', v)
                          }}
                        >
                          <SelectTrigger className="h-7 text-[11px] w-full bg-background/70 border-sidebar-border/70 focus:ring-sidebar-ring/40">
                            <SelectValue
                              placeholder={
                                (() => {
                                  const v = getPendingOrOriginal('fontFamily') || ''
                                  if (!v) return 'Select font'
                                  return FONT_OPTIONS.some((o) => o.value === v) ? v : 'Custom'
                                })()
                              }
                            />
                          </SelectTrigger>
                          <SelectContent className="max-h-[220px]">
                            {FONT_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} className="text-[11px]">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-3 h-8">
                        <div className="flex-1 min-w-0 h-full flex items-center">
                          <div className="flex items-center justify-evenly gap-0.5 rounded-md p-0.5 w-full h-7 border bg-sidebar-accent/60 border-sidebar-border/70">
                            <TextStyleToggle
                              icon={Bold}
                              property="fontWeight"
                              activeValue="bold"
                              inactiveValue="normal"
                              tooltip="Bold"
                              onPreview={handlePreview}
                            />
                            <TextStyleToggle
                              icon={Italic}
                              property="fontStyle"
                              activeValue="italic"
                              inactiveValue="normal"
                              tooltip="Italic"
                              onPreview={handlePreview}
                            />
                            <TextStyleToggle
                              icon={Underline}
                              property="textDecoration"
                              activeValue="underline"
                              inactiveValue="none"
                              tooltip="Underline"
                              onPreview={handlePreview}
                            />
                            <TextStyleToggle
                              icon={Strikethrough}
                              property="textDecoration"
                              activeValue="line-through"
                              inactiveValue="none"
                              tooltip="Strikethrough"
                              onPreview={handlePreview}
                            />
                          </div>
                        </div>
                        <div className="h-full flex items-center max-w-[120px]">
                          <FontSizeStepper onPreview={handlePreview} />
                        </div>
                      </div>
                      <IconGridInput
                        label="Align"
                        property="textAlign"
                        options={TEXT_ALIGN_OPTIONS}
                        columns={4}
                        onPreview={handlePreview}
                      />
                      <InlineColorInput label="Color" property="color" onPreview={handlePreview} />
                      <LineHeightStepper onPreview={handlePreview} />
                      <InlineInput label="Letter" property="letterSpacing" onPreview={handlePreview} />
                    </div>
                  </CollapsibleSection>
                )}

                {sections.showSize && shouldShowSection('Size') && (
                  <CollapsibleSection title="Size" icon={<Square className="h-3.5 w-3.5" />} defaultOpen={false}>
                    <div className="space-y-2">
                      <InlineInput label="Width" property="width" onPreview={handlePreview} />
                      <InlineInput label="Height" property="height" onPreview={handlePreview} />
                      <InlineInput label="Min W" property="minWidth" onPreview={handlePreview} />
                      <InlineInput label="Max W" property="maxWidth" onPreview={handlePreview} />
                      <InlineInput label="Min H" property="minHeight" onPreview={handlePreview} />
                      <InlineInput label="Max H" property="maxHeight" onPreview={handlePreview} />
                    </div>
                  </CollapsibleSection>
                )}

                {sections.showLayout && shouldShowSection('Layout') && (
                  <CollapsibleSection title="Layout" icon={<LayoutGrid className="h-3.5 w-3.5" />} defaultOpen={false}>
                    <div className="space-y-2">
                      <InlineSelectInput
                        label="Display"
                        property="display"
                        options={[
                          { label: 'block', value: 'block' },
                          { label: 'inline', value: 'inline' },
                          { label: 'inline-block', value: 'inline-block' },
                          { label: 'flex', value: 'flex' },
                          { label: 'grid', value: 'grid' },
                          { label: 'none', value: 'none' },
                        ]}
                        onPreview={handlePreview}
                      />
                      <IconGridInput
                        label="Direction"
                        property="flexDirection"
                        options={FLEX_DIRECTION_OPTIONS}
                        columns={4}
                        onPreview={handlePreview}
                      />
                      <IconGridInput
                        label="Justify"
                        property="justifyContent"
                        options={JUSTIFY_CONTENT_OPTIONS}
                        columns={6}
                        onPreview={handlePreview}
                      />
                      <IconGridInput
                        label="Align"
                        property="alignItems"
                        options={ALIGN_ITEMS_OPTIONS}
                        columns={5}
                        onPreview={handlePreview}
                      />
                      <InlineInput label="Gap" property="gap" onPreview={handlePreview} />
                      <InlineSelectInput
                        label="Overflow"
                        property="overflow"
                        options={[
                          { label: 'visible', value: 'visible' },
                          { label: 'hidden', value: 'hidden' },
                          { label: 'scroll', value: 'scroll' },
                          { label: 'auto', value: 'auto' },
                        ]}
                        onPreview={handlePreview}
                      />
                      <InlineSelectInput
                        label="Position"
                        property="position"
                        options={[
                          { label: 'static', value: 'static' },
                          { label: 'relative', value: 'relative' },
                          { label: 'absolute', value: 'absolute' },
                          { label: 'fixed', value: 'fixed' },
                          { label: 'sticky', value: 'sticky' },
                        ]}
                        onPreview={handlePreview}
                      />
                      <InlineTextInput label="z-index" property="zIndex" placeholder="auto" onPreview={handlePreview} />
                    </div>
                  </CollapsibleSection>
                )}

                {shouldShowSection('Fill') && (
                  <CollapsibleSection title="Fill" icon={<Paintbrush className="h-3.5 w-3.5" />} defaultOpen={false}>
                    <FillControl onPreview={handlePreview} />
                  </CollapsibleSection>
                )}

                {shouldShowSection('Spacing') && (
                  <CollapsibleSection title="Spacing" icon={<Move className="h-3.5 w-3.5" />} defaultOpen={false}>
                    <div className="space-y-3">
                      <SpacingControl label="Padding" propertyPrefix="padding" onPreview={handlePreview} />
                      <SpacingControl label="Margin" propertyPrefix="margin" onPreview={handlePreview} />
                    </div>
                  </CollapsibleSection>
                )}

                {shouldShowSection('Stroke') && (
                  <CollapsibleSection title="Stroke" icon={<Square className="h-3.5 w-3.5" />} defaultOpen={false}>
                    <div className="space-y-2">
                      <StrokeRadiusSlider onPreview={handlePreview} />
                      <StrokeAdvancedCornerRadius onPreview={handlePreview} />
                      <InlineSelectInput
                        label="Style"
                        property="borderStyle"
                        options={[
                          { label: 'none', value: 'none' },
                          { label: 'solid', value: 'solid' },
                          { label: 'dashed', value: 'dashed' },
                          { label: 'dotted', value: 'dotted' },
                          { label: 'double', value: 'double' },
                        ]}
                        onPreview={handlePreview}
                      />
                      <StrokeWidthStepper onPreview={handlePreview} />
                      <InlineColorInput label="Color" property="borderColor" onPreview={handlePreview} />
                    </div>
                  </CollapsibleSection>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="attributes" className="flex-1 flex flex-col overflow-hidden m-0">
            <ScrollArea className="flex-1 min-w-0">
              <div className="p-3 space-y-3 min-w-0 w-full">
                <p className="text-xs text-muted-foreground">
                  HTML attributes editing coming soon.
                </p>
                {selectedElement && (
                  <div className="space-y-2">
                    <InlineTextInput label="id" property="zIndex" placeholder="element-id" onPreview={() => {}} />
                    <InlineTextInput label="class" property="zIndex" placeholder="class-names" onPreview={() => {}} />
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="events" className="flex-1 flex flex-col overflow-hidden m-0">
            <ScrollArea className="flex-1 min-w-0">
              <div className="pb-6 min-w-0 w-full">
                {shouldShowSection('Effects') && (
                  <CollapsibleSection
                    title="Effects"
                    icon={<Layers className="h-3.5 w-3.5" />}
                    onAdd={handleAddBoxShadow}
                    defaultOpen={false}
                  >
                    <div className="space-y-2">
                      <OpacityStepper onPreview={handlePreview} />
                      {boxShadows.map((shadow, i) => (
                        <BoxShadowItem
                          key={i}
                          value={shadow}
                          onChange={(v) => handleUpdateBoxShadow(i, v)}
                          onRemove={() => handleRemoveBoxShadow(i)}
                        />
                      ))}
                      {boxShadows.length === 0 && (
                        <p className="text-[10px] text-muted-foreground italic">No shadows. Click + to add.</p>
                      )}
                    </div>
                  </CollapsibleSection>
                )}

                {shouldShowSection('Transform') && (
                  <CollapsibleSection title="Transform" icon={<MousePointer2 className="h-3.5 w-3.5" />}>
                    <div className="space-y-2">
                      <InlineTextInput label="Value" property="transform" placeholder="none" onPreview={handlePreview} />
                    </div>
                  </CollapsibleSection>
                )}

                {shouldShowSection('Transition') && (
                  <CollapsibleSection
                    title="Transition"
                    icon={<Zap className="h-3.5 w-3.5" />}
                    onAdd={handleAddTransition}
                    defaultOpen={false}
                  >
                    <div className="space-y-2">
                      {transitions.map((transition, i) => (
                        <TransitionItem
                          key={i}
                          value={transition}
                          onChange={(v) => handleUpdateTransition(i, v)}
                          onRemove={() => handleRemoveTransition(i)}
                        />
                      ))}
                      {transitions.length === 0 && (
                        <p className="text-[10px] text-muted-foreground italic">No transitions. Click + to add.</p>
                      )}
                    </div>
                  </CollapsibleSection>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-sidebar-border space-y-2">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-8 text-[11px] bg-background/40 border-sidebar-border/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={handleReset}
              disabled={!hasChanges}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset
            </Button>
            <Button
              size="sm"
              className="flex-1 h-8 text-[11px]"
              onClick={handleApply}
              disabled={!hasChanges}
            >
              Apply
            </Button>
          </div>
          {hasChanges && (
            <p className="text-[10px] text-muted-foreground text-center">
              {Object.keys(pendingChanges).length} change(s)
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
