import type {
  NativeDesktopInteractionChange,
  NativeDesktopInteractionKind,
} from "../../../../../shared/desktopInteractionTypes"
import {
  beginDesktopInteraction,
  type DesktopInteractionLease,
} from "./interactionStore"

export function initNativeWindowInteractionBridge(): () => void {
  if (
    typeof window === "undefined" ||
    !window.electronAPI?.window?.onInteractionChange
  ) {
    return () => {}
  }

  const activeLeases = new Map<
    NativeDesktopInteractionKind,
    DesktopInteractionLease
  >()

  const cleanup = window.electronAPI.window.onInteractionChange(
    (change: NativeDesktopInteractionChange) => {
      const existing = activeLeases.get(change.kind)

      if (change.active) {
        if (!existing) {
          const lease = beginDesktopInteraction(change.kind)
          activeLeases.set(change.kind, lease)
        }
      } else {
        if (existing) {
          activeLeases.delete(change.kind)
          existing.end()
        }
      }
    },
  )

  return () => {
    cleanup()
    for (const lease of activeLeases.values()) {
      lease.end()
    }
    activeLeases.clear()
  }
}
