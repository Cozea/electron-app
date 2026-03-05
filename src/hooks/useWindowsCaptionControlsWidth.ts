import { useEffect, useState } from "react"

const FALLBACK_WINDOWS_CAPTION_CONTROLS_WIDTH = 140
const MIN_VALID_WINDOWS_CAPTION_CONTROLS_WIDTH = 80
const MIN_TUNED_WINDOWS_CAPTION_CONTROLS_WIDTH = 96
const WINDOWS_CAPTION_CONTROLS_TRIM_PX = 24

interface TitlebarAreaRectLike {
  x: number
  y: number
  width: number
  height: number
}

interface WindowControlsOverlayLike extends EventTarget {
  visible: boolean
  getTitlebarAreaRect: () => TitlebarAreaRectLike
}

interface NavigatorWithWindowControlsOverlay extends Navigator {
  windowControlsOverlay?: WindowControlsOverlayLike
}

function isWindowsElectronClient(): boolean {
  return typeof window !== "undefined" && window.electronAPI?.platform === "win32"
}

function readWindowsCaptionControlsWidth(): number {
  if (!isWindowsElectronClient()) return 0

  const nav = navigator as NavigatorWithWindowControlsOverlay
  const overlay = nav.windowControlsOverlay
  if (!overlay || !overlay.visible || typeof overlay.getTitlebarAreaRect !== "function") {
    return Math.max(
      MIN_TUNED_WINDOWS_CAPTION_CONTROLS_WIDTH,
      FALLBACK_WINDOWS_CAPTION_CONTROLS_WIDTH - WINDOWS_CAPTION_CONTROLS_TRIM_PX
    )
  }

  try {
    const area = overlay.getTitlebarAreaRect()
    const reservedRightWidth = window.innerWidth - (area.x + area.width)
    if (
      Number.isFinite(reservedRightWidth) &&
      reservedRightWidth >= MIN_VALID_WINDOWS_CAPTION_CONTROLS_WIDTH
    ) {
      return Math.max(
        MIN_TUNED_WINDOWS_CAPTION_CONTROLS_WIDTH,
        Math.round(reservedRightWidth - WINDOWS_CAPTION_CONTROLS_TRIM_PX)
      )
    }
  } catch {
    // Fallback below.
  }

  return Math.max(
    MIN_TUNED_WINDOWS_CAPTION_CONTROLS_WIDTH,
    FALLBACK_WINDOWS_CAPTION_CONTROLS_WIDTH - WINDOWS_CAPTION_CONTROLS_TRIM_PX
  )
}

export function useWindowsCaptionControlsWidth(): number {
  const [width, setWidth] = useState<number>(() => readWindowsCaptionControlsWidth())

  useEffect(() => {
    if (!isWindowsElectronClient()) {
      setWidth(0)
      return
    }

    const update = () => {
      setWidth(readWindowsCaptionControlsWidth())
    }

    const nav = navigator as NavigatorWithWindowControlsOverlay
    const overlay = nav.windowControlsOverlay

    update()
    window.addEventListener("resize", update)
    overlay?.addEventListener?.("geometrychange", update as EventListener)

    return () => {
      window.removeEventListener("resize", update)
      overlay?.removeEventListener?.("geometrychange", update as EventListener)
    }
  }, [])

  return width
}
