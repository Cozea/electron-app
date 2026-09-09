import { COLLABORATION_PROTOCOL_REVISION, validateCheckpointInspection, protocolRecord, protocolSequence, type CheckpointClaimResult } from "../../../../shared/collaborationProtocol"
import * as Y from "yjs"
import { bytesToEnvelope, decryptPayload, encryptPayload, envelopeToBytes } from "../../../../shared/collaborationCipher"
import { collaborationDigest, COLLABORATION_CHUNK_CHARS, COLLABORATION_MAX_ENCODED_CHECKPOINT, validateEncryptedCollaborationEnvelope } from "../../../../shared/collaborationWire"
import type { CheckpointUploadLease, EncryptedCheckpointDescriptor } from "../../../../shared/collaborationCheckpoint"
import { DurableSessionStore } from "./DurableSessionStore"

interface CheckpointClientOptions {
  sessionId: string
  projectId: string
  roomId: string
  keyVersion: number
  roomKeyBase64: string
  role: "editor" | "observer"
  store: DurableSessionStore
  deferCompaction?: boolean
  request: (body: Record<string, unknown>) => Promise<unknown>
}

/** Electron owns decryption and durable recovery; the renderer sees file state only. */
export class SessionCheckpointClient {
  private readonly options: CheckpointClientOptions
  constructor(options: CheckpointClientOptions) { this.options = options }

  private request(body: Record<string, unknown>): Promise<unknown> {
    return this.options.request({ ...body, protocolRevision: COLLABORATION_PROTOCOL_REVISION })
  }

  private validate(descriptor: EncryptedCheckpointDescriptor): void {
    const { roomId, projectId, keyVersion } = this.options
    if (!descriptor || descriptor.generation !== 3 || descriptor.roomId !== roomId || descriptor.projectId !== projectId || descriptor.keyVersion !== keyVersion ||
      typeof descriptor.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(descriptor.id) ||
      !Number.isSafeInteger(descriptor.sequence) || descriptor.sequence < 0 ||
      !Number.isSafeInteger(descriptor.totalChars) || descriptor.totalChars < 1 || descriptor.totalChars > COLLABORATION_MAX_ENCODED_CHECKPOINT ||
      descriptor.chunkCount !== Math.ceil(descriptor.totalChars / COLLABORATION_CHUNK_CHARS) || !/^[a-f0-9]{64}$/.test(descriptor.digest)) throw new Error("Invalid encrypted checkpoint descriptor; local recovery data was retained")
  }

  private async decode(encoded: string, sequence: number, kind: "yjs_snapshot" | "yjs_update"): Promise<Uint8Array> {
    const { roomId, projectId, keyVersion, roomKeyBase64 } = this.options
    validateEncryptedCollaborationEnvelope(encoded, { roomId, projectId, keyVersion, kind })
    const envelope = bytesToEnvelope(Buffer.from(encoded, "base64"))
    const metadata = JSON.parse(Buffer.from(envelope.aad, "base64").toString("utf8")) as { snapshotBaseSeq?: unknown }
    if (kind === "yjs_snapshot" && metadata.snapshotBaseSeq !== sequence) throw new Error("Encrypted checkpoint sequence does not match")
    return decryptPayload({ roomKeyBase64, envelope })
  }

  async load(descriptor: EncryptedCheckpointDescriptor): Promise<{ sequence: number; update: Uint8Array }> {
    this.validate(descriptor)
    const pieces: string[] = []
    for (let index = 0; index < descriptor.chunkCount; index++) {
      const result = await this.request({ operation: "read", id: descriptor.id, index }) as { id: string; index: number; data: string }
      if (result.id !== descriptor.id || result.index !== index || typeof result.data !== "string" || result.data.length !== Math.min(COLLABORATION_CHUNK_CHARS, descriptor.totalChars - index * COLLABORATION_CHUNK_CHARS)) throw new Error("Checkpoint changed during download; retry recovery")
      pieces.push(result.data)
    }
    const encoded = pieces.join("")
    if (await collaborationDigest(encoded) !== descriptor.digest) throw new Error("Encrypted checkpoint checksum failed; retry recovery")
    const update = await this.decode(encoded, descriptor.sequence, "yjs_snapshot")
    // Parse Yjs before replacing the last known-good local recovery record.
    const document = new Y.Doc({ gc: false })
    try {
      Y.applyUpdate(document, update)
      if (document.store.pendingStructs !== null || document.store.pendingDs !== null) throw new Error("Checkpoint has unresolved CRDT dependencies; previous recovery was retained")
    } finally { document.destroy() }
    await this.options.store.saveCheckpoint({ generation: 3, roomId: this.options.roomId, sequence: descriptor.sequence, keyVersion: descriptor.keyVersion, snapshotBinary: encoded })
    return { sequence: descriptor.sequence, update }
  }

