import { createElement, type ComponentType, type SVGProps } from 'react'

import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'

export type HugeIconComponent = ComponentType<SVGProps<SVGSVGElement>>

export function asHugeIcon(icon: IconSvgElement): HugeIconComponent {
  return function HugeIconComponent(props: SVGProps<SVGSVGElement>) {
    const { strokeWidth, ...rest } = props
    const parsedStrokeWidth =
      typeof strokeWidth === 'string' ? Number.parseFloat(strokeWidth) : strokeWidth
    const resolvedStrokeWidth = Number.isFinite(parsedStrokeWidth) ? parsedStrokeWidth : undefined

    return createElement(HugeiconsIcon, {
      icon,
      ...rest,
      ...(typeof resolvedStrokeWidth === 'number' ? { strokeWidth: resolvedStrokeWidth } : {}),
    })
  }
}
