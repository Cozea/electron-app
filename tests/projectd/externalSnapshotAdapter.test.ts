import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { BoundedDiff } from "../../apps/projectd/src/collaboration/BoundedDiff"
import { BaselineStore } from "../../apps/projectd/src/collaboration/BaselineStore"
import { ExternalSnapshotAdapter } from "../../apps/projectd/src/collaboration/ExternalSnapshotAdapter"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { OutboundBatchQueue } from "../../apps/projectd/src/collaboration/OutboundBatchQueue"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import type { ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"

describe("P08 snapshot-anchored filesystem -> CRDT adapter", () => {
  const actorExternal: ChangeActor = { actorType: "external" }

  const tmpDir = "/tmp"
  let testDbPath: string
  let db: ProjectdDatabase

  beforeEach(() => {
    testDbPath = path.join(tmpDir, `test_p08_db_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`)
    db = new ProjectdDatabase(testDbPath)
  })

  afterEach(() => {
    if (db) {
      db.close()
    }
    for (const p of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        // Ignore
      }
    }
  })

  // ─── CRITICAL CONCURRENCY TEST (Section 10.11 - 10.12) ────────────────────────
  it("merges external save D based on baseline B with concurrent remote update C", () => {
    const replica = new SessionReplica("session_p08", "local_replica")
    const baselineStore = new BaselineStore()
    const adapter = new ExternalSnapshotAdapter({ replica, baselineStore })

    // 1. Initial file creation: B = "hello world"
    const file = replica.createFile({
      path: "greeting.txt",
      kind: "text",
      content: "hello world",
      actor: actorExternal,
    })
    adapter.initializeBaseline(file.fileId, "hello world")

    expect(replica.textDocs.getTextContent(file.fileId)).toBe("hello world")

    // 2. Remote update arrives: advances live CRDT C to "hello amazing world"
    const liveDoc = replica.textDocs.getOrCreate(file.fileId)
    liveDoc.text.insert(5, " amazing")
    expect(replica.textDocs.getTextContent(file.fileId)).toBe("hello amazing world")

    // 3. External editor (e.g. VS Code), which had opened B ("hello world"), saves D = "hello world!"
    const res = adapter.applyExternalDiskChange({
      fileId: file.fileId,
      diskText: "hello world!",
      actor: actorExternal,
    })

    // 4. Critical assertion: The generated update must merge cleanly using B's Yjs ancestry!
    // Resulting text must preserve remote edit " amazing " AND include external "!"
    const converged = replica.textDocs.getTextContent(file.fileId)
    expect(converged).toBe("hello amazing world!")
    expect(res.isNoop).toBe(false)
    expect(res.update.length).toBeGreaterThan(0)
  })

  it("produces micro-granular Yjs updates for single character insertions and deletions", () => {
    const replica = new SessionReplica("session_p08", "local_replica")
    const baselineStore = new BaselineStore()
    const adapter = new ExternalSnapshotAdapter({ replica, baselineStore })

    const file = replica.createFile({
      path: "app.ts",
      kind: "text",
      content: "const count = 1;",
      actor: actorExternal,
    })
    adapter.initializeBaseline(file.fileId, "const count = 1;")

    // Insert single character '0' -> "const count = 10;"
    const insertRes = adapter.applyExternalDiskChange({
      fileId: file.fileId,
      diskText: "const count = 10;",
      actor: actorExternal,
    })

    expect(insertRes.convergedText).toBe("const count = 10;")
    // Update should be small (micro-granular delta, not full document replacement)
    expect(insertRes.update.length).toBeLessThan(100)

    // Delete single character '0' -> "const count = 1;"
    const deleteRes = adapter.applyExternalDiskChange({
      fileId: file.fileId,
      diskText: "const count = 1;",
      actor: actorExternal,
    })

    expect(deleteRes.convergedText).toBe("const count = 1;")
    expect(deleteRes.update.length).toBeLessThan(100)
  })

  it("handles Unicode and multi-byte emojis cleanly without surrogate corruption", () => {
    const replica = new SessionReplica("session_p08", "local_replica")
    const baselineStore = new BaselineStore()
    const adapter = new ExternalSnapshotAdapter({ replica, baselineStore })

    const initial = "Ready for launch 🚀 today!"
    const file = replica.createFile({
      path: "status.txt",
      kind: "text",
      content: initial,
      actor: actorExternal,
    })
    adapter.initializeBaseline(file.fileId, initial)

    // Add another emoji in the middle
    const edited = "Ready for launch 🚀 and celebration 🎉 today!"
    const res = adapter.applyExternalDiskChange({
      fileId: file.fileId,
      diskText: edited,
      actor: actorExternal,
    })

    expect(res.convergedText).toBe(edited)
    expect(res.convergedText).toContain("🚀")
    expect(res.convergedText).toContain("🎉")
  })

  it("handles newline and EOL changes properly", () => {
    const replica = new SessionReplica("session_p08", "local_replica")
    const baselineStore = new BaselineStore()
    const adapter = new ExternalSnapshotAdapter({ replica, baselineStore })

    const file = replica.createFile({
      path: "lines.txt",
      kind: "text",
      content: "line1\nline2\nline3\n",
      actor: actorExternal,
    })
    adapter.initializeBaseline(file.fileId, "line1\nline2\nline3\n")

    const res = adapter.applyExternalDiskChange({
      fileId: file.fileId,
      diskText: "line1\r\nline2\r\nline3\r\n",
      actor: actorExternal,
    })

    expect(res.convergedText).toBe("line1\r\nline2\r\nline3\r\n")
  })

  it("handles whole-file code formatting rewrites", () => {
    const replica = new SessionReplica("session_p08", "local_replica")
    const baselineStore = new BaselineStore()
    const adapter = new ExternalSnapshotAdapter({ replica, baselineStore })

    const unformatted = `function add(a,b){return a+b}`
    const file = replica.createFile({
      path: "math.ts",
      kind: "text",
      content: unformatted,
      actor: actorExternal,
    })
    adapter.initializeBaseline(file.fileId, unformatted)

    const formatted = `function add(a: number, b: number): number {\n  return a + b;\n}\n`
    const res = adapter.applyExternalDiskChange({
      fileId: file.fileId,
      diskText: formatted,
      actor: actorExternal,
    })

    expect(res.convergedText).toBe(formatted)
  })

  it("falls back gracefully on pathological diffs using prefix/suffix trimming", () => {
    const diff = new BoundedDiff({ timeoutMs: 1 }) // Ultra short timeout to force fallback

    const strA = "A".repeat(10_000) + "MIDDLE_OLD" + "Z".repeat(10_000)
    const strB = "A".repeat(10_000) + "MIDDLE_NEW" + "Z".repeat(10_000)

    const ops = diff.computePrefixSuffixFallback(strA, strB)

    // Must preserve common prefix of 10,000 'A's and suffix of 10,000 'Z's
    const prefixOp = ops.find((o) => o.op === "equal" && o.text.startsWith("AAAA"))
    const suffixOp = ops.find((o) => o.op === "equal" && o.text.startsWith("ZZZZ"))

    expect(prefixOp).toBeDefined()
    expect(suffixOp).toBeDefined()
    expect(prefixOp?.text.length).toBe(10_007)
    expect(suffixOp?.text.length).toBe(10_000)
  })

  it("enqueues and persists outbound batches with SQLite durability", () => {
    const sessionId = "sess_queue_test"
    const queue = new OutboundBatchQueue(db, { sessionId, roomKey: new Uint8Array(32).fill(7) })

    const batch = {
      batchId: "batch_1",
      sessionId,
      clientId: "client_1",
      operations: [
        {
          type: "text-yjs" as const,
          docId: "f_1",
          update: new Uint8Array([1, 2, 3, 4]),
        },
      ],
      createdAt: Date.now(),
    }

    // Enqueue
    queue.enqueue(batch)

    // Retrieve pending
    let pending = queue.getPendingBatches(sessionId)
    expect(pending).toHaveLength(1)
    expect(pending[0].batchId).toBe("batch_1")
    expect(pending[0].state).toBe("pending")
    expect(pending[0].batch.operations[0].type).toBe("text-yjs")

    // Mark sent
    queue.markSent("batch_1")
    pending = queue.getPendingBatches(sessionId)
    expect(pending[0].state).toBe("sent")
    expect(pending[0].retryCount).toBe(1)

    // Mark acked
    queue.markAcked("batch_1", 42)
    pending = queue.getPendingBatches(sessionId)
    expect(pending).toHaveLength(0) // Acked batches are no longer pending
  })
})
