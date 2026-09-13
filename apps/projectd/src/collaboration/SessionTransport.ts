/**
 * Session Transport client with E2EE payload encryption and replay cursor tracking.
 *
 * Master Specification: Section 13.1 - 13.10
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import type { CollaborationBatch, SessionReplica, ReplicaSnapshot } from "./SessionReplica"
import type { OutboundBatchQueue } from "./OutboundBatchQueue"

const ROOM_KEY_BYTES = 32

export interface SessionTransportOptions {
  sessionId: string
  roomUrl?: string
  roomKey: Buffer | Uint8Array // The session's 32-byte AES-256-GCM key (Section 26.2)
  /** Current content-key generation. Version 1 is the pre-rotation wire format. */
  roomKeyVersion?: number
  /** Older keys retained only for authorized members so persisted room history can replay. */
  previousRoomKeys?: Readonly<Record<number, Buffer | Uint8Array>>
  queue?: OutboundBatchQueue
  replica: SessionReplica
}

export class SessionTransport {
  readonly sessionId: string
  readonly roomUrl?: string
  readonly replica: SessionReplica
  readonly queue?: OutboundBatchQueue
  private readonly roomKeys = new Map<number, Buffer>()
  private readonly activeKeyVersion: number

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

    const roomKeyVersion = Math.max(1, Math.floor(options.roomKeyVersion ?? 1))
    this.sessionId = options.sessionId
    this.roomUrl = options.roomUrl
    this.replica = options.replica
    this.queue = options.queue
    this.activeKeyVersion = roomKeyVersion
    this.roomKeys.set(roomKeyVersion, roomKey)
    for (const [versionText, keyBytes] of Object.entries(options.previousRoomKeys ?? {})) {
      const version = Number(versionText)
      const key = Buffer.from(keyBytes)
      if (!Number.isSafeInteger(version) || version < 1 || version >= roomKeyVersion || key.length !== ROOM_KEY_BYTES) continue
      this.roomKeys.set(version, key)
    }
  }

  get connected(): boolean {
    return this.isConnected
  }

  restoreCloudSnapshot(snapshot: ReplicaSnapshot, sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < this.lastAppliedSessionSeq || this.replica.hasUnexportedChanges()) {
      throw new Error("Cannot replace the replay baseline with this snapshot")
    }
    this.replica.restoreSnapshot(snapshot)
    this.lastAppliedSessionSeq = sequence
    for (const applied of this.appliedAboveWatermark) {
      if (applied <= sequence) this.appliedAboveWatermark.delete(applied)
    }
    while (this.appliedAboveWatermark.delete(this.lastAppliedSessionSeq + 1)) this.lastAppliedSessionSeq++
    this.lastDurableSessionSeq = Math.max(this.lastDurableSessionSeq, this.lastAppliedSessionSeq)
  }

  /**
   * Section 13.5: Encrypts collaboration batch payload client-side with AES-256-GCM.
   */
  encryptBatch(batch: CollaborationBatch): string {
    const roomKey = this.requireKey(this.activeKeyVersion)
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", roomKey, iv)
    cipher.setAAD(this.associatedData(this.activeKeyVersion))

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
    const encoded = combined.toString("base64")
    // Version 1 was originally an unprefixed base64 payload. New writes use an
    // explicit prefix while the decoder still accepts persisted legacy v1 batches.
    return `v1:${this.activeKeyVersion}:${encoded}`
  }

  /**
   * Decrypts collaboration batch payload client-side.
   */
  decryptBatch(encryptedBase64: string): CollaborationBatch {
    const envelope = parseKeyedEnvelope(encryptedBase64)
    const roomKey = this.requireKey(envelope.keyVersion)
    const combined = Buffer.from(envelope.payload, "base64")
    const iv = combined.subarray(0, 12)
    const tag = combined.subarray(12, 28)
    const ciphertext = combined.subarray(28)

    const decipher = createDecipheriv("aes-256-gcm", roomKey, iv)
    decipher.setAAD(this.associatedData(envelope.keyVersion))
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

  private requireKey(keyVersion: number): Buffer {
    const key = this.roomKeys.get(keyVersion)
    if (!key) throw new Error(`Session ${this.sessionId} has no key for generation ${keyVersion}`)
    return key
  }

  private associatedData(keyVersion: number): Buffer {
    const suffix = keyVersion === 1 ? "" : `:key:${keyVersion}`
    return Buffer.from(`cozea-session-batch:v1:${this.sessionId}${suffix}`, "utf8")
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

function parseKeyedEnvelope(value: string): { keyVersion: number; payload: string } {
  const match = /^v1:(\d+):(.+)$/.exec(value)
  if (!match) return { keyVersion: 1, payload: value }
  const keyVersion = Number(match[1])
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) throw new Error("Invalid session key generation")
  return { keyVersion, payload: match[2] }
}

function assertSessionSeq(sessionSeq: number): void {
  if (!Number.isSafeInteger(sessionSeq) || sessionSeq < 1) {
    throw new Error(`Invalid sessionSeq ${sessionSeq}`)
  }
}
