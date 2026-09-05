import * as Y from "yjs"
import fs from "node:fs/promises"
import { bytesToEnvelope, decryptPayload } from "../../../../shared/collaborationCipher"
import { validateEncryptedCollaborationEnvelope } from "../../../../shared/collaborationWire"
import { DurableSessionStore } from "./DurableSessionStore"
import { readOfflineRecovery } from "./SessionOfflineRecovery"
import { inventoryRecoveryStorage } from "./RecoveryStorageBudget"
import type { SessionRecoveryKey } from "./SessionKeyRecovery"
import type { CollaborationRecoveryCleanupResult } from "../../../../shared/collaborationRecovery"

/** Host must exclude session start, active runtimes and maintenance for this whole
 * operation. An initializer persists its basis before its outbox row exists. */
export async function compactQuiescentInitializationBases(input: {
  root: string; projectId: string; sessionId: string; current: SessionRecoveryKey; keys: SessionRecoveryKey[]
}): Promise<CollaborationRecoveryCleanupResult & { unusedKeyVersions: number[] }> {
  const empty = { files: 0, bytes: 0, unusedKeyVersions: [] as number[] }
  const roomId = `session:${input.sessionId}`
  if (!input.keys.length || input.keys.length > 64 || new Set(input.keys.map(key => key.keyVersion)).size !== input.keys.length ||
    !input.keys.some(key => key.keyVersion === input.current.keyVersion && key.roomKeyBase64 === input.current.roomKeyBase64)) throw new Error("Recovery key inventory is incomplete")
  await inventoryRecoveryStorage(input.root)
  const stores = input.keys.map(key => ({ key, store: new DurableSessionStore(input.root, roomId, key.keyVersion) }))
  // Include every retained epoch, including a not-yet-activated rotation key.
  // Unknown or still-referenced histories are never garbage-collected.
  for (const { key, store } of stores) {
    if ((await store.list(roomId, key.keyVersion)).length || (await store.listEditorIngress()).length) return empty
    if ((await readOfflineRecovery(store, key, input.sessionId)).entries.length) return empty
  }
  const currentStore = stores.find(item => item.key.keyVersion === input.current.keyVersion)!.store
  const { checkpoint } = await currentStore.recover()
  if (!checkpoint) return empty
  if (checkpoint.generation !== 3 || checkpoint.keyVersion !== input.current.keyVersion || !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0) throw new Error("Recovery checkpoint metadata is invalid")
  validateEncryptedCollaborationEnvelope(checkpoint.snapshotBinary, { roomId, projectId: input.projectId, kind: "yjs_snapshot", keyVersion: input.current.keyVersion })
  const envelope = bytesToEnvelope(Buffer.from(checkpoint.snapshotBinary, "base64"))
  const metadata = JSON.parse(Buffer.from(envelope.aad, "base64").toString())
  if (metadata.snapshotBaseSeq !== checkpoint.sequence || metadata.sessionId !== undefined && metadata.sessionId !== input.sessionId) throw new Error("Recovery checkpoint identity differs")
  const checkpointUpdate = await decryptPayload({ envelope, roomKeyBase64: input.current.roomKeyBase64, expectedKind: "yjs_snapshot" })
  const canonical = new Y.Doc({ gc: false })
  try {
    Y.applyUpdate(canonical, checkpointUpdate)
    if (canonical.store.pendingStructs !== null || canonical.store.pendingDs !== null) return empty
    const before = Buffer.from(Y.encodeStateAsUpdate(canonical))
    const plans = []
    for (const { key, store } of stores) {
      const covered = []
      for (const record of await store.listInitializationBases()) {
        const basisEnvelope = bytesToEnvelope(Buffer.from(record.encoded, "base64"))
        const identity = JSON.parse(Buffer.from(basisEnvelope.aad, "base64").toString())
        if (basisEnvelope.keyVersion !== key.keyVersion || identity.purpose !== "file-initialization-basis" || identity.sessionId !== input.sessionId ||
          typeof identity.fileId !== "string" || !/^[a-f0-9]{64}$/.test(identity.fileId)) throw new Error("Initialization basis identity differs; recovery was retained")
        const update = await decryptPayload({ envelope: basisEnvelope, roomKeyBase64: key.roomKeyBase64, expectedKind: "yjs_snapshot" })
        const merged = new Y.Doc({ gc: false })
        try {
          Y.applyUpdate(merged, checkpointUpdate); Y.applyUpdate(merged, update)
          // State vectors alone omit delete sets and pending dependency structs.
          if (merged.store.pendingStructs === null && merged.store.pendingDs === null && before.equals(Buffer.from(Y.encodeStateAsUpdate(merged)))) covered.push(record)
        } finally { merged.destroy() }
      }
      plans.push({ store, covered })
    }
    // Validate the complete bounded plan before deleting any selected basis.
    const result = { files: 0, bytes: 0, unusedKeyVersions: [] as number[] }
    for (const { store, covered } of plans) {
      const removed = await store.retireInitializationBases(covered)
      result.files += removed.files; result.bytes += removed.bytes
    }
    // Projection receipts and all unknown records pin their keys. Retire only
    // an older key with literally no remaining epoch data or cross-epoch journal.
    if (!(await Promise.all(stores.map(({ store }) => store.readProjection()))).some(Boolean)) {
      for (const { key, store } of stores) {
        if (key.keyVersion >= input.current.keyVersion) continue
        const entries = await fs.readdir(store.directory, { withFileTypes: true })
        if (entries.every(entry => key.keyVersion === 1 && entry.name === "keys" && entry.isDirectory())) result.unusedKeyVersions.push(key.keyVersion)
      }
    }
    return result
  } finally { canonical.destroy() }
}
