import { describe, expect, it, vi } from "vitest"

import {
  BrowserAutomationAdapter,
  type BrowserAutomationHost,
  type BrowserAutomationHostTileState,
} from "../../../electron/browser-automation/BrowserAutomationAdapter"
import { buildSnapshotScript } from "../../../electron/browser-automation/pageScripts"

function makeHost(
  initial: BrowserAutomationHostTileState[],
  overrides?: Partial<BrowserAutomationHost>,
): BrowserAutomationHost {
  const tiles = new Map(initial.map((tile) => [tile.tileId, { ...tile }]))

  const host: BrowserAutomationHost = {
    listOpenTiles: () => Array.from(tiles.values()),
    getTileState: (tileId) => tiles.get(tileId) ?? null,
    navigate: async (tileId, url) => {
      const existing = tiles.get(tileId)
      if (!existing) return null
      const next = { ...existing, url, title: `Loaded ${url}`, isLoading: false }
      tiles.set(tileId, next)
      return next
    },
    executeJavaScript: async () => ({
      url: "http://127.0.0.1:5173/",
      title: "Demo",
      visibleText: "Hello agent",
      interactiveElements: [
        { tag: "button", role: "button", name: "Go", selector: "button.primary" },
      ],
    }),
    ...overrides,
  }
  return host
}

describe("BrowserAutomationAdapter", () => {
  it("reports disabled status when flag is off", () => {
    const adapter = new BrowserAutomationAdapter({
      host: makeHost([{ tileId: "t1", url: "http://127.0.0.1:1", title: "", isLoading: false }]),
      isEnabled: () => false,
    })
    const status = adapter.status()
    expect(status.ok).toBe(true)
    expect(status.result?.enabled).toBe(false)
    expect(status.result?.flag).toBe("cozea.browser.agentAutomation")
    expect(status.result?.openTiles).toEqual([])
  })

  it("lists open tiles when enabled", () => {
    const adapter = new BrowserAutomationAdapter({
      host: makeHost([
        { tileId: "t1", url: "http://127.0.0.1:5173/", title: "App", isLoading: false },
      ]),
      isEnabled: () => true,
    })
    const status = adapter.status()
    expect(status.result?.enabled).toBe(true)
    expect(status.result?.openTiles).toHaveLength(1)
    expect(status.result?.openTiles[0]?.tileId).toBe("t1")
  })

  it("refuses navigate when disabled", async () => {
    const adapter = new BrowserAutomationAdapter({
      host: makeHost([{ tileId: "t1", url: "about:blank", title: "", isLoading: false }]),
      isEnabled: () => false,
    })
    const result = await adapter.navigate({ tileId: "t1", url: "http://localhost:5173" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("disabled")
  })

  it("refuses navigate on tiles that are not already open", async () => {
    const adapter = new BrowserAutomationAdapter({
      host: makeHost([]),
      isEnabled: () => true,
    })
    const result = await adapter.navigate({ tileId: "missing", url: "http://localhost:5173" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("tile_not_open")
  })

  it("refuses non-loopback navigate URLs", async () => {
    const adapter = new BrowserAutomationAdapter({
      host: makeHost([{ tileId: "t1", url: "about:blank", title: "", isLoading: false }]),
      isEnabled: () => true,
    })
    const result = await adapter.navigate({ tileId: "t1", url: "https://example.com" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("url_not_allowed")
  })

  it("navigates loopback URLs on open tiles", async () => {
    const adapter = new BrowserAutomationAdapter({
      host: makeHost([{ tileId: "t1", url: "about:blank", title: "", isLoading: false }]),
      isEnabled: () => true,
    })
    const result = await adapter.navigate({ tileId: "t1", url: "localhost:5173/demo" })
    expect(result.ok).toBe(true)
    expect(result.result?.url).toContain("http://localhost:5173/demo")
  })

  it("returns title and visible text from snapshot", async () => {
    const executeJavaScript = vi.fn(async (_tileId: string, script: string) => {
      expect(script).toContain("interactiveElements")
      expect(script).toBe(buildSnapshotScript())
      return {
        url: "http://127.0.0.1:5173/",
        title: "Preview",
        visibleText: "Welcome",
        interactiveElements: [],
      }
    })
    const adapter = new BrowserAutomationAdapter({
      host: makeHost(
        [{ tileId: "t1", url: "http://127.0.0.1:5173/", title: "Old", isLoading: false }],
        { executeJavaScript },
      ),
      isEnabled: () => true,
    })
    const result = await adapter.snapshot({ tileId: "t1" })
    expect(result.ok).toBe(true)
    expect(result.result?.title).toBe("Preview")
    expect(result.result?.visibleText).toBe("Welcome")
  })

  it("clicks by CSS selector", async () => {
    const executeJavaScript = vi.fn(async () => ({ ok: true }))
    const adapter = new BrowserAutomationAdapter({
      host: makeHost(
        [{ tileId: "t1", url: "http://127.0.0.1:5173/", title: "App", isLoading: false }],
        { executeJavaScript },
      ),
      isEnabled: () => true,
    })
    const result = await adapter.click({ tileId: "t1", selector: "button.primary" })
    expect(result.ok).toBe(true)
    expect(executeJavaScript).toHaveBeenCalledOnce()
    const script = executeJavaScript.mock.calls[0]?.[1] as string
    expect(script).toContain("button.primary")
  })

  it("maps missing click targets", async () => {
    const adapter = new BrowserAutomationAdapter({
      host: makeHost(
        [{ tileId: "t1", url: "http://127.0.0.1:5173/", title: "App", isLoading: false }],
        { executeJavaScript: async () => ({ ok: false, error: "not_found" }) },
      ),
      isEnabled: () => true,
    })
    const result = await adapter.click({ tileId: "t1", selector: "#missing" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("target_not_found")
  })

  it("types into an editable selector", async () => {
    const executeJavaScript = vi.fn(async () => ({ ok: true }))
    const adapter = new BrowserAutomationAdapter({
      host: makeHost(
        [{ tileId: "t1", url: "http://127.0.0.1:5173/", title: "App", isLoading: false }],
        { executeJavaScript },
      ),
      isEnabled: () => true,
    })
    const result = await adapter.type({
      tileId: "t1",
      selector: "input[name='q']",
      text: "hello",
      clear: true,
    })
    expect(result.ok).toBe(true)
    const script = executeJavaScript.mock.calls[0]?.[1] as string
    expect(script).toContain("input[name=\\'q\\']")
    expect(script).toContain("hello")
  })

  it("maps non-editable type targets", async () => {
    const adapter = new BrowserAutomationAdapter({
      host: makeHost(
        [{ tileId: "t1", url: "http://127.0.0.1:5173/", title: "App", isLoading: false }],
        { executeJavaScript: async () => ({ ok: false, error: "not_editable" }) },
      ),
      isEnabled: () => true,
    })
    const result = await adapter.type({ tileId: "t1", text: "x" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("target_not_editable")
  })
})
