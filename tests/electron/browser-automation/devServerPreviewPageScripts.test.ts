import { describe, expect, it } from "vitest"

import {
  buildDevServerPreviewClickScript,
  buildDevServerPreviewScrollScript,
  buildDevServerPreviewTypeScript,
  buildDevServerPreviewWaitForScript,
} from "../../../apps/desktop/electron/browser-automation/devServerPreviewPageScripts"

function expectValidExpression(script: string): void {
  expect(() => new Function(`return ${script}`)).not.toThrow()
}

describe("Dev Server preview page scripts", () => {
  it("keeps selector and text input inside serialized literals", () => {
    const selector = `button[data-label='";globalThis.injected=true;//']`
    const text = `hello "world"\n</script>`
    const click = buildDevServerPreviewClickScript({ selector })
    const type = buildDevServerPreviewTypeScript({ selector, text, clear: true, tileId: "tile" })

    expect(click).toContain(JSON.stringify(selector))
    expect(type).toContain(JSON.stringify(text))
    expectValidExpression(click)
    expectValidExpression(type)
  })

  it("uses the native value setter for each supported form control", () => {
    const script = buildDevServerPreviewTypeScript({
      tileId: "tile",
      locator: "role=combobox[name='Theme']",
      text: "dark",
    })

    expect(script).toContain("HTMLInputElement.prototype")
    expect(script).toContain("HTMLTextAreaElement.prototype")
    expect(script).toContain("HTMLSelectElement.prototype")
    expectValidExpression(script)
  })

  it("normalizes non-finite scroll and timeout values to safe defaults", () => {
    const scroll = buildDevServerPreviewScrollScript({
      tileId: "tile",
      deltaX: Number.POSITIVE_INFINITY,
      deltaY: Number.NaN,
    })
    const wait = buildDevServerPreviewWaitForScript({
      tileId: "tile",
      timeoutMs: Number.NaN,
      text: "Ready",
    })

    expect(scroll).not.toMatch(/Infinity|NaN/)
    expect(wait).not.toMatch(/Infinity|NaN/)
    expect(wait).toContain("15000")
    expectValidExpression(scroll)
    expectValidExpression(wait)
  })
})
