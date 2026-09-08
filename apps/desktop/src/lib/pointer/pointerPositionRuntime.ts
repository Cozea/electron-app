export interface GlobalPointerPosition {
  readonly clientX: number
  readonly clientY: number
  readonly revision: number
}

let currentPointerPosition: GlobalPointerPosition = {
  clientX: -100_000,
  clientY: -100_000,
  revision: 0,
}

const listeners = new Set<(position: GlobalPointerPosition) => void>()
let isInitialized = false

function onPointerUpdate(event: PointerEvent): void {
  currentPointerPosition = {
    clientX: event.clientX,
    clientY: event.clientY,
    revision: currentPointerPosition.revision + 1,
  }
  for (const listener of listeners) {
    try {
      listener(currentPointerPosition)
    } catch (err) {
      console.error("[pointerPositionRuntime] Listener error:", err)
    }
  }
}

export function initGlobalPointerPositionTracking(): () => void {
  if (isInitialized || typeof document === "undefined") {
    return () => {}
  }
  isInitialized = true

  document.addEventListener("pointermove", onPointerUpdate, {
    capture: true,
    passive: true,
  })
  document.addEventListener("pointerdown", onPointerUpdate, {
    capture: true,
    passive: true,
  })

  return () => {
    document.removeEventListener("pointermove", onPointerUpdate, true)
    document.removeEventListener("pointerdown", onPointerUpdate, true)
    isInitialized = false
  }
}

export function getGlobalPointerPosition(): GlobalPointerPosition {
  if (!isInitialized) {
    initGlobalPointerPositionTracking()
  }
  return currentPointerPosition
}

export function subscribeGlobalPointerPosition(
  listener: (position: GlobalPointerPosition) => void,
): () => void {
  if (!isInitialized) {
    initGlobalPointerPositionTracking()
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isPointInsideRect(
  x: number,
  y: number,
  rect: { left: number; right: number; top: number; bottom: number },
): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

export function _resetGlobalPointerPositionRuntimeForTesting(): void {
  currentPointerPosition = {
    clientX: -100_000,
    clientY: -100_000,
    revision: 0,
  }
  listeners.clear()
  isInitialized = false
}
