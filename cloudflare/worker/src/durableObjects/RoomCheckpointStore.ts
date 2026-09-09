import type { CheckpointUploadLease, EncryptedCheckpointDescriptor } from "../../../../shared/collaborationCheckpoint"
import type { FileInitializationLease, FileInitializationOrigin } from "../../../../shared/collaborationFileInitialization"
import { CHECKPOINT_LEASE_MS, CHECKPOINT_UPLOAD_LIFETIME_MS, FILE_INITIALIZATION_LEASE_MS, COLLABORATION_PROTOCOL_REVISION, CollaborationProtocolError, type CheckpointRequest, type RoomAuthority, type CheckpointInspection, type CheckpointClaimResult, type FileClaimResult } from "../../../../shared/collaborationProtocol"
import { COLLABORATION_CHUNK_CHARS, collaborationDigest, decodeCanonicalBase64, validateEncryptedCollaborationEnvelope } from "../../../../shared/collaborationWire"

/** Structural subset shared by the real room storage and crash-test adapters. */
export interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  put(entries: Record<string, unknown>): Promise<void>
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  list<T>(options?: { prefix?: string; start?: string; end?: string; limit?: number }): Promise<Map<string, T>>
  transaction<T>(closure: (storage: RoomStorage) => Promise<T>): Promise<T>
}
interface Upload { lease: CheckpointUploadLease; createdAt: number; totalChars?: number; digest?: string; received: number[] }
interface Binding { roomId: string; projectId: string; sessionId: string }
const uploadKey = (id: string) => `g3:checkpoint-upload:${id}`
const descriptorKey = (id: string) => `g3:checkpoint-descriptor:${id}`
const pieceKey = (id: string, index: number) => `g3:checkpoint-piece:${id}:${String(index).padStart(4, "0")}`
const activeKey = (version: number) => `g3:checkpoint-active:${version}`
const leaseKey = (version: number) => `g3:checkpoint-lease:${version}`
const fileKey = (id: string) => `g3:file-initialization:${id}`
const ALLOCATED_KEY = "g3:checkpoint-allocated-chars"
const MAX_ALLOCATED_CHARS = 128 * 1024 * 1024
export const ROOM_BINDING_KEY = "g3:binding"
export const ROOM_COMPACTION_FLOOR_KEY = "g3:compaction-floor"

/** All methods are called through the room's single update/checkpoint queue.
 * A finalized descriptor is the commit point: partial uploads are never canonical.
 * This store never prunes updates merely because Git publication advanced.
 */
export class RoomCheckpointStore {
  constructor(private readonly storage: RoomStorage, private readonly now: () => number = Date.now) {}

  async bind(authority: RoomAuthority): Promise<void> {
    if (authority.roomId !== `session:${authority.sessionId}`) throw new CollaborationProtocolError("SESSION_MISMATCH", "Checkpoint room binding is invalid", 403)
    await this.storage.transaction(async storage => {
      const previous = await storage.get<Binding>(ROOM_BINDING_KEY)
      if (previous && (previous.roomId !== authority.roomId || previous.projectId !== authority.projectId || previous.sessionId !== authority.sessionId)) throw new CollaborationProtocolError("SESSION_MISMATCH", "Durable room belongs to another session", 403)
      if (!previous) await storage.put(ROOM_BINDING_KEY, { roomId: authority.roomId, projectId: authority.projectId, sessionId: authority.sessionId })
    })
  }

  async current(keyVersion: number): Promise<EncryptedCheckpointDescriptor | null> {
    return await this.storage.get<EncryptedCheckpointDescriptor>(activeKey(keyVersion)) ?? null
  }

