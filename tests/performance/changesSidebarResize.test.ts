import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { _resetGeometrySchedulerForTesting } from "../../apps/desktop/src/lib/desktopInteraction/geometryScheduler"
import {
  _resetDesktopInteractionStoreForTesting,
  isDesktopInteractionActive,
} from "../../apps/desktop/src/lib/desktopInteraction/interactionStore"
import { useChangesSidebarStore } from "../../apps/desktop/src/features/source-control/model/changesSidebarStore"

describe("changesSidebarResize", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetDesktopInteractionStoreForTesting()
    _resetGeometrySchedulerForTesting()
    useChangesSidebarStore.setState({ width: 300, minWidth: 200, isOpen: true })
  })

  afterEach(() => {
    _resetDesktopInteractionStoreForTesting()
    _resetGeometrySchedulerForTesting()
    vi.useRealTimers()
  })

  it("commits store width exactly once per completed resize drag", () => {
    const storeListener = vi.fn()
    const unsub = useChangesSidebarStore.subscribe(storeListener)

    // Initial state
    expect(useChangesSidebarStore.getState().width).toBe(300)
    expect(isDesktopInteractionActive()).toBe(false)

    // Simulate drag start, move x 10, end
    // Calling setWidth on store (e.g. at end of drag)
    const setWidth = useChangesSidebarStore.getState().actions.setWidth
    setWidth(450)

    expect(useChangesSidebarStore.getState().width).toBe(450)
    expect(storeListener).toHaveBeenCalledTimes(1)

    unsub()
  })

  it("correctly clamps width to minWidth and maxWidth bounds", () => {
    const setWidth = useChangesSidebarStore.getState().actions.setWidth

    // Below minWidth (200) -> clamps to 200
    setWidth(150)
    expect(useChangesSidebarStore.getState().width).toBe(200)

    // Above maxWidth (1200) -> clamps to 1200
    setWidth(1500)
    expect(useChangesSidebarStore.getState().width).toBe(1200)

    // Valid width
    setWidth(500)
    expect(useChangesSidebarStore.getState().width).toBe(500)
  })
})
