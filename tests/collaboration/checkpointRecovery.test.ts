/* oxlint-disable typescript/triple-slash-reference -- Worker globals are ambient, not an importable module. */
/// <reference path="../../cloudflare/worker/src/cloudflare-runtime.d.ts" />
import { afterEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import { handleCheckpointOperation } from "../../cloudflare/worker/src/lib/collaborationCheckpoints"
import { encryptPayload, envelopeToBytes, bytesToEnvelope, decryptPayload } from "../../shared/collaborationCipher"
import { collaborationDigest, COLLABORATION_CHUNK_CHARS } from "../../shared/collaborationWire"
import type { CheckpointUploadLease, EncryptedCheckpointDescriptor } from "../../shared/collaborationCheckpoint"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { SessionCheckpointClient } from "../../apps/desktop/electron/collaboration/SessionCheckpointClient"
import { DurableSessionStore } from "../../apps/desktop/electron/collaboration/DurableSessionStore"

const key = Buffer.alloc(32, 7).toString("base64")
const authority = { userId: "alice", role: "editor" as const, keyVersion: 1, roomId: "session:s", projectId: "p" }
function fixture() {
  const records = new Map<string, unknown>()
  const storage = {
    get: async (name: string) => structuredClone(records.get(name)),
    put: vi.fn(async (name: string | Record<string, unknown>, value?: unknown) => {
      for (const [k, v] of typeof name === "string" ? [[name, value]] : Object.entries(name)) records.set(k as string, structuredClone(v))
    }),
    delete: async (names: string | string[]) => { for (const name of Array.isArray(names) ? names : [names]) records.delete(name) },
  } as unknown as DurableObjectStorage
  const call = (body: Record<string, unknown>, auth = authority) => handleCheckpointOperation(storage, auth, body)
  const claim = async (sequence = 0) => (await call({ operation: "claim", sequence }) as { lease: CheckpointUploadLease }).lease
  const encode = async (doc: Y.Doc, sequence: number) => Buffer.from(envelopeToBytes(await encryptPayload({ roomKeyBase64: key, kind: "yjs_snapshot", keyVersion: 1, plaintext: Y.encodeStateAsUpdate(doc), metadata: { roomId: authority.roomId, projectId: authority.projectId, snapshotBaseSeq: sequence } }))).toString("base64")
  const upload = async (lease: CheckpointUploadLease, encoded: string, start = 0) => {
    for (let offset = start * COLLABORATION_CHUNK_CHARS; offset < encoded.length; offset += COLLABORATION_CHUNK_CHARS) await call({ operation: "upload", id: lease.id, index: offset / COLLABORATION_CHUNK_CHARS, totalChars: encoded.length, digest: await collaborationDigest(encoded), data: encoded.slice(offset, offset + COLLABORATION_CHUNK_CHARS) })
  }
  return { records, storage, call, claim, encode, upload }
}
afterEach(() => vi.useRealTimers())

describe("durable encrypted CRDT checkpoints", () => {
  it("freezes writes while rotating, retains the old checkpoint until cutover and retries the complete new checkpoint", async () => {
    const f = fixture(), root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-checkpoint-rotation-"))
    const doc = new Y.Doc({ gc: false })
    try {
      doc.getText("shared").insert(0, "acknowledged before rotation")
      const lease = await f.claim(); await f.upload(lease, await f.encode(doc, 0)); await f.call({ operation: "finalize", id: lease.id })
      const before = f.records.get("encrypted-checkpoint") as EncryptedCheckpointDescriptor
      f.records.set("head-sequence", 2)
      const rotating = { ...authority, rotationRequired: true }
      await expect(handleCheckpointOperation(f.storage, rotating, { operation: "claim", sequence: 2 })).rejects.toThrow("rotation")
      await expect(handleCheckpointOperation(f.storage, rotating, { operation: "file.claim", fileId: "file" })).rejects.toThrow("rotation")
      const pending = { ...rotating, previousKeyVersion: 1, keyVersion: 2 }
      await expect(handleCheckpointOperation(f.storage, pending, { operation: "claim", sequence: 1 })).rejects.toThrow("frozen")
      const key2 = Buffer.alloc(32, 2).toString("base64")
      const request = (body: Record<string, unknown>) => handleCheckpointOperation(f.storage, pending, body)
      const client = new SessionCheckpointClient({ sessionId: "s", projectId: "p", roomId: "session:s", keyVersion: 2, roomKeyBase64: key2, role: "editor", store: new DurableSessionStore(root, "session:s", 2), request })
      expect(await client.checkpoint(2, Y.encodeStateAsUpdate(doc))).toBe(true)
      expect(await handleCheckpointOperation(f.storage, rotating, { operation: "inspect" })).toMatchObject({ checkpoint: before })
      const after = f.records.get("encrypted-checkpoint") as EncryptedCheckpointDescriptor
      expect(after).toMatchObject({ sequence: 2, keyVersion: 2 })
      expect(await request({ operation: "claim", sequence: 2 })).toEqual({ checkpoint: after })
      const recovered = await client.load(after)
      expect(recovered.update).toEqual(Y.encodeStateAsUpdate(doc))
      const oldPiece = await handleCheckpointOperation(f.storage, rotating, { operation: "read", id: before.id, index: 0 }) as { data: string }
      expect(oldPiece.data).toBeTruthy()
    } finally { doc.destroy(); await fs.rm(root, { recursive: true, force: true }) }
  })
  it("bootstraps two device stores from one history and retries identical ciphertext after interruption", async () => {
    const f = fixture(), root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-checkpoint-"))
    try {
      const make = (device: string, request = f.call) => new SessionCheckpointClient({ sessionId: "s", projectId: "p", roomId: "session:s", role: "editor", keyVersion: 1, roomKeyBase64: key, store: new DurableSessionStore(path.join(root, device), "session:s"), request })
      let interrupted = false
      const first = make("alice", async body => {
        const result = await f.call(body)
        if (body.operation === "upload" && !interrupted) { interrupted = true; throw new Error("network lost") }
        return result
      })
      await expect(first.bootstrap()).rejects.toThrow("network lost")
      const a = await make("alice").bootstrap(), b = await make("bob").bootstrap()
      expect(a).not.toBeNull(); expect(b).toEqual(a)
      expect(await make("alice").recoverLocal()).toEqual(a)
      const local = new Y.Doc({ gc: false }); Y.applyUpdate(local, a!.update)
      local.getText("file").insert(0, "durably acknowledged")
      const encoded = Buffer.from(envelopeToBytes(await encryptPayload({ roomKeyBase64: key, keyVersion: 1, kind: "yjs_update", plaintext: Y.encodeStateAsUpdate(local), metadata: { roomId: "session:s", projectId: "p", idempotencyKey: "first" } }))).toString("base64")
      await new DurableSessionStore(path.join(root, "alice"), "session:s").saveAcknowledged(1, encoded)
      const restarted = await make("alice").recoverLocal()
      expect(restarted?.sequence).toBe(1)
      const restored = new Y.Doc({ gc: false }); Y.applyUpdate(restored, restarted!.update)
      expect(restored.getText("file").toString()).toBe("durably acknowledged")
      local.destroy(); restored.destroy()
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
  it("elects one bootstrap history and resumes a partial upload after room restart", async () => {
    const f = fixture(), doc = new Y.Doc({ gc: false })
    doc.getText("file").insert(0, "shared".repeat(20_000))
    const lease = await f.claim(), encoded = await f.encode(doc, 0)
    expect(await f.call({ operation: "claim", sequence: 0 }, { ...authority, userId: "bob" })).toMatchObject({ waiting: true })
    await f.call({ operation: "upload", id: lease.id, index: 0, totalChars: encoded.length, digest: await collaborationDigest(encoded), data: encoded.slice(0, COLLABORATION_CHUNK_CHARS) })
    await expect(f.call({ operation: "finalize", id: lease.id })).rejects.toThrow("incomplete")
    expect(await f.call({ operation: "inspect" })).toEqual({ checkpoint: null, headSequence: 0 })
    expect((await f.claim()).id).toBe(lease.id)
    await f.upload(lease, encoded, 1)
    const finished = await handleCheckpointOperation(f.storage, authority, { operation: "finalize", id: lease.id })
    expect(await f.call({ operation: "finalize", id: lease.id })).toEqual(finished)
    expect(finished).toMatchObject({ checkpoint: { sequence: 0, chunkCount: Math.ceil(encoded.length / COLLABORATION_CHUNK_CHARS) } })
    doc.destroy()
  })

  it("retains the prior checkpoint if replacement persistence fails", async () => {
    const f = fixture(), doc = new Y.Doc({ gc: false })
    const original = await f.claim(); await f.upload(original, await f.encode(doc, 0)); await f.call({ operation: "finalize", id: original.id })
    f.records.set("head-sequence", 3)
    const next = await f.claim(3); await f.upload(next, await f.encode(doc, 3))
    vi.mocked(f.storage.put).mockRejectedValueOnce(new Error("disk full"))
    await expect(f.call({ operation: "finalize", id: next.id })).rejects.toThrow("disk full")
    expect(await f.call({ operation: "read", id: original.id, index: 0 })).toHaveProperty("data")
    await f.call({ operation: "finalize", id: next.id })
    await expect(f.call({ operation: "read", id: original.id, index: 0 })).rejects.toThrow("changed")
    doc.destroy()
  })

  it("rejects observers, expired leases, altered sequence metadata and noninteger cursors", async () => {
    const f = fixture(), doc = new Y.Doc()
    await expect(handleCheckpointOperation(f.storage, { ...authority, role: "observer" }, { operation: "claim", sequence: 0 })).rejects.toThrow("editor")
    await expect(f.call({ operation: "claim", sequence: "0" })).rejects.toThrow("sequence")
    const lease = await f.claim(); await f.upload(lease, await f.encode(doc, 1))
    await expect(f.call({ operation: "finalize", id: lease.id })).rejects.toThrow("sequence")
    vi.useFakeTimers(); vi.setSystemTime(lease.expiresAt + 1)
    await expect(f.call({ operation: "finalize", id: lease.id })).rejects.toThrow("expired")
    expect((await f.claim()).id).not.toBe(lease.id)
    doc.destroy()
  })

  it("restores CRDT identities before replaying an older offline edit", async () => {
    const f = fixture(), primary = new Y.Doc({ gc: false }), offline = new Y.Doc({ gc: false })
    primary.getText("file").insert(0, "abc")
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(primary))
    const vector = Y.encodeStateVector(offline)
    offline.getText("file").insert(1, "offline")
    primary.getText("file").delete(0, 2)
    const lease = await f.claim(); await f.upload(lease, await f.encode(primary, 0))
    const { checkpoint } = await f.call({ operation: "finalize", id: lease.id }) as { checkpoint: EncryptedCheckpointDescriptor }
    const pieces = []
    for (let index = 0; index < checkpoint.chunkCount; index++) pieces.push((await f.call({ operation: "read", id: checkpoint.id, index }) as { data: string }).data)
    const recovered = new Y.Doc({ gc: false })
    Y.applyUpdate(recovered, await decryptPayload({ roomKeyBase64: key, envelope: bytesToEnvelope(Buffer.from(pieces.join(""), "base64")) }))
    Y.applyUpdate(recovered, Y.encodeStateAsUpdate(offline, vector))
    Y.applyUpdate(primary, Y.encodeStateAsUpdate(offline, vector))
    expect(recovered.getText("file").toString()).toBe(primary.getText("file").toString())
    expect(recovered.getText("file").toString()).toContain("offline")
    primary.destroy(); offline.destroy(); recovered.destroy()
  })
})
