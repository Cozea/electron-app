import * as Y from "yjs"
import { describe, expect, it } from "vitest"
import { SessionFileDocument } from "../../shared/SessionFileDocument"

function pair() {
  const canonical = new SessionFileDocument("s")
  canonical.initializeFile({ id: "file1", path: "a.txt", originalPath: "a.txt", content: "hello world" })
  const a = new SessionFileDocument("s"), b = new SessionFileDocument("s")
  Y.applyUpdate(a.doc, canonical.checkpoint())
  Y.applyUpdate(b.doc, canonical.checkpoint())
  canonical.destroy()
  return { a, b, merge() { const ua = a.checkpoint(), ub = b.checkpoint(); Y.applyUpdate(a.doc, ub); Y.applyUpdate(b.doc, ua) } }
}

describe("session file CRDT identities", () => {
  it("converges concurrent edits and a rename without replacing the text identity", () => {
    const p = pair()
    const text = p.a.text("file1")
    p.a.renameFile("file1", "renamed.txt")
    p.b.text("file1").insert(5, " shared")
    p.merge()
    expect(p.a.text("file1")).toBe(text)
    expect(p.a.files()).toEqual(p.b.files())
    expect(p.a.snapshotChanges()).toEqual([{ path: "a.txt", content: null }, { path: "renamed.txt", content: "hello shared world", executable: false }])
    p.a.destroy(); p.b.destroy()
  })

  it("retains a concurrent edit after deletion for explicit recovery", () => {
    const p = pair()
    p.a.deleteFile("file1")
    p.b.text("file1").insert(11, " from offline")
    p.merge()
    expect(p.a.snapshotChanges()).toEqual([{ path: "a.txt", content: null }])
    expect(p.a.file("file1")?.content).toBe("hello world from offline")
    p.a.restoreFile("file1", "recovered.txt")
    p.merge()
    expect(p.a.files()).toEqual(p.b.files())
    expect(p.b.resolvePath("recovered.txt")?.content).toBe("hello world from offline")
    p.a.destroy(); p.b.destroy()
  })

  it("makes concurrent path collisions visible without losing either file", () => {
    const p = pair()
    p.a.initializeFile({ id: "new-a", path: "new.txt", content: "first device" })
    p.b.initializeFile({ id: "new-b", path: "NEW.txt", content: "second device" })
    p.merge()
    expect(p.a.pathConflicts()[0]?.fileIds.sort()).toEqual(["new-a", "new-b"])
    expect(() => p.a.snapshotChanges()).toThrow("collisions")
    p.a.renameFile("new-b", "second.txt")
    p.merge()
    expect(p.a.pathConflicts()).toEqual([])
    expect(p.b.resolvePath("second.txt")?.content).toBe("second device")
    p.a.destroy(); p.b.destroy()
  })

  it("reconciles a stale formatter write against the projected state without deleting newer shared edits", () => {
    const p = pair()
    const projected = p.a.checkpoint()
    p.b.text("file1").insert(5, " from collaborator")
    Y.applyUpdate(p.a.doc, p.b.checkpoint())
    p.a.reconcileExternalWrite("file1", "hello WORLD", projected)
    p.merge()
    expect(p.a.text("file1").toString()).toBe("hello from collaborator WORLD")
    expect(p.a.files()).toEqual(p.b.files())
    p.a.destroy(); p.b.destroy()
  })

  it("accepts an older offline edit after a checkpoint while preserving removed text identities", () => {
    const p = pair()
    p.a.text("file1").delete(0, 5)
    const checkpoint = p.a.checkpoint()
    p.b.text("file1").insert(5, " offline")
    const recovered = new SessionFileDocument("s")
    Y.applyUpdate(recovered.doc, checkpoint)
    Y.applyUpdate(recovered.doc, p.b.checkpoint())
    expect(recovered.text("file1").toString()).toBe(" offline world")
    p.a.destroy(); p.b.destroy(); recovered.destroy()
  })
})