  async handle(authority: RoomAuthority, request: CheckpointRequest): Promise<unknown> {
    await this.bind(authority)
    if (request.operation === "inspect") {
      const result: CheckpointInspection = { generation: 3, protocolRevision: COLLABORATION_PROTOCOL_REVISION,
        headSequence: await this.storage.get<number>("head-sequence") ?? 0, compactionFloor: await this.storage.get<number>(ROOM_COMPACTION_FLOOR_KEY) ?? 0,
        checkpoint: await this.current(authority.keyVersion) }
      return result
    }
    if (request.operation === "read") {
      const descriptor = await this.storage.get<EncryptedCheckpointDescriptor>(descriptorKey(request.id))
      if (!descriptor || descriptor.keyVersion !== authority.keyVersion || descriptor.roomId !== authority.roomId || descriptor.projectId !== authority.projectId || request.index >= descriptor.chunkCount) throw new CollaborationProtocolError("CHECKPOINT_REQUIRED", "Checkpoint is unavailable for this room/key; retry inspection", 409, true)
      const data = await this.storage.get<string>(pieceKey(request.id, request.index))
      if (data === undefined) throw new CollaborationProtocolError("CHECKPOINT_REQUIRED", "Checkpoint chunk is unavailable; local recovery remains retained", 409, true)
      return { id: request.id, index: request.index, data }
    }
    if (request.operation === "file.claim") return this.claimFile(authority, request.fileId)
    this.requireWriter(authority)
    if (request.operation === "claim") return this.claim(authority, request.sequence)
    if (request.operation === "upload") return this.upload(authority, request)
    return this.finalize(authority, request.id)
  }

  private requireWriter(authority: RoomAuthority): void {
    if (authority.role !== "editor") throw new CollaborationProtocolError("READ_ONLY", "Observers cannot publish shared updates or checkpoints", 403)
    if (authority.rotationRequired && !authority.previousKeyVersion) throw new CollaborationProtocolError("KEY_ROTATION_REQUIRED", "Complete room key rotation before publishing", 409, true)
  }

  private async claim(authority: RoomAuthority, sequence: number): Promise<CheckpointClaimResult> {
    const head = await this.storage.get<number>("head-sequence") ?? 0
    const floor = await this.storage.get<number>(ROOM_COMPACTION_FLOOR_KEY) ?? 0
    const current = await this.current(authority.keyVersion)
    if (sequence > head || sequence < floor || (current && sequence < current.sequence)) throw new CollaborationProtocolError("INVALID_SEQUENCE", "Checkpoint sequence is outside canonical room history", 409, true)
    if (!current && head > 0 && !authority.previousKeyVersion) throw new CollaborationProtocolError("CHECKPOINT_REQUIRED", "Room history has no canonical checkpoint; do not create a new history over retained updates", 409, true)
    const old = await this.storage.get<CheckpointUploadLease>(leaseKey(authority.keyVersion))
    if (old && old.expiresAt > this.now()) {
      if (old.principalId === authority.principalId && old.sequence === sequence) return { lease: old }
      return { waiting: true, retryAfterMs: Math.min(1000, old.expiresAt - this.now()) }
    }
    if (old) await this.retireIncomplete(old.id)
    const lease: CheckpointUploadLease = { id: crypto.randomUUID(), principalId: authority.principalId, sequence, keyVersion: authority.keyVersion, expiresAt: this.now() + CHECKPOINT_LEASE_MS }
    const upload: Upload = { lease, createdAt: this.now(), received: [] }
    await this.storage.put({ [leaseKey(authority.keyVersion)]: lease, [uploadKey(lease.id)]: upload })
    return { lease }
  }

  private async authorizedUpload(authority: RoomAuthority, id: string): Promise<Upload> {
    const upload = await this.storage.get<Upload>(uploadKey(id))
    const active = await this.storage.get<CheckpointUploadLease>(leaseKey(authority.keyVersion))
    if (!upload || !active || active.id !== id || upload.lease.principalId !== authority.principalId || upload.lease.keyVersion !== authority.keyVersion || upload.lease.expiresAt <= this.now()) throw new CollaborationProtocolError("LEASE_EXPIRED", "Checkpoint upload lease expired; inspect and claim again", 409, true)
    return upload
  }

