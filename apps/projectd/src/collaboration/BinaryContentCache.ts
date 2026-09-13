/**
 * Local content-addressed cache for binary assets.
 *
 * Master Specification: Section 9.8, 11.4
 */

import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { ProjectdDatabase } from "../storage/Database"

export const CHUNK_SIZE_BYTES = 4 * 1024 * 1024 // 4 MiB fixed chunks (Section 11.4)

export interface BinaryChunkDescriptor {
  index: number
  hash: string
  size: number
  encryptedRef: string
}

export interface BinaryManifest {
  contentHash: string
  size: number
  chunkSize: number
  chunks: BinaryChunkDescriptor[]
}

export function getDefaultBinaryCacheDir(): string {
  if (process.env.COZEA_BINARY_CACHE_DIR) {
    return process.env.COZEA_BINARY_CACHE_DIR
  }
  return path.join(os.homedir(), "Library/Application Support/Cozea/binary-cache")
}

export class BinaryContentCache {
  readonly cacheDir: string
  readonly db?: ProjectdDatabase

  constructor(options?: { cacheDir?: string; db?: ProjectdDatabase }) {
    this.cacheDir = options?.cacheDir ?? getDefaultBinaryCacheDir()
    this.db = options?.db
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true })
  }

  getCachePath(contentHash: string): string {
    const cleanHash = contentHash.replace(/[^a-zA-Z0-9]/g, "")
    return path.join(this.cacheDir, cleanHash)
  }

  async has(contentHash: string): Promise<boolean> {
    try {
      const p = this.getCachePath(contentHash)
      await fs.access(p)
      return true
    } catch {
      return false
    }
  }

  async put(bytes: Buffer | Uint8Array): Promise<{ contentHash: string; size: number; cachedPath: string }> {
    await this.ensureDir()
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const contentHash = createHash("sha256").update(buffer).digest("hex")
    const cachedPath = this.getCachePath(contentHash)

    await fs.writeFile(cachedPath, buffer)
    this.record(contentHash, cachedPath, buffer.length)

    return { contentHash, size: buffer.length, cachedPath }
  }

  /**
   * Stores a known immutable revision from a bounded stream. The content-addressed
   * cache path is replaced only after the exact size and SHA-256 are verified.
   */
  async putFrom(input: {
    contentHash: string
    size: number
    stream: (write: (chunk: Buffer) => Promise<void>) => Promise<void>
  }): Promise<{ contentHash: string; size: number; cachedPath: string }> {
    if (!/^[a-f0-9]{64}$/.test(input.contentHash) || !Number.isSafeInteger(input.size) || input.size < 0) {
      throw new Error("Invalid binary cache stream metadata")
    }
    await this.ensureDir()
    const cachedPath = this.getCachePath(input.contentHash)
    const tempPath = `${cachedPath}.tmp.${randomUUID().slice(0, 8)}`
    const handle = await fs.open(tempPath, "w", 0o600)
    const digest = createHash("sha256")
    let size = 0
    try {
      await input.stream(async (chunk) => {
        if (!Buffer.isBuffer(chunk) || chunk.length === 0) return
        if (size + chunk.length > input.size) throw new Error("Streamed binary cache content exceeds its revision size")
        digest.update(chunk)
        let offset = 0
        while (offset < chunk.length) {
          const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null)
          if (bytesWritten <= 0) throw new Error("Could not write streamed binary cache content")
          offset += bytesWritten
        }
        size += chunk.length
      })
      await handle.sync()
    } catch (error) {
      await handle.close().catch(() => undefined)
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
    await handle.close()
    const contentHash = digest.digest("hex")
    if (size !== input.size || contentHash !== input.contentHash) {
      await fs.rm(tempPath, { force: true })
      throw new Error("Streamed binary cache content failed verification")
    }
    try {
      await fs.rename(tempPath, cachedPath)
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
    }
    this.record(contentHash, cachedPath, size)
    return { contentHash, size, cachedPath }
  }

  async get(contentHash: string): Promise<Buffer | null> {
    const cachedPath = this.getCachePath(contentHash)
    try {
      const bytes = await fs.readFile(cachedPath)
      const verifiedHash = createHash("sha256").update(bytes).digest("hex")
      if (verifiedHash !== contentHash) {
        console.warn(`[BinaryCache] Hash mismatch for ${contentHash}: found ${verifiedHash}`)
        return null
      }
      return bytes
    } catch {
      return null
    }
  }

  /** Writes provisional chunks; false means the sink must be discarded or reset. */
  async copyTo(contentHash: string, expectedSize: number, write: (chunk: Buffer) => Promise<void>): Promise<boolean> {
    const handle = await fs.open(this.getCachePath(contentHash), "r").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null
      throw error
    })
    if (!handle) return false
    try {
      if ((await handle.stat()).size !== expectedSize) return false
      const hash = createHash("sha256")
      let total = 0
      while (total < expectedSize) {
        const buffer = Buffer.allocUnsafe(Math.min(CHUNK_SIZE_BYTES, expectedSize - total))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, total)
        if (!bytesRead) return false
        const chunk = buffer.subarray(0, bytesRead)
        hash.update(chunk)
        await write(chunk)
        total += bytesRead
      }
      return hash.digest("hex") === contentHash
    } finally { await handle.close() }
  }

  /**
   * Validates the complete cache object before exposing any bytes to a sink that
   * cannot be reset. This permits safe network fallback into the same atomic
   * materialization stream when a cache file is missing or corrupt.
   */
  async copyVerifiedTo(contentHash: string, expectedSize: number, write: (chunk: Buffer) => Promise<void>): Promise<boolean> {
    const cachePath = this.getCachePath(contentHash)
    const verifyHandle = await fs.open(cachePath, "r").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null
      throw error
    })
    if (!verifyHandle) return false
    try {
      if ((await verifyHandle.stat()).size !== expectedSize) return false
      const digest = createHash("sha256")
      let position = 0
      while (position < expectedSize) {
        const buffer = Buffer.allocUnsafe(Math.min(CHUNK_SIZE_BYTES, expectedSize - position))
        const { bytesRead } = await verifyHandle.read(buffer, 0, buffer.length, position)
        if (!bytesRead) return false
        digest.update(buffer.subarray(0, bytesRead))
        position += bytesRead
      }
      if (digest.digest("hex") !== contentHash) return false
    } finally {
      await verifyHandle.close()
    }

    const streamHandle = await fs.open(cachePath, "r").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null
      throw error
    })
    if (!streamHandle) return false
    try {
      if ((await streamHandle.stat()).size !== expectedSize) return false
      let position = 0
      while (position < expectedSize) {
        const buffer = Buffer.allocUnsafe(Math.min(CHUNK_SIZE_BYTES, expectedSize - position))
        const { bytesRead } = await streamHandle.read(buffer, 0, buffer.length, position)
        if (!bytesRead) return false
        await write(buffer.subarray(0, bytesRead))
        position += bytesRead
      }
      return position === expectedSize
    } finally {
      await streamHandle.close()
    }
  }

  /**
   * Section 11.4: Splits large binary into 4 MiB chunks and builds manifest.
   */
  createManifest(bytes: Buffer | Uint8Array, baseUri = "blob:"): BinaryManifest {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const fullHash = createHash("sha256").update(buffer).digest("hex")
    const chunks: BinaryChunkDescriptor[] = []

    let offset = 0
    let index = 0
    while (offset < buffer.length) {
      const chunkBytes = buffer.subarray(offset, Math.min(offset + CHUNK_SIZE_BYTES, buffer.length))
      const chunkHash = createHash("sha256").update(chunkBytes).digest("hex")
      chunks.push({
        index,
        hash: chunkHash,
        size: chunkBytes.length,
        encryptedRef: `${baseUri}${chunkHash}`,
      })
      offset += chunkBytes.length
      index++
    }

    return {
      contentHash: fullHash,
      size: buffer.length,
      chunkSize: CHUNK_SIZE_BYTES,
      chunks,
    }
  }

  private record(contentHash: string, cachedPath: string, size: number): void {
    if (!this.db) return
    const stmt = this.db.db.prepare(`
      INSERT INTO binary_cache (content_hash, local_path, size, verified_at, ref_count)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(content_hash) DO UPDATE SET
        verified_at = excluded.verified_at,
        ref_count = binary_cache.ref_count + 1
    `)
    stmt.run(contentHash, cachedPath, size, Date.now())
  }
}
