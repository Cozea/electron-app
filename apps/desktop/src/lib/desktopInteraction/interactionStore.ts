import type { DesktopInteractionKind } from "../../../../../shared/desktopInteractionTypes"

export type { DesktopInteractionKind }

type InteractionId = number

export interface DesktopInteractionLease {
  readonly id: InteractionId
  readonly kind: DesktopInteractionKind
  end(): void
}

type InteractionListener = (
  activeKinds: ReadonlySet<DesktopInteractionKind>,
) => void

let nextInteractionId: InteractionId = 1
const activeLeases = new Map<InteractionId, DesktopInteractionKind>()
const kindCounts = new Map<DesktopInteractionKind, number>()
const listeners = new Set<InteractionListener>()
const deferredCallbacks = new Map<string | symbol, () => void>()

let pendingIdleRafId: number | null = null

function getRaf(): (callback: FrameRequestCallback) => number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame
  }
  return (cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number
}

function getCaf(): (handle: number) => void {
  if (typeof cancelAnimationFrame === "function") {
    return cancelAnimationFrame
  }
  return (id: number) => clearTimeout(id as unknown as NodeJS.Timeout)
}

function addDomClass(className: string): void {
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.classList.add(className)
  }
}

function removeDomClass(className: string): void {
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.classList.remove(className)
  }
}

function notifyListeners(): void {
  if (listeners.size === 0) return
  const snapshot = getDesktopInteractionSnapshot()
  for (const listener of listeners) {
    try {
      listener(snapshot)
    } catch (error) {
      console.error("[interactionStore] Listener error:", error)
    }
  }
}

function scheduleIdleFlush(): void {
  if (pendingIdleRafId !== null) return
  const rAF = getRaf()
  pendingIdleRafId = rAF(() => {
    pendingIdleRafId = null
    if (activeLeases.size > 0) {
      // Interaction became active again before the frame arrived; wait until idle
      return
    }
    flushDeferredCallbacks()
  })
}

function flushDeferredCallbacks(): void {
  if (deferredCallbacks.size === 0) return
  const callbacks = Array.from(deferredCallbacks.values())
  deferredCallbacks.clear()
  for (const cb of callbacks) {
    try {
      cb()
    } catch (error) {
      console.error("[interactionStore] Deferred callback error:", error)
    }
  }
}

export function beginDesktopInteraction(
  kind: DesktopInteractionKind,
): DesktopInteractionLease {
  const id = nextInteractionId++
  let isEnded = false

  const isFirstGlobal = activeLeases.size === 0
  const currentKindCount = kindCounts.get(kind) ?? 0

  activeLeases.set(id, kind)
  kindCounts.set(kind, currentKindCount + 1)

  if (isFirstGlobal) {
    addDomClass("cozea-live-interaction")
  }
  if (currentKindCount === 0) {
    addDomClass(`cozea-interaction-${kind}`)
  }

  notifyListeners()

  const lease: DesktopInteractionLease = {
    id,
    kind,
    end() {
      if (isEnded) return
      isEnded = true

      activeLeases.delete(id)
      const count = kindCounts.get(kind) ?? 1
      if (count <= 1) {
        kindCounts.delete(kind)
        removeDomClass(`cozea-interaction-${kind}`)
      } else {
        kindCounts.set(kind, count - 1)
      }

      if (activeLeases.size === 0) {
        removeDomClass("cozea-live-interaction")
        scheduleIdleFlush()
      }

      notifyListeners()
    },
  }

  return lease
}

export function isDesktopInteractionActive(): boolean {
  return activeLeases.size > 0
}

export function isDesktopInteractionKindActive(
  kind: DesktopInteractionKind,
): boolean {
  return (kindCounts.get(kind) ?? 0) > 0
}

export function subscribeDesktopInteraction(
  listener: InteractionListener,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getDesktopInteractionSnapshot(): ReadonlySet<DesktopInteractionKind> {
  const activeSet = new Set<DesktopInteractionKind>()
  for (const [kind, count] of kindCounts.entries()) {
    if (count > 0) {
      activeSet.add(kind)
    }
  }
  return activeSet
}

export function deferUntilDesktopInteractionIdle(
  key: string | symbol,
  callback: () => void,
): () => void {
  deferredCallbacks.set(key, callback)

  if (activeLeases.size === 0) {
    scheduleIdleFlush()
  }

  return () => {
    if (deferredCallbacks.get(key) === callback) {
      deferredCallbacks.delete(key)
    }
  }
}

/** Testing helper to reset all state between tests */
export function _resetDesktopInteractionStoreForTesting(): void {
  if (pendingIdleRafId !== null) {
    getCaf()(pendingIdleRafId)
    pendingIdleRafId = null
  }
  activeLeases.clear()
  kindCounts.clear()
  listeners.clear()
  deferredCallbacks.clear()
  nextInteractionId = 1
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.className = document.documentElement.className
      .split(/\s+/)
      .filter(
        c => c !== "cozea-live-interaction" && !c.startsWith("cozea-interaction-"),
      )
      .join(" ")
  }
}
