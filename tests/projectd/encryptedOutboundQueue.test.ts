import { randomBytes } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "vitest"
import { OutboundBatchQueue } from "../../apps/projectd/src/collaboration/OutboundBatchQueue"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import { SessionReplica, type CollaborationBatch } from "../../apps/projectd/src/collaboration/SessionReplica"

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

function database(): ProjectdDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-encrypted-outbox-"))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  const db = new ProjectdDatabase(path.join(dir, "journal.sqlite"))
  cleanups.push(() => db.close())
  return db
}

function batch(id: string): CollaborationBatch {
  return {
    batchId: id, sessionId: "session_encrypted", clientId: "private_client_marker", createdAt: 1234,
    operations: [{ type: "text-yjs", docId: "private_path_marker", update: new Uint8Array([3, 1, 4]) }],
  }
}

it("retains tree and text deltas when the journal rejects a write, then retries their exact contents", () => {
  const source = new SessionReplica("session_encrypted", "source")
  const target = new SessionReplica("session_encrypted", "target")
  const entry = source.createFile({ path: "retained.txt", kind: "text", content: "retained bytes",
    actor: { actorType: "user", principalId: "writer" } })
  expect(() => source.exportBatch(() => { throw new Error("disk full") })).toThrow("disk full")
  expect(source.hasUnexportedChanges()).toBe(true)
  const queue = new OutboundBatchQueue(database(), { sessionId: "session_encrypted", roomKey: randomBytes(32) })
  source.exportBatch((pending) => queue.enqueue(pending))
  expect(source.hasUnexportedChanges()).toBe(false)
  target.applyBatch(queue.getPendingBatches("session_encrypted")[0].batch)
  expect(target.tree.listLiveEntries()[0].path).toBe("retained.txt")
  expect(target.textDocs.getTextContent(entry.fileId)).toBe("retained bytes")
})

it("reopens exact encrypted pending bytes across key rotation without plaintext paths or source metadata", () => {
  const db = database()
  const oldKey = randomBytes(32)
  const currentKey = randomBytes(32)
  const keys = { sessionId: "session_encrypted", roomKey: oldKey }
  new OutboundBatchQueue(db, keys).enqueue(batch("first"))
  const stored = db.db.prepare("SELECT payload_json FROM outbound_batches").get() as { payload_json: string }
  expect(stored.payload_json.startsWith("czenc1:")).toBe(true)
  expect(stored.payload_json).not.toContain("private_")
  const reopenedDb = new ProjectdDatabase(db.dbPath)
  cleanups.push(() => reopenedDb.close())
  const rotated = new OutboundBatchQueue(reopenedDb, {
    ...keys, roomKey: currentKey, roomKeyVersion: 2, previousRoomKeys: { 1: oldKey },
  })
  rotated.enqueue(batch("second"))
  expect(rotated.getPendingBatches(keys.sessionId).map((row) => row.batch)).toEqual([batch("first"), batch("second")])
  expect(() => new OutboundBatchQueue(reopenedDb, { ...keys, roomKey: currentKey, roomKeyVersion: 2 })
    .getPendingBatches(keys.sessionId)).toThrow(/key generation 1/)
  expect(rotated.getPendingBatches(keys.sessionId)).toHaveLength(2)
  expect(() => rotated.getPendingBatches("another-session")).toThrow(/session mismatch/)
})

it("authenticates the batch identity and ordering, retaining damaged records for recovery", () => {
  const db = database()
  const queue = new OutboundBatchQueue(db, { sessionId: "session_encrypted", roomKey: randomBytes(32) })
  queue.enqueue(batch("first"))
  db.db.prepare("UPDATE outbound_batches SET local_order=7 WHERE batch_id='first'").run()
  expect(() => queue.getPendingBatches("session_encrypted")).toThrow()
  expect(db.db.prepare("SELECT COUNT(*) AS n FROM outbound_batches").get()).toMatchObject({ n: 1 })
})

it("encrypts retained legacy work before returning it without changing retry identity", () => {
  const db = database()
  const queue = new OutboundBatchQueue(db, { sessionId: "session_encrypted", roomKey: randomBytes(32) })
  const original = batch("retained")
  const json = JSON.stringify(original, (_, value) => value instanceof Uint8Array
    ? { __b64: Buffer.from(value).toString("base64") } : value)
  db.db.prepare(`INSERT INTO outbound_batches
    (batch_id, session_id, created_at, state, local_order, payload_json, retry_count)
    VALUES (?, ?, ?, 'sent', 1, ?, 2)`).run(original.batchId, original.sessionId, original.createdAt, json)
  expect(queue.getPendingBatches(original.sessionId)[0]).toMatchObject({ batch: original, state: "sent", retryCount: 2 })
  const stored = db.db.prepare("SELECT payload_json FROM outbound_batches").get() as { payload_json: string }
  expect(stored.payload_json.startsWith("czenc1:")).toBe(true)
})
