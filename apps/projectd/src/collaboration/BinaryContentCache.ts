/**
 * Local content-addressed cache for binary assets.
 *
 * Master Specification: Section 9.8, 11.4
 */

import { createHash } from "node:crypto"
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

    if (this.db) {
      const stmt = this.db.db.prepare(`
        INSERT INTO binary_cache (content_hash, local_path, size, verified_at, ref_count)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(content_hash) DO UPDATE SET
          verified_at = excluded.verified_at,
          ref_count = binary_cache.ref_count + 1
      `)
      stmt.run(contentHash, cachedPath, buffer.length, Date.now())
    }

    return { contentHash, size: buffer.length, cachedPath }
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
}
