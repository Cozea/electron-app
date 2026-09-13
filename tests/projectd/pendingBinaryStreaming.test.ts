import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { CHUNK_SIZE_BYTES } from "../../apps/projectd/src/collaboration/BinaryContentCache"
import { PendingBinaryStore, type PendingBinaryIntent } from "../../apps/projectd/src/collaboration/PendingBinaryStore"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function revisionId(intent: PendingBinaryIntent, contentHash: string): string {
  return `staged_${hash(Buffer.from(JSON.stringify([
    intent.path,
    intent.fileId,
    intent.baseRevisionId,
    intent.mode,
    contentHash,
  ])))}`
}

describe("streamed retained binary staging", () => {
  const paths: string[] = []
  const databases: ProjectdDatabase[] = []
  const sessionId = "czs_0123456789abcdef"
  const roomKey = randomBytes(32)
  const intent: PendingBinaryIntent = {
    path: "assets/model.bin",
    fileId: "file_model",
    baseRevisionId: "rev_parent",
    mode: 0o100644,
  }

  afterEach(async () => {
    for (const database of databases.splice(0)) database.close()
    for (const target of paths.splice(0)) {
      await fs.rm(target, { recursive: true, force: true })
      await fs.rm(`${target}-wal`, { force: true })
      await fs.rm(`${target}-shm`, { force: true })
    }
  })

  it("replaces orphan chunks, stages in bounded reads, and streams exactly after database restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-pending-stream-"))
    const dbPath = path.join(root, "projectd.sqlite")
    paths.push(root)
    let database = new ProjectdDatabase(dbPath)
    databases.push(database)
    let store = new PendingBinaryStore(database, { sessionId, roomKey })

    const bytes = Buffer.alloc(CHUNK_SIZE_BYTES + 17, 6)
    for (let index = CHUNK_SIZE_BYTES - 8; index < bytes.length; index++) bytes[index] = index % 251
    const contentHash = hash(bytes)
    const stagedId = revisionId(intent, contentHash)
    database.db.prepare("INSERT INTO pending_binary_chunks VALUES (?, ?, ?, ?)")
      .run(sessionId, stagedId, 99, "orphan-from-crash")
    const reads: Array<{ offset: number; length: number }> = []

    const record = await store.stageFrom(intent, {
      contentHash,
      size: bytes.length,
      read: async (offset, length) => {
        reads.push({ offset, length })
        return bytes.subarray(offset, offset + length)
      },
    })

    expect(reads).toEqual([
      { offset: 0, length: CHUNK_SIZE_BYTES },
      { offset: CHUNK_SIZE_BYTES, length: 17 },
    ])
    expect(record).toMatchObject({ revisionId: stagedId, contentHash, size: bytes.length, chunks: 2 })
    expect(store.count()).toBe(1)
    expect((database.db.prepare("SELECT count(*) AS count FROM pending_binary_chunks WHERE session_id=? AND revision_id=?")
      .get(sessionId, stagedId) as { count: number }).count).toBe(2)

    database.close()
    databases.pop()
    database = new ProjectdDatabase(dbPath)
    databases.push(database)
    store = new PendingBinaryStore(database, { sessionId, roomKey })
    const restored = store.list()[0]!
    const output: Buffer[] = []
    await store.writeTo(restored, async (chunk) => { output.push(Buffer.from(chunk)) })
    expect(output.map((chunk) => chunk.length)).toEqual([CHUNK_SIZE_BYTES, 17])
    // NOTE: Buffer.equals, not toEqual — vitest deep-equality on multi-MiB
    // buffers costs seconds per assertion and trips the 20s CI timeout.
    const streamed = Buffer.concat(output)
    expect(streamed.length).toBe(bytes.length)
    expect(streamed.equals(bytes)).toBe(true)

    const source = store.asSource(restored)
    expect(source.contentHash).toBe(contentHash)
    expect(source.size).toBe(bytes.length)
    const head = await source.read(0, CHUNK_SIZE_BYTES)
    const headExpected = bytes.subarray(0, CHUNK_SIZE_BYTES)
    expect(head.length).toBe(headExpected.length)
    expect(head.equals(headExpected)).toBe(true)
    expect(await source.read(CHUNK_SIZE_BYTES, 17)).toEqual(bytes.subarray(CHUNK_SIZE_BYTES))
    // A bounded upload client may ask an unaligned range that crosses a stored chunk.
    expect(await source.read(CHUNK_SIZE_BYTES - 8, 16)).toEqual(bytes.subarray(CHUNK_SIZE_BYTES - 8, CHUNK_SIZE_BYTES + 8))
    await expect(source.read(0, CHUNK_SIZE_BYTES + 1)).rejects.toThrow("range")
  })

  it("removes provisional chunks when a stable source changes during capture", async () => {
    const database = new ProjectdDatabase(":memory:")
    databases.push(database)
    const store = new PendingBinaryStore(database, { sessionId, roomKey })
    const expected = Buffer.alloc(CHUNK_SIZE_BYTES + 1, 1)
    const changed = Buffer.from(expected)
    changed[changed.length - 1] = 2
    const contentHash = hash(expected)
    const stagedId = revisionId(intent, contentHash)

    await expect(store.stageFrom(intent, {
      contentHash,
      size: changed.length,
      read: async (offset, length) => changed.subarray(offset, offset + length),
    })).rejects.toThrow("changed")

    expect(store.count()).toBe(0)
    expect((database.db.prepare("SELECT count(*) AS count FROM pending_binary_chunks WHERE session_id=? AND revision_id=?")
      .get(sessionId, stagedId) as { count: number }).count).toBe(0)
  })

  it("purges crash chunks even when the workspace content changed before reopen", () => {
    const database = new ProjectdDatabase(":memory:")
    databases.push(database)
    new PendingBinaryStore(database, { sessionId, roomKey })
    const abandonedRevision = revisionId(intent, hash(Buffer.from("old bytes")))
    database.db.prepare("INSERT INTO pending_binary_chunks VALUES (?, ?, ?, ?)")
      .run(sessionId, abandonedRevision, 0, "abandoned-encrypted-chunk")
    database.db.prepare("INSERT INTO pending_binary_chunks VALUES (?, ?, ?, ?)")
      .run("czs_other_session00", "staged_other", 0, "other-session-chunk")

    new PendingBinaryStore(database, { sessionId, roomKey })

    expect((database.db.prepare("SELECT count(*) AS count FROM pending_binary_chunks WHERE session_id=?")
      .get(sessionId) as { count: number }).count).toBe(0)
    expect((database.db.prepare("SELECT count(*) AS count FROM pending_binary_chunks WHERE session_id=?")
      .get("czs_other_session00") as { count: number }).count).toBe(1)
  })
})
