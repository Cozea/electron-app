import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { _resetGeometrySchedulerForTesting } from "../../apps/desktop/src/lib/desktopInteraction/geometryScheduler"
import {
  _resetDesktopInteractionStoreForTesting,
  beginDesktopInteraction,
} from "../../apps/desktop/src/lib/desktopInteraction/interactionStore"
import { createTerminalResizeCoordinator } from "../../apps/desktop/src/features/terminal/terminalResizeCoordinator"

describe("terminalResizeCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetDesktopInteractionStoreForTesting()
    _resetGeometrySchedulerForTesting()
  })

  afterEach(() => {
    _resetDesktopInteractionStoreForTesting()
    _resetGeometrySchedulerForTesting()
    vi.useRealTimers()
  })

  it("coalesces 10 container notifications before rAF into exactly one visual fit", () => {
    let fitCount = 0
    const mockContainer = {
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
    } as unknown as HTMLElement

    const coordinator = createTerminalResizeCoordinator({
      name: "test-term-1",
      container: mockContainer,
      fit: () => {
        fitCount++
      },
      getBufferState: () => ({ wasAtBottom: true }),
      scrollToBottom: vi.fn(),
      getDimensions: () => ({ cols: 80, rows: 24 }),
      onSendPtyResize: vi.fn(),
    })

    // Fire 10 container resize notifications rapidly
    for (let i = 0; i < 10; i++) {
      coordinator.onContainerResize({ width: 800 + i * 2, height: 600 })
    }

    // No fit before frame executes
    expect(fitCount).toBe(0)

    // Advance frame
    vi.advanceTimersByTime(16)
    expect(fitCount).toBe(1)

    coordinator.dispose()
  })

  it("suppresses backend PTY resize when cols and rows are unchanged", () => {
    const ptySends: Array<{ cols: number; rows: number }> = []
    const mockContainer = {
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
    } as unknown as HTMLElement

    const coordinator = createTerminalResizeCoordinator({
      name: "test-term-2",
      container: mockContainer,
      fit: vi.fn(),
      getBufferState: () => ({ wasAtBottom: true }),
      scrollToBottom: vi.fn(),
      getDimensions: () => ({ cols: 80, rows: 24 }),
      onSendPtyResize: (size) => ptySends.push(size),
    })

    coordinator.onContainerResize({ width: 800, height: 600 })
    vi.advanceTimersByTime(16)
    expect(ptySends).toEqual([{ cols: 80, rows: 24 }])

    // Another resize that results in the exact same cols and rows must send nothing
    coordinator.onContainerResize({ width: 805, height: 600 })
    vi.advanceTimersByTime(16)
    expect(ptySends).toHaveLength(1)

    coordinator.dispose()
  })

  it("throttles PTY resize IPC to <= 1 send per 100ms while desktop interaction is active", () => {
    const ptySends: Array<{ cols: number; rows: number }> = []
    let currentCols = 80
    const mockContainer = {
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
    } as unknown as HTMLElement

    const coordinator = createTerminalResizeCoordinator({
      name: "test-term-3",
      container: mockContainer,
      fit: vi.fn(),
      getBufferState: () => ({ wasAtBottom: true }),
      scrollToBottom: vi.fn(),
      getDimensions: () => ({ cols: currentCols, rows: 24 }),
      onSendPtyResize: (size) => ptySends.push(size),
    })

    const lease = beginDesktopInteraction("dockview-sash")

    // First resize sends immediately as initial sample
    coordinator.onContainerResize({ width: 800, height: 600 })
    vi.advanceTimersByTime(16)
    expect(ptySends).toHaveLength(1)
    expect(ptySends[0]).toEqual({ cols: 80, rows: 24 })

    // Repeated resizes every 16ms within the 100ms window
    for (let i = 1; i <= 5; i++) {
      currentCols = 80 + i
      coordinator.onContainerResize({ width: 800 + i * 20, height: 600 })
      vi.advanceTimersByTime(16)
    }

    // Still throttled: only 1 send happened so far
    expect(ptySends).toHaveLength(1)

    // Advance past 100ms throttle timer
    vi.advanceTimersByTime(40)
    // Throttle fired with latest pending size
    expect(ptySends).toHaveLength(2)
    expect(ptySends[1]).toEqual({ cols: 85, rows: 24 })

    lease.end()
    coordinator.dispose()
  })

  it("flushes exact final PTY size immediately when desktop interaction ends", () => {
    const ptySends: Array<{ cols: number; rows: number }> = []
    let currentCols = 80
    const mockContainer = {
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
    } as unknown as HTMLElement

    const coordinator = createTerminalResizeCoordinator({
      name: "test-term-4",
      container: mockContainer,
      fit: vi.fn(),
      getBufferState: () => ({ wasAtBottom: true }),
      scrollToBottom: vi.fn(),
      getDimensions: () => ({ cols: currentCols, rows: 24 }),
      onSendPtyResize: (size) => ptySends.push(size),
    })

    const lease = beginDesktopInteraction("dockview-sash")

    coordinator.onContainerResize({ width: 800, height: 600 })
    vi.advanceTimersByTime(16)
    expect(ptySends).toHaveLength(1)

    // Intermediate changes
    currentCols = 90
    coordinator.onContainerResize({ width: 900, height: 600 })
    vi.advanceTimersByTime(16)

    currentCols = 100
    coordinator.onContainerResize({ width: 1000, height: 600 })
    vi.advanceTimersByTime(16)

    // Ending the interaction must flush exact final size immediately without waiting for throttle timeout
    lease.end()
    expect(ptySends).toHaveLength(2)
    expect(ptySends[1]).toEqual({ cols: 100, rows: 24 })

    coordinator.dispose()
  })
})
