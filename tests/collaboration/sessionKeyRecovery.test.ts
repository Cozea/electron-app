import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"
import { expect, it } from "vitest"
import { DurableSessionStore } from "../../apps/desktop/electron/collaboration/DurableSessionStore"
import { migrateSessionKeyRecovery } from "../../apps/desktop/electron/collaboration/SessionKeyRecovery"
import { bytesToEnvelope, decryptPayload, encryptPayload, envelopeToBytes } from "../../shared/collaborationCipher"

it("re-encrypts older offline edits once, retaining their identities and originals through durable acknowledgement", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-rotation-"))
  const first = { keyVersion: 1, roomKeyBase64: Buffer.alloc(32, 1).toString("base64") }
  const next = { keyVersion: 2, roomKeyBase64: Buffer.alloc(32, 2).toString("base64") }
  const original = new Y.Doc({ gc: false }), offline = new Y.Doc({ gc: false }), current = new Y.Doc({ gc: false })
  try {
    original.getText("file").insert(0, "base")
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(original)); Y.applyUpdate(current, Y.encodeStateAsUpdate(original))
    const vector = Y.encodeStateVector(offline)
    offline.getText("file").insert(0, "offline ")
    current.getText("file").insert(4, " live")
    const update = Y.encodeStateAsUpdate(offline, vector)
    const envelope = await encryptPayload({ ...first, kind: "yjs_update", plaintext: update, metadata: { roomId: "session:s", projectId: "p", idempotencyKey: "old-edit" } })
    const source = new DurableSessionStore(root, "session:s")
    await source.enqueue({ id: "old-edit", projectId: "p", roomId: "session:s", keyVersion: 1, updateBinary: Buffer.from(envelopeToBytes(envelope)).toString("base64"), timestamp: 1 })
    const projection = await encryptPayload({ ...first, kind: "yjs_snapshot", plaintext: Buffer.from("retained projection"), metadata: { purpose: "local-projection", sessionId: "s" } })
    await source.saveProjection(Buffer.from(envelopeToBytes(projection)).toString("base64"))
    const options = { root, projectId: "p", sessionId: "s", roomId: "session:s", previous: [first], next, acknowledgedUpdate: Y.encodeStateAsUpdate(current) }
    await migrateSessionKeyRecovery(options)
    const target = new DurableSessionStore(root, "session:s", 2)
    const [migrated] = await target.list("session:s", 2)
    expect(await source.list("session:s", 1)).toHaveLength(1)
    await migrateSessionKeyRecovery(options)
    expect(await target.list("session:s", 2)).toEqual([migrated])
    const encoded = bytesToEnvelope(Buffer.from(migrated!.updateBinary, "base64"))
    await expect(decryptPayload({ envelope: encoded, roomKeyBase64: first.roomKeyBase64 })).rejects.toThrow()
    const plain = await decryptPayload({ envelope: encoded, roomKeyBase64: next.roomKeyBase64 })
    expect(plain).toEqual(update)
    Y.applyUpdate(current, plain)
    expect(current.getText("file").toString()).toBe("offline base live")
    const projected = await decryptPayload({ envelope: bytesToEnvelope(Buffer.from((await target.readProjection())!, "base64")), roomKeyBase64: next.roomKeyBase64 })
    expect(Buffer.from(projected).toString()).toBe("retained projection")
    await target.acknowledge(migrated!.id)
    expect(await source.list("session:s", 1)).toEqual([])
    expect(await target.list("session:s", 2)).toEqual([])
    await migrateSessionKeyRecovery(options)
    expect(await target.list("session:s", 2)).toEqual([])
  } finally { original.destroy(); offline.destroy(); current.destroy(); await fs.rm(root, { recursive: true, force: true }) }
})