  private async upload(authority: RoomAuthority, request: Extract<CheckpointRequest, { operation: "upload" }>): Promise<{ stored: true }> {
    const finalized = await this.storage.get<EncryptedCheckpointDescriptor>(descriptorKey(request.id))
    if (finalized) {
      if (finalized.keyVersion !== authority.keyVersion || finalized.roomId !== authority.roomId || finalized.totalChars !== request.totalChars || finalized.digest !== request.digest || await this.storage.get<string>(pieceKey(request.id, request.index)) !== request.data) throw new CollaborationProtocolError("UPLOAD_MISMATCH", "Finalized checkpoint cannot be replaced", 409)
      return { stored: true }
    }
    const upload = await this.authorizedUpload(authority, request.id)
    if (upload.totalChars !== undefined && (upload.totalChars !== request.totalChars || upload.digest !== request.digest)) throw new CollaborationProtocolError("UPLOAD_MISMATCH", "Checkpoint lease must retry its original ciphertext", 409)
    const existing = await this.storage.get<string>(pieceKey(request.id, request.index))
    if (existing !== undefined && existing !== request.data) throw new CollaborationProtocolError("UPLOAD_MISMATCH", "Checkpoint chunk changed during retry", 409)
    const allocated = await this.storage.get<number>(ALLOCATED_KEY) ?? 0
    const incoming = upload.totalChars === undefined ? request.totalChars : 0
    if (allocated + incoming > MAX_ALLOCATED_CHARS) throw new CollaborationProtocolError("RETENTION_LIMIT", "Checkpoint retention budget reached; retained checkpoints are not evicted to make room", 507, true)
    const lease = { ...upload.lease, expiresAt: Math.min(upload.createdAt + CHECKPOINT_UPLOAD_LIFETIME_MS, this.now() + CHECKPOINT_LEASE_MS) }
    const next: Upload = { ...upload, lease, totalChars: request.totalChars, digest: request.digest, received: [...new Set([...upload.received, request.index])] }
    await this.storage.put({ [pieceKey(request.id, request.index)]: request.data, [uploadKey(request.id)]: next, [leaseKey(authority.keyVersion)]: lease, [ALLOCATED_KEY]: allocated + incoming })
    return { stored: true }
  }

  private async finalize(authority: RoomAuthority, id: string): Promise<{ checkpoint: EncryptedCheckpointDescriptor }> {
    const previous = await this.storage.get<EncryptedCheckpointDescriptor>(descriptorKey(id))
    if (previous) {
      if (previous.keyVersion !== authority.keyVersion || previous.roomId !== authority.roomId) throw new CollaborationProtocolError("SESSION_MISMATCH", "Checkpoint receipt belongs to another key or room", 403)
      return { checkpoint: previous }
    }
    const upload = await this.authorizedUpload(authority, id)
    if (!upload.totalChars || !upload.digest) throw new CollaborationProtocolError("UPLOAD_INCOMPLETE", "Checkpoint upload has no chunks", 409, true)
    const count = Math.ceil(upload.totalChars / COLLABORATION_CHUNK_CHARS)
    if (upload.received.length !== count) throw new CollaborationProtocolError("UPLOAD_INCOMPLETE", "Checkpoint upload is incomplete", 409, true)
    const pieces: string[] = []
    for (let index = 0; index < count; index++) {
      const piece = await this.storage.get<string>(pieceKey(id, index))
      if (piece === undefined) throw new CollaborationProtocolError("UPLOAD_INCOMPLETE", "Checkpoint chunk is missing", 409, true)
      pieces.push(piece)
    }
    const encoded = pieces.join("")
    if (encoded.length !== upload.totalChars || await collaborationDigest(encoded) !== upload.digest) throw new CollaborationProtocolError("CHECKSUM_MISMATCH", "Checkpoint ciphertext digest does not match", 409)
    validateEncryptedCollaborationEnvelope(encoded, { roomId: authority.roomId, projectId: authority.projectId, keyVersion: authority.keyVersion, kind: "yjs_snapshot" })
    const outer = JSON.parse(new TextDecoder().decode(decodeCanonicalBase64(encoded, upload.totalChars))) as { aad: string }
    const metadata = JSON.parse(new TextDecoder().decode(decodeCanonicalBase64(outer.aad, 8192))) as { snapshotBaseSeq?: unknown }
    if (metadata.snapshotBaseSeq !== upload.lease.sequence) throw new CollaborationProtocolError("INVALID_SEQUENCE", "Encrypted checkpoint sequence differs from its lease", 409)
    const checkpoint: EncryptedCheckpointDescriptor = { generation: 3, id, roomId: authority.roomId, projectId: authority.projectId, sequence: upload.lease.sequence,
      keyVersion: authority.keyVersion, totalChars: upload.totalChars, chunkCount: count, digest: upload.digest, createdAt: this.now() }
    await this.storage.transaction(async storage => {
      const live = await storage.get<CheckpointUploadLease>(leaseKey(authority.keyVersion))
      const current = await storage.get<EncryptedCheckpointDescriptor>(activeKey(authority.keyVersion))
      if (live?.id !== id || live.expiresAt <= this.now() || (current && current.sequence > checkpoint.sequence)) throw new CollaborationProtocolError("LEASE_EXPIRED", "Checkpoint finalization lost its lease", 409, true)
      await storage.put({ [descriptorKey(id)]: checkpoint, [activeKey(authority.keyVersion)]: checkpoint })
      await storage.delete([leaseKey(authority.keyVersion), uploadKey(id)])
    })
    return { checkpoint }
  }

