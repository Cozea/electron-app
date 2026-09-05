import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DurableSessionStore } from "../../apps/desktop/electron/collaboration/DurableSessionStore"
import { compactVerifiedRecoveryStore } from "../../apps/desktop/electron/collaboration/RecoveryStorageCleanup"
import { encryptPayload, envelopeToBytes } from "../../shared/collaborationCipher"
let root: string
const roomId = "session:s", projectId = "p", sessionId = "s"
const key = Buffer.alloc(32, 7).toString("base64")
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-recovery-cleanup-")) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
async function fixture(keyVersion = 1) {
  const store = new DurableSessionStore(root, roomId, keyVersion)
  const doc = new Y.Doc({ gc: false })
  doc.getText("file").insert(0, "acknowledged text")
  let snapshotBinary: string
  try {
    snapshotBinary = Buffer.from(envelopeToBytes(await encryptPayload({ roomKeyBase64: key, keyVersion, kind: "yjs_snapshot", plaintext: Y.encodeStateAsUpdate(doc), metadata: { roomId, projectId, snapshotBaseSeq: 1 } }))).toString("base64")
  } finally { doc.destroy() }
  const checkpoint = { generation: 3 as const, roomId, keyVersion, sequence: 1, snapshotBinary }
  await store.saveCheckpoint(checkpoint)
  // Model a crash after replacement persistence but before covered-log cleanup.
  await store.saveAcknowledged(1, "covered encrypted receive log")
  await store.saveAcknowledged(2, "newer encrypted receive log")
  const pending = { id: "pending", projectId, roomId, keyVersion, updateBinary: "unpublished encrypted edit", timestamp: 1 }
  await store.enqueue(pending)
  await store.saveEditorIngress({ ...pending, id: "editor" })
  await store.prepareCheckpointUpload("upload", "pending encrypted snapshot")
  await store.saveProjection("encrypted displaced-file metadata")
  await fs.writeFile(path.join(store.directory, ".interrupted.pending"), "unknown recovery bytes")
  return { store, checkpoint, options: { root, roomId, projectId, sessionId, keyVersion, roomKeyBase64: key } }
}

describe("authenticated checkpoint-covered cleanup", () => {
  it("removes only covered logs, retaining every unpublished/unknown record", async () => {
    const { store, options } = await fixture()
    const before = await fs.readdir(store.directory)
    const result = await compactVerifiedRecoveryStore(options)
    expect(result.files).toBe(1); expect(result.bytes).toBeGreaterThan(0)
    expect((await fs.readdir(store.directory)).sort()).toEqual(before.filter(name => name !== "ack-0000000000000001.json").sort())
    expect(await store.list(roomId, 1)).toHaveLength(1)
    expect(await store.listEditorIngress()).toHaveLength(1)
    expect((await store.recover()).updates.map(item => item.sequence)).toEqual([2])
    expect(await compactVerifiedRecoveryStore(options)).toEqual({ files: 0, bytes: 0 })
  })
  it("does not touch another key version while cleaning a catalog-selected store", async () => {
    const first = await fixture(1), next = await fixture(2)
    await compactVerifiedRecoveryStore(next.options)
    expect(await fs.readFile(path.join(first.store.directory, "ack-0000000000000001.json"), "utf8")).toContain("covered")
    expect(await next.store.list(roomId, 2)).toHaveLength(1)
  })
  it("retains logs when the key is unavailable or checkpoint metadata is tampered", async () => {
    const { store, checkpoint, options } = await fixture()
    await expect(compactVerifiedRecoveryStore({ ...options, roomKeyBase64: Buffer.alloc(32, 9).toString("base64") })).rejects.toThrow()
    await fs.writeFile(path.join(store.directory, "checkpoint.json"), JSON.stringify({ ...checkpoint, sequence: 2 }))
    await expect(compactVerifiedRecoveryStore(options)).rejects.toThrow("identity")
    expect((await fs.readdir(store.directory)).filter(name => name.startsWith("ack-"))).toHaveLength(2)
  })
  it("rechecks the authenticated replacement and rejects corrupt covered-log metadata", async () => {
    const { store, checkpoint } = await fixture()
    await expect(store.compactAcknowledged({ ...checkpoint, snapshotBinary: "different" })).rejects.toThrow("changed")
    await fs.writeFile(path.join(store.directory, "ack-0000000000000001.json"), JSON.stringify({ sequence: 99, updateBinary: "opaque" }))
    await expect(store.compactAcknowledged(checkpoint)).rejects.toThrow("invalid")
    expect((await fs.readdir(store.directory)).filter(name => name.startsWith("ack-"))).toHaveLength(2)
  })
})
