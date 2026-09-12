import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { randomBytes } from "node:crypto"
import { expect, it, vi } from "vitest"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import { exportLocalRecovery } from "../../apps/projectd/src/collaboration/LocalRecoveryExporter"
import { PendingBinaryStore } from "../../apps/projectd/src/collaboration/PendingBinaryStore"
import { CHUNK_SIZE_BYTES } from "../../apps/projectd/src/collaboration/BinaryContentCache"

it("retains encrypted binary versions across restart and key rotation, with atomic staging and authenticated chunks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-binary-staging-"))
  const dbPath = path.join(root, "journal.sqlite")
  let db = new ProjectdDatabase(dbPath)
  const roomKey = randomBytes(32)
  const keys = { sessionId: "session", roomKey }
  const intent = { path: "private-image.bin", fileId: "file", baseRevisionId: "base", mode: 0o100644 }
  const bytes = Buffer.alloc(CHUNK_SIZE_BYTES + 31, 42)
  try {
    let store = new PendingBinaryStore(db, keys)
    const first = store.stage(intent, bytes)
    expect(store.stage(intent, bytes).revisionId).toBe(first.revisionId)
    const second = store.stage(intent, Buffer.from("later version"))
    expect(store.list()).toHaveLength(2)
    const rows = db.db.prepare("SELECT envelope FROM pending_binary_versions").all()
    expect(JSON.stringify(rows)).not.toContain(intent.path)
    expect(JSON.stringify(rows)).not.toContain("later version")
    db.close()
    db = new ProjectdDatabase(dbPath)
    store = new PendingBinaryStore(db, { ...keys, roomKey: randomBytes(32), roomKeyVersion: 2, previousRoomKeys: { 1: roomKey } })
    expect(store.readBytes(store.list()[0]).equals(bytes)).toBe(true)
    expect(store.readBytes(store.list()[1]).toString()).toBe("later version")
    const capture = store.captureForExport()
    const capturedChunks: Buffer[] = []
    try {
      await capture.writeTo(first, async (chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE_BYTES)
        capturedChunks.push(chunk)
        // Removal from another store must not invalidate an in-flight export.
        new PendingBinaryStore(db, keys).remove(first.revisionId)
      })
      expect(Buffer.concat(capturedChunks)).toEqual(bytes)
    } finally { capture.close() }
    new PendingBinaryStore(db, keys).stage(intent, bytes)
    const wholeRead = vi.spyOn(PendingBinaryStore.prototype, "readBytes").mockImplementation(() => { throw new Error("whole draft read forbidden") })
    const exported = await exportLocalRecovery(db, { publicSessionId: keys.sessionId, projectId: "project", workspaceId: "workspace",
      rootPath: path.join(root, "absent-workspace"), roomKeyBase64: roomKey.toString("base64"), background: {
        gatewayUrl: "https://unused.example", convexUrl: "https://unused.convex.cloud" } }, root)
    expect(wholeRead).not.toHaveBeenCalled()
    wholeRead.mockRestore()
    expect(exported).toMatchObject({ pendingOnly: true, pendingBinaryVersions: 2, files: 2, pendingBatches: 0 })
    const manifest = JSON.parse(await fs.readFile(path.join(exported.directory, "manifest.json"), "utf8")) as {
      pendingBinaryVersions: Array<{ revisionId: string; path: string; contentFile: string }>
    }
    expect(manifest.pendingBinaryVersions.map((version) => version.path)).toEqual([intent.path, intent.path])
    expect((await fs.readFile(path.join(exported.directory, manifest.pendingBinaryVersions.find((record) => record.revisionId === first.revisionId)!.contentFile))).equals(bytes)).toBe(true)
    expect(await fs.readFile(path.join(exported.directory, manifest.pendingBinaryVersions.find((record) => record.revisionId === second.revisionId)!.contentFile), "utf8")).toBe("later version")
    expect(store.list()).toHaveLength(2)
    expect(await fs.readdir(path.join(exported.directory, "project"))).toEqual([])
    expect(() => new PendingBinaryStore(db, { ...keys, roomKey: randomBytes(32) }).list()).toThrow()
    // A chunk from another revision cannot be substituted, even with the same key.
    db.db.prepare(`UPDATE pending_binary_chunks SET envelope=(SELECT envelope FROM pending_binary_chunks WHERE revision_id=? AND chunk_index=0)
      WHERE revision_id=? AND chunk_index=0`).run(second.revisionId, first.revisionId)
    expect(() => store.readBytes(first)).toThrow()
    store.remove(first.revisionId)
    expect(store.readBytes(store.list()[0]).toString()).toBe("later version")
    db.db.exec("CREATE TRIGGER reject_binary_chunk BEFORE INSERT ON pending_binary_chunks BEGIN SELECT RAISE(ABORT, 'disk full'); END")
    expect(() => store.stage(intent, Buffer.from("uncommitted"))).toThrow(/disk full/)
    expect(store.list()).toHaveLength(1)
  } finally { vi.restoreAllMocks(); db.close(); await fs.rm(root, { recursive: true, force: true }) }
})
