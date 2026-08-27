import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefCallback,
} from "react"

interface PointerClientPosition {
  x: number
  y: number
}

let lastPointerClientPosition: PointerClientPosition | null = null

function recordPointerClientPosition(position: PointerClientPosition): void {
  lastPointerClientPosition = position
}

function recordPointerEventPosition(event: PointerEvent | MouseEvent): void {
  recordPointerClientPosition({
    x: event.clientX,
    y: event.clientY,
  })
}

function isPointerInsideElement(
  element: HTMLElement,
  position: PointerClientPosition,
): boolean {
  const rect = element.getBoundingClientRect()
  return (
    position.x >= rect.left &&
    position.x <= rect.right &&
    position.y >= rect.top &&
    position.y <= rect.bottom
  )
}

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

  const syncHoverWithPointer = useCallback(() => {
    if (!enabled) {
      setIsHovered(false)
      return false
    }

    const node = elementRef.current
    const pointer = lastPointerClientPosition
    if (!node || !pointer) {
      return false
    }

    const nextIsHovered = isPointerInsideElement(node, pointer)
    setIsHovered((current) => (current === nextIsHovered ? current : nextIsHovered))
    return nextIsHovered
  }, [enabled])

  const ref = useCallback<RefCallback<TElement>>((node) => {
    elementRef.current = node
    setElement(node)
  }, [])

  const handleDocumentPointerUpdate = useCallback(
    (event: PointerEvent | MouseEvent) => {
      recordPointerEventPosition(event)
      syncHoverWithPointer()
    },
    [syncHoverWithPointer],
  )

  const handlePointerEnter = useCallback(
    (event: ReactPointerEvent<TElement>) => {
      recordPointerClientPosition({
        x: event.clientX,
        y: event.clientY,
      })
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
    (event: ReactPointerEvent<TElement>) => {
      recordPointerClientPosition({
        x: event.clientX,
        y: event.clientY,
      })
      if (enabled) {
        setIsHovered(true)
      }
    },
    [enabled],
  )

  useLayoutEffect(() => {
    if (!enabled) {
      setIsHovered(false)
      return
    }

    syncHoverWithPointer()

    if (typeof window === "undefined") {
      return
    }

    const animationFrameId = window.requestAnimationFrame(syncHoverWithPointer)
    return () => {
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [element, enabled, syncHoverWithPointer])

  useEffect(() => {
    if (!enabled || typeof document === "undefined") {
      return
    }

    document.addEventListener("pointermove", handleDocumentPointerUpdate, {
      capture: true,
      passive: true,
    })
    document.addEventListener("pointerdown", handleDocumentPointerUpdate, {
      capture: true,
      passive: true,
    })
    document.addEventListener("mousemove", handleDocumentPointerUpdate, {
      capture: true,
      passive: true,
    })
    document.addEventListener("mousedown", handleDocumentPointerUpdate, {
      capture: true,
      passive: true,
    })

    return () => {
      document.removeEventListener("pointermove", handleDocumentPointerUpdate, true)
      document.removeEventListener("pointerdown", handleDocumentPointerUpdate, true)
      document.removeEventListener("mousemove", handleDocumentPointerUpdate, true)
      document.removeEventListener("mousedown", handleDocumentPointerUpdate, true)
    }
  }, [enabled, handleDocumentPointerUpdate])

  useEffect(() => {
    if (
      !enabled ||
      !element ||
      typeof ResizeObserver === "undefined" ||
      typeof window === "undefined"
    ) {
      return
    }

    let animationFrameId: number | null = null
    const scheduleSync = () => {
      if (animationFrameId !== null) {
        return
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null
        syncHoverWithPointer()
      })
    }

    const resizeObserver = new ResizeObserver(scheduleSync)
    resizeObserver.observe(element)
    if (element.parentElement) {
      resizeObserver.observe(element.parentElement)
    }

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }
      resizeObserver.disconnect()
    }
  }, [element, enabled, syncHoverWithPointer])

  return {
    ref,
    isHovered,
    onPointerEnter: handlePointerEnter,
    onPointerLeave: handlePointerLeave,
    onPointerMove: handlePointerMove,
  }
}
