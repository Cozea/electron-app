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
 ArrowLeftRight,
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
import {
 useVisualEditorStore,
 type DirectEditableAttributeName,
 type DirectEditableAttributes,
 type EditorTab,
 type ElementStyles,
 type StyleState,
} from '@/stores/useVisualEditorStore'
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
 onApplyChanges: () => Promise<void> | void
  onClose?: () => void
  saveFeedback?: {
  message: string | null
  tone: 'default' | 'destructive' | 'success' | 'warning'
  }
  savePending?: boolean
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
const FONT_CURRENT_VALUE = '__current_font__'
const FONT_UNSET_VALUE = '__unset_font__'

const TYPOGRAPHY_ELEMENTS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'label', 'li', 'td', 'th', 'strong', 'em', 'b', 'i', 'small', 'blockquote', 'code', 'pre']
const CONTAINER_ELEMENTS = ['div', 'section', 'article', 'aside', 'main', 'nav', 'header', 'footer', 'ul', 'ol', 'form', 'fieldset', 'figure', 'figcaption']
const TEXT_EDITABLE_ELEMENTS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'label', 'button', 'li', 'td', 'th', 'strong', 'em', 'b', 'i', 'small', 'blockquote']

function getFontDisplayLabel(fontFamily: string | undefined): string {
 if (!fontFamily) return 'Select font'
 const firstFamily = fontFamily.split(',')[0]?.trim()
 return firstFamily ? firstFamily.replace(/^['"]|['"]$/g, '') : fontFamily
}

function parseNumericCssValue(
 rawValue: string | undefined,
 options?: {
 defaultValue?: number
 defaultUnit?: 'px' | '%' | 'em' | 'rem' | 'vw' | 'vh'
 min?: number
 max?: number
 },
): { value: number; unit: 'px' | '%' | 'em' | 'rem' | 'vw' | 'vh' } {
 const {
 defaultValue = 0,
 defaultUnit = 'px',
 min = Number.NEGATIVE_INFINITY,
 max = Number.POSITIVE_INFINITY,
 } = options ?? {}

 if (!rawValue) {
 return { value: defaultValue, unit: defaultUnit }
 }

 const match = rawValue.match(/^(-?[\d.]+)(px|%|em|rem|vw|vh)?$/)
 if (!match) {
 return { value: defaultValue, unit: defaultUnit }
 }

 const parsedValue = Number.parseFloat(match[1])
 if (Number.isNaN(parsedValue)) {
 return { value: defaultValue, unit: defaultUnit }
 }

 return {
 value: Math.min(max, Math.max(min, parsedValue)),
 unit: (match[2] as 'px' | '%' | 'em' | 'rem' | 'vw' | 'vh' | undefined) ?? defaultUnit,
 }
}

function isToggleActive(
 property: keyof ElementStyles,
 currentValue: string,
 activeValue: string,
): boolean {
 const normalizedValue = currentValue.trim().toLowerCase()
 const normalizedActiveValue = activeValue.trim().toLowerCase()

 if (property === 'fontWeight' && normalizedActiveValue === 'bold') {
 if (normalizedValue === 'bold' || normalizedValue === 'bolder') return true
 const numericWeight = Number.parseInt(normalizedValue, 10)
 return Number.isFinite(numericWeight) && numericWeight >= 600
 }

 if (property === 'fontStyle') {
 return normalizedValue.includes(normalizedActiveValue)
 }

 if (property === 'textDecoration') {
 return normalizedValue.includes(normalizedActiveValue)
 }

 return normalizedValue === normalizedActiveValue
}

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

const ATTRIBUTE_FIELD_CONFIG: Record<
 DirectEditableAttributeName,
 { label: string; placeholder: string }
> = {
 alt: { label: 'alt', placeholder: 'Accessible image description' },
 'aria-label': { label: 'aria-label', placeholder: 'Accessible label' },
 className: { label: 'class', placeholder: 'class-names' },
 href: { label: 'href', placeholder: '/path or https://…' },
 id: { label: 'id', placeholder: 'element-id' },
 src: { label: 'src', placeholder: '/image.png or https://…' },
 title: { label: 'title', placeholder: 'Tooltip title' },
}

function parseSelectedElementAttributes(htmlSnippet: string | undefined, selectedElementId?: string, selectedClassName?: string): DirectEditableAttributes {
 if (!htmlSnippet) {
 return {
 className: selectedClassName ?? '',
 id: selectedElementId ?? '',
 }
 }

 try {
 const parser = new DOMParser()
 const document = parser.parseFromString(htmlSnippet, 'text/html')
 const element = document.body.firstElementChild
 if (!element) {
 return {
 className: selectedClassName ?? '',
 id: selectedElementId ?? '',
 }
 }

 return {
 alt: element.getAttribute('alt') ?? '',
 'aria-label': element.getAttribute('aria-label') ?? '',
 className: element.getAttribute('class') ?? selectedClassName ?? '',
 href: element.getAttribute('href') ?? '',
 id: element.getAttribute('id') ?? selectedElementId ?? '',
 src: element.getAttribute('src') ?? '',
 title: element.getAttribute('title') ?? '',
 }
 } catch {
 return {
 className: selectedClassName ?? '',
 id: selectedElementId ?? '',
 }
 }
}

function getAttributeFields(tagName: string | undefined, defaults: DirectEditableAttributes): DirectEditableAttributeName[] {
 const tag = tagName?.toLowerCase() ?? ''
 const fields: DirectEditableAttributeName[] = ['id', 'className', 'title', 'aria-label']

 if (tag === 'a' || defaults.href) {
 fields.splice(2, 0, 'href')
 }

 if (tag === 'img' || defaults.src || defaults.alt) {
 fields.splice(2, 0, 'src')
 fields.splice(3, 0, 'alt')
 }

 return Array.from(new Set(fields))
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
 const { pendingChanges, selectedElement, updatePendingChange } = useVisualEditorStore()
 const currentValue = property in pendingChanges ? pendingChanges[property] : selectedElement?.computedStyles?.[property] || ''
 const isActive = isToggleActive(property, currentValue || '', activeValue)

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
 'flex items-center justify-center h-full flex-1 rounded-none transition-colors',
 'first:rounded-l-2xl last:rounded-r-2xl',
 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
 isActive && 'bg-primary text-primary-foreground',
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
 const { pendingChanges, selectedElement, updatePendingChange } = useVisualEditorStore()
 const raw = ('fontSize' in pendingChanges ? pendingChanges['fontSize'] : selectedElement?.computedStyles?.['fontSize']) || ''
 const { value: num, unit } = useMemo(() => {
 return parseNumericCssValue(raw, {
 defaultValue: FONT_SIZE_MIN,
 defaultUnit: 'px',
 min: FONT_SIZE_MIN,
 max: FONT_SIZE_MAX,
 })
 }, [raw])

 const setValue = useCallback(
 (value: number) => {
 const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, value))
 const css = `${clamped}${unit}`
 updatePendingChange('fontSize', css)
 onPreview('fontSize', css)
 },
 [onPreview, unit, updatePendingChange]
 )

 return (
 <div className="flex items-center gap-0 flex-1 min-w-0 h-9">
 <Input
 type="text"
 value={num}
 onChange={(e) => {
 const v = parseFloat(e.target.value)
 if (!Number.isNaN(v)) setValue(v)
 }}
 className="h-full text-[11px] font-mono pl-4 pr-2 flex-1 min-w-0 text-right rounded-r-none bg-secondary/80 focus-visible:ring-sidebar-ring/40 rounded-l-2xl"
 />
 <div className="flex flex-col shrink-0 h-full rounded-r-2xl bg-secondary/80 overflow-hidden border-l border-sidebar-border/50">
 <button
 type="button"
 onClick={() => setValue(num + FONT_SIZE_STEP)}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 border-b border-sidebar-border/50 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
 aria-label="Increase"
 >
 <ChevronUp className="h-3 w-3" />
 </button>
 <button
 type="button"
 onClick={() => setValue(num - FONT_SIZE_STEP)}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
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
 const { pendingChanges, selectedElement, updatePendingChange } = useVisualEditorStore()
 const raw = ('lineHeight' in pendingChanges ? pendingChanges['lineHeight'] : selectedElement?.computedStyles?.['lineHeight']) || ''
 const { value: num, unit } = useMemo(() => {
 return parseNumericCssValue(raw, {
 defaultValue: 0,
 defaultUnit: 'px',
 min: LINE_HEIGHT_MIN,
 max: LINE_HEIGHT_MAX,
 })
 }, [raw])

 const setValue = useCallback(
 (value: number) => {
 const clamped = Math.min(LINE_HEIGHT_MAX, Math.max(LINE_HEIGHT_MIN, value))
 const css = `${clamped}${unit}`
 updatePendingChange('lineHeight', css)
 onPreview('lineHeight', css)
 },
 [onPreview, unit, updatePendingChange]
 )

 return (
 <div className="flex items-center gap-2 h-9">
 <Label className="text-[11px] text-sidebar-foreground/70 w-14 shrink-0 truncate">Spacing</Label>
 <div className="flex items-center gap-0 flex-1 min-w-0">
 <Input
 type="text"
 value={num}
 onChange={(e) => {
 const v = parseFloat(e.target.value)
 if (!Number.isNaN(v)) setValue(v)
 }}
 className="h-9 text-[11px] font-mono pl-4 pr-2 flex-1 min-w-0 text-right rounded-l-2xl rounded-r-none bg-secondary/80 focus-visible:ring-sidebar-ring/40"
 />
 <div className="flex flex-col shrink-0 h-9 rounded-r-2xl bg-secondary/80 overflow-hidden border-l border-sidebar-border/50">
 <button
 type="button"
 onClick={() => setValue(num + LINE_HEIGHT_STEP)}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 border-b border-sidebar-border/50 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
 aria-label="Increase"
 >
 <ChevronUp className="h-3 w-3" />
 </button>
 <button
 type="button"
 onClick={() => setValue(num - LINE_HEIGHT_STEP)}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
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
 const { pendingChanges, selectedElement, updatePendingChange } = useVisualEditorStore()
 const [fillMode, setFillMode] = useState<'color' | 'image'>('color')

 // Color input state (hex buffer when editing)
 const bgColorRaw = ('backgroundColor' in pendingChanges ? pendingChanges['backgroundColor'] : selectedElement?.computedStyles?.['backgroundColor']) || ''
 const hexValue = toHex(bgColorRaw)
 const [colorEditing, setColorEditing] = useState(false)
 const [colorBuffer, setColorBuffer] = useState(hexValue)

 const [prevHexValue, setPrevHexValue] = useState(hexValue)
 const [prevColorEditing, setPrevColorEditing] = useState(colorEditing)
 if (hexValue !== prevHexValue || colorEditing !== prevColorEditing) {
   setPrevHexValue(hexValue)
   setPrevColorEditing(colorEditing)
   if (!colorEditing) setColorBuffer(hexValue)
 }

 const handleColorChange = useCallback(
 (hex: string) => {
 updatePendingChange('backgroundColor', hex)
 onPreview('backgroundColor', hex)
 },
 [onPreview, updatePendingChange]
 )

 const backgroundImageValue = ('backgroundImage' in pendingChanges ? pendingChanges['backgroundImage'] : selectedElement?.computedStyles?.['backgroundImage']) || ''
 const commitBackgroundImage = useCallback(
 (value: string) => {
 updatePendingChange('backgroundImage', value)
 onPreview('backgroundImage', value)
 },
 [onPreview, updatePendingChange]
 )

 return (
 <div className="space-y-2">
        <div className="flex items-center w-full h-9 rounded-2xl bg-secondary/80 overflow-hidden">
          <button
            type="button"
            onClick={() => setFillMode('color')}
            className={cn(
              'flex items-center justify-center h-full flex-1 text-[11px] transition-colors',
              'first:rounded-l-2xl last:rounded-r-2xl',
              'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              fillMode === 'color'
                ? 'bg-primary text-primary-foreground'
                : 'text-sidebar-foreground/70'
            )}
          >
            Color
          </button>
          <button
            type="button"
            onClick={() => setFillMode('image')}
            className={cn(
              'flex items-center justify-center h-full flex-1 text-[11px] transition-colors',
              'first:rounded-l-2xl last:rounded-r-2xl',
              'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              fillMode === 'image'
                ? 'bg-primary text-primary-foreground'
                : 'text-sidebar-foreground/70'
            )}
          >
            Image
          </button>
        </div>
      <div className="flex items-center gap-1.5 h-9">
 {fillMode === 'color' ? (
 <>
 <ColorPickerPopover
 value={hexValue}
 onChange={handleColorChange}
 trigger={
 <button
                    className="w-9 h-9 rounded-full cursor-pointer bg-secondary/80 shrink-0 border border-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-sidebar-ring/40"
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
 className="h-9 rounded-2xl text-[11px] font-mono pl-4 pr-2 flex-1 min-w-0 bg-secondary/80 focus-visible:ring-sidebar-ring/40"
 placeholder="#000000"
 />
 </>
 ) : (
 <Input
 type="text"
 value={backgroundImageValue}
 onChange={(e) => commitBackgroundImage(e.target.value)}
 className="h-9 rounded-2xl text-[11px] font-mono pl-4 pr-2 flex-1 min-w-0 bg-secondary/80 focus-visible:ring-sidebar-ring/40"
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
 const { pendingChanges, selectedElement, updatePendingChange } = useVisualEditorStore()

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
 const value = parseNumericValue(prop in pendingChanges ? pendingChanges[prop] : selectedElement?.computedStyles?.[prop])
 return (
 <div key={side} className="flex items-center gap-2 h-9 min-w-0">
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
 className="h-9 text-[11px] font-mono pl-4 pr-2 w-12 text-center rounded-l-2xl rounded-r-none bg-secondary/80 focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
 />
 <div className="flex flex-col shrink-0 h-9 rounded-r-2xl bg-secondary/80 overflow-hidden border-l border-sidebar-border/50">
 <button
 type="button"
 onClick={() => setValue(prop, value + SPACING_STEP)}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 border-b border-sidebar-border/50 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
 aria-label="Increase"
 >
 <ChevronUp className="h-3 w-3" />
 </button>
 <button
 type="button"
 onClick={() => setValue(prop, value - SPACING_STEP)}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
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
 const { pendingChanges, selectedElement, updatePendingChange } = useVisualEditorStore()
 const raw = ('borderWidth' in pendingChanges ? pendingChanges['borderWidth'] : selectedElement?.computedStyles?.['borderWidth']) || ''
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
 <div className="flex items-center gap-2 h-9">
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
 className="h-9 text-[11px] font-mono pl-4 pr-2 flex-1 min-w-0 text-right rounded-l-2xl rounded-r-none bg-secondary/80 focus-visible:ring-sidebar-ring/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
 />
 <div className="flex flex-col shrink-0 h-9 rounded-r-2xl bg-secondary/80 overflow-hidden border-l border-sidebar-border/50">
 <button
 type="button"
 onClick={() => setValue(num + BORDER_WIDTH_STEP)}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 border-b border-sidebar-border/50 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
 aria-label="Increase"
 >
 <ChevronUp className="h-3 w-3" />
 </button>
 <button
 type="button"
 onClick={() => setValue(num - BORDER_WIDTH_STEP)}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
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
 const { pendingChanges, selectedElement, updatePendingChange } = useVisualEditorStore()
 const raw = ('opacity' in pendingChanges ? pendingChanges['opacity'] : selectedElement?.computedStyles?.['opacity']) || ''
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
 <div className="flex items-center gap-2 h-9">
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
 className="h-9 text-[11px] font-mono pl-4 pr-2 flex-1 min-w-0 text-right rounded-l-2xl rounded-r-none bg-secondary/80 focus-visible:ring-sidebar-ring/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
 />
 <div className="flex flex-col shrink-0 h-9 rounded-r-2xl bg-secondary/80 overflow-hidden border-l border-sidebar-border/50">
 <button
 type="button"
 onClick={() => setValue(num + OPACITY_STEP)}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
 aria-label="Increase opacity"
 >
 <ChevronUp className="h-3 w-3" />
 </button>
 <button
 type="button"
 onClick={() => setValue(num - OPACITY_STEP)}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
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
 const { pendingChanges, selectedElement, updatePendingChange } = useVisualEditorStore()
 const raw = ('borderRadius' in pendingChanges ? pendingChanges['borderRadius'] : selectedElement?.computedStyles?.['borderRadius']) || ''
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
 <div className="flex items-center gap-2 h-9 min-w-0">
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
 className="h-9 text-[11px] font-mono pl-4 pr-2 w-12 text-center rounded-l-2xl rounded-r-none bg-secondary/80 focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
 />
 <div className="flex flex-col shrink-0 h-9 rounded-r-2xl bg-secondary/80 overflow-hidden border-l border-sidebar-border/50">
 <button
 type="button"
 onClick={() => setValue(Math.min(100, num + STEP))}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 border-b border-sidebar-border/50 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
 aria-label="Increase"
 >
 <ChevronUp className="h-3 w-3" />
 </button>
 <button
 type="button"
 onClick={() => setValue(Math.max(0, num - STEP))}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
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
 'w-full min-w-0 h-2 accent-sidebar-primary bg-secondary/80 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-sidebar-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-0'
const CORNER_RADIUS_MAX = 100
const CORNER_RADIUS_STEP = 1

// Border radius control with 4 corners: each has slider + number input + up/down arrows on the right
function BorderRadiusControl({
 onPreview,
}: {
 onPreview: (prop: keyof ElementStyles, value: string) => void
}) {
 const { pendingChanges, selectedElement, updatePendingChange } = useVisualEditorStore()

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
 const value = parseNumericValue(corner.prop in pendingChanges ? pendingChanges[corner.prop] : selectedElement?.computedStyles?.[corner.prop])
 return (
 <div key={corner.label} className="flex items-center gap-2 h-9 min-w-0">
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
 className="h-9 text-[11px] font-mono pl-4 pr-2 w-12 text-center rounded-l-2xl rounded-r-none bg-secondary/80 focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
 />
 <div className="flex flex-col shrink-0 h-9 rounded-r-2xl bg-secondary/80 overflow-hidden border-l border-sidebar-border/50">
 <button
 type="button"
 onClick={() => setValue(corner.prop, Math.min(CORNER_RADIUS_MAX, value + CORNER_RADIUS_STEP))}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 border-b border-sidebar-border/50 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
 aria-label="Increase"
 >
 <ChevronUp className="h-3 w-3" />
 </button>
 <button
 type="button"
 onClick={() => setValue(corner.prop, Math.max(0, value - CORNER_RADIUS_STEP))}
 className="flex-1 min-h-0 flex items-center justify-center px-2.5 hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors"
 aria-label="Decrease"
 >
 <ChevronDown className="h-3 w-3" />
 </button>
 </div>
 </div>
 </div>
 </div> )
 })}
 </div>
 )
}

export function VisualEditorSidebar({
 onPreviewStyle,
 onPreviewText,
 onApplyChanges,
  onClose,
  saveFeedback,
  savePending = false,
  className,
}: VisualEditorSidebarProps) {
 const {
 isOpen,
 panelWidth,
 selectedElement,
 pendingChanges,
 pendingTextChange,
 pendingAttributes,
 styleState,
 activeTab,
 searchQuery,
 inspectorSide,
 isSwitchingSide,
 openingAfterSwitch,
 close,
 clearPendingChanges,
 updatePendingAttribute,
 updatePendingText,
 updatePendingChange,
 setStyleState,
 setActiveTab,
 setSearchQuery,
 setPanelWidth,
 toggleInspectorSide,
 completeSideSwitch,
 setOpeningAfterSwitchComplete,
 } = useVisualEditorStore()

 const handleClose = useCallback(() => {
 close()
 onClose?.()
 }, [close, onClose])

 useEffect(() => {
 const onKeyDown = (e: KeyboardEvent) => {
 if (e.key === 'Escape') {
 handleClose()
 }
 }
 if (isOpen) {
 window.addEventListener('keydown', onKeyDown)
 return () => window.removeEventListener('keydown', onKeyDown)
 }
 }, [isOpen, handleClose])

 useEffect(() => {
 console.log('[VisualEditor][sidebar:selectedElement]', selectedElement
 ? {
 selector: selectedElement.selector,
 tagName: selectedElement.tagName,
 path: selectedElement.path ?? null,
 textContent: selectedElement.textContent ?? null,
 computedStyles: {
 fontFamily: selectedElement.computedStyles?.fontFamily ?? null,
 fontSize: selectedElement.computedStyles?.fontSize ?? null,
 fontWeight: selectedElement.computedStyles?.fontWeight ?? null,
 lineHeight: selectedElement.computedStyles?.lineHeight ?? null,
 letterSpacing: selectedElement.computedStyles?.letterSpacing ?? null,
 textAlign: selectedElement.computedStyles?.textAlign ?? null,
 color: selectedElement.computedStyles?.color ?? null,
 },
 }
 : null)
 }, [selectedElement])

 const [isDragging, setIsDragging] = useState(false)
 const dragStartX = useRef(0)
 const dragStartWidth = useRef(0)

  const hasChanges =
    Object.keys(pendingChanges).length > 0 ||
    pendingTextChange !== null ||
    Object.keys(pendingAttributes).length > 0
  const contentValue = pendingTextChange !== null ? pendingTextChange : (selectedElement?.textContent || '')
  console.log('[VisualEditor][sidebar:render] contentValue:', contentValue, 'pendingTextChange:', pendingTextChange, 'selectedElement.textContent:', selectedElement?.textContent)
  const selectedElementKey = selectedElement?.path?.join('.') ?? selectedElement?.selector ?? 'none'
  const attributeDefaults = useMemo(
    () => parseSelectedElementAttributes(selectedElement?.htmlSnippet, selectedElement?.id, selectedElement?.className),
    [selectedElement?.className, selectedElement?.htmlSnippet, selectedElement?.id]
  )
  const attributeFields = useMemo(
    () => getAttributeFields(selectedElement?.tagName, attributeDefaults),
    [attributeDefaults, selectedElement?.tagName]
  )

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

 const handleAttributeChange = useCallback((attribute: DirectEditableAttributeName, value: string) => {
  const originalValue = attributeDefaults[attribute] ?? ''
  if (value === originalValue) {
   updatePendingAttribute(attribute, null)
   return
  }
  updatePendingAttribute(attribute, value)
 }, [attributeDefaults, updatePendingAttribute])

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
 const delta = inspectorSide === 'left' ? e.clientX - dragStartX.current : dragStartX.current - e.clientX
 const newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, dragStartWidth.current + delta))
 setPanelWidth(newWidth)
 }, [isDragging, inspectorSide, setPanelWidth])

 const handlePointerUp = useCallback(() => {
 setIsDragging(false)
 }, [])

 const handleDoubleClick = useCallback(() => {
 setPanelWidth(DEFAULT_PANEL_WIDTH)
 }, [setPanelWidth])

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

 const closedTransform = inspectorSide === 'left' ? 'translateX(-100%)' : 'translateX(100%)'

 // When switching sides: close anim on current side, then open anim on new side
 const visuallyOpen = isOpen && !isSwitchingSide && !openingAfterSwitch

 const transitionStyles = !isDragging
 ? 'transform 250ms ease-out, width 250ms ease-out, min-width 250ms ease-out, max-width 250ms ease-out, opacity 250ms ease-out'
 : 'none'

 const handleTransitionEnd = useCallback(
 (e: React.TransitionEvent) => {
 if (e.target !== e.currentTarget) return
 if (isSwitchingSide) completeSideSwitch()
 },
 [isSwitchingSide, completeSideSwitch]
 )

 useEffect(() => {
 if (!openingAfterSwitch) return
 const id = requestAnimationFrame(() => setOpeningAfterSwitchComplete())
 return () => cancelAnimationFrame(id)
 }, [openingAfterSwitch, setOpeningAfterSwitchComplete])

 return (
 <div
 className={cn(
 'flex flex-col bg-background text-sidebar-foreground overflow-hidden relative',
 inspectorSide === 'right' && 'sidebar-fade-border sidebar-fade-border-left',
 className
 )}
 style={{
 width: visuallyOpen ? panelWidth : 0,
 minWidth: visuallyOpen ? panelWidth : 0,
 maxWidth: visuallyOpen ? MAX_PANEL_WIDTH : 0,
 flexGrow: 0,
 flexShrink: 0,
 pointerEvents: visuallyOpen ? 'auto' : 'none',
 transform: visuallyOpen ? 'translateX(0)' : closedTransform,
 opacity: visuallyOpen ? 1 : 0,
 transition: transitionStyles,
 }}
 onTransitionEnd={handleTransitionEnd}
 >
 {visuallyOpen && (
 <div
 className={cn(
 'absolute top-0 bottom-0 w-1.5 cursor-ew-resize z-50',
 inspectorSide === 'left' ? 'right-0' : 'left-0',
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
 transition: !isDragging ? 'width 250ms ease-out' : 'none',
 }}
 >
 <div className="h-10 shrink-0" aria-hidden="true" />
 <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EditorTab)} className="flex-1 flex flex-col overflow-hidden">
 {/* Header */}
 <div className="flex items-center gap-2 h-9 px-2 shrink-0">
 <TabsList className="flex min-w-0 flex-1 h-8 bg-transparent rounded-none p-0 gap-1">
 <TabsTrigger
 value="styling"
 aria-label="Design"
 className={cn(
 'relative flex-1 min-w-0 h-6 px-2 bg-transparent shadow-none rounded-full',
 'text-muted-foreground hover:text-sidebar-foreground hover:bg-transparent',
 'data-[state=active]:bg-secondary/80 data-[state=active]:text-secondary-foreground data-[state=active]:shadow-none'
 )}
 >
 <Paintbrush className="h-3.5 w-3.5 shrink-0" />
 </TabsTrigger>
 <TabsTrigger
 value="events"
 aria-label="Effects"
 className={cn(
 'relative flex-1 min-w-0 h-6 px-2 bg-transparent shadow-none rounded-full',
 'text-muted-foreground hover:text-sidebar-foreground hover:bg-transparent',
 'data-[state=active]:bg-secondary/80 data-[state=active]:text-secondary-foreground data-[state=active]:shadow-none'
 )}
 >
 <Zap className="h-3.5 w-3.5 shrink-0" />
 </TabsTrigger>
 <TabsTrigger
 value="attributes"
 aria-label="Inspect"
 className={cn(
 'relative flex-1 min-w-0 h-6 px-2 bg-transparent shadow-none rounded-full',
 'text-muted-foreground hover:text-sidebar-foreground hover:bg-transparent',
 'data-[state=active]:bg-secondary/80 data-[state=active]:text-secondary-foreground data-[state=active]:shadow-none'
 )}
 >
 <Code className="h-3.5 w-3.5 shrink-0" />
 </TabsTrigger>
 </TabsList>
 <div className="flex items-center gap-0.5 shrink-0">
 <Button
 variant="ghost"
 size="icon"
 className="h-7 w-7 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
 onClick={toggleInspectorSide}
 aria-label="Move inspector to other side"
 >
 <ArrowLeftRight className="h-4 w-4" />
 </Button>
 <Button
 variant="ghost"
 size="icon"
 className="h-7 w-7 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
 onClick={handleClose}
 >
 <X className="h-4 w-4" />
 </Button>
 </div>
 </div>

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
 key={`content:${selectedElementKey}`}
 className="w-full min-h-[70px] max-h-[160px] text-[11px] bg-secondary/80 rounded-2xl pl-4 pr-2 py-3 resize-y focus:outline-none focus:ring-1 focus:ring-sidebar-ring/40"
 value={contentValue}
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
 {(() => {
 const currentFontValue = ('fontFamily' in pendingChanges ? pendingChanges['fontFamily'] : selectedElement?.computedStyles?.['fontFamily']) || ''
 const foundFont = FONT_OPTIONS.find((option) => option.value === currentFontValue)
 const selectValue = foundFont
 ? foundFont.value
 : currentFontValue
 ? FONT_CURRENT_VALUE
 : FONT_UNSET_VALUE

 return (
 <Select
 key={`font-family:${selectedElementKey}`}
 value={selectValue}
 onValueChange={(v) => {
 if (v === FONT_CURRENT_VALUE || v === FONT_UNSET_VALUE) return
 updatePendingChange('fontFamily', v)
 handlePreview('fontFamily', v)
 }}
 >
 <SelectTrigger className="h-9 text-[11px] w-full bg-secondary/80 focus:ring-sidebar-ring/40 rounded-2xl">
 <SelectValue
 placeholder={
 (() => {
 const v = ('fontFamily' in pendingChanges ? pendingChanges['fontFamily'] : selectedElement?.computedStyles?.['fontFamily']) || ''
 return getFontDisplayLabel(v)
 })()
 }
 />
 </SelectTrigger>
 <SelectContent className="max-h-[220px]">
 {!currentFontValue ? (
 <SelectItem value={FONT_UNSET_VALUE} className="text-[11px] text-muted-foreground italic">
 Select font
 </SelectItem>
 ) : null}
 {currentFontValue && !foundFont ? (
 <SelectItem value={FONT_CURRENT_VALUE} className="text-[11px] text-muted-foreground italic">
 {getFontDisplayLabel(currentFontValue)}
 </SelectItem>
 ) : null}
 {FONT_OPTIONS.map((opt) => (
 <SelectItem key={opt.value} value={opt.value} className="text-[11px]">
 {opt.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 )
 })()}
 </div>
 <div className="flex items-center gap-3 h-9">
 <div className="flex-1 min-w-0 h-full">
 <div className="flex items-center w-full h-9 rounded-2xl bg-secondary/80 overflow-hidden">
 <TextStyleToggle
 key={`bw:${selectedElementKey}`}
 icon={Bold}
 property="fontWeight"
 activeValue="bold"
 inactiveValue="normal"
 tooltip="Bold"
 onPreview={handlePreview}
 />
 <TextStyleToggle
 key={`i:${selectedElementKey}`}
 icon={Italic}
 property="fontStyle"
 activeValue="italic"
 inactiveValue="normal"
 tooltip="Italic"
 onPreview={handlePreview}
 />
 <TextStyleToggle
 key={`u:${selectedElementKey}`}
 icon={Underline}
 property="textDecoration"
 activeValue="underline"
 inactiveValue="none"
 tooltip="Underline"
 onPreview={handlePreview}
 />
 <TextStyleToggle
 key={`s:${selectedElementKey}`}
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
 <FontSizeStepper key={`fs:${selectedElementKey}`} onPreview={handlePreview} />
 </div>
 </div>
 <IconGridInput
 key={`align:${selectedElementKey}`}
 label="Align"
 property="textAlign"
 options={TEXT_ALIGN_OPTIONS}
 columns={4}
 onPreview={handlePreview}
 className="h-9 rounded-2xl"
 />
 <InlineColorInput key={`color:${selectedElementKey}`} label="Color" property="color" onPreview={handlePreview} />
 <LineHeightStepper key={`lh:${selectedElementKey}`} onPreview={handlePreview} />
 <InlineInput
 key={`ls:${selectedElementKey}`}
 label="Letter"
 property="letterSpacing"
 units={['px', 'em', 'rem']}
 onPreview={handlePreview}
 />
 </div>
 </CollapsibleSection>
 )}

 {sections.showSize && shouldShowSection('Size') && (
 <CollapsibleSection title="Size" icon={<Square className="h-3.5 w-3.5" />} defaultOpen={false}>
 <div className="space-y-2">
 <InlineInput key={`w:${selectedElementKey}`} label="Width" property="width" onPreview={handlePreview} />
 <InlineInput key={`h:${selectedElementKey}`} label="Height" property="height" onPreview={handlePreview} />
 <InlineInput key={`mw:${selectedElementKey}`} label="Min W" property="minWidth" onPreview={handlePreview} />
 <InlineInput key={`mxw:${selectedElementKey}`} label="Max W" property="maxWidth" onPreview={handlePreview} />
 <InlineInput key={`mnh:${selectedElementKey}`} label="Min H" property="minHeight" onPreview={handlePreview} />
 <InlineInput key={`mxh:${selectedElementKey}`} label="Max H" property="maxHeight" onPreview={handlePreview} />
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
 {selectedElement && (
 <div className="space-y-2">
 {attributeFields.map((attribute) => {
 const config = ATTRIBUTE_FIELD_CONFIG[attribute]
 const value = pendingAttributes[attribute] ?? attributeDefaults[attribute] ?? ''
 return (
 <div key={`${selectedElementKey}:${attribute}`} className="space-y-1.5">
 <Label className="text-[11px] text-sidebar-foreground/70">{config.label}</Label>
 <Input
 type="text"
 value={value}
 onChange={(event) => handleAttributeChange(attribute, event.target.value)}
 className="h-9 rounded-2xl bg-secondary/80 pl-4 pr-2 font-mono text-[11px] focus-visible:ring-sidebar-ring/40"
 placeholder={config.placeholder}
 spellCheck={false}
 />
 </div>
 )
 })}
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
 <div className="px-3 py-2 space-y-2">
  {saveFeedback?.message ? (
  <p
  className={cn(
  'text-[11px]',
  saveFeedback.tone === 'success' && 'text-emerald-600 dark:text-emerald-400',
  saveFeedback.tone === 'warning' && 'text-amber-600 dark:text-amber-400',
  saveFeedback.tone === 'destructive' && 'text-destructive',
  saveFeedback.tone === 'default' && 'text-muted-foreground'
  )}
  >
  {saveFeedback.message}
  </p>
  ) : null}
  <div className="flex gap-2">
  <Button
  variant="outline"
 size="sm"
 className="flex-1 h-8 text-[11px] bg-background/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
  disabled={!hasChanges || savePending}
  >
  {savePending ? 'Saving…' : 'Save'}
  </Button>
  </div>
  </div>
 </div>
</div>
 )
}
