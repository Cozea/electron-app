/**
 * Session Transport client with E2EE payload encryption and replay cursor tracking.
 *
 * Master Specification: Section 13.1 - 13.10
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import type { CollaborationBatch, SessionReplica } from "./SessionReplica"
import type { OutboundBatchQueue } from "./OutboundBatchQueue"

export interface SessionTransportOptions {
  sessionId: string
  roomUrl?: string
  roomKey?: Buffer | Uint8Array // 32-byte AES-GCM key for E2EE
  queue?: OutboundBatchQueue
  replica: SessionReplica
}

export class SessionTransport {
  readonly sessionId: string
  readonly roomUrl?: string
  readonly replica: SessionReplica
  readonly queue?: OutboundBatchQueue
  private readonly roomKey: Buffer

  public lastAppliedSessionSeq = 0
  public lastDurableSessionSeq = 0
  private isConnected = false

  constructor(options: SessionTransportOptions) {
    this.sessionId = options.sessionId
    this.roomUrl = options.roomUrl
    this.replica = options.replica
    this.queue = options.queue
    this.roomKey = options.roomKey ? Buffer.from(options.roomKey) : Buffer.alloc(32, 7) // 256-bit key
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
    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const json = decrypted.toString("utf8")

    return JSON.parse(json, (_, val) => {
      if (val && typeof val === "object" && val.__b64) {
        return new Uint8Array(Buffer.from(val.__b64, "base64"))
      }
      return val
    }) as CollaborationBatch
  }

  /**
   * Receives and applies an encrypted batch from the server room.
   */
  receiveEncryptedBatch(sessionSeq: number, encryptedPayload: string): void {
    if (sessionSeq <= this.lastAppliedSessionSeq) {
      // Already applied or duplicate
      return
    }

    const batch = this.decryptBatch(encryptedPayload)
    this.replica.applyBatch(batch)

    this.lastAppliedSessionSeq = sessionSeq
    this.lastDurableSessionSeq = Math.max(this.lastDurableSessionSeq, sessionSeq)
  }
}
