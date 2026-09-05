import * as Y from "yjs"
import { describe, expect, it } from "vitest"
import { AcknowledgedCollaborationState } from "@/features/collaboration/runtime/AcknowledgedCollaborationState"

function text(update: Uint8Array): string {
  const doc = new Y.Doc()
  try { Y.applyUpdate(doc, update); return doc.getText("text").toString() } finally { doc.destroy() }
}

describe("acknowledged commit state", () => {
  it("captures the exact barrier while later edits continue", () => {
    const source = new Y.Doc()
    const state = new AcknowledgedCollaborationState(Y.encodeStateAsUpdate(source), 0)
    const updates: Uint8Array[] = []
    source.on("update", update => updates.push(update))
    source.getText("text").insert(0, "shared")
    state.apply(1, updates[0]!)
    source.getText("text").insert(6, " later")
    state.apply(2, updates[1]!)
    source.getText("text").insert(12, " unacknowledged")
    expect(text(state.capture(1))).toBe("shared")
    expect(text(state.capture(2))).toBe("shared later")
    state.compact(1)
    expect(text(state.capture(2))).toBe("shared later")
    expect(() => state.capture(0)).toThrow(/not available/)
    state.destroy(); source.destroy()
  })
  it("rejects sequence gaps and ignores replayed updates", () => {
    const doc = new Y.Doc()
    const state = new AcknowledgedCollaborationState(Y.encodeStateAsUpdate(doc), 0)
    let update = new Uint8Array()
    doc.on("update", bytes => { update = bytes })
    doc.getText("text").insert(0, "hello")
    expect(() => state.apply(2, update)).toThrow(/Missing/)
    state.apply(1, update); state.apply(1, update)
    expect(text(state.capture(1))).toBe("hello")
    expect(() => state.capture(2)).toThrow(/not available/)
    state.destroy(); doc.destroy()
  })
})
