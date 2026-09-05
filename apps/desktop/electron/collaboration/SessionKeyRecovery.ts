import { createHash } from "node:crypto"
import * as Y from "yjs"
import { bytesToEnvelope, decryptPayload, decryptPayloadMetadata, encryptPayload, envelopeToBytes } from "../../../../shared/collaborationCipher"
import { validateEncryptedCollaborationEnvelope } from "../../../../shared/collaborationWire"
import { SessionFileDocument } from "../../../../shared/SessionFileDocument"
import { fileInitializationOrigin, type FileInitializationLease } from "../../../../shared/collaborationFileInitialization"
import { readOfflineRecovery, saveOfflineRecovery, recoverySourceId, recoveryEntryId, type RecoverySource } from "./SessionOfflineRecovery"
import { DurableSessionStore } from "./DurableSessionStore"

export interface SessionRecoveryKey { keyVersion: number; roomKeyBase64: string }

/** Copy pending CRDT operations to durable new-key ciphertext before touching
 * the originals. Original records disappear only after the room acknowledges
 * the corresponding migrated record, through DurableSessionStore.acknowledge.
 */
export async function migrateSessionKeyRecovery(options: {
  root: string; projectId: string; sessionId: string; roomId: string
  previous: SessionRecoveryKey[]; next: SessionRecoveryKey; acknowledgedUpdate: Uint8Array
  role?: "editor" | "observer"
  claimFile?: (fileId: string) => Promise<{ lease?: FileInitializationLease; sequence?: number; waiting?: boolean }>
  canonicalState?: (sequence?: number) => Promise<Uint8Array>
}): Promise<void> {
  const { roomId, projectId, sessionId, next } = options
  const target = new DurableSessionStore(options.root, roomId, next.keyVersion)
  const copied = new Set((await target.list(roomId, next.keyVersion)).map(record => record.id))
  const acknowledged = new Y.Doc({ gc: false })
  Y.applyUpdate(acknowledged, options.acknowledgedUpdate)
  try {
    const journal = await readOfflineRecovery(target, next, sessionId)
    const keys = [...options.previous.filter(key => key.keyVersion < next.keyVersion).sort((a, b) => b.keyVersion - a.keyVersion), next]
    // Newest journal wins for partial resolution; older copies are never allowed
    // to resurrect a resolved entry after another key rotation.
    for (const key of keys) {
      if (key.keyVersion === next.keyVersion) continue
      for (const entry of (await readOfflineRecovery(new DurableSessionStore(options.root, roomId, key.keyVersion), key, sessionId)).entries) {
        if (!journal.entries.some(current => current.id === entry.id)) journal.entries.push(entry)
      }
    }
    await saveOfflineRecovery(target, next, sessionId, journal)
    const quarantined = new Set(journal.entries.flatMap(entry => entry.sources.map(recoverySourceId)))
    const rows = []
    for (const key of keys) {
      const source = new DurableSessionStore(options.root, roomId, key.keyVersion)
      for (const { record, kind } of [...(await source.list(roomId, key.keyVersion)).map(record => ({ record, kind: undefined })),
        ...(await source.listEditorIngress()).map(record => ({ record, kind: "ingress" as const }))]) {
        const ref: RecoverySource = { keyVersion: key.keyVersion, id: record.id, ...(kind ? { kind } : {}) }
        if (quarantined.has(recoverySourceId(ref))) continue
        validateEncryptedCollaborationEnvelope(record.updateBinary, { roomId, projectId, keyVersion: key.keyVersion, kind: "yjs_update" })
        const envelope = bytesToEnvelope(Buffer.from(record.updateBinary, "base64"))
        const update = await decryptPayload({ envelope, roomKeyBase64: key.roomKeyBase64 })
        const metadata = JSON.parse(Buffer.from(envelope.aad, "base64").toString()) as Record<string, unknown>
        const privateMetadata = await decryptPayloadMetadata({ envelope, roomKeyBase64: key.roomKeyBase64 })
        rows.push({ source, key, record, ref, update, metadata, privateMetadata, initialization: fileInitializationOrigin(metadata.initialization) })
      }
    }
    const predecessors = new Set(rows.flatMap(row => row.record.migratedFrom ? [recoverySourceId(row.record.migratedFrom)] : []))
    const active = rows.filter(row => !predecessors.has(recoverySourceId(row.ref)))
    const claims = new Map<string, FileInitializationLease>()
    let competing = false
    for (const row of active.filter(row => row.initialization)) {
      const origin = row.initialization!
      const claim = await options.claimFile?.(origin.fileId)
      if (claim?.sequence !== undefined && options.canonicalState) Y.applyUpdate(acknowledged, await options.canonicalState(claim.sequence))
      const missing = Y.decodeUpdate(Y.diffUpdate(row.update, Y.encodeStateVector(acknowledged)))
      if (!missing.structs.length && !missing.ds.clients.size) continue
      if (claim?.lease && options.role !== "observer") {
        if (claim.lease.keyVersion !== next.keyVersion || claim.lease.expiresAt <= Date.now()) throw new Error("File initialization authority changed during recovery; retry with the current room key")
        claims.set(recoverySourceId(row.ref), claim.lease); continue
      }
      // No new lease is permission to merge an alternative base. Observers and
      // waiting editors also retain an inspectable branch while canonical work opens.
      competing = true
    }
    if (competing) {
      const branch = new SessionFileDocument(sessionId)
      try {
        const basisRow = active.find(row => row.initialization && row.privateMetadata?.recoveryBasis)
        const basisRef = basisRow?.privateMetadata?.recoveryBasis as { id?: string; keyVersion?: number } | undefined
        let basis: Uint8Array | null = null
        if (basisRef && typeof basisRef.id === "string" && typeof basisRef.keyVersion === "number") {
          const basisKey = keys.find(key => key.keyVersion === basisRef.keyVersion)
          const encoded = await new DurableSessionStore(options.root, roomId, basisRef.keyVersion).readInitializationBasis(basisRef.id)
          if (basisKey && encoded) {
            const envelope = bytesToEnvelope(Buffer.from(encoded, "base64"))
            const metadata = JSON.parse(Buffer.from(envelope.aad, "base64").toString())
            if (envelope.keyVersion !== basisKey.keyVersion || metadata.purpose !== "file-initialization-basis" || metadata.sessionId !== sessionId || metadata.fileId !== basisRow?.initialization?.fileId) throw new Error("Initialization basis identity differs")
            basis = await decryptPayload({ envelope, roomKeyBase64: basisKey.roomKeyBase64, expectedKind: "yjs_snapshot" })
          }
        }
        if (basis) Y.applyUpdate(branch.doc, basis)
        else {
          // Legacy records predate explicit bases. Use an old checkpoint only
          // when it does not establish a competing file history.
          for (const key of [...keys].sort((a, b) => a.keyVersion - b.keyVersion)) {
            const recovery = await new DurableSessionStore(options.root, roomId, key.keyVersion).recover()
            if (!recovery.checkpoint) continue
            const envelope = bytesToEnvelope(Buffer.from(recovery.checkpoint.snapshotBinary, "base64"))
            const update = await decryptPayload({ envelope, roomKeyBase64: key.roomKeyBase64, expectedKind: "yjs_snapshot" })
            const candidate = new SessionFileDocument(sessionId)
            try {
              Y.applyUpdate(candidate.doc, update)
              if (active.some(row => row.initialization && candidate.file(row.initialization.fileId) && Y.decodeUpdate(Y.diffUpdate(row.update, Y.encodeStateVector(candidate.doc))).structs.length)) continue
              Y.applyUpdate(branch.doc, update); break
            } finally { candidate.destroy() }
          }
        }
        const localClients = new Set(rows.map(row => row.metadata.clientId).filter(value => typeof value === "string"))
        // Replay locally authored old acknowledged deltas too: some accepted deltas can
        // remain pending until their unacknowledged initializer is recovered.
        for (const key of [...keys].sort((a, b) => a.keyVersion - b.keyVersion)) {
          if (key.keyVersion === next.keyVersion) continue
          const recovery = await new DurableSessionStore(options.root, roomId, key.keyVersion).recover()
          if (basis && recovery.checkpoint) {
            const envelope = bytesToEnvelope(Buffer.from(recovery.checkpoint.snapshotBinary, "base64"))
            const update = await decryptPayload({ envelope, roomKeyBase64: key.roomKeyBase64, expectedKind: "yjs_snapshot" })
            // Covered ACK logs may already be compacted. Retain structs still
            // missing from canonical, including pending initializer dependencies,
            // without importing the competing integrated initialization history.
            Y.applyUpdate(branch.doc, Y.diffUpdate(update, Y.encodeStateVector(acknowledged)))
          }
          for (const record of recovery.updates) {
            const envelope = bytesToEnvelope(Buffer.from(record.updateBinary, "base64"))
            const metadata = JSON.parse(Buffer.from(envelope.aad, "base64").toString())
            if (basis && !localClients.has(metadata.clientId)) continue
            const origin = fileInitializationOrigin(metadata.initialization)
            if (origin && active.some(row => row.initialization?.fileId === origin.fileId && row.initialization.leaseId !== origin.leaseId)) continue
            Y.applyUpdate(branch.doc, await decryptPayload({ envelope, roomKeyBase64: key.roomKeyBase64 }))
          }
        }
        for (const row of rows.sort((a, b) => a.record.timestamp - b.record.timestamp)) Y.applyUpdate(branch.doc, row.update)
        const sources = rows.map(row => row.ref)
        const id = recoveryEntryId(sources)
        if (!journal.entries.some(entry => entry.id === id)) journal.entries.push({ id, sources, branch: Buffer.from(branch.checkpoint()).toString("base64"), files: branch.files(), incomplete: !basis || branch.files().length === 0 || branch.doc.store.pendingStructs !== null || branch.doc.store.pendingDs !== null, resolved: [], saves: {} })
        // The encrypted journal is committed before transport is allowed to
        // exclude even one old outbox/ingress record.
        await saveOfflineRecovery(target, next, sessionId, journal)
      } finally { branch.destroy() }
    } else {
      for (const row of active) {
        if (row.initialization) {
          const lease = claims.get(recoverySourceId(row.ref))
          if (!lease) {
            if (row.ref.kind === "ingress") await row.source.acknowledgeEditorIngress(row.record.id)
            else await row.source.acknowledge(row.record.id)
            continue
          }
          if (row.key.keyVersion === next.keyVersion && row.initialization.leaseId === lease.leaseId) continue
        } else if (row.key.keyVersion === next.keyVersion) continue
        const lease = claims.get(recoverySourceId(row.ref))
        const id = `rot_${createHash("sha256").update(`${row.key.keyVersion}\0${row.record.id}${lease ? `\0${lease.leaseId}` : ""}`).digest("hex")}`
        if (copied.has(id)) continue
        const encrypted = await encryptPayload({ ...next, kind: "yjs_update", plaintext: row.update,
          metadata: { ...row.metadata, roomId, projectId, sessionId, idempotencyKey: id,
            ...(lease ? { initialization: { type: "file-initialization", fileId: lease.fileId, leaseId: lease.leaseId } } : {}) },
          ...(row.privateMetadata ? { privateMetadata: row.privateMetadata } : {}) })
        await target.enqueue({ ...row.record, id, keyVersion: next.keyVersion, updateBinary: Buffer.from(envelopeToBytes(encrypted)).toString("base64"), migratedFrom: row.ref })
        copied.add(id)
      }
    }
    let projectionCopied = Boolean(await target.readProjection())
    for (const previous of keys.filter(key => key.keyVersion < next.keyVersion)) {
      if (projectionCopied) break
      const projection = await new DurableSessionStore(options.root, roomId, previous.keyVersion).readProjection()
      if (!projection) continue
      const envelope = bytesToEnvelope(Buffer.from(projection, "base64"))
      const metadata = JSON.parse(Buffer.from(envelope.aad, "base64").toString()) as Record<string, unknown>
      if (envelope.keyVersion !== previous.keyVersion || metadata.purpose !== "local-projection" || metadata.sessionId !== sessionId) throw new Error("Projection key recovery identity mismatch")
      const plaintext = await decryptPayload({ envelope, roomKeyBase64: previous.roomKeyBase64, expectedKind: "yjs_snapshot" })
      const encrypted = await encryptPayload({ ...next, kind: "yjs_snapshot", plaintext, metadata })
      await target.saveProjection(Buffer.from(envelopeToBytes(encrypted)).toString("base64")); projectionCopied = true
    }

  } finally { acknowledged.destroy() }
}
