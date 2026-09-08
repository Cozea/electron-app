import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  _resetDesktopInteractionStoreForTesting,
  beginDesktopInteraction,
} from "../../apps/desktop/src/lib/desktopInteraction/interactionStore"
import {
  initInteractionFrameDiagnostics,
} from "../../apps/desktop/src/lib/performance/interactionFrameDiagnostics"

describe("interactionFrameDiagnostics", () => {
  let cleanup: () => void
  let hadWindow = false

  beforeEach(() => {
    vi.useFakeTimers()
    _resetDesktopInteractionStoreForTesting()
    if (typeof (globalThis as any).window === "undefined") {
      hadWindow = false
      ;(globalThis as any).window = globalThis
    } else {
      hadWindow = true
    }
    cleanup = initInteractionFrameDiagnostics()
  })

  afterEach(() => {
    cleanup()
    _resetDesktopInteractionStoreForTesting()
    if (!hadWindow) {
      delete (globalThis as any).window
    }
    vi.useRealTimers()
  })

  it("exposes __cozeaInteractionPerf and records metrics across interaction lifecycle", () => {
    expect(window.__cozeaInteractionPerf).toBeDefined()
    expect(window.__cozeaInteractionPerf?.getLastSample()).toBeNull()

    const lease = beginDesktopInteraction("sidebar-resize")

    // Advance several frames with simulated time steps
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(16.67)
    }

    // Interaction still active: no completed sample yet
    expect(window.__cozeaInteractionPerf?.getLastSample()).toBeNull()

    // End interaction
    lease.end()

    const sample = window.__cozeaInteractionPerf?.getLastSample()
    expect(sample).not.toBeNull()
    expect(sample?.frameCount).toBeGreaterThan(0)
    expect(sample?.durationMs).toBeGreaterThan(0)
    expect(sample?.activeKinds).toContain("sidebar-resize")
    expect(sample?.p50Ms).toBeGreaterThan(0)
    expect(sample?.p95Ms).toBeGreaterThan(0)
    expect(sample?.estimatedRefreshIntervalMs).toBe(16.67)

    const history = window.__cozeaInteractionPerf?.getHistory()
    expect(history?.length).toBe(1)

    window.__cozeaInteractionPerf?.clear()
    expect(window.__cozeaInteractionPerf?.getLastSample()).toBeNull()
    expect(window.__cozeaInteractionPerf?.getHistory()?.length).toBe(0)
  })
})
