import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DurableSessionStore } from "../../apps/desktop/electron/collaboration/DurableSessionStore"
import { compactQuiescentInitializationBases } from "../../apps/desktop/electron/collaboration/InitializationBasisCleanup"
import { saveOfflineRecovery } from "../../apps/desktop/electron/collaboration/SessionOfflineRecovery"
import { encryptPayload, envelopeToBytes } from "../../shared/collaborationCipher"

let root: string
const projectId = "p", sessionId = "s", roomId = "session:s"
const first = { keyVersion: 1, roomKeyBase64: Buffer.alloc(32, 1).toString("base64") }
const current = { keyVersion: 2, roomKeyBase64: Buffer.alloc(32, 2).toString("base64") }
const opts = () => ({ root, projectId, sessionId, current, keys: [first, current] })
const store = (version: number) => new DurableSessionStore(root, roomId, version)
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-basis-cleanup-")) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
async function encoded(update: Uint8Array, key = first, purpose = "file-initialization-basis") {
  return Buffer.from(envelopeToBytes(await encryptPayload({ ...key, kind: "yjs_snapshot", plaintext: update,
    metadata: { roomId, projectId, sessionId, purpose, fileId: "a".repeat(64), snapshotBaseSeq: 5 } }))).toString("base64")
}
async function checkpoint(update: Uint8Array) {
  await store(2).saveCheckpoint({ generation: 3, roomId, keyVersion: 2, sequence: 5, snapshotBinary: await encoded(update, current, "checkpoint") })
}
function doc() { const value = new Y.Doc({ gc: false }); value.getText("file").insert(0, "original"); return value }

describe("quiescent initialization history cleanup", () => {
  it("prunes covered old-key bases while retaining a newer insert and deletion absent from the durable checkpoint", async () => {
    const base = doc()
    try {
      const initial = Y.encodeStateAsUpdate(base)
      await checkpoint(initial)
      await store(1).saveInitializationBasis("covered", await encoded(initial))
      base.getText("file").delete(0, 1)
      await store(1).saveInitializationBasis("unpublished-delete", await encoded(Y.encodeStateAsUpdate(base)))
      base.getText("file").insert(0, "new")
      await store(2).saveInitializationBasis("unpublished-insert", await encoded(Y.encodeStateAsUpdate(base), current))
      const removed = await compactQuiescentInitializationBases(opts())
      expect(removed.files).toBe(1)
      expect(removed.unusedKeyVersions).toEqual([])
      expect(await store(1).readInitializationBasis("covered")).toBeNull()
      expect(await store(1).readInitializationBasis("unpublished-delete")).not.toBeNull()
      expect(await store(2).readInitializationBasis("unpublished-insert")).not.toBeNull()
      expect((await compactQuiescentInitializationBases(opts())).files).toBe(0)
    } finally { base.destroy() }
  })
  it.each(["outbox", "ingress"] as const)("retains bases referenced by %s in any retained key epoch", async kind => {
    const base = doc()
    try {
      const update = Y.encodeStateAsUpdate(base)
      await checkpoint(update); await store(1).saveInitializationBasis("basis", await encoded(update))
      const pending = { id: "pending", roomId, projectId, keyVersion: 2, updateBinary: "retained pending ciphertext", timestamp: 1 }
      if (kind === "outbox") await store(2).enqueue(pending)
      else await store(2).saveEditorIngress(pending)
      expect((await compactQuiescentInitializationBases(opts())).files).toBe(0)
      expect(await store(1).readInitializationBasis("basis")).not.toBeNull()
    } finally { base.destroy() }
  })
  it("validates all selected bases before any deletion and retains unknown files and projection dependencies", async () => {
    const base = doc()
    try {
      const update = Y.encodeStateAsUpdate(base)
      await checkpoint(update)
      await store(1).saveInitializationBasis("a-covered", await encoded(update))
      await store(2).saveInitializationBasis("z-invalid", await encoded(update, current, "other-purpose"))
      await expect(compactQuiescentInitializationBases(opts())).rejects.toThrow("identity")
      expect(await store(1).readInitializationBasis("a-covered")).not.toBeNull()
      await fs.rm(path.join(store(2).directory, "initialization-basis-z-invalid.json"))
      await fs.writeFile(path.join(store(1).directory, ".unknown.pending"), "retained")
      expect((await compactQuiescentInitializationBases(opts())).unusedKeyVersions).toEqual([])
      await fs.rm(path.join(store(1).directory, ".unknown.pending"))
      await store(2).saveProjection("opaque encrypted projection")
      expect((await compactQuiescentInitializationBases(opts())).unusedKeyVersions).toEqual([])
    } finally { base.destroy() }
  })
  it("only proposes an older sealed key after every byte depending on that epoch is gone", async () => {
    const base = doc()
    try {
      const update = Y.encodeStateAsUpdate(base)
      await checkpoint(update); await store(1).saveInitializationBasis("covered", await encoded(update))
      expect((await compactQuiescentInitializationBases(opts())).unusedKeyVersions).toEqual([1])
      expect((await compactQuiescentInitializationBases(opts())).unusedKeyVersions).toEqual([1])
      expect((await store(2).recover()).checkpoint).not.toBeNull()
    } finally { base.destroy() }
  })
  it("retains the complete basis/key chain while an offline recovery journal exists", async () => {
    const base = doc()
    try {
      const update = Y.encodeStateAsUpdate(base)
      await checkpoint(update); await store(1).saveInitializationBasis("covered", await encoded(update))
      await saveOfflineRecovery(store(2), current, sessionId, { version: 1, entries: [{ id: "recovery", kind: "external", incomplete: true,
        branch: Buffer.from(update).toString("base64"), sources: [], files: [], resolved: [], saves: {} }] })
      expect(await compactQuiescentInitializationBases(opts())).toEqual({ files: 0, bytes: 0, unusedKeyVersions: [] })
      expect(await store(1).readInitializationBasis("covered")).not.toBeNull()
    } finally { base.destroy() }
  })
})
