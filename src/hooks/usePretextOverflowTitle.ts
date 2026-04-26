import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react"

import { measureTextNaturalWidth } from "@/lib/text/pretextMeasure"

interface UsePretextOverflowTitleOptions {
  font: string
}

/**
 * Computes title tooltips only when text is likely truncated in a measured container.
 */
export function usePretextOverflowTitle(options: UsePretextOverflowTitleOptions) {
  const { font } = options
  const containerRef = useRef<HTMLElement | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? 0
      setContainerWidth(nextWidth)
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const getOverflowTitle = useCallback(
    (text: string, reservedWidth: number): string | undefined => {
      if (!text || containerWidth <= 0) return undefined
      const availableLabelWidth = Math.max(0, containerWidth - reservedWidth)
      const textWidth = measureTextNaturalWidth(text, font)
      return textWidth > availableLabelWidth ? text : undefined
    },
    [containerWidth, font],
  )

  return {
    containerRef,
    getOverflowTitle,
  }
}

export function usePretextOverflowTitleFor<T extends HTMLElement>(
  options: UsePretextOverflowTitleOptions,
) {
  const base = usePretextOverflowTitle(options)
  return {
    containerRef: base.containerRef as MutableRefObject<T | null>,
    getOverflowTitle: base.getOverflowTitle,
  }
}
