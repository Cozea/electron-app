import type { BrowserWindow } from "electron"
import type {
  NativeDesktopInteractionChange,
  NativeDesktopInteractionKind,
} from "../../../shared/desktopInteractionTypes"

export const WINDOW_INTERACTION_CHANNEL = "window:interaction-change"
export const FALLBACK_COMPLETION_TIMEOUT_MS = 120

export function attachWindowInteractionLifecycle(
  window: BrowserWindow,
): () => void {
  let isResizeActive = false
  let isMoveActive = false
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  let moveTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const sendChange = (kind: NativeDesktopInteractionKind, active: boolean) => {
    if (disposed || window.isDestroyed()) return
    const payload: NativeDesktopInteractionChange = { kind, active }
    try {
      window.webContents.send(WINDOW_INTERACTION_CHANNEL, payload)
    } catch {
      // Window or webContents may be in teardown
    }
  }

  const setResizeActive = (active: boolean) => {
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer)
      resizeTimer = null
    }
    if (isResizeActive === active) return
    isResizeActive = active
    sendChange("native-window-resize", active)
  }

  const pulseResize = () => {
    if (disposed) return
    if (!isResizeActive) {
      setResizeActive(true)
    }
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer)
    }
    resizeTimer = setTimeout(() => {
      resizeTimer = null
      setResizeActive(false)
    }, FALLBACK_COMPLETION_TIMEOUT_MS)
  }

  const endResize = () => {
    if (disposed) return
    setResizeActive(false)
  }

  const setMoveActive = (active: boolean) => {
    if (moveTimer !== null) {
      clearTimeout(moveTimer)
      moveTimer = null
    }
    if (isMoveActive === active) return
    isMoveActive = active
    sendChange("native-window-move", active)
  }

  const pulseMove = () => {
    if (disposed) return
    if (!isMoveActive) {
      setMoveActive(true)
    }
    if (moveTimer !== null) {
      clearTimeout(moveTimer)
    }
    moveTimer = setTimeout(() => {
      moveTimer = null
      setMoveActive(false)
    }, FALLBACK_COMPLETION_TIMEOUT_MS)
  }

  const endMove = () => {
    if (disposed) return
    setMoveActive(false)
  }

  const onWillResize = () => pulseResize()
  const onResize = () => pulseResize()
  const onResized = () => endResize()

  const onWillMove = () => pulseMove()
  const onMove = () => pulseMove()
  const onMoved = () => endMove()

  const onClosed = () => {
    dispose()
  }

  // Register events
  ;(window as any).on("will-resize", onWillResize)
  window.on("resize", onResize)
  window.on("resized", onResized)

  ;(window as any).on("will-move", onWillMove)
  window.on("move", onMove)
  window.on("moved", onMoved)

  window.once("closed", onClosed)

  const dispose = () => {
    if (disposed) return

    if (resizeTimer !== null) {
      clearTimeout(resizeTimer)
      resizeTimer = null
    }
    if (moveTimer !== null) {
      clearTimeout(moveTimer)
      moveTimer = null
    }

    if (!window.isDestroyed()) {
      ;(window as any).removeListener("will-resize", onWillResize)
      window.removeListener("resize", onResize)
      window.removeListener("resized", onResized)

      ;(window as any).removeListener("will-move", onWillMove)
      window.removeListener("move", onMove)
      window.removeListener("moved", onMoved)

      window.removeListener("closed", onClosed)

      if (isResizeActive) {
        isResizeActive = false
        sendChange("native-window-resize", false)
      }
      if (isMoveActive) {
        isMoveActive = false
        sendChange("native-window-move", false)
      }
    }

    disposed = true
  }

  return dispose
}