  private async claimFile(authority: RoomAuthority, fileId: string): Promise<FileClaimResult> {
    const existing = await this.storage.get<FileInitializationLease>(fileKey(fileId))
    if (existing?.sequence !== undefined) return { sequence: existing.sequence }
    if (authority.role === "observer") return { waiting: true, retryAfterMs: 1000 }
    this.requireWriter(authority)
    if (!await this.current(authority.keyVersion)) throw new CollaborationProtocolError("CHECKPOINT_REQUIRED", "Initialize the session checkpoint before opening shared files", 409, true)
    if (existing && existing.expiresAt > this.now() && existing.keyVersion === authority.keyVersion) return existing.principalId === authority.principalId ? { lease: existing } : { waiting: true, retryAfterMs: 1000 }
    if (!existing) {
      const count = await this.storage.get<number>("g3:file-initialization-count") ?? 0
      if (count >= 10_000) throw new CollaborationProtocolError("RETENTION_LIMIT", "Shared file initialization limit reached", 409, true)
      const lease: FileInitializationLease = { fileId, leaseId: crypto.randomUUID(), principalId: authority.principalId, keyVersion: authority.keyVersion, expiresAt: this.now() + FILE_INITIALIZATION_LEASE_MS }
      await this.storage.put({ [fileKey(fileId)]: lease, "g3:file-initialization-count": count + 1 })
      return { lease }
    }
    const lease: FileInitializationLease = { fileId, leaseId: crypto.randomUUID(), principalId: authority.principalId, keyVersion: authority.keyVersion, expiresAt: this.now() + FILE_INITIALIZATION_LEASE_MS }
    await this.storage.put(fileKey(fileId), lease)
    return { lease }
  }

  /** Include this dictionary in the same durable write as update and ACK identity. */
  async initializationReceipt(authority: RoomAuthority, origin: FileInitializationOrigin, sequence: number): Promise<Record<string, unknown>> {
    const lease = await this.storage.get<FileInitializationLease>(fileKey(origin.fileId))
    if (!lease || lease.leaseId !== origin.leaseId || lease.principalId !== authority.principalId || lease.keyVersion !== authority.keyVersion || lease.expiresAt <= this.now() || lease.sequence !== undefined) throw new CollaborationProtocolError("CHECKPOINT_REQUIRED", "File initialization lease changed; retain and reconcile the old local history", 409, true)
    return { [fileKey(origin.fileId)]: { ...lease, sequence } }
  }

  private async retireIncomplete(id: string): Promise<void> {
    const upload = await this.storage.get<Upload>(uploadKey(id))
    if (!upload || await this.storage.get(descriptorKey(id))) return
    for (let index = 0; index < upload.received.length; index += 128) await this.storage.delete(upload.received.slice(index, index + 128).map(piece => pieceKey(id, piece)))
    await this.storage.transaction(async storage => {
      if (!await storage.get(uploadKey(id))) return
      const allocated = await storage.get<number>(ALLOCATED_KEY) ?? 0
      await storage.put(ALLOCATED_KEY, Math.max(0, allocated - (upload.totalChars ?? 0)))
      await storage.delete(uploadKey(id))
    })
  }
}
