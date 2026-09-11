/**
 * Session Transport client with E2EE payload encryption and replay cursor tracking.
 *
 * Master Specification: Section 13.1 - 13.10
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import type { CollaborationBatch, SessionReplica } from "./SessionReplica"
import type { OutboundBatchQueue } from "./OutboundBatchQueue"

const ROOM_KEY_BYTES = 32

export interface SessionTransportOptions {
  sessionId: string
  roomUrl?: string
  roomKey: Buffer | Uint8Array // The session's 32-byte AES-256-GCM key (Section 26.2)
  queue?: OutboundBatchQueue
  replica: SessionReplica
}

export class SessionTransport {
  readonly sessionId: string
  readonly roomUrl?: string
  readonly replica: SessionReplica
  readonly queue?: OutboundBatchQueue
  private readonly roomKey: Buffer
  // Binds every ciphertext to this session, so a batch cannot be replayed into another.
  private readonly associatedData: Buffer

  /** Every sessionSeq up to and including this one has been applied or acknowledged. */
  public lastAppliedSessionSeq = 0
  public lastDurableSessionSeq = 0
  private readonly appliedAboveWatermark = new Set<number>()
  private isConnected = false

  constructor(options: SessionTransportOptions) {
    if (!options.roomKey) {
      throw new Error(`SessionTransport for ${options.sessionId} requires the session's room key`)
    }
    const roomKey = Buffer.from(options.roomKey)
    if (roomKey.length !== ROOM_KEY_BYTES) {
      throw new Error(`Session room key must be ${ROOM_KEY_BYTES} bytes, got ${roomKey.length}`)
    }

    this.sessionId = options.sessionId
    this.roomUrl = options.roomUrl
    this.replica = options.replica
    this.queue = options.queue
    this.roomKey = roomKey
    this.associatedData = Buffer.from(`cozea-session-batch:v1:${options.sessionId}`, "utf8")
  }

  get connected(): boolean {
    return this.isConnected
  }

  /**
   * Section 13.5: Encrypts collaboration batch payload client-side with AES-256-GCM.
   */
  encryptBatch(batch: CollaborationBatch): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", this.roomKey, iv)
    cipher.setAAD(this.associatedData)

    // Base64 serialize Uint8Arrays
    const plaintext = JSON.stringify(batch, (_, val) => {
      if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
        return { __b64: Buffer.from(val).toString("base64") }
      }
      return val
    })

    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
    const tag = cipher.getAuthTag()

    // Envelope: iv (12 bytes) + tag (16 bytes) + ciphertext
    const combined = Buffer.concat([iv, tag, encrypted])
    return combined.toString("base64")
  }

  /**
   * Decrypts collaboration batch payload client-side.
   */
  decryptBatch(encryptedBase64: string): CollaborationBatch {
    const combined = Buffer.from(encryptedBase64, "base64")
    const iv = combined.subarray(0, 12)
    const tag = combined.subarray(12, 28)
    const ciphertext = combined.subarray(28)

    const decipher = createDecipheriv("aes-256-gcm", this.roomKey, iv)
    decipher.setAAD(this.associatedData)
    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const json = decrypted.toString("utf8")

    const batch = JSON.parse(json, (_, val) => {
      if (val && typeof val === "object" && val.__b64) {
        return new Uint8Array(Buffer.from(val.__b64, "base64"))
      }
      return val
    }) as CollaborationBatch

    if (batch.sessionId !== this.sessionId) {
      throw new Error(`Batch ${batch.batchId} belongs to session ${batch.sessionId}, not ${this.sessionId}`)
    }
    return batch
  }

  /**
   * Receives and applies an encrypted batch from the server room. Batches may arrive
   * out of order (live broadcast racing a replay); only exact duplicates are skipped,
   * and Yjs integrates the updates causally. Returns false for a duplicate.
   */
  receiveEncryptedBatch(sessionSeq: number, encryptedPayload: string): boolean {
    assertSessionSeq(sessionSeq)
    if (this.hasApplied(sessionSeq)) {
      return false
    }

    const batch = this.decryptBatch(encryptedPayload)
    this.replica.applyBatch(batch)
    this.markApplied(sessionSeq)
    return true
  }

  /**
   * Records the sequence the room assigned to one of this replica's own batches, so
   * replay does not hand it back as a gap.
   */
  acknowledgeLocalBatch(sessionSeq: number): void {
    assertSessionSeq(sessionSeq)
    this.markApplied(sessionSeq)
  }

  private hasApplied(sessionSeq: number): boolean {
    return sessionSeq <= this.lastAppliedSessionSeq || this.appliedAboveWatermark.has(sessionSeq)
  }

  private markApplied(sessionSeq: number): void {
    if (sessionSeq > this.lastAppliedSessionSeq) {
      this.appliedAboveWatermark.add(sessionSeq)
      while (this.appliedAboveWatermark.delete(this.lastAppliedSessionSeq + 1)) {
        this.lastAppliedSessionSeq += 1
      }
    }
    this.lastDurableSessionSeq = Math.max(this.lastDurableSessionSeq, sessionSeq)
  }
}

function assertSessionSeq(sessionSeq: number): void {
  if (!Number.isSafeInteger(sessionSeq) || sessionSeq < 1) {
    throw new Error(`Invalid sessionSeq ${sessionSeq}`)
  }
}
