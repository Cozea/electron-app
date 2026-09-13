/**
 * Session-scoped encrypted object transport for binary collaboration chunks.
 *
 * Binary payloads are encrypted locally with the session room key and uploaded
 * separately from the room's bounded collaboration messages. The E2EE room batch
 * carries only the immutable chunk manifest.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

import {
  CHUNK_SIZE_BYTES,
  type BinaryChunkDescriptor,
  type BinaryManifest,
} from "./BinaryContentCache"

const ENVELOPE_OVERHEAD_BYTES = 12 + 16
const MAX_ENCRYPTED_CHUNK_BYTES = CHUNK_SIZE_BYTES + ENVELOPE_OVERHEAD_BYTES
const ROOM_KEY_BYTES = 32

export interface BinaryObjectStoreOptions {
  sessionId: string
  roomKey: Buffer | Uint8Array
  roomKeyVersion?: number
  previousRoomKeys?: Readonly<Record<number, Buffer | Uint8Array>>
  /** Current room WebSocket URL; the HTTP object endpoint uses the same origin. */
  getRoomUrl: () => string
  /** Current short-lived session token. */
  getToken: () => Promise<string>
  fetchFn?: typeof fetch
}

export interface BinaryUploadSource {
  /** Exact plaintext byte size. */
  size: number
  /** SHA-256 of the complete plaintext source, computed by the stable-reader boundary. */
  contentHash: string
  /** Reads exactly this range without requiring the complete file in memory. */
  read(offset: number, length: number): Promise<Buffer>
}

export interface BinaryObjectClient {
  upload(bytes: Buffer | Uint8Array): Promise<BinaryManifest>
  uploadFrom?(source: BinaryUploadSource): Promise<BinaryManifest>
  download(manifest: BinaryManifest): Promise<Buffer>
  downloadTo?(manifest: BinaryManifest, write: (chunk: Buffer) => Promise<void>): Promise<void>
}

export class BinaryObjectStoreError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "BinaryObjectStoreError"
    this.code = code
  }
}

export class SessionBinaryObjectStore implements BinaryObjectClient {
  readonly sessionId: string
  private readonly roomKeys = new Map<number, Buffer>()
  private readonly activeKeyVersion: number
  private readonly getRoomUrl: () => string
  private readonly getToken: () => Promise<string>
  private readonly fetchFn: typeof fetch

  constructor(options: BinaryObjectStoreOptions) {
    const roomKey = Buffer.from(options.roomKey)
    if (roomKey.length !== ROOM_KEY_BYTES) {
      throw new Error(`Binary object store requires the session's ${ROOM_KEY_BYTES}-byte room key`)
    }
    this.sessionId = options.sessionId
    this.activeKeyVersion = Math.max(1, Math.floor(options.roomKeyVersion ?? 1))
    this.roomKeys.set(this.activeKeyVersion, roomKey)
    for (const [versionText, keyBytes] of Object.entries(options.previousRoomKeys ?? {})) {
      const version = Number(versionText)
      const key = Buffer.from(keyBytes)
      if (!Number.isSafeInteger(version) || version < 1 || version >= this.activeKeyVersion || key.length !== ROOM_KEY_BYTES) continue
      this.roomKeys.set(version, key)
    }
    this.getRoomUrl = options.getRoomUrl
    this.getToken = options.getToken
    this.fetchFn = options.fetchFn ?? fetch
  }

  /** Convenience wrapper for small/in-memory callers. */
  async upload(bytes: Buffer | Uint8Array): Promise<BinaryManifest> {
    const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    return this.uploadFrom({
      size: content.length,
      contentHash: sha256(content),
      read: async (offset, length) => content.subarray(offset, offset + length),
    })
  }

