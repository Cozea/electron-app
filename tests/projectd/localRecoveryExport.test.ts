import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash, randomBytes } from "node:crypto"
import { expect, it } from "vitest"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { LocalReplicaStore } from "../../apps/projectd/src/collaboration/LocalReplicaStore"
import { OutboundBatchQueue } from "../../apps/projectd/src/collaboration/OutboundBatchQueue"
import { BinaryContentCache } from "../../apps/projectd/src/collaboration/BinaryContentCache"
import { exportLocalRecovery, exportRecoveryReplica } from "../../apps/projectd/src/collaboration/LocalRecoveryExporter"

it("streams large recovery variants, projects verified bytes and discards incomplete exports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-stream-recovery-"))
  const replica = new SessionReplica("czs_0123456789abcdef", "exporter")
  const actor = { actorType: "user" as const }
  const entry = replica.createFile({ path: "large.bin", kind: "binary", actor })
  const chunk = Buffer.alloc(4 * 1024 * 1024, 7)
  const hash = createHash("sha256")
  for (let i = 0; i < 17; i++) hash.update(chunk)
  const contentHash = hash.digest("hex")
  replica.binaryStore.addRevision({ fileId: entry.fileId, revisionId: "large", baseRevisionId: null,
    contentHash, size: chunk.length * 17, actor, createdAt: 1, encryptedManifestRef: "fixture" })
  const options = { replica, pending: [], snapshotSequence: 1, source: "local" as const, destinationParent: root }
  try {
    const result = await exportRecoveryReplica({ ...options, writeBinary: async (_, write) => {
      for (let i = 0; i < 17; i++) await write(chunk)
      return true
    } })
    expect(result).toMatchObject({ files: 1, missingBinaryContents: 0, projectOmissions: 0 })
    const file = await fs.open(path.join(result.directory, "project/large.bin"), "r")
    const actual = createHash("sha256")
    try {
      expect((await file.stat()).size).toBe(chunk.length * 17)
      for (;;) { const { bytesRead } = await file.read(chunk); if (!bytesRead) break; actual.update(chunk.subarray(0, bytesRead)) }
    } finally { await file.close() }
    expect(actual.digest("hex")).toBe(contentHash)
    const missing = await exportRecoveryReplica({ ...options, writeBinary: async (_, write) => {
      await write(chunk)
      return false
    } })
    expect(missing).toMatchObject({ files: 0, missingBinaryContents: 1, projectOmissions: 1 })
    const folder = createHash("sha256").update(entry.fileId).digest("hex")
    expect(await fs.readdir(path.join(missing.directory, "files", folder))).toEqual([])
    const before = (await fs.readdir(root)).sort()
    await expect(exportRecoveryReplica({ ...options, source: "cloud", writeBinary: async (_, write) => {
      await write(chunk)
      throw new Error("download interrupted")
    } })).rejects.toThrow("download interrupted")
    expect((await fs.readdir(root)).sort()).toEqual(before)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it("exports retained text/conflict/binary variants and pending changes without consuming recovery or following source paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-export-"))
  const db = new ProjectdDatabase(path.join(root, "journal.sqlite"))
  const source = path.join(root, "workspace")
  await fs.mkdir(source)
  await fs.writeFile(path.join(source, "untouched.txt"), "newer disk edit")
  const sessionId = "czs_0123456789abcdef"
  const roomKey = randomBytes(32)
  const keys = { sessionId, roomKey }
  const replica = new SessionReplica(sessionId, "original")
  const actor = { actorType: "user" as const, principalId: "principal" }
  const first = replica.createFile({ path: "collision.txt", kind: "text", content: "first", actor })
  replica.createFile({ path: "collision.txt", kind: "text", content: "second", actor })
  replica.createFile({ path: "src/main.ts", kind: "text", content: "export const recovered = true", actor })
  replica.tree.createEntry({ path: "unsafe-link", kind: "symlink", symlinkTarget: "../../outside", actor })
  const binary = replica.createFile({ path: "image.bin", kind: "binary", actor })
  const cache = new BinaryContentCache({ cacheDir: path.join(root, "cache"), db })
  const cached = await cache.put(Buffer.from("retained binary"))
  replica.binaryStore.addRevision({ revisionId: "cached", fileId: binary.fileId, baseRevisionId: null,
    contentHash: cached.contentHash, size: cached.size, encryptedManifestRef: "ref", actor, createdAt: 1 })
  replica.binaryStore.addRevision({ revisionId: "missing", fileId: binary.fileId, baseRevisionId: null,
    contentHash: "a".repeat(64), size: 7, encryptedManifestRef: "ref", actor, createdAt: 2 })
  replica.exportBatch()
  new LocalReplicaStore(db, keys).save({ sequence: 4, replica: replica.captureSnapshot() })
  replica.textDocs.setTextContent(first.fileId, "first plus pending edit")
  const batch = replica.exportBatch()!
  const queue = new OutboundBatchQueue(db, keys)
  queue.enqueue(batch)
  const descriptor = { publicSessionId: sessionId, projectId: "project", workspaceId: "workspace", rootPath: source,
    roomKeyBase64: roomKey.toString("base64"), background: { gatewayUrl: "https://unused.example", convexUrl: "https://unused.convex.cloud" } }
  try {
    await expect(exportLocalRecovery(db, descriptor, source, cache)).rejects.toThrow(/outside the session workspace/)
    const result = await exportLocalRecovery(db, descriptor, root, cache)
    expect(result).toMatchObject({ files: 4, pendingBatches: 1, missingBinaryContents: 1 })
    expect(await fs.readFile(path.join(result.directory, "project/src/main.ts"), "utf8")).toBe("export const recovered = true")
    await expect(fs.stat(path.join(result.directory, "project/collision.txt"))).rejects.toMatchObject({ code: "ENOENT" })
    const manifest = JSON.parse(await fs.readFile(path.join(result.directory, "manifest.json"), "utf8")) as {
      files: Array<{ originalPath: string; contentFiles: string[] }>; conflicts: { pathCollisions: unknown[] }
    }
    expect(manifest.conflicts.pathCollisions).toHaveLength(1)
    const text = await Promise.all(manifest.files.filter((entry) => entry.originalPath === "collision.txt")
      .map((entry) => fs.readFile(path.join(result.directory, entry.contentFiles[0]), "utf8")))
    expect(text.sort()).toEqual(["first plus pending edit", "second"])
    expect(manifest.files.find((entry) => entry.originalPath === "unsafe-link")?.contentFiles).toEqual([])
    const retained = await fs.readFile(path.join(result.directory, "retained-state.json"), "utf8")
    expect(retained).not.toContain(descriptor.roomKeyBase64)
    expect(retained).toContain(batch.batchId)
    expect(queue.getPendingBatches(sessionId)).toHaveLength(1)
    expect(await fs.readFile(path.join(source, "untouched.txt"), "utf8")).toBe("newer disk edit")
    expect((await fs.stat(result.directory)).mode & 0o777).toBe(0o700)
    await expect(exportLocalRecovery(db, { ...descriptor, roomKeyBase64: randomBytes(32).toString("base64") }, root, cache)).rejects.toThrow()
  } finally {
    db.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})
