import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefCallback,
} from "react"
import { registerGeometryTask } from "@/lib/desktopInteraction/geometryScheduler"
import {
  getGlobalPointerPosition,
  isPointInsideRect,
} from "@/lib/pointer/pointerPositionRuntime"

interface UseElementPointerHoverOptions {
  enabled?: boolean
}

interface UseElementPointerHoverResult<TElement extends HTMLElement> {
  ref: RefCallback<TElement>
  isHovered: boolean
  onPointerEnter: (event: ReactPointerEvent<TElement>) => void
  onPointerLeave: (event: ReactPointerEvent<TElement>) => void
  onPointerMove: (event: ReactPointerEvent<TElement>) => void
}

export function useElementPointerHover<TElement extends HTMLElement>({
  enabled = true,
}: UseElementPointerHoverOptions = {}): UseElementPointerHoverResult<TElement> {
  const elementRef = useRef<TElement | null>(null)
  const [element, setElement] = useState<TElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)

  const ref = useCallback<RefCallback<TElement>>((node) => {
    elementRef.current = node
    setElement(node)
  }, [])

  const handlePointerEnter = useCallback(
    (_event: ReactPointerEvent<TElement>) => {
      if (enabled) {
        setIsHovered(true)
      }
    },
    [enabled],
  )

  const handlePointerLeave = useCallback(() => {
    setIsHovered(false)
  }, [])

  const handlePointerMove = useCallback(
    (_event: ReactPointerEvent<TElement>) => {
      if (enabled && !isHovered) {
        setIsHovered(true)
      }
    },
    [enabled, isHovered],
  )

  // Reconcile hover only when geometry changes underneath a stationary pointer
  useEffect(() => {
    if (!enabled || !element || typeof ResizeObserver === "undefined") {
      if (!enabled) setIsHovered(false)
      return
    }

    const task = registerGeometryTask<boolean>({
      name: "element-hover-reconcile",
      read: () => {
        const node = elementRef.current
        if (!node) return null
        const rect = node.getBoundingClientRect()
        const pointer = getGlobalPointerPosition()
        return isPointInsideRect(pointer.clientX, pointer.clientY, rect)
      },
      write: (isInside) => {
        setIsHovered((current) => (current === isInside ? current : isInside))
      },
    })

    const ro = new ResizeObserver(() => {
      task.invalidate()
    })
    ro.observe(element)

    return () => {
      ro.disconnect()
      task.dispose()
    }
  }, [element, enabled])

  return {
    ref,
    isHovered,
    onPointerEnter: handlePointerEnter,
    onPointerLeave: handlePointerLeave,
    onPointerMove: handlePointerMove,
  }
}