  /**
   * Encrypts and uploads fixed-size chunks without materializing the whole source.
   * The expected whole-content hash prevents a file that changes between a prior
   * stable scan and this upload from being published under stale metadata.
   *
   * PUT is immutable. On retry, a 412 means that exact chunk reference already
   * exists; it is downloaded, authenticated and hash-checked before continuing.
   * This makes interruption recovery naturally resumable at the 4 MiB chunk boundary.
   */
  async uploadFrom(source: BinaryUploadSource): Promise<BinaryManifest> {
    if (!Number.isSafeInteger(source.size) || source.size < 0 || !/^[a-f0-9]{64}$/.test(source.contentHash)) {
      throw new BinaryObjectStoreError("BAD_SOURCE", "Binary upload source has invalid size or content hash")
    }
    const chunks: BinaryChunkDescriptor[] = []
    const completeHash = createHash("sha256")
    let offset = 0
    let index = 0

    while (offset < source.size) {
      const expectedSize = Math.min(CHUNK_SIZE_BYTES, source.size - offset)
      const chunk = await source.read(offset, expectedSize)
      if (!Buffer.isBuffer(chunk) || chunk.length !== expectedSize) {
        throw new BinaryObjectStoreError(
          "SOURCE_CHANGED",
          `Binary upload source returned ${Buffer.isBuffer(chunk) ? chunk.length : 0} bytes; expected ${expectedSize}`,
        )
      }
      completeHash.update(chunk)
      const chunkHash = sha256(chunk)
      const encryptedRef = `v1/${this.activeKeyVersion}/${source.contentHash}/${index}/${chunkHash}`
      const encrypted = this.encryptChunk(this.activeKeyVersion, encryptedRef, chunk)
      const created = await this.putChunk(encryptedRef, encrypted)
      if (!created) {
        const existing = this.decryptChunk(this.activeKeyVersion, encryptedRef, await this.getChunk(encryptedRef))
        if (existing.length !== chunk.length || sha256(existing) !== chunkHash) {
          throw new BinaryObjectStoreError("CHUNK_HASH_MISMATCH", "Existing immutable binary chunk failed verification")
        }
      }
      chunks.push({ index, hash: chunkHash, size: chunk.length, encryptedRef })
      offset += chunk.length
      index += 1
    }

    if (completeHash.digest("hex") !== source.contentHash) {
      throw new BinaryObjectStoreError("SOURCE_CHANGED", "Binary upload source no longer matches its stable SHA-256")
    }
    return {
      contentHash: source.contentHash,
      size: source.size,
      chunkSize: CHUNK_SIZE_BYTES,
      chunks,
    }
  }

  /** Downloads, decrypts and verifies every chunk before returning reconstructed bytes. */
  async download(manifest: BinaryManifest): Promise<Buffer> {
    const chunks: Buffer[] = []
    await this.downloadTo(manifest, async (chunk) => { chunks.push(chunk) })
    return Buffer.concat(chunks, manifest.size)
  }

  /** The sink is provisional until whole-content verification succeeds. */
  async downloadTo(manifest: BinaryManifest, write: (chunk: Buffer) => Promise<void>): Promise<void> {
    validateManifest(manifest)
    const contentHash = createHash("sha256")
    let total = 0

    for (const descriptor of manifest.chunks) {
      const encrypted = await this.getChunk(descriptor.encryptedRef)
      const keyVersion = encryptedRefKeyVersion(descriptor.encryptedRef)
      const plaintext = this.decryptChunk(keyVersion, descriptor.encryptedRef, encrypted)
      if (plaintext.length !== descriptor.size) {
        throw new BinaryObjectStoreError(
          "CHUNK_SIZE_MISMATCH",
          `Binary chunk ${descriptor.index} has ${plaintext.length} bytes; expected ${descriptor.size}`,
        )
      }
      const actualHash = sha256(plaintext)
      if (actualHash !== descriptor.hash) {
        throw new BinaryObjectStoreError(
          "CHUNK_HASH_MISMATCH",
          `Binary chunk ${descriptor.index} failed SHA-256 verification`,
        )
      }
      contentHash.update(plaintext)
      total += plaintext.length
      await write(plaintext)
    }

    if (total !== manifest.size) {
      throw new BinaryObjectStoreError("CONTENT_SIZE_MISMATCH", `Binary content has ${total} bytes; expected ${manifest.size}`)
    }
    if (contentHash.digest("hex") !== manifest.contentHash) {
      throw new BinaryObjectStoreError("CONTENT_HASH_MISMATCH", "Binary content failed SHA-256 verification")
    }
  }

  private encryptChunk(keyVersion: number, ref: string, plaintext: Buffer): Buffer {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", this.requireKey(keyVersion), iv)
    cipher.setAAD(this.associatedData(ref))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
  }

