import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { AcknowledgedCollaborationState } from "../../shared/AcknowledgedCollaborationState"

function contents(update: Uint8Array): string {
  const doc = new Y.Doc()
  try { Y.applyUpdate(doc, update); return doc.getText("file").toString() }
  finally { doc.destroy() }
}
describe("acknowledged snapshots pinned across asynchronous commit barriers", () => {
  it("T09 defers local compaction until every pending capture releases its baseline", () => {
    const doc = new Y.Doc({ gc: false })
    const state = new AcknowledgedCollaborationState(Y.encodeStateAsUpdate(doc), 0)
    try {
      const updates: Uint8Array[] = []; doc.on("update", update => updates.push(update))
      const release0 = state.pin()
      doc.getText("file").insert(0, "one"); state.apply(1, updates.shift()!)
      const release1 = state.pin()
      doc.getText("file").insert(3, " two"); state.apply(2, updates.shift()!)
      state.compact(2)
      expect(contents(state.capture(0))).toBe("")
      expect(contents(state.capture(1))).toBe("one")
      release0()
      expect(() => state.capture(0)).toThrow("not available")
      expect(contents(state.capture(1))).toBe("one")
      release1(); release1()
      expect(() => state.capture(1)).toThrow("not available")
      expect(contents(state.capture(2))).toBe("one two")
      state.compact(1) // Older completion must not move the baseline backwards.
      expect(contents(state.capture(2))).toBe("one two")
    } finally { state.destroy(); doc.destroy() }
  })
})
