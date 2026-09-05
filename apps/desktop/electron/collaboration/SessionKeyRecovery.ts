import { createHash } from "node:crypto"
import * as Y from "yjs"
import { bytesToEnvelope, decryptPayload, decryptPayloadMetadata, encryptPayload, envelopeToBytes } from "../../../../shared/collaborationCipher"
import { validateEncryptedCollaborationEnvelope } from "../../../../shared/collaborationWire"
import { DurableSessionStore } from "./DurableSessionStore"

export interface SessionRecoveryKey { keyVersion: number; roomKeyBase64: string }

/** Copy pending CRDT operations to durable new-key ciphertext before touching
 * the originals. Original records disappear only after the room acknowledges
 * the corresponding migrated record, through DurableSessionStore.acknowledge.
 */
export async function migrateSessionKeyRecovery(options: {
  root: string; projectId: string; sessionId: string; roomId: string
  previous: SessionRecoveryKey[]; next: SessionRecoveryKey; acknowledgedUpdate: Uint8Array
}): Promise<void> {
  const { roomId, projectId, sessionId, next } = options
  const target = new DurableSessionStore(options.root, roomId, next.keyVersion)
  const copied = new Set((await target.list(roomId, next.keyVersion)).map(record => record.id))
  const acknowledged = new Y.Doc({ gc: false })
  Y.applyUpdate(acknowledged, options.acknowledgedUpdate)
  try {
    let projectionCopied = Boolean(await target.readProjection())
    for (const previous of [...options.previous].filter(key => key.keyVersion < next.keyVersion).sort((a, b) => b.keyVersion - a.keyVersion)) {
      const source = new DurableSessionStore(options.root, roomId, previous.keyVersion)
      const records = [...(await source.list(roomId, previous.keyVersion)).map(record => ({ record, kind: undefined })),
        ...(await source.listEditorIngress()).map(record => ({ record, kind: "ingress" as const }))]
      for (const { record, kind } of records) {
        const id = `rot_${createHash("sha256").update(`${previous.keyVersion}\0${record.id}`).digest("hex")}`
        if (copied.has(id)) continue
        validateEncryptedCollaborationEnvelope(record.updateBinary, { roomId, projectId, keyVersion: previous.keyVersion, kind: "yjs_update" })
        const envelope = bytesToEnvelope(Buffer.from(record.updateBinary, "base64"))
        const update = await decryptPayload({ envelope, roomKeyBase64: previous.roomKeyBase64 })
        const metadata = JSON.parse(Buffer.from(envelope.aad, "base64").toString()) as Record<string, unknown>
        if (metadata.initialization) {
          // An acknowledged initializer is already in the durable checkpoint.
          // An unaccepted competing history must not be merged as another base.
          const missing = Y.decodeUpdate(Y.diffUpdate(update, Y.encodeStateVector(acknowledged)))
          if (missing.structs.length || missing.ds.clients.size) throw new Error("An interrupted file initialization needs its canonical history recovered before key rotation replay; local files were retained")
          await source.acknowledge(record.id)
          continue
        }
        const privateMetadata = await decryptPayloadMetadata({ envelope, roomKeyBase64: previous.roomKeyBase64 })
        const encrypted = await encryptPayload({ ...next, kind: "yjs_update", plaintext: update,
          metadata: { ...metadata, roomId, projectId, sessionId, idempotencyKey: id }, ...(privateMetadata ? { privateMetadata } : {}) })
        await target.enqueue({ ...record, id, keyVersion: next.keyVersion, updateBinary: Buffer.from(envelopeToBytes(encrypted)).toString("base64"), migratedFrom: { keyVersion: previous.keyVersion, id: record.id, ...(kind ? { kind } : {}) } })
        copied.add(id)
      }
      if (!projectionCopied) {
        const projection = await source.readProjection()
        if (projection) {
          const envelope = bytesToEnvelope(Buffer.from(projection, "base64"))
          const metadata = JSON.parse(Buffer.from(envelope.aad, "base64").toString()) as Record<string, unknown>
          if (envelope.keyVersion !== previous.keyVersion || metadata.purpose !== "local-projection" || metadata.sessionId !== sessionId) throw new Error("Projection key recovery identity mismatch")
          const plaintext = await decryptPayload({ envelope, roomKeyBase64: previous.roomKeyBase64, expectedKind: "yjs_snapshot" })
          const encrypted = await encryptPayload({ ...next, kind: "yjs_snapshot", plaintext, metadata })
          await target.saveProjection(Buffer.from(envelopeToBytes(encrypted)).toString("base64")); projectionCopied = true
        }
      }
    }
  } finally { acknowledged.destroy() }
}
