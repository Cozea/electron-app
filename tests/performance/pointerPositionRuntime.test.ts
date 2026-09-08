import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  _resetGlobalPointerPositionRuntimeForTesting,
  getGlobalPointerPosition,
  initGlobalPointerPositionTracking,
  isPointInsideRect,
  subscribeGlobalPointerPosition,
} from "../../apps/desktop/src/lib/pointer/pointerPositionRuntime"

describe("pointerPositionRuntime", () => {
  let originalDocument: unknown

  beforeEach(() => {
    _resetGlobalPointerPositionRuntimeForTesting()
    originalDocument = globalThis.document

    const listeners = new Map<string, Function[]>()
    ;(globalThis as any).document = {
      addEventListener: (type: string, listener: Function) => {
        const arr = listeners.get(type) ?? []
        arr.push(listener)
        listeners.set(type, arr)
      },
      removeEventListener: (type: string, listener: Function) => {
        const arr = listeners.get(type) ?? []
        const filtered = arr.filter((l) => l !== listener)
        listeners.set(type, filtered)
      },
      _dispatch: (type: string, evt: any) => {
        const arr = listeners.get(type) ?? []
        for (const l of arr) l(evt)
      },
    }
  })

  afterEach(() => {
    _resetGlobalPointerPositionRuntimeForTesting()
    if (originalDocument === undefined) {
      delete (globalThis as any).document
    } else {
      ;(globalThis as any).document = originalDocument
    }
  })

  it("initializes and tracks pointermove and pointerdown with monotonic revisions", () => {
    const cleanup = initGlobalPointerPositionTracking()

    const initial = getGlobalPointerPosition()
    expect(initial.revision).toBe(0)

    const updates: number[] = []
    const unsub = subscribeGlobalPointerPosition((pos) => {
      updates.push(pos.revision)
    })

    ;(globalThis.document as any)._dispatch("pointermove", { clientX: 150, clientY: 250 })
    expect(getGlobalPointerPosition()).toEqual({
      clientX: 150,
      clientY: 250,
      revision: 1,
    })
    expect(updates).toEqual([1])

    ;(globalThis.document as any)._dispatch("pointerdown", { clientX: 160, clientY: 260 })
    expect(getGlobalPointerPosition()).toEqual({
      clientX: 160,
      clientY: 260,
      revision: 2,
    })
    expect(updates).toEqual([1, 2])

    unsub()
    cleanup()
  })

  it("correctly determines whether point is inside rect", () => {
    const rect = { left: 100, right: 300, top: 50, bottom: 200 }
    expect(isPointInsideRect(150, 100, rect)).toBe(true)
    expect(isPointInsideRect(100, 50, rect)).toBe(true)
    expect(isPointInsideRect(300, 200, rect)).toBe(true)
    expect(isPointInsideRect(99, 100, rect)).toBe(false)
    expect(isPointInsideRect(301, 100, rect)).toBe(false)
    expect(isPointInsideRect(150, 49, rect)).toBe(false)
    expect(isPointInsideRect(150, 201, rect)).toBe(false)
  })
})
