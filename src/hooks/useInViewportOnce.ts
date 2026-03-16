import { useEffect, useState, type RefObject } from 'react'

interface UseInViewportOnceOptions {
  root?: Element | Document | null
  rootMargin?: string
  threshold?: number | number[]
}

/**
 * Returns true once the element enters the viewport.
 * Useful for deferring non-critical work until the item is likely visible.
 */
export function useInViewportOnce<T extends Element>(
  ref: RefObject<T | null>,
  {
    root = null,
    rootMargin = '200px',
    threshold = 0,
  }: UseInViewportOnceOptions = {}
): boolean {
  const [hasIntersected, setHasIntersected] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (hasIntersected) return
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        setHasIntersected(true)
        observer.disconnect()
      },
      { root, rootMargin, threshold }
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [hasIntersected, ref, root, rootMargin, threshold])

  return hasIntersected
}
