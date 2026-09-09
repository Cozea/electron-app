import type { CheckpointUploadLease, EncryptedCheckpointDescriptor } from "./collaborationCheckpoint"
import type { FileInitializationLease } from "./collaborationFileInitialization"
import { COLLABORATION_CHUNK_CHARS, COLLABORATION_MAX_ENCODED_CHECKPOINT } from "./collaborationWire"

/** Wire revision is independent from the CRDT identity generation and local schema. */
export const COLLABORATION_PROTOCOL_REVISION = 1
export const CHECKPOINT_LEASE_MS = 120_000
export const CHECKPOINT_UPLOAD_LIFETIME_MS = 10 * 60_000
export const FILE_INITIALIZATION_LEASE_MS = 60_000

export class CollaborationProtocolError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400, readonly recoverable = false, readonly retryAfterMs?: number) {
    super(message)
    this.name = "CollaborationProtocolError"
  }
}

export interface RoomAuthority {
  principalId: string
  projectId: string
  sessionId: string
  roomId: string
  role: "editor" | "observer"
  keyVersion: number
  rotationRequired?: boolean
  previousKeyVersion?: number
}

export type CheckpointRequest =
  | { operation: "inspect" }
  | { operation: "claim"; sequence: number }
  | { operation: "upload"; id: string; index: number; totalChars: number; digest: string; data: string }
  | { operation: "finalize"; id: string }
  | { operation: "read"; id: string; index: number }
  | { operation: "file.claim"; fileId: string }

export interface CheckpointInspection {
  generation: 3
  protocolRevision: typeof COLLABORATION_PROTOCOL_REVISION
  headSequence: number
  compactionFloor: number
  checkpoint: EncryptedCheckpointDescriptor | null
}
export interface CheckpointClaimResult { lease?: CheckpointUploadLease; waiting?: boolean; retryAfterMs?: number }
export interface FileClaimResult { lease?: FileInitializationLease; sequence?: number; waiting?: boolean; retryAfterMs?: number }

export function protocolRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CollaborationProtocolError("INVALID_REQUEST", `${label} must be an object`)
  return value as Record<string, unknown>
}
export function protocolId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new CollaborationProtocolError("INVALID_REQUEST", `${label} is invalid`)
  return value
}
export function protocolSequence(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new CollaborationProtocolError("INVALID_REQUEST", `${label} is invalid`)
  return value
}
export function requireProtocolRevision(value: unknown): void {
  if (value !== COLLABORATION_PROTOCOL_REVISION) throw new CollaborationProtocolError("PROTOCOL_MISMATCH", "The collaboration client and server require the same checkpoint protocol revision; local recovery was retained", 409)
}
export function isCheckpointRead(request: CheckpointRequest): boolean {
  // file.claim is also an observation when the caller is an observer. The room
  // returns an existing initialization receipt or waiting, never an editor lease.
  return request.operation === "inspect" || request.operation === "read" || request.operation === "file.claim"
}

export function parseRoomAuthority(value: unknown): RoomAuthority {
  const record = protocolRecord(value, "Room authority")
  const sessionId = protocolId(record.sessionId, "sessionId")
  if (record.roomId !== `session:${sessionId}` || (record.role !== "editor" && record.role !== "observer")) throw new CollaborationProtocolError("SESSION_MISMATCH", "Room authority identity is invalid", 403)
  const keyVersion = protocolSequence(record.keyVersion, "keyVersion")
  if (keyVersion < 1) throw new CollaborationProtocolError("ENCRYPTION_KEY_STALE", "An active room key is required", 409, true)
  const previous = record.previousKeyVersion === undefined ? undefined : protocolSequence(record.previousKeyVersion, "previousKeyVersion")
  return { principalId: protocolId(record.principalId, "principalId"), projectId: protocolId(record.projectId, "projectId"), sessionId, roomId: record.roomId,
    role: record.role, keyVersion, rotationRequired: record.rotationRequired === true, ...(previous ? { previousKeyVersion: previous } : {}) }
}

export function parseCheckpointRequest(value: unknown): CheckpointRequest {
  const request = protocolRecord(value, "Checkpoint request")
  requireProtocolRevision(request.protocolRevision)
  switch (request.operation) {
    case "inspect": return { operation: "inspect" }
    case "claim": return { operation: "claim", sequence: protocolSequence(request.sequence, "sequence") }
    case "finalize": return { operation: "finalize", id: protocolId(request.id, "id") }
    case "read": return { operation: "read", id: protocolId(request.id, "id"), index: protocolSequence(request.index, "index") }
    case "file.claim": return { operation: "file.claim", fileId: protocolId(request.fileId, "fileId") }
    case "upload": {
      const id = protocolId(request.id, "id"), index = protocolSequence(request.index, "index"), totalChars = protocolSequence(request.totalChars, "totalChars")
      if (totalChars < 4 || totalChars > COLLABORATION_MAX_ENCODED_CHECKPOINT || totalChars % 4 !== 0 || index >= Math.ceil(totalChars / COLLABORATION_CHUNK_CHARS) ||
        typeof request.digest !== "string" || !/^[a-f0-9]{64}$/.test(request.digest) || typeof request.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(request.data) ||
        request.data.length !== Math.min(COLLABORATION_CHUNK_CHARS, totalChars - index * COLLABORATION_CHUNK_CHARS)) throw new CollaborationProtocolError("INVALID_CHUNK", "Invalid encrypted checkpoint chunk")
      return { operation: "upload", id, index, totalChars, digest: request.digest, data: request.data }
    }
    default: throw new CollaborationProtocolError("UNKNOWN_OPERATION", "Unsupported collaboration checkpoint operation")
  }
}

export function validateCheckpointInspection(value: unknown): CheckpointInspection {
  const record = protocolRecord(value, "Checkpoint inspection")
  requireProtocolRevision(record.protocolRevision)
  if (record.generation !== 3 || !(record.checkpoint === null || (record.checkpoint && typeof record.checkpoint === "object" && !Array.isArray(record.checkpoint)))) throw new CollaborationProtocolError("INVALID_RESPONSE", "Invalid checkpoint inspection response")
  const headSequence = protocolSequence(record.headSequence, "headSequence"), compactionFloor = protocolSequence(record.compactionFloor, "compactionFloor")
  if (compactionFloor > headSequence) throw new CollaborationProtocolError("INVALID_RESPONSE", "Compaction floor exceeds the room head")
  // The client additionally validates the complete descriptor and room identity
  // before reading ciphertext. This check rejects missing/ambiguous old replies.
  const checkpoint = record.checkpoint as EncryptedCheckpointDescriptor | null
  if (checkpoint && (protocolSequence(checkpoint.sequence, "checkpoint sequence") > headSequence || checkpoint.sequence < compactionFloor)) throw new CollaborationProtocolError("INVALID_RESPONSE", "Checkpoint does not cover the retained room history")
  if (!checkpoint && compactionFloor > 0) throw new CollaborationProtocolError("CHECKPOINT_REQUIRED", "Compacted room has no recoverable checkpoint", 409, true)
  return { generation: 3, protocolRevision: COLLABORATION_PROTOCOL_REVISION, headSequence, compactionFloor, checkpoint }
}
