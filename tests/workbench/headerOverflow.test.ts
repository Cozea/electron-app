import { describe, expect, it } from "vitest"
import { resolveHeaderOverflow } from "../../apps/desktop/src/components/layouts/unified-header/headerOverflow"

const items = [
  { id: "changes", width: 80, priority: 80 },
  { id: "editor", width: 50, priority: 30 },
  { id: "share", width: 28, priority: 20 },
]
describe("header space allocation", () => {
  it("accounts for the disclosure and removes secondary actions first", () => {
    expect(resolveHeaderOverflow(items, 140, new Set())).toEqual(new Set(["share", "editor"]))
    expect([...resolveHeaderOverflow(items, 180, new Set())]).toEqual([])
  })
  it("does not oscillate when the width reverses around a threshold", () => {
    let hidden = resolveHeaderOverflow(items, 175, new Set())
    expect(hidden.size).toBeGreaterThan(0)
    const initial = [...hidden]
    for (const width of [176, 175, 177, 174, 179, 175]) {
      hidden = resolveHeaderOverflow(items, width, hidden)
      expect([...hidden]).toEqual(initial)
    }
    expect(resolveHeaderOverflow(items, 220, hidden).size).toBe(0)
  })
  it("keeps a focused action visible and discards removed or empty groups", () => {
    expect(resolveHeaderOverflow([{ ...items[0], pinned: true }, items[1]], 40, new Set()).has("changes")).toBe(false)
    expect([...resolveHeaderOverflow([{ ...items[0], width: 0 }], 0, new Set(["changes", "removed"]))]).toEqual([])
  })
  it("chooses the complete fitting set after a large resize", () => {
    const hidden = resolveHeaderOverflow(items, 35, new Set())
    expect(hidden.size).toBe(3)
    expect(resolveHeaderOverflow(items, 500, hidden).size).toBe(0)
  })
})
