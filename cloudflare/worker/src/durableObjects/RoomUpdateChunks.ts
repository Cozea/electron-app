import { CollaborationProtocolError, protocolId, type RoomAuthority } from "../../../../shared/collaborationProtocol"
import { COLLABORATION_CHUNK_CHARS, COLLABORATION_MAX_ENCODED_UPDATE, collaborationDigest, validateCollaborationChunk, type CollaborationChunk } from "../../../../shared/collaborationWire"
import type { RoomStorage } from "./RoomCheckpointStore"

export interface StoredSessionUpdate {
  seq: number
  updateBinary?: string
  chunkCount?: number
  totalChars?: number
  digest?: string
  principalId?: string
  keyVersion?: number
  idempotencyKey: string
  clientId: string
  timestamp: number
  retainedBytes?: number
}
interface IncomingUpload {
  identity: string
  principalId: string
  keyVersion: number
  id: string
  digest: string
  totalChars: number
  count: number
  timestamp: number
  createdAt: number
  received: number[]
}
const INCOMING_KEY = "g3:incoming-update-manifests"
const MAX_INCOMING = 8
const MAX_INCOMING_CHARS = 16 * 1024 * 1024
const INCOMING_TTL_MS = 120_000
const identity = (authority: RoomAuthority, id: string) => `${authority.principalId}:${authority.keyVersion}:${protocolId(id, "update ID")}`
const incomingPieceKey = (name: string, index: number) => `g3:incoming-piece:${name}:${index}`
export const acceptedPieceKey = (sequence: number, index: number) => `g3:update-piece:${String(sequence).padStart(16, "0")}:${index}`
export const legacyUpdateReceiptKey = (id: string): string => `g3:legacy-update-receipt:${protocolId(id, "update ID")}`
export const updateReceiptKey = (authority: RoomAuthority, id: string): string => `g3:update-receipt:${identity(authority, id)}`

/** Bounded durable assembly. Hibernation/re-instantiation preserves partial uploads.
 * Admission and completion are serialized by the enclosing room; receipt creation
 * is deliberately separate so the room can commit sequence + update + file lease.
 */
export class RoomUpdateChunks {
  private readonly storage: RoomStorage
  private readonly now: () => number
  constructor(storage: RoomStorage, now: () => number = Date.now) { this.storage = storage; this.now = now }

  async accept(authority: RoomAuthority, chunk: CollaborationChunk, timestamp: number): Promise<string | null> {
    if (!chunk || typeof chunk !== "object" || typeof chunk.id !== "string" || typeof chunk.digest !== "string") throw new CollaborationProtocolError("INVALID_CHUNK", "Encrypted update chunk is invalid")
    validateCollaborationChunk(chunk)
    if (!Number.isFinite(timestamp) || timestamp < 0 || chunk.totalChars % 4 !== 0) throw new CollaborationProtocolError("INVALID_CHUNK", "Encrypted update metadata is invalid")
    const name = identity(authority, chunk.id)
    const manifests = await this.storage.get<Record<string, IncomingUpload>>(INCOMING_KEY) ?? {}
    // The manifest inventory is bounded to eight rows, independent of session age.
    for (const upload of Object.values(manifests)) {
      if (upload.createdAt + INCOMING_TTL_MS > this.now()) continue
      await this.storage.delete(upload.received.map(index => incomingPieceKey(upload.identity, index)))
      delete manifests[upload.identity]
    }
    let upload = manifests[name]
    if (!upload) {
      if (Object.keys(manifests).length >= MAX_INCOMING || Object.values(manifests).reduce((total, item) => total + item.totalChars, 0) + chunk.totalChars > MAX_INCOMING_CHARS) throw new CollaborationProtocolError("BACKPRESSURE", "Too many incomplete updates; retry after the upload window", 429, true, 1000)
      upload = { identity: name, principalId: authority.principalId, keyVersion: authority.keyVersion, id: chunk.id, digest: chunk.digest,
        totalChars: chunk.totalChars, count: chunk.count, timestamp, createdAt: this.now(), received: [] }
    }
    if (upload.digest !== chunk.digest || upload.totalChars !== chunk.totalChars || upload.count !== chunk.count) throw new CollaborationProtocolError("IDEMPOTENCY_MISMATCH", "A pending update ID was reused with different ciphertext", 409)
    const existing = await this.storage.get<string>(incomingPieceKey(name, chunk.index))
    if (existing !== undefined && existing !== chunk.data) throw new CollaborationProtocolError("IDEMPOTENCY_MISMATCH", "An update chunk changed during retry", 409)
    const next = { ...upload, received: [...new Set([...upload.received, chunk.index])] }
    manifests[name] = next
    await this.storage.put({ [INCOMING_KEY]: manifests, [incomingPieceKey(name, chunk.index)]: chunk.data })
    if (next.received.length !== next.count) return null
    const pieces: string[] = []
    for (let index = 0; index < next.count; index++) {
      const piece = await this.storage.get<string>(incomingPieceKey(name, index))
      if (piece === undefined) throw new CollaborationProtocolError("UPLOAD_INCOMPLETE", "An update chunk is unavailable; retransmit the retained update", 409, true)
      pieces.push(piece)
    }
    const encoded = pieces.join("")
    if (encoded.length !== next.totalChars || await collaborationDigest(encoded) !== next.digest) throw new CollaborationProtocolError("CHECKSUM_MISMATCH", "Encrypted update failed its complete-payload checksum", 409)
    return encoded
  }

