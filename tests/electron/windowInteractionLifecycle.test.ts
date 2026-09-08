import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  attachWindowInteractionLifecycle,
  FALLBACK_COMPLETION_TIMEOUT_MS,
  WINDOW_INTERACTION_CHANNEL,
} from "../../apps/desktop/electron/windowInteractionLifecycle"
import type { NativeDesktopInteractionChange } from "../../shared/desktopInteractionTypes"

class MockBrowserWindow extends EventEmitter {
  isDestroyedFlag = false
  sentIpcMessages: Array<{ channel: string; payload: unknown }> = []

  webContents = {
    send: (channel: string, payload: unknown) => {
      this.sentIpcMessages.push({ channel, payload })
    },
  }

  isDestroyed(): boolean {
    return this.isDestroyedFlag
  }

  destroy(): void {
    this.isDestroyedFlag = true
    this.emit("closed")
  }
}

describe("windowInteractionLifecycle", () => {
  let mockWin: MockBrowserWindow

  beforeEach(() => {
    vi.useFakeTimers()
    mockWin = new MockBrowserWindow()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("produces exactly one start event across repeated resize pulses and one end on resized", () => {
    const detach = attachWindowInteractionLifecycle(mockWin as any)

    // First resize pulse triggers start
    mockWin.emit("will-resize")
    expect(mockWin.sentIpcMessages).toHaveLength(1)
    expect(mockWin.sentIpcMessages[0]).toEqual({
      channel: WINDOW_INTERACTION_CHANNEL,
      payload: { kind: "native-window-resize", active: true },
    })

    // Repeated resize pulses do NOT send duplicate active: true messages
    mockWin.emit("resize")
    mockWin.emit("resize")
    mockWin.emit("resize")
    expect(mockWin.sentIpcMessages).toHaveLength(1)

    // Explicit resized ends the interaction
    mockWin.emit("resized")
    expect(mockWin.sentIpcMessages).toHaveLength(2)
    expect(mockWin.sentIpcMessages[1]).toEqual({
      channel: WINDOW_INTERACTION_CHANNEL,
      payload: { kind: "native-window-resize", active: false },
    })

    detach()
  })

  it("ends interaction via fallback timer if no explicit end event arrives", () => {
    const detach = attachWindowInteractionLifecycle(mockWin as any)

    mockWin.emit("will-resize")
    mockWin.emit("resize")
    expect(mockWin.sentIpcMessages).toHaveLength(1)

    // Within fallback window, pulse keeps it active
    vi.advanceTimersByTime(FALLBACK_COMPLETION_TIMEOUT_MS - 20)
    mockWin.emit("resize")
    expect(mockWin.sentIpcMessages).toHaveLength(1)

    // Let fallback timer expire
    vi.advanceTimersByTime(FALLBACK_COMPLETION_TIMEOUT_MS)
    expect(mockWin.sentIpcMessages).toHaveLength(2)
    expect(mockWin.sentIpcMessages[1]).toEqual({
      channel: WINDOW_INTERACTION_CHANNEL,
      payload: { kind: "native-window-resize", active: false },
    })

    detach()
  })

  it("handles native window move lifecycle with repeated pulses and explicit moved", () => {
    const detach = attachWindowInteractionLifecycle(mockWin as any)

    mockWin.emit("will-move")
    mockWin.emit("move")
    mockWin.emit("move")

    expect(mockWin.sentIpcMessages).toHaveLength(1)
    expect(mockWin.sentIpcMessages[0]).toEqual({
      channel: WINDOW_INTERACTION_CHANNEL,
      payload: { kind: "native-window-move", active: true },
    })

    mockWin.emit("moved")
    expect(mockWin.sentIpcMessages).toHaveLength(2)
    expect(mockWin.sentIpcMessages[1]).toEqual({
      channel: WINDOW_INTERACTION_CHANNEL,
      payload: { kind: "native-window-move", active: false },
    })

    detach()
  })

  it("never sends width, height, x, or y geometry through native interaction IPC", () => {
    const detach = attachWindowInteractionLifecycle(mockWin as any)

    mockWin.emit("will-resize", {}, { width: 1200, height: 800 })
    mockWin.emit("resize", {}, { width: 1220, height: 800 })
    mockWin.emit("resized")

    mockWin.emit("will-move", {}, { x: 100, y: 100 })
    mockWin.emit("move", {}, { x: 150, y: 100 })
    mockWin.emit("moved")

    for (const msg of mockWin.sentIpcMessages) {
      expect(msg.channel).toBe(WINDOW_INTERACTION_CHANNEL)
      const payload = msg.payload as NativeDesktopInteractionChange
      expect(Object.keys(payload).sort()).toEqual(["active", "kind"])
      expect(typeof payload.active).toBe("boolean")
      expect(["native-window-resize", "native-window-move"]).toContain(payload.kind)
      expect((payload as any).width).toBeUndefined()
      expect((payload as any).height).toBeUndefined()
      expect((payload as any).x).toBeUndefined()
      expect((payload as any).y).toBeUndefined()
    }

    detach()
  })

  it("cleans up listeners and timers on detach or window closed", () => {
    const detach = attachWindowInteractionLifecycle(mockWin as any)

    mockWin.emit("will-resize")
    expect(mockWin.listenerCount("resize")).toBeGreaterThan(0)

    detach()
    expect(mockWin.listenerCount("resize")).toBe(0)
    expect(mockWin.listenerCount("move")).toBe(0)

    // Should have sent active: false on detach if active
    const lastMsg = mockWin.sentIpcMessages[mockWin.sentIpcMessages.length - 1]
    expect(lastMsg?.payload).toEqual({
      kind: "native-window-resize",
      active: false,
    })
  })
})
