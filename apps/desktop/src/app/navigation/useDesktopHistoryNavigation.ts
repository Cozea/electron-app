import { useEffect, useEffectEvent } from "react"
import { useRouter } from "@tanstack/react-router"

export type HistoryDirection = "back" | "forward"

interface HistoryKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * The platform's back/forward keys: ⌘[ / ⌘] on macOS (Finder, Safari, Xcode),
 * Alt+← / Alt+→ elsewhere (Explorer, browsers).
 */
export function historyDirectionForKey(event: HistoryKeyEvent, isMac: boolean): HistoryDirection | null {
  if (event.shiftKey) return null
  if (isMac) {
    if (!event.metaKey || event.ctrlKey || event.altKey) return null
    if (event.key === "[") return "back"
    if (event.key === "]") return "forward"
    return null
  }
  if (!event.altKey || event.metaKey || event.ctrlKey) return null
  if (event.key === "ArrowLeft") return "back"
  if (event.key === "ArrowRight") return "forward"
  return null
}

/** Mouse buttons 3 and 4 are the side "back" and "forward" buttons. */
export function historyDirectionForMouseButton(button: number): HistoryDirection | null {
  if (button === 3) return "back"
  if (button === 4) return "forward"
  return null
}

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='']",
  "[contenteditable='true']",
  // Terminals and code editors bind these keys themselves (⌘[ outdents).
  ".xterm",
  ".cm-editor",
  ".monaco-editor",
].join(",")

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null
}

/**
 * Steps through app history the way a desktop app does: keyboard shortcuts,
 * mouse side buttons, and — relayed from the main process — the Go menu,
 * trackpad swipes and Windows/Linux app commands. Keys are left alone while
 * an editable element has focus so editors keep their own bindings.
 */
export function useDesktopHistoryNavigation(): void {
  const router = useRouter()

  const go = useEffectEvent((direction: HistoryDirection) => {
    if (direction === "back") {
      if (router.history.canGoBack()) router.history.back()
    } else {
      router.history.forward()
    }
  })

  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes("mac")

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return
      const direction = historyDirectionForKey(event, isMac)
      if (!direction) return
      event.preventDefault()
      go(direction)
    }

    // macOS only: on Windows/Linux the same buttons also raise an app command,
    // which the main process relays, and handling both would step twice.
    // mouseup, not mousedown, keeps it to one step per click.
    const onMouseUp = (event: MouseEvent) => {
      if (!isMac) return
      const direction = historyDirectionForMouseButton(event.button)
      if (!direction) return
      event.preventDefault()
      go(direction)
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("mouseup", onMouseUp)
    const unsubscribe = window.electronAPI?.app?.onHistoryNavigate?.((direction) => go(direction))
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("mouseup", onMouseUp)
      unsubscribe?.()
    }
  }, [])
}