  async finish(authority: RoomAuthority, id: string): Promise<void> {
    const name = identity(authority, id)
    const manifests = await this.storage.get<Record<string, IncomingUpload>>(INCOMING_KEY) ?? {}
    const upload = manifests[name]
    if (!upload) return
    // Only called after the accepted update and receipt are durable. A crash
    // during cleanup leaves retryable staging, never the only acknowledged copy.
    await this.storage.delete(upload.received.map(index => incomingPieceKey(name, index)))
    delete manifests[name]
    await this.storage.put(INCOMING_KEY, manifests)
  }
}

/** At most 64 pieces + one metadata row, below the 128-entry storage.put limit. */
export async function encodeStoredUpdate(input: Omit<StoredSessionUpdate, "chunkCount" | "totalChars" | "digest"> & { updateBinary: string }): Promise<{ update: StoredSessionUpdate; pieces: Record<string, string> }> {
  const encoded = input.updateBinary
  if (encoded.length < 1 || encoded.length > COLLABORATION_MAX_ENCODED_UPDATE) throw new CollaborationProtocolError("UPDATE_TOO_LARGE", "Update exceeds the bounded encrypted transfer size")
  const digest = await collaborationDigest(encoded)
  if (encoded.length <= COLLABORATION_CHUNK_CHARS) return { update: { ...input, digest, totalChars: encoded.length }, pieces: {} }
  const count = Math.ceil(encoded.length / COLLABORATION_CHUNK_CHARS)
  const pieces: Record<string, string> = {}
  for (let index = 0; index < count; index++) pieces[acceptedPieceKey(input.seq, index)] = encoded.slice(index * COLLABORATION_CHUNK_CHARS, (index + 1) * COLLABORATION_CHUNK_CHARS)
  const { updateBinary: _encoded, ...metadata } = input
  return { update: { ...metadata, digest, totalChars: encoded.length, chunkCount: count }, pieces }
}

export async function readStoredUpdate(storage: RoomStorage, update: StoredSessionUpdate): Promise<string> {
  if (typeof update.updateBinary === "string") return update.updateBinary
  if (!Number.isSafeInteger(update.chunkCount) || !update.chunkCount || !update.totalChars || update.totalChars > COLLABORATION_MAX_ENCODED_UPDATE || update.chunkCount !== Math.ceil(update.totalChars / COLLABORATION_CHUNK_CHARS) || !update.digest) throw new CollaborationProtocolError("CHECKPOINT_REQUIRED", "Retained update metadata is invalid; recover from a checkpoint", 409, true)
  const pieces: string[] = []
  for (let index = 0; index < update.chunkCount; index++) {
    const piece = await storage.get<string>(acceptedPieceKey(update.seq, index))
    if (piece === undefined) throw new CollaborationProtocolError("CHECKPOINT_REQUIRED", "Retained update has a missing piece; recover from a checkpoint", 409, true)
    pieces.push(piece)
  }
  const encoded = pieces.join("")
  if (encoded.length !== update.totalChars || await collaborationDigest(encoded) !== update.digest) throw new CollaborationProtocolError("CHECKPOINT_REQUIRED", "Retained encrypted update failed checksum validation", 409, true)
  return encoded
}

/** Includes record and index overhead, matching the admission-time accounting. */
export function retainedUpdateBytes(update: StoredSessionUpdate): number {
  return update.retainedBytes ?? (update.updateBinary?.length ?? update.totalChars ?? 0) + update.idempotencyKey.length * 2 + 1024
}

export async function retainedRoomUsage(storage: RoomStorage): Promise<{ bytes: number; count: number }> {
  const saved = await storage.get<{ bytes: number; count: number }>("retained-usage")
  if (saved) return saved
  // One migration census, never a recurring per-update inventory.
  const usage = { bytes: 0, count: 0 }
  let start = "update:"
  while (true) {
    const entries = await storage.list<StoredSessionUpdate>({ prefix: "update:", start, limit: 128 })
    for (const update of entries.values()) { usage.bytes += retainedUpdateBytes(update); usage.count++ }
    if (entries.size < 128) break
    start = [...entries.keys()].at(-1)! + "\0"
  }
  await storage.put("retained-usage", usage)
  return usage
}
