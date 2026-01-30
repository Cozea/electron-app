import { useMemo, useState, useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useVisualEditorStore, type ElementStyles } from '@/stores/useVisualEditorStore'
import { ColorPickerPopover } from './ColorPickerPopover'

type CSSUnit = 'px' | '%' | 'em' | 'rem' | 'vw' | 'vh' | 'auto' | ''

interface InlineInputProps {
  label: string
  property: keyof ElementStyles
  units?: CSSUnit[]
  placeholder?: string
  onPreview: (prop: keyof ElementStyles, value: string) => void
}

function parseValueAndUnit(value: string | undefined): { num: string; unit: CSSUnit } {
  if (!value) return { num: '', unit: '' }
  if (value === 'auto') return { num: '', unit: 'auto' }
  const match = value.match(/^([\d.]+)(px|%|em|rem|vw|vh)?$/)
  if (match) {
    return { num: match[1], unit: (match[2] as CSSUnit) || '%' }
  }
  return { num: value, unit: '' }
}

export function InlineInput({
  label,
  property,
  units = ['%'],
  placeholder = '—',
  onPreview,
}: InlineInputProps) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const rawValue = getPendingOrOriginal(property) || ''
  const { num, unit } = useMemo(() => parseValueAndUnit(rawValue), [rawValue])

  const defaultUnit = units[0] ?? '%'
  const effectiveUnit: CSSUnit = num === '' && unit === '' ? defaultUnit : unit

  const buildValue = (n: string, u: CSSUnit): string => {
    if (u === 'auto') return 'auto'
    if (!n || n === '') return ''
    return `${n}${u}`
  }

  const handleNumChange = (newNum: string) => {
    const cssValue = buildValue(newNum, effectiveUnit)
    updatePendingChange(property, cssValue)
    onPreview(property, cssValue)
  }

  const isAuto = effectiveUnit === 'auto'
  const showUnitSelect = units.length > 1

  return (
    <div className="flex items-center gap-2 h-7">
      <Label className="text-[11px] text-sidebar-foreground/70 w-14 shrink-0 truncate">
        {label}
      </Label>
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <Input
          type="text"
          value={isAuto ? 'auto' : num}
          onChange={(e) => handleNumChange(e.target.value)}
          disabled={isAuto}
          className={cn(
            'h-7 text-[11px] font-mono px-2 flex-1 min-w-0 bg-background/70 border-sidebar-border/70 focus-visible:ring-sidebar-ring/40',
            isAuto && 'text-muted-foreground'
          )}
          placeholder={placeholder}
        />
        {showUnitSelect && (
          <Select
            value={effectiveUnit === '' ? defaultUnit : effectiveUnit}
            onValueChange={(v) => {
              const cssValue = buildValue(num, v as CSSUnit)
              updatePendingChange(property, cssValue)
              onPreview(property, cssValue)
            }}
          >
            <SelectTrigger className="h-7 w-14 text-[11px] px-1.5 shrink-0 bg-background/70 border-sidebar-border/70 focus:ring-sidebar-ring/40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {units.map((u) => (
                <SelectItem key={u || '—'} value={u || ''} className="text-[11px]">
                  {u || '—'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )
}

// Variant for text inputs without units (like font-family)
interface InlineTextInputProps {
  label: string
  property: keyof ElementStyles
  placeholder?: string
  onPreview: (prop: keyof ElementStyles, value: string) => void
}

export function InlineTextInput({
  label,
  property,
  placeholder = '—',
  onPreview,
}: InlineTextInputProps) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const value = getPendingOrOriginal(property) || ''

  const handleChange = (newValue: string) => {
    updatePendingChange(property, newValue)
    onPreview(property, newValue)
  }

  return (
    <div className="flex items-center gap-2 h-7">
      <Label className="text-[11px] text-sidebar-foreground/70 w-14 shrink-0 truncate">
        {label}
      </Label>
      <Input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="h-7 text-[11px] font-mono px-2 flex-1 min-w-0 bg-background/70 border-sidebar-border/70 focus-visible:ring-sidebar-ring/40"
        placeholder={placeholder}
      />
    </div>
  )
}

// Variant for color inputs
interface InlineColorInputProps {
  label: string
  property: keyof ElementStyles
  onPreview: (prop: keyof ElementStyles, value: string) => void
}

/** Convert rgb(r,g,b) or rgba(r,g,b,a) to #rrggbb hex. */
function rgbRgbaToHex(css: string | undefined): string | null {
  if (!css) return null
  const match = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/)
  if (!match) return null
  const r = parseInt(match[1], 10).toString(16).padStart(2, '0')
  const g = parseInt(match[2], 10).toString(16).padStart(2, '0')
  const b = parseInt(match[3], 10).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

/** Normalize to 6-digit hex for display and storage. Accepts #rgb, #rrggbb, #rrggbbaa, rrggbb, rgb(), rgba(). */
export function toHex(css: string | undefined): string {
  if (!css || !css.trim()) return '#000000'
  const s = css.trim()
  // #rgb -> #rrggbb
  const short = s.match(/^#?([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/)
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
  }
  // #rrggbb or rrggbb -> #rrggbb
  const six = s.match(/^#?([0-9a-fA-F]{6})$/)
  if (six) return `#${six[1].toLowerCase()}`
  // #rrggbbaa -> use first 6
  const eight = s.match(/^#?([0-9a-fA-F]{8})$/)
  if (eight) return `#${eight[1].slice(0, 6).toLowerCase()}`
  const fromRgb = rgbRgbaToHex(s)
  if (fromRgb) return fromRgb
  return '#000000'
}

export function InlineColorInput({
  label,
  property,
  onPreview,
}: InlineColorInputProps) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const rawValue = getPendingOrOriginal(property) || ''
  const hexValue = toHex(rawValue)

  const [isEditing, setIsEditing] = useState(false)
  const [buffer, setBuffer] = useState(hexValue)

  useEffect(() => {
    if (!isEditing) setBuffer(hexValue)
  }, [hexValue, isEditing])

  const handleChange = (hex: string) => {
    updatePendingChange(property, hex)
    onPreview(property, hex)
  }

  const displayValue = isEditing ? buffer : hexValue

  return (
    <div className="flex items-center gap-2 h-7">
      <Label className="text-[11px] text-sidebar-foreground/70 w-14 shrink-0 truncate">
        {label}
      </Label>
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <ColorPickerPopover
          value={hexValue}
          onChange={handleChange}
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
          value={displayValue}
          onChange={(e) => setBuffer(e.target.value)}
          onFocus={() => {
            setBuffer(hexValue)
            setIsEditing(true)
          }}
          onBlur={() => {
            setIsEditing(false)
            const hex = toHex(buffer.trim())
            handleChange(hex)
          }}
          className="h-7 text-[11px] font-mono px-2 flex-1 min-w-0 bg-background/70 border-sidebar-border/70 focus-visible:ring-sidebar-ring/40"
          placeholder="#000000"
        />
      </div>
    </div>
  )
}

// Variant for select inputs
interface InlineSelectInputProps {
  label: string
  property: keyof ElementStyles
  options: Array<{ label: string; value: string }>
  onPreview: (prop: keyof ElementStyles, value: string) => void
}

export function InlineSelectInput({
  label,
  property,
  options,
  onPreview,
}: InlineSelectInputProps) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const UNSET_VALUE = '__unset__'
  const rawValue = getPendingOrOriginal(property)
  const optionValues = useMemo(() => new Set(options.map((o) => o.value)), [options])

  const selectValue = useMemo(() => {
    if (rawValue === undefined) return undefined
    if (rawValue === '') return UNSET_VALUE
    return optionValues.has(rawValue) ? rawValue : undefined
  }, [rawValue, optionValues])

  const handleChange = (newValue: string) => {
    const nextValue = newValue === UNSET_VALUE ? '' : newValue
    updatePendingChange(property, nextValue)
    onPreview(property, nextValue)
  }

  return (
    <div className="flex items-center gap-2 min-h-7 h-7 max-h-7">
      <Label className="text-[11px] text-sidebar-foreground/70 w-14 shrink-0 truncate">
        {label}
      </Label>
      <Select value={selectValue} onValueChange={handleChange}>
        <SelectTrigger className="!h-7 min-h-7 max-h-7 text-[11px] flex-1 py-0 bg-background/70 border-sidebar-border/70 focus:ring-sidebar-ring/40">
          <SelectValue placeholder={rawValue || 'Select'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET_VALUE} className="text-[11px] text-muted-foreground italic">Reset</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-[11px]">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
