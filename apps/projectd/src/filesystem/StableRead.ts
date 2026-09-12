/**
 * Stable read algorithm for dirty files.
 *
 * Master Specification: Section 12.5
 * Steps:
 * 1. delay initial settle (~50-75 ms);
 * 2. lstat;
 * 3. read bytes or hash them through a bounded stream;
 * 4. lstat again;
 * 5. if size/mtime/inode changed, retry with exponential backoff;
 * 6. return the SHA-256 only after the read is stable.
 */

import { createHash } from "node:crypto"
import fs from "node:fs/promises"

const HASH_READ_CHUNK_BYTES = 1024 * 1024

export interface StableReadResult {
  path: string
  exists: boolean
  bytes?: Buffer
  contentHash?: string
  size?: number
  mtimeMs?: number
  mode?: number
  inode?: number
  isSymlink: boolean
  symlinkTarget?: string
}

export interface StableReadOptions {
  settleDelayMs?: number
  maxRetries?: number
  backoffFactor?: number
}

export class StableFileReader {
  private readonly defaultSettleMs: number
  private readonly maxRetries: number
  private readonly backoffFactor: number

  constructor(options?: StableReadOptions) {
    this.defaultSettleMs = options?.settleDelayMs ?? 50
    this.maxRetries = options?.maxRetries ?? 5
    this.backoffFactor = options?.backoffFactor ?? 1.5
  }

  /** Stable read for callers that genuinely need complete file bytes. */
  read(absolutePath: string, options?: { skipInitialDelay?: boolean }): Promise<StableReadResult> {
    return this.readInternal(absolutePath, true, options)
  }

  /**
   * Stable metadata/hash read for scanners and watchers. Regular-file bytes are
   * consumed in 1 MiB chunks and are never accumulated in memory.
   */
  readMetadata(absolutePath: string, options?: { skipInitialDelay?: boolean }): Promise<StableReadResult> {
    return this.readInternal(absolutePath, false, options)
  }

  private async readInternal(
    absolutePath: string,
    includeBytes: boolean,
    options?: { skipInitialDelay?: boolean },
  ): Promise<StableReadResult> {
    if (!options?.skipInitialDelay && this.defaultSettleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.defaultSettleMs))
    }

    let delay = this.defaultSettleMs
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const stat1 = await fs.lstat(absolutePath)
        const read = await this.readWithStat(absolutePath, stat1, includeBytes)
        if (read) return read

        await new Promise((resolve) => setTimeout(resolve, delay))
        delay = Math.round(delay * this.backoffFactor)
      } catch (err: any) {
        if (err.code === "ENOENT") {
          if (attempt < this.maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, delay))
            delay = Math.round(delay * this.backoffFactor)
            continue
          }
          return { path: absolutePath, exists: false, isSymlink: false }
        }
        throw err
      }
    }

    // Preserve the historical final-attempt behavior after repeated write churn.
    try {
      const stat = await fs.lstat(absolutePath)
      if (stat.isSymbolicLink()) return this.symlinkResult(absolutePath, stat, includeBytes)
      if (!stat.isFile()) return this.specialResult(absolutePath, stat)
      if (includeBytes) {
        const bytes = await fs.readFile(absolutePath)
        return {
          path: absolutePath,
          exists: true,
          bytes,
          contentHash: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
          mtimeMs: stat.mtimeMs,
          mode: stat.mode,
          inode: stat.ino,
          isSymlink: false,
        }
      }
      const streamed = await this.hashRegularFile(absolutePath, stat.size)
      return {
        path: absolutePath,
        exists: true,
        contentHash: streamed.hash,
        size: streamed.size,
        mtimeMs: stat.mtimeMs,
        mode: stat.mode,
        inode: stat.ino,
        isSymlink: false,
      }
    } catch {
      return { path: absolutePath, exists: false, isSymlink: false }
    }
  }

  /** Null means the file changed during this attempt and must be retried. */
  private async readWithStat(
    absolutePath: string,
    stat1: Awaited<ReturnType<typeof fs.lstat>>,
    includeBytes: boolean,
  ): Promise<StableReadResult | null> {
    if (stat1.isSymbolicLink()) return this.symlinkResult(absolutePath, stat1, includeBytes)
    if (!stat1.isFile()) return this.specialResult(absolutePath, stat1)

    let bytes: Buffer | undefined
    let contentHash: string
    let size: number
    if (includeBytes) {
      bytes = await fs.readFile(absolutePath)
      size = bytes.length
      contentHash = createHash("sha256").update(bytes).digest("hex")
    } else {
      const streamed = await this.hashRegularFile(absolutePath, stat1.size)
      size = streamed.size
      contentHash = streamed.hash
    }
    const stat2 = await fs.lstat(absolutePath)

    if (stat1.size !== stat2.size || stat1.mtimeMs !== stat2.mtimeMs || stat1.ino !== stat2.ino || size !== stat2.size) {
      return null
    }
    return {
      path: absolutePath,
      exists: true,
      ...(bytes ? { bytes } : {}),
      contentHash,
      size,
      mtimeMs: stat2.mtimeMs,
      mode: stat2.mode,
      inode: stat2.ino,
      isSymlink: false,
    }
  }

  private async hashRegularFile(absolutePath: string, expectedSize: number): Promise<{ hash: string; size: number }> {
    const handle = await fs.open(absolutePath, "r")
    const digest = createHash("sha256")
    const buffer = Buffer.allocUnsafe(HASH_READ_CHUNK_BYTES)
    let offset = 0
    try {
      while (offset < expectedSize) {
        const length = Math.min(buffer.length, expectedSize - offset)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        if (bytesRead === 0) break
        digest.update(buffer.subarray(0, bytesRead))
        offset += bytesRead
      }
    } finally {
      await handle.close()
    }
    return { hash: digest.digest("hex"), size: offset }
  }

  private async symlinkResult(
    absolutePath: string,
    stat: Awaited<ReturnType<typeof fs.lstat>>,
    includeBytes: boolean,
  ): Promise<StableReadResult> {
    const target = await fs.readlink(absolutePath)
    const bytes = Buffer.from(target, "utf8")
    return {
      path: absolutePath,
      exists: true,
      ...(includeBytes ? { bytes } : {}),
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
      mtimeMs: stat.mtimeMs,
      mode: stat.mode,
      inode: stat.ino,
      isSymlink: true,
      symlinkTarget: target,
    }
  }

  private specialResult(
    absolutePath: string,
    stat: Awaited<ReturnType<typeof fs.lstat>>,
  ): StableReadResult {
    return {
      path: absolutePath,
      exists: true,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      mode: stat.mode,
      inode: stat.ino,
      isSymlink: false,
    }
  }
}
