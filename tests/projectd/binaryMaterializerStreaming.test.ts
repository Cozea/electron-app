import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BaselineStore } from "../../apps/projectd/src/collaboration/BaselineStore"
import type { BinaryRevision } from "../../apps/projectd/src/collaboration/BinaryStore"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { FilesystemMaterializer } from "../../apps/projectd/src/filesystem/Materializer"
import { MaterializationIndex } from "../../apps/projectd/src/filesystem/MaterializationIndex"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

describe("streamed binary materialization", () => {
  const roots: string[] = []
  const databases: ProjectdDatabase[] = []

  afterEach(async () => {
    for (const database of databases.splice(0)) database.close()
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  })

  it("streams a remote revision atomically and copies divergent local bytes without resolving the whole binary", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-stream-materializer-"))
    roots.push(root)
    const database = new ProjectdDatabase(":memory:")
    databases.push(database)
    const sessionId = "session_stream_materializer"
    const replica = new SessionReplica(sessionId, "materializer_test")
    const index = new MaterializationIndex(database)
    const baselineStore = new BaselineStore()
    const entry = replica.createFile({
      path: "assets/model.bin",
      kind: "binary",
      actor: { actorType: "user", principalId: "peer" },
    })

    const chunks = [Buffer.alloc(1024 * 1024, 1), Buffer.alloc(1024 * 1024, 2), Buffer.from("tail")]
    const expected = Buffer.concat(chunks)
    const revision: BinaryRevision = {
      revisionId: "rev_streamed",
      fileId: entry.fileId,
      baseRevisionId: null,
      contentHash: hash(expected),
      encryptedManifestRef: "fixture",
      size: expected.length,
      actor: { actorType: "user", principalId: "peer" },
      createdAt: 1,
    }
    replica.addBinaryRevision(revision)

    const destination = path.join(root, "assets/model.bin")
    await fs.mkdir(path.dirname(destination), { recursive: true })
    const previous = Buffer.from("previous materialized bytes")
    const divergent = Buffer.from("local edits that must survive")
    await fs.writeFile(destination, divergent)
    const stat = await fs.lstat(destination)
    index.recordMaterialization({
      sessionId,
      fileId: entry.fileId,
      relativePath: entry.path,
      kind: "binary",
      mode: 0o100644,
      diskHash: hash(previous),
      diskSize: previous.length,
      diskMtimeMs: stat.mtimeMs - 1,
      state: "materialized",
    })

    const wholeResolver = vi.fn(async () => {
      throw new Error("whole-buffer resolver must not run")
    })
    const writes: number[] = []
    const materializer = new FilesystemMaterializer({
      workspaceRoot: root,
      sessionId,
      replica,
      index,
      baselineStore,
      resolveBinary: wholeResolver,
      streamBinary: async (requested, write) => {
        expect(requested.revisionId).toBe(revision.revisionId)
        for (const chunk of chunks) {
          writes.push(chunk.length)
          await write(chunk)
        }
      },
    })

    await materializer.materializeFile(entry.fileId, Date.now())

    expect(wholeResolver).not.toHaveBeenCalled()
    expect(writes).toEqual(chunks.map((chunk) => chunk.length))
    // NOTE: Buffer.equals, not toEqual — vitest deep-equality on multi-MiB
    // buffers costs seconds per assertion and trips the 20s CI timeout.
    const materialized = await fs.readFile(destination)
    expect(materialized.length).toBe(expected.length)
    expect(materialized.equals(expected)).toBe(true)
    const names = await fs.readdir(path.dirname(destination))
    const backupName = names.find((name) => name.startsWith("model.bin.conflict."))
    expect(backupName).toBeTruthy()
    expect(await fs.readFile(path.join(path.dirname(destination), backupName!))).toEqual(divergent)
    expect(names.filter((name) => name.includes(".tmp."))).toEqual([])

    expect(index.getByFileId(sessionId, entry.fileId)).toMatchObject({
      diskHash: revision.contentHash,
      diskSize: revision.size,
      kind: "binary",
      relativePath: entry.path,
    })
  })
})
