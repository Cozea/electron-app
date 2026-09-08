import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  _resetBrowserSurfaceGeometryRuntimeForTesting,
  clearBrowserSurfaceGeometryOwner,
  getBrowserSurfaceContent,
  getBrowserSurfaceRect,
  registerBrowserSurfaceGeometryOwner,
  setBrowserSurfaceContent,
  setBrowserSurfaceRect,
  subscribeBrowserSurfaceContent,
  subscribeBrowserSurfaceGeometry,
  subscribeBrowserSurfaceRect,
} from "../../apps/desktop/src/features/browser/browserSurfaceGeometryRuntime"
import {
  acquireBrowserSurface,
  useBrowserSurfaceStore,
} from "../../apps/desktop/src/features/browser/browserSurfaceStore"

describe("browserSurfaceGeometryRuntime", () => {
  beforeEach(() => {
    _resetBrowserSurfaceGeometryRuntimeForTesting()
    useBrowserSurfaceStore.setState({ byTabId: {} })
  })

  it("sets and gets rect and notifies listeners only on actual change", () => {
    const owner = Symbol("owner-tab-1")
    registerBrowserSurfaceGeometryOwner("tab-1", owner)

    let rectNotifications = 0
    let geometryNotifications = 0

    const unsubRect = subscribeBrowserSurfaceRect("tab-1", () => {
      rectNotifications++
    })
    const unsubGeom = subscribeBrowserSurfaceGeometry("tab-1", () => {
      geometryNotifications++
    })

    const initialRect = { x: 10, y: 20, width: 300, height: 200 }
    expect(setBrowserSurfaceRect("tab-1", owner, initialRect)).toBe(true)
    expect(getBrowserSurfaceRect("tab-1")).toEqual(initialRect)
    expect(rectNotifications).toBe(1)
    expect(geometryNotifications).toBe(1)

    // Equal rect should suppress notification
    expect(
      setBrowserSurfaceRect("tab-1", owner, {
        x: 10,
        y: 20,
        width: 300,
        height: 200,
      }),
    ).toBe(true)
    expect(rectNotifications).toBe(1)
    expect(geometryNotifications).toBe(1)

    // Different rect notifies
    expect(
      setBrowserSurfaceRect("tab-1", owner, {
        x: 15,
        y: 20,
        width: 300,
        height: 200,
      }),
    ).toBe(true)
    expect(rectNotifications).toBe(2)
    expect(geometryNotifications).toBe(2)

    unsubRect()
    unsubGeom()
  })

  it("isolates notifications per tab (one tab's rect does not notify another tab)", () => {
    const owner1 = Symbol("owner-1")
    const owner2 = Symbol("owner-2")
    registerBrowserSurfaceGeometryOwner("tab-1", owner1)
    registerBrowserSurfaceGeometryOwner("tab-2", owner2)

    let tab1Calls = 0
    let tab2Calls = 0

    subscribeBrowserSurfaceRect("tab-1", () => {
      tab1Calls++
    })
    subscribeBrowserSurfaceRect("tab-2", () => {
      tab2Calls++
    })

    setBrowserSurfaceRect("tab-1", owner1, { x: 0, y: 0, width: 100, height: 100 })
    expect(tab1Calls).toBe(1)
    expect(tab2Calls).toBe(0)

    setBrowserSurfaceRect("tab-2", owner2, { x: 50, y: 50, width: 200, height: 200 })
    expect(tab1Calls).toBe(1)
    expect(tab2Calls).toBe(1)
  })

  it("prevents stale owner from publishing rect", () => {
    const staleOwner = Symbol("stale-owner")
    const activeOwner = Symbol("active-owner")

    registerBrowserSurfaceGeometryOwner("tab-1", staleOwner)
    registerBrowserSurfaceGeometryOwner("tab-1", activeOwner)

    const rect = { x: 0, y: 0, width: 100, height: 100 }
    expect(setBrowserSurfaceRect("tab-1", staleOwner, rect)).toBe(false)
    expect(getBrowserSurfaceRect("tab-1")).toBeNull()

    expect(setBrowserSurfaceRect("tab-1", activeOwner, rect)).toBe(true)
    expect(getBrowserSurfaceRect("tab-1")).toEqual(rect)
  })

  it("clears rect on release through clearBrowserSurfaceGeometryOwner", () => {
    const owner = Symbol("owner")
    registerBrowserSurfaceGeometryOwner("tab-1", owner)
    setBrowserSurfaceRect("tab-1", owner, { x: 0, y: 0, width: 100, height: 100 })
    expect(getBrowserSurfaceRect("tab-1")).not.toBeNull()

    clearBrowserSurfaceGeometryOwner("tab-1", owner)
    expect(getBrowserSurfaceRect("tab-1")).toBeNull()
  })

  it("integrates with acquireBrowserSurface lease and keeps rect changes out of low-frequency Zustand store", () => {
    const lease = acquireBrowserSurface("tab-leased")
    expect(getBrowserSurfaceRect("tab-leased")).toBeNull()

    const storeListener = vi.fn()
    const unsubStore = useBrowserSurfaceStore.subscribe(storeListener)

    // First present sets presentation visible + rect
    lease.present({ x: 0, y: 0, width: 200, height: 100 }, true)
    expect(getBrowserSurfaceRect("tab-leased")).toEqual({ x: 0, y: 0, width: 200, height: 100 })
    const callsAfterFirstPresent = storeListener.mock.calls.length

    // Changing ONLY the rect must NOT emit a new Zustand presentation store change
    lease.present({ x: 10, y: 20, width: 250, height: 120 }, true)
    expect(getBrowserSurfaceRect("tab-leased")).toEqual({ x: 10, y: 20, width: 250, height: 120 })
    expect(storeListener.mock.calls.length).toBe(callsAfterFirstPresent)

    // Releasing clears geometry rect
    lease.release()
    expect(getBrowserSurfaceRect("tab-leased")).toBeNull()

    unsubStore()
  })

  it("handles content presentation subscriptions and exact equality", () => {
    let contentCalls = 0
    subscribeBrowserSurfaceContent("tab-content", () => {
      contentCalls++
    })

    const c1 = { x: 0, y: 0, width: 800, height: 600, scale: 1, scrollLeft: 0, scrollTop: 0 }
    setBrowserSurfaceContent("tab-content", c1)
    expect(getBrowserSurfaceContent("tab-content")).toEqual(c1)
    expect(contentCalls).toBe(1)

    // Equal content does not notify
    setBrowserSurfaceContent("tab-content", { ...c1 })
    expect(contentCalls).toBe(1)

    // Modified scale notifies
    setBrowserSurfaceContent("tab-content", { ...c1, scale: 1.5 })
    expect(contentCalls).toBe(2)
  })

  it("verifies BrowserPreviewActions uses snapshot getter and does not subscribe to store rect", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const code = fs.readFileSync(
      path.resolve(__dirname, "../../apps/desktop/src/features/browser/BrowserPreviewActions.tsx"),
      "utf-8",
    )
    expect(code).toContain("getBrowserSurfaceRect(runtimeTabId)")
    expect(code).not.toContain("store.byTabId[runtimeTabId]?.rect")
  })
})
