import { useMemo } from 'react'
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
    return { num: match[1], unit: (match[2] as CSSUnit) || 'px' }
  }
  return { num: value, unit: '' }
}

export function InlineInput({
  label,
  property,
  units = ['px', '%', 'em', 'rem', 'auto'],
  placeholder = '—',
  onPreview,
}: InlineInputProps) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const rawValue = getPendingOrOriginal(property) || ''
  const { num, unit } = useMemo(() => parseValueAndUnit(rawValue), [rawValue])

  const NO_UNIT = '__no_unit__'
  const defaultUnit = units[0] ?? 'px'
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

  const handleUnitChange = (newUnit: CSSUnit | typeof NO_UNIT) => {
    const resolvedUnit = newUnit === NO_UNIT ? '' : newUnit
    const cssValue = buildValue(num, resolvedUnit)
    updatePendingChange(property, cssValue)
    onPreview(property, cssValue)
  }

  const isAuto = effectiveUnit === 'auto'
  const selectUnitValue = effectiveUnit === '' ? NO_UNIT : effectiveUnit

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
        <Select value={selectUnitValue} onValueChange={(v) => handleUnitChange(v as CSSUnit | typeof NO_UNIT)}>
          <SelectTrigger className="h-7 w-14 text-[11px] px-1.5 shrink-0 bg-background/70 border-sidebar-border/70 focus:ring-sidebar-ring/40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {units.map((u) => (
              <SelectItem key={u || NO_UNIT} value={u || NO_UNIT} className="text-[11px]">
                {u || '—'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

function rgbToHex(rgb: string | undefined): string | null {
  if (!rgb) return null
  const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (!match) return null
  const r = parseInt(match[1]).toString(16).padStart(2, '0')
  const g = parseInt(match[2]).toString(16).padStart(2, '0')
  const b = parseInt(match[3]).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

export function InlineColorInput({
  label,
  property,
  onPreview,
}: InlineColorInputProps) {
  const { getPendingOrOriginal, updatePendingChange } = useVisualEditorStore()
  const value = getPendingOrOriginal(property) || ''
  const hexValue = rgbToHex(value) || value || '#000000'

  const handleChange = (newValue: string) => {
    updatePendingChange(property, newValue)
    onPreview(property, newValue)
  }

  return (
    <div className="flex items-center gap-2 h-7">
      <Label className="text-[11px] text-sidebar-foreground/70 w-14 shrink-0 truncate">
        {label}
      </Label>
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <input
          type="color"
          value={hexValue}
          onChange={(e) => handleChange(e.target.value)}
          className="w-7 h-7 rounded-md border border-sidebar-border/70 cursor-pointer bg-background/70 shrink-0"
        />
        <Input
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
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
    <div className="flex items-center gap-2 h-7">
      <Label className="text-[11px] text-sidebar-foreground/70 w-14 shrink-0 truncate">
        {label}
      </Label>
      <Select value={selectValue} onValueChange={handleChange}>
        <SelectTrigger className="h-7 text-[11px] flex-1 bg-background/70 border-sidebar-border/70 focus:ring-sidebar-ring/40">
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
