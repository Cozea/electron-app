import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  _resetDesktopInteractionStoreForTesting,
  beginDesktopInteraction,
  deferUntilDesktopInteractionIdle,
  getDesktopInteractionSnapshot,
  isDesktopInteractionActive,
  isDesktopInteractionKindActive,
  subscribeDesktopInteraction,
} from "../../apps/desktop/src/lib/desktopInteraction/interactionStore"

describe("desktopInteractionStore", () => {
  const classList = new Set<string>()
  let originalDocument: unknown

  beforeEach(() => {
    vi.useFakeTimers()
    classList.clear()

    originalDocument = globalThis.document
    ;(globalThis as any).document = {
      documentElement: {
        classList: {
          add: (name: string) => classList.add(name),
          remove: (name: string) => classList.delete(name),
          contains: (name: string) => classList.has(name),
        },
        className: "",
      },
    }

    _resetDesktopInteractionStoreForTesting()
  })

  afterEach(() => {
    _resetDesktopInteractionStoreForTesting()
    vi.useRealTimers()
    if (originalDocument === undefined) {
      delete (globalThis as any).document
    } else {
      ;(globalThis as any).document = originalDocument
    }
  })

  it("handles nested same-kind leases correctly", () => {
    expect(isDesktopInteractionActive()).toBe(false)
    expect(isDesktopInteractionKindActive("sidebar-resize")).toBe(false)
    expect(classList.has("cozea-live-interaction")).toBe(false)
    expect(classList.has("cozea-interaction-sidebar-resize")).toBe(false)

    const lease1 = beginDesktopInteraction("sidebar-resize")
    expect(isDesktopInteractionActive()).toBe(true)
    expect(isDesktopInteractionKindActive("sidebar-resize")).toBe(true)
    expect(classList.has("cozea-live-interaction")).toBe(true)
    expect(classList.has("cozea-interaction-sidebar-resize")).toBe(true)

    const lease2 = beginDesktopInteraction("sidebar-resize")
    expect(isDesktopInteractionActive()).toBe(true)
    expect(isDesktopInteractionKindActive("sidebar-resize")).toBe(true)

    // Ending one nested lease should not end the kind or global interaction
    lease1.end()
    expect(isDesktopInteractionActive()).toBe(true)
    expect(isDesktopInteractionKindActive("sidebar-resize")).toBe(true)
    expect(classList.has("cozea-live-interaction")).toBe(true)
    expect(classList.has("cozea-interaction-sidebar-resize")).toBe(true)

    // Ending the final lease should end the kind and global interaction
    lease2.end()
    expect(isDesktopInteractionActive()).toBe(false)
    expect(isDesktopInteractionKindActive("sidebar-resize")).toBe(false)
    expect(classList.has("cozea-live-interaction")).toBe(false)
    expect(classList.has("cozea-interaction-sidebar-resize")).toBe(false)
  })

  it("handles simultaneous different-kind leases", () => {
    const lease1 = beginDesktopInteraction("dockview-sash")
    const lease2 = beginDesktopInteraction("sidebar-resize")

    expect(isDesktopInteractionActive()).toBe(true)
    expect(isDesktopInteractionKindActive("dockview-sash")).toBe(true)
    expect(isDesktopInteractionKindActive("sidebar-resize")).toBe(true)
    expect(classList.has("cozea-live-interaction")).toBe(true)
    expect(classList.has("cozea-interaction-dockview-sash")).toBe(true)
    expect(classList.has("cozea-interaction-sidebar-resize")).toBe(true)

    const snapshot = getDesktopInteractionSnapshot()
    expect(snapshot.has("dockview-sash")).toBe(true)
    expect(snapshot.has("sidebar-resize")).toBe(true)
    expect(snapshot.size).toBe(2)

    // Ending one lease removes only its kind class, preserving global active class
    lease1.end()
    expect(isDesktopInteractionActive()).toBe(true)
    expect(isDesktopInteractionKindActive("dockview-sash")).toBe(false)
    expect(isDesktopInteractionKindActive("sidebar-resize")).toBe(true)
    expect(classList.has("cozea-live-interaction")).toBe(true)
    expect(classList.has("cozea-interaction-dockview-sash")).toBe(false)
    expect(classList.has("cozea-interaction-sidebar-resize")).toBe(true)

    // Ending second lease removes everything
    lease2.end()
    expect(isDesktopInteractionActive()).toBe(false)
    expect(isDesktopInteractionKindActive("sidebar-resize")).toBe(false)
    expect(classList.has("cozea-live-interaction")).toBe(false)
    expect(classList.has("cozea-interaction-sidebar-resize")).toBe(false)
  })

  it("is idempotent on multiple end() calls", () => {
    const lease = beginDesktopInteraction("changes-sidebar-resize")
    expect(isDesktopInteractionActive()).toBe(true)

    lease.end()
    expect(isDesktopInteractionActive()).toBe(false)

    // Second call should no-op without error or count underflow
    lease.end()
    expect(isDesktopInteractionActive()).toBe(false)
    expect(isDesktopInteractionKindActive("changes-sidebar-resize")).toBe(false)
  })

  it("notifies subscribers on interaction changes", () => {
    const events: Array<string[]> = []
    const unsubscribe = subscribeDesktopInteraction(snapshot => {
      events.push(Array.from(snapshot).sort())
    })

    const lease1 = beginDesktopInteraction("native-window-resize")
    const lease2 = beginDesktopInteraction("dockview-sash")
    lease1.end()
    lease2.end()
    unsubscribe()

    expect(events).toEqual([
      ["native-window-resize"],
      ["dockview-sash", "native-window-resize"],
      ["dockview-sash"],
      [],
    ])
  })

  it("deduplicates idle callbacks and executes only on requestAnimationFrame after final interaction", () => {
    let callA = 0
    let callB = 0

    const lease1 = beginDesktopInteraction("native-window-move")
    const lease2 = beginDesktopInteraction("sidebar-resize")

    // Queue two deferred tasks with the same key
    deferUntilDesktopInteractionIdle("task-x", () => {
      callA++
    })
    deferUntilDesktopInteractionIdle("task-x", () => {
      callB++
    })

    // Advance time while interactions are active - callback must NOT run yet
    vi.advanceTimersByTime(200)
    expect(callA).toBe(0)
    expect(callB).toBe(0)

    // End one lease - still not idle
    lease1.end()
    vi.advanceTimersByTime(200)
    expect(callA).toBe(0)
    expect(callB).toBe(0)

    // End final lease - should schedule rAF flush
    lease2.end()
    expect(callA).toBe(0)
    expect(callB).toBe(0)

    // Advance animation frame timer (fake timers advance setTimeout/rAF)
    vi.advanceTimersByTime(16)

    // Latest callback with key "task-x" ran, previous superseded
    expect(callA).toBe(0)
    expect(callB).toBe(1)
  })

  it("allows cancelling deferred idle callbacks", () => {
    let called = 0
    const cancel = deferUntilDesktopInteractionIdle("test-key", () => {
      called++
    })
    cancel()

    vi.advanceTimersByTime(50)
    expect(called).toBe(0)
  })
})
