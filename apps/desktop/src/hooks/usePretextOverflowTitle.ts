import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefCallback } from "react"

import { measureTextNaturalWidth } from "@/lib/text/pretextMeasure"

interface UsePretextOverflowTitleOptions {
  font?: string
}

/**
 * Computes title tooltips only when text is likely truncated in a measured container.
 */
export function usePretextOverflowTitle(options: UsePretextOverflowTitleOptions = {}) {
  const { font } = options
  const containerRef = useRef<HTMLElement | null>(null)
  const [measurement, setMeasurement] = useState({ width: 0, font: font ?? "" })

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const measure = (width = element.getBoundingClientRect().width) => {
      const nextFont = font ?? getComputedStyle(element).font
      setMeasurement((current) =>
        current.width === width && current.font === nextFont
          ? current
          : { width, font: nextFont },
      )
    }
    const observer = new ResizeObserver((entries) => {
      measure(entries[0]?.contentRect.width ?? 0)
    })

    observer.observe(element)
    measure()

    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure()
    })

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [font])

  const getOverflowTitle = useCallback(
    (text: string, reservedWidth: number): string | undefined => {
      if (!text || measurement.width <= 0 || !measurement.font) return undefined
      const availableLabelWidth = Math.max(0, measurement.width - reservedWidth)
      const textWidth = measureTextNaturalWidth(text, measurement.font)
      return textWidth > availableLabelWidth ? text : undefined
    },
    [measurement],
  )

  return {
    containerRef,
    getOverflowTitle,
  }
}

export function usePretextOverflowTitleFor<T extends HTMLElement>(
  options: UsePretextOverflowTitleOptions = {},
) {
  const base = usePretextOverflowTitle(options)
  return {
    containerRef: base.containerRef as MutableRefObject<T | null>,
    getOverflowTitle: base.getOverflowTitle,
  }
}

/** Uses the browser's rendered overflow metrics for a single truncating text element. */
export function useElementOverflowTitleFor<T extends HTMLElement>(text: string) {
  const [isOverflowing, setIsOverflowing] = useState(false)

  const elementRef = useCallback<RefCallback<T>>((element) => {
    if (!element) return

    const measure = () => {
      const nextOverflowing = element.scrollWidth > element.clientWidth
      setIsOverflowing((current) =>
        current === nextOverflowing ? current : nextOverflowing,
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()

    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure()
    })

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [text])

  return {
    elementRef,
    overflowTitle: isOverflowing ? text : undefined,
  }
}
