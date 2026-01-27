import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalSpaceBetween,
  AlignHorizontalSpaceAround,
  AlignHorizontalDistributeCenter,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  Maximize2,
  GripHorizontal,
} from 'lucide-react'

export interface IconGridOption {
  value: string
  icon: LucideIcon
  tooltip: string
}

export const FLEX_DIRECTION_OPTIONS: IconGridOption[] = [
  { value: 'row', icon: ArrowRight, tooltip: 'Row' },
  { value: 'row-reverse', icon: ArrowLeft, tooltip: 'Row Reverse' },
  { value: 'column', icon: ArrowDown, tooltip: 'Column' },
  { value: 'column-reverse', icon: ArrowUp, tooltip: 'Column Reverse' },
]

export const JUSTIFY_CONTENT_OPTIONS: IconGridOption[] = [
  { value: 'flex-start', icon: AlignHorizontalJustifyStart, tooltip: 'Start' },
  { value: 'center', icon: AlignHorizontalJustifyCenter, tooltip: 'Center' },
  { value: 'flex-end', icon: AlignHorizontalJustifyEnd, tooltip: 'End' },
  { value: 'space-between', icon: AlignHorizontalSpaceBetween, tooltip: 'Space Between' },
  { value: 'space-around', icon: AlignHorizontalSpaceAround, tooltip: 'Space Around' },
  { value: 'space-evenly', icon: AlignHorizontalDistributeCenter, tooltip: 'Space Evenly' },
]

export const ALIGN_ITEMS_OPTIONS: IconGridOption[] = [
  { value: 'flex-start', icon: AlignStartVertical, tooltip: 'Start' },
  { value: 'center', icon: AlignCenterVertical, tooltip: 'Center' },
  { value: 'flex-end', icon: AlignEndVertical, tooltip: 'End' },
  { value: 'stretch', icon: Maximize2, tooltip: 'Stretch' },
  { value: 'baseline', icon: GripHorizontal, tooltip: 'Baseline' },
]

export const TEXT_ALIGN_OPTIONS: IconGridOption[] = [
  { value: 'left', icon: AlignLeft, tooltip: 'Left' },
  { value: 'center', icon: AlignCenter, tooltip: 'Center' },
  { value: 'right', icon: AlignRight, tooltip: 'Right' },
  { value: 'justify', icon: AlignJustify, tooltip: 'Justify' },
]

