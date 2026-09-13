import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

export interface AtomicBinaryWriteInput {
  destinationPath: string
  tempIdentity: string
  mode: number
  expectedSize: number
  expectedHash: string
  stream: (write: (chunk: Buffer) => Promise<void>) => Promise<void>
}

export interface AtomicBinaryWriteResult {
  size: number
  contentHash: string
  mtimeMs: number
}

/**
 * Writes a binary revision without ever requiring its complete payload in memory.
 * The destination is replaced only after all streamed bytes match the immutable
 * revision size and SHA-256. Failed/interrupted streams remove their temp file and
 * leave the previous workspace file untouched.
 */
export async function writeVerifiedBinaryAtomic(input: AtomicBinaryWriteInput): Promise<AtomicBinaryWriteResult> {
  if (!Number.isSafeInteger(input.expectedSize) || input.expectedSize < 0 || !/^[a-f0-9]{64}$/.test(input.expectedHash)) {
    throw new Error("Invalid binary materialization metadata")
  }
  await fs.mkdir(path.dirname(input.destinationPath), { recursive: true })
  const tempPath = `${input.destinationPath}.tmp.${input.tempIdentity}.${crypto.randomUUID().slice(0, 8)}`
  const handle = await fs.open(tempPath, "w", input.mode & 0o777)
  const digest = createHash("sha256")
  let size = 0
  try {
    await input.stream(async (chunk) => {
      if (!Buffer.isBuffer(chunk) || chunk.length === 0) return
      if (size + chunk.length > input.expectedSize) throw new Error("Streamed binary exceeds its revision size")
      digest.update(chunk)
      let offset = 0
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null)
        if (bytesWritten <= 0) throw new Error("Could not write streamed binary materialization")
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
  if (size !== input.expectedSize || contentHash !== input.expectedHash) {
    await fs.rm(tempPath, { force: true })
    throw new Error("Streamed binary does not match its revision metadata")
  }
  try {
    await fs.chmod(tempPath, input.mode & 0o777)
    await fs.rename(tempPath, input.destinationPath)
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
  }
  const stat = await fs.lstat(input.destinationPath)
  return { size: stat.size, contentHash, mtimeMs: stat.mtimeMs }
}
