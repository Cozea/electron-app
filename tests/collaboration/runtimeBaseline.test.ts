import { describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import * as Y from "yjs"
import { SessionFileDocument } from "../../shared/SessionFileDocument"

describe("collaboration refactor runtime baseline", () => {
  it("round-trips stable file identity and incremental text with the pinned Yjs runtime", () => {
    const left = new SessionFileDocument("runtime-fixture")
    const right = new SessionFileDocument("runtime-fixture")
    try {
      left.initializeFile({ id: "file_fixture", path: "src/example.ts", originalPath: "src/example.ts", content: "const answer = 41\n" })
      Y.applyUpdate(right.doc, left.checkpoint())
      const vector = Y.encodeStateVector(right.doc)
      left.replaceText("file_fixture", "const answer = 42\n")
      Y.applyUpdate(right.doc, Y.encodeStateAsUpdate(left.doc, vector))
      expect(right.file("file_fixture")).toEqual(left.file("file_fixture"))
      expect(right.file("file_fixture")?.content).toBe("const answer = 42\n")
    } finally { left.destroy(); right.destroy() }
  })

  it("supports the existing Node-SQLite transaction and BLOB APIs without Bun-SQLite", () => {
    const db = new DatabaseSync(":memory:")
    try {
      db.exec("CREATE TABLE fixture (id TEXT PRIMARY KEY, payload BLOB NOT NULL)")
      db.exec("BEGIN IMMEDIATE")
      db.prepare("INSERT INTO fixture VALUES (?, ?)").run("pending", new Uint8Array([1, 2, 3]))
      db.exec("ROLLBACK")
      expect(db.prepare("SELECT COUNT(*) AS count FROM fixture").get()?.count).toBe(0)
      db.exec("BEGIN IMMEDIATE")
      db.prepare("INSERT INTO fixture VALUES (?, ?)").run("accepted", new Uint8Array([4, 5, 6]))
      db.exec("COMMIT")
      const row = db.prepare("SELECT payload FROM fixture WHERE id = ?").get("accepted")
      expect(Array.from(row?.payload as Uint8Array)).toEqual([4, 5, 6])
      expect(db.prepare("SELECT sqlite_version() AS version").get()?.version).toMatch(/^\d+\.\d+\.\d+/)
    } finally { db.close() }
  })
})