  async bootstrap(): Promise<{ sequence: number; update: Uint8Array } | null> {
    const local = await this.recoverLocal()
    const inspected = validateCheckpointInspection(await this.request({ operation: "inspect" }))
    if (local && local.sequence > inspected.headSequence) throw new Error("The room head is behind retained canonical recovery; no local data was replaced")
    if (inspected.checkpoint) {
      this.validate(inspected.checkpoint)
      return local && local.sequence >= inspected.checkpoint.sequence ? local : this.load(inspected.checkpoint)
    }
    if (local) throw new Error("The room lost its canonical checkpoint; local recovery data was retained")
    if (this.options.role === "observer") return null
    const claimed = await this.request({ operation: "claim", sequence: 0 }) as { lease?: CheckpointUploadLease; waiting?: boolean }
    if (!claimed.lease) return null
    // Only the elected device constructs the first CRDT history.
    const document = new Y.Doc({ gc: false })
    try {
      document.getMap("session").set("identity", { generation: 3, sessionId: this.options.sessionId })
      const descriptor = await this.upload(claimed.lease, Y.encodeStateAsUpdate(document))
      return this.load(descriptor)
    } finally { document.destroy() }
  }

  async upload(lease: CheckpointUploadLease, update: Uint8Array): Promise<EncryptedCheckpointDescriptor> {
    const { roomId, projectId, roomKeyBase64, keyVersion } = this.options
    if (this.options.role !== "editor" || lease.keyVersion !== keyVersion || lease.expiresAt <= Date.now()) throw new Error("Checkpoint lease is no longer authorized")
    const prepared = Buffer.from(envelopeToBytes(await encryptPayload({ roomKeyBase64, kind: "yjs_snapshot", keyVersion, plaintext: update, metadata: { roomId, projectId, snapshotBaseSeq: lease.sequence } }))).toString("base64")
    // AES uses a random IV. Reusing the lease must retry exactly the originally
    // prepared ciphertext, including after a crash or a lost finalization reply.
    const encoded = await this.options.store.prepareCheckpointUpload(lease.id, prepared)
    validateEncryptedCollaborationEnvelope(encoded, { roomId, projectId, kind: "yjs_snapshot", keyVersion })
    const digest = await collaborationDigest(encoded)
    for (let offset = 0; offset < encoded.length; offset += COLLABORATION_CHUNK_CHARS) await this.request({ operation: "upload", id: lease.id, index: offset / COLLABORATION_CHUNK_CHARS, totalChars: encoded.length, digest, data: encoded.slice(offset, offset + COLLABORATION_CHUNK_CHARS) })
    const finalized = await this.request({ operation: "finalize", id: lease.id }) as { checkpoint: EncryptedCheckpointDescriptor }
    this.validate(finalized.checkpoint)
    if (finalized.checkpoint.digest !== digest || finalized.checkpoint.sequence !== lease.sequence) throw new Error("Checkpoint finalization differs from the prepared state")
    return finalized.checkpoint
  }

  async recoverLocal(): Promise<{ sequence: number; update: Uint8Array } | null> {
    const recovered = await this.options.store.recover()
    if (!recovered.checkpoint) return null
    const document = new Y.Doc({ gc: false })
    try {
      let sequence = recovered.checkpoint.sequence
      Y.applyUpdate(document, await this.decode(recovered.checkpoint.snapshotBinary, sequence, "yjs_snapshot"))
      for (const entry of recovered.updates) {
        Y.applyUpdate(document, await this.decode(entry.updateBinary, entry.sequence, "yjs_update"))
        sequence = entry.sequence
      }
      return { sequence, update: Y.encodeStateAsUpdate(document) }
    } finally { document.destroy() }
  }

  async compact(descriptor: EncryptedCheckpointDescriptor): Promise<void> {
    this.validate(descriptor)
    if (this.options.role !== "editor") throw new Error("Only an editor may compact canonical replay")
    // A finalized remote blob alone is not enough: this exact replacement must
    // already be a verified durable local checkpoint before asking for removal.
    const recovered = await this.options.store.recover()
    if (!recovered.checkpoint || recovered.checkpoint.sequence !== descriptor.sequence || await collaborationDigest(recovered.checkpoint.snapshotBinary) !== descriptor.digest) throw new Error("Save the verified checkpoint before compacting room history")
    let previousRemoved = -1
    for (let page = 0; page < 1024; page++) {
      const result = protocolRecord(await this.request({ operation: "compact", id: descriptor.id }), "Checkpoint compaction")
      const floor = protocolSequence(result.compactionFloor, "compactionFloor")
      const removed = protocolSequence(result.removedUpdates, "removedUpdates")
      if (result.checkpointId !== descriptor.id || floor !== descriptor.sequence || typeof result.hasMore !== "boolean") throw new Error("Compaction receipt does not match the verified checkpoint")
      if (!result.hasMore) return
      if (removed === 0 && previousRemoved === 0) throw new Error("Compaction made no progress; local recovery was retained")
      previousRemoved = removed
    }
    throw new Error("Compaction exceeded its bounded batch limit; retry maintenance")
  }

  async checkpoint(sequence: number, update: Uint8Array): Promise<boolean> {
    if (this.options.role !== "editor") return false
    const result = await this.request({ operation: "claim", sequence }) as CheckpointClaimResult
    if (!result.lease && !result.checkpoint) return false
    const descriptor = result.checkpoint ?? await this.upload(result.lease!, update)
    await this.load(descriptor)
    if (!this.options.deferCompaction) await this.compact(descriptor)
    return true
  }
}
