/**
 * Stable read algorithm for dirty files.
 *
 * Master Specification: Section 12.5
 * Steps:
 * 1. delay initial settle (~50-75 ms);
 * 2. lstat;
 * 3. read bytes;
 * 4. lstat again;
 * 5. if size/mtime/inode changed, retry with exponential backoff;
 * 6. hash stable bytes with SHA-256.
 */

import { createHash } from "node:crypto"
import fs from "node:fs/promises"

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

  async read(
    absolutePath: string,
    options?: { skipInitialDelay?: boolean },
  ): Promise<StableReadResult> {
    if (!options?.skipInitialDelay && this.defaultSettleMs > 0) {
      await new Promise((r) => setTimeout(r, this.defaultSettleMs))
    }

    let delay = this.defaultSettleMs

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const stat1 = await fs.lstat(absolutePath)

        if (stat1.isSymbolicLink()) {
          const target = await fs.readlink(absolutePath)
          const targetHash = createHash("sha256").update(target).digest("hex")
          return {
            path: absolutePath,
            exists: true,
            bytes: Buffer.from(target, "utf8"),
            contentHash: targetHash,
            size: target.length,
            mtimeMs: stat1.mtimeMs,
            mode: stat1.mode,
            inode: stat1.ino,
            isSymlink: true,
            symlinkTarget: target,
          }
        }

        if (!stat1.isFile()) {
          // Directories or special entries
          return {
            path: absolutePath,
            exists: true,
            size: stat1.size,
            mtimeMs: stat1.mtimeMs,
            mode: stat1.mode,
            inode: stat1.ino,
            isSymlink: false,
          }
        }

        const bytes = await fs.readFile(absolutePath)
        const stat2 = await fs.lstat(absolutePath)

        // Verify stability: size, mtime, inode must match
        if (stat1.size === stat2.size && stat1.mtimeMs === stat2.mtimeMs && stat1.ino === stat2.ino) {
          const contentHash = createHash("sha256").update(bytes).digest("hex")
          return {
            path: absolutePath,
            exists: true,
            bytes,
            contentHash,
            size: bytes.length,
            mtimeMs: stat2.mtimeMs,
            mode: stat2.mode,
            inode: stat2.ino,
            isSymlink: false,
          }
        }

        // File changed while reading; wait and retry
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.round(delay * this.backoffFactor)
      } catch (err: any) {
        if (err.code === "ENOENT") {
          // File deleted or temporary file replaced atomically
          if (attempt < this.maxRetries - 1) {
            await new Promise((r) => setTimeout(r, delay))
            delay = Math.round(delay * this.backoffFactor)
            continue
          }
          return {
            path: absolutePath,
            exists: false,
            isSymlink: false,
          }
        }
        throw err
      }
    }

    // Final attempt read
    try {
      const bytes = await fs.readFile(absolutePath)
      const stat = await fs.lstat(absolutePath)
      const contentHash = createHash("sha256").update(bytes).digest("hex")
      return {
        path: absolutePath,
        exists: true,
        bytes,
        contentHash,
        size: bytes.length,
        mtimeMs: stat.mtimeMs,
        mode: stat.mode,
        inode: stat.ino,
        isSymlink: stat.isSymbolicLink(),
      }
    } catch {
      return {
        path: absolutePath,
        exists: false,
        isSymlink: false,
      }
    }
  }
}