  private decryptChunk(keyVersion: number, ref: string, encrypted: Buffer): Buffer {
    if (encrypted.length < ENVELOPE_OVERHEAD_BYTES) {
      throw new BinaryObjectStoreError("BAD_CHUNK", "Encrypted binary chunk is truncated")
    }
    const iv = encrypted.subarray(0, 12)
    const tag = encrypted.subarray(12, 28)
    const ciphertext = encrypted.subarray(28)
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.requireKey(keyVersion), iv)
      decipher.setAAD(this.associatedData(ref))
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch {
      throw new BinaryObjectStoreError("DECRYPT_FAILED", "Encrypted binary chunk could not be authenticated")
    }
  }

  private associatedData(ref: string): Buffer {
    return Buffer.from(`cozea-session-binary:v1:${this.sessionId}:${ref}`, "utf8")
  }

  private requireKey(keyVersion: number): Buffer {
    const key = this.roomKeys.get(keyVersion)
    if (!key) throw new BinaryObjectStoreError("KEY_MISSING", `No session key is available for generation ${keyVersion}`)
    return key
  }

  private async putChunk(ref: string, body: Buffer): Promise<boolean> {
    if (body.length > MAX_ENCRYPTED_CHUNK_BYTES) {
      throw new BinaryObjectStoreError("CHUNK_TOO_LARGE", `Encrypted binary chunk exceeds ${MAX_ENCRYPTED_CHUNK_BYTES} bytes`)
    }
    const response = await this.fetchFn(this.objectUrl(ref), {
      method: "PUT",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: {
        authorization: `Bearer ${await this.getToken()}`,
        "content-type": "application/octet-stream",
      },
      body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    })
    if (response.status === 412) return false
    if (!response.ok) {
      throw new BinaryObjectStoreError("UPLOAD_FAILED", `Binary chunk upload failed with HTTP ${response.status}`)
    }
    return true
  }

  private async getChunk(ref: string): Promise<Buffer> {
    const response = await this.fetchFn(this.objectUrl(ref), {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: { authorization: `Bearer ${await this.getToken()}` },
    })
    if (!response.ok) {
      throw new BinaryObjectStoreError("DOWNLOAD_FAILED", `Binary chunk download failed with HTTP ${response.status}`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new BinaryObjectStoreError("BAD_CHUNK", "Downloaded binary chunk is empty")
    const parts: Buffer[] = []
    let length = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > MAX_ENCRYPTED_CHUNK_BYTES) {
          await reader.cancel()
          throw new BinaryObjectStoreError("CHUNK_TOO_LARGE", "Downloaded binary chunk exceeds the protocol limit")
        }
        parts.push(Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
    }
    return Buffer.concat(parts, length)
  }

  private objectUrl(ref: string): string {
    if (!isValidEncryptedRef(ref)) {
      throw new BinaryObjectStoreError("BAD_REF", `Invalid binary object reference '${ref}'`)
    }
    const roomUrl = new URL(this.getRoomUrl())
    roomUrl.protocol = roomUrl.protocol === "wss:" ? "https:" : "http:"
    roomUrl.pathname = `/collab/sessions/binary/${encodeURIComponent(this.sessionId)}/${ref}`
    roomUrl.search = ""
    roomUrl.hash = ""
    return roomUrl.toString()
  }
}

export function isValidEncryptedRef(ref: string): boolean {
  return /^v1\/\d{1,9}\/[a-f0-9]{64}\/\d{1,8}\/[a-f0-9]{64}$/.test(ref)
}

function encryptedRefKeyVersion(ref: string): number {
  if (!isValidEncryptedRef(ref)) throw new BinaryObjectStoreError("BAD_REF", `Invalid binary object reference '${ref}'`)
  const version = Number(ref.split("/", 3)[1])
  if (!Number.isSafeInteger(version) || version < 1) throw new BinaryObjectStoreError("BAD_REF", "Invalid binary key generation")
  return version
}

function validateManifest(manifest: BinaryManifest): void {
  if (!/^[a-f0-9]{64}$/.test(manifest.contentHash)) {
    throw new BinaryObjectStoreError("BAD_MANIFEST", "Binary manifest has an invalid content hash")
  }
  if (!Number.isSafeInteger(manifest.size) || manifest.size < 0 || manifest.chunkSize !== CHUNK_SIZE_BYTES) {
    throw new BinaryObjectStoreError("BAD_MANIFEST", "Binary manifest has invalid size metadata")
  }
  let expectedIndex = 0
  let total = 0
  for (const chunk of manifest.chunks) {
    if (
      chunk.index !== expectedIndex ||
      !Number.isSafeInteger(chunk.size) ||
      chunk.size < 0 ||
      chunk.size > CHUNK_SIZE_BYTES ||
      !/^[a-f0-9]{64}$/.test(chunk.hash) ||
      !isValidEncryptedRef(chunk.encryptedRef)
    ) {
      throw new BinaryObjectStoreError("BAD_MANIFEST", `Binary manifest chunk ${expectedIndex} is invalid`)
    }
    total += chunk.size
    expectedIndex += 1
  }
  if (manifest.size === 0 && manifest.chunks.length !== 0) {
    throw new BinaryObjectStoreError("BAD_MANIFEST", "Empty binary content must have no chunks")
  }
  if (manifest.size > 0 && (manifest.chunks.length === 0 || total !== manifest.size)) {
    throw new BinaryObjectStoreError("BAD_MANIFEST", "Binary manifest chunk sizes do not match content size")
  }
}

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
