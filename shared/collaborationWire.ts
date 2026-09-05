/** Versioned, content-free validation shared by clients and the encrypted room. */
export const COLLABORATION_WIRE_GENERATION = 3
export const COLLABORATION_CHUNK_CHARS = 64 * 1024
export const COLLABORATION_MAX_ENCODED_UPDATE = 4 * 1024 * 1024
export const COLLABORATION_MAX_ENCODED_CHECKPOINT = 24 * 1024 * 1024

export interface CollaborationChunk {
  id: string
  index: number
  count: number
  totalChars: number
  digest: string
  data: string
}

export function decodeCanonicalBase64(value: unknown, maxChars: number): Uint8Array {
  if (typeof value !== "string" || !value.length || value.length > maxChars || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("Invalid encrypted base64 payload")
  const binary = atob(value)
  if (btoa(binary) !== value) throw new Error("Noncanonical encrypted base64 payload")
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

export function validateEncryptedCollaborationEnvelope(encoded: string, expected: {
  roomId: string; projectId: string; kind: "yjs_update" | "yjs_snapshot" | "yjs_awareness"
  keyVersion?: number; idempotencyKey?: string
}): { keyVersion: number } {
  const max = expected.kind === "yjs_snapshot" ? COLLABORATION_MAX_ENCODED_CHECKPOINT : COLLABORATION_MAX_ENCODED_UPDATE
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeCanonicalBase64(encoded, max)))
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid encrypted collaboration envelope")
  const envelope = value as Record<string, unknown>
  if (envelope.v !== 1 || envelope.alg !== "A256GCM" || envelope.kind !== expected.kind ||
    !Number.isSafeInteger(envelope.keyVersion) || Number(envelope.keyVersion) < 1 ||
    (expected.keyVersion !== undefined && envelope.keyVersion !== expected.keyVersion)) throw new Error("Encrypted envelope kind or key is invalid")
  if (decodeCanonicalBase64(envelope.iv, 16).length !== 12 || decodeCanonicalBase64(envelope.ciphertext, max).length < 16) throw new Error("Encrypted envelope IV or authentication tag is invalid")
  const metadata: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeCanonicalBase64(envelope.aad, 8192)))
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Encrypted envelope metadata is invalid")
  const aad = metadata as Record<string, unknown>
  if (aad.v !== 1 || aad.kind !== envelope.kind || aad.keyVersion !== envelope.keyVersion ||
    aad.roomId !== expected.roomId || aad.projectId !== expected.projectId ||
    (expected.idempotencyKey !== undefined && aad.idempotencyKey !== expected.idempotencyKey)) throw new Error("Encrypted envelope does not belong to this room or operation")
  if (envelope.privateMetadata !== undefined) {
    if (!envelope.privateMetadata || typeof envelope.privateMetadata !== "object" || Array.isArray(envelope.privateMetadata)) throw new Error("Invalid private envelope metadata")
    const privateMetadata = envelope.privateMetadata as Record<string, unknown>
    if (decodeCanonicalBase64(privateMetadata.iv, 16).length !== 12 || decodeCanonicalBase64(privateMetadata.ciphertext, 16_384).length < 16) throw new Error("Invalid private envelope metadata")
  }
  return { keyVersion: Number(envelope.keyVersion) }
}

export async function collaborationDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

export async function splitCollaborationUpdate(id: string, value: string): Promise<CollaborationChunk[]> {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id) || value.length < 1 || value.length > COLLABORATION_MAX_ENCODED_UPDATE) throw new Error("Collaboration update exceeds its chunking limit")
  const digest = await collaborationDigest(value)
  const count = Math.ceil(value.length / COLLABORATION_CHUNK_CHARS)
  return Array.from({ length: count }, (_, index) => ({ id, index, count, totalChars: value.length, digest, data: value.slice(index * COLLABORATION_CHUNK_CHARS, (index + 1) * COLLABORATION_CHUNK_CHARS) }))
}

export function validateCollaborationChunk(chunk: CollaborationChunk): void {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(chunk.id) || !/^[0-9a-f]{64}$/.test(chunk.digest) ||
    !Number.isSafeInteger(chunk.totalChars) || chunk.totalChars < 1 || chunk.totalChars > COLLABORATION_MAX_ENCODED_UPDATE ||
    chunk.count !== Math.ceil(chunk.totalChars / COLLABORATION_CHUNK_CHARS) ||
    !Number.isSafeInteger(chunk.index) || chunk.index < 0 || chunk.index >= chunk.count ||
    typeof chunk.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.data) ||
    chunk.data.length !== Math.min(COLLABORATION_CHUNK_CHARS, chunk.totalChars - chunk.index * COLLABORATION_CHUNK_CHARS)) throw new Error("Invalid encrypted update chunk")
}

export class CollaborationChunkReceiver {
  private readonly pending = new Map<string, { descriptor: CollaborationChunk; pieces: Map<number, string> }>()
  async accept(chunk: CollaborationChunk): Promise<string | null> {
    validateCollaborationChunk(chunk)
    let pending = this.pending.get(chunk.id)
    if (!pending) {
      if (this.pending.size >= 8) throw new Error("Too many incomplete encrypted updates")
      pending = { descriptor: chunk, pieces: new Map() }
      this.pending.set(chunk.id, pending)
    }
    if (pending.descriptor.digest !== chunk.digest || pending.descriptor.totalChars !== chunk.totalChars ||
      (pending.pieces.has(chunk.index) && pending.pieces.get(chunk.index) !== chunk.data)) throw new Error("Encrypted update chunks disagree")
    pending.pieces.set(chunk.index, chunk.data)
    if (pending.pieces.size !== chunk.count) return null
    const result = Array.from({ length: chunk.count }, (_, index) => pending.pieces.get(index)!).join("")
    if (await collaborationDigest(result) !== chunk.digest) throw new Error("Encrypted update chunk checksum failed")
    this.pending.delete(chunk.id)
    return result
  }
  clear(): void { this.pending.clear() }
}
