import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { BinaryContentCache, CHUNK_SIZE_BYTES } from "../../apps/projectd/src/collaboration/BinaryContentCache"

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

describe("streaming binary content cache", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  })

  it("stores streamed content only after complete hash and size verification", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-cache-stream-"))
    roots.push(root)
    const cache = new BinaryContentCache({ cacheDir: root })
    const chunks = [Buffer.alloc(CHUNK_SIZE_BYTES, 3), Buffer.from("tail")]
    const bytes = Buffer.concat(chunks)
    const contentHash = hash(bytes)

    const result = await cache.putFrom({
      contentHash,
      size: bytes.length,
      stream: async (write) => {
        for (const chunk of chunks) await write(chunk)
      },
    })

    expect(result).toEqual({ contentHash, size: bytes.length, cachedPath: cache.getCachePath(contentHash) })
    // NOTE: Buffer.equals, not toEqual — vitest deep-equality on multi-MiB
    // buffers costs seconds per assertion and trips the 20s CI timeout.
    const stored = await fs.readFile(result.cachedPath)
    expect(stored.length).toBe(bytes.length)
    expect(stored.equals(bytes)).toBe(true)
    expect((await fs.readdir(root)).filter((name) => name.includes(".tmp."))).toEqual([])
  })

  it("discards a failed streamed cache write without replacing an existing verified object", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-cache-fail-"))
    roots.push(root)
    const cache = new BinaryContentCache({ cacheDir: root })
    const expected = Buffer.from("expected cache bytes")
    const contentHash = hash(expected)
    await fs.writeFile(cache.getCachePath(contentHash), expected)

    await expect(cache.putFrom({
      contentHash,
      size: expected.length,
      stream: async (write) => {
        await write(Buffer.from("different cache bytes"))
      },
    })).rejects.toThrow(/verification|size/i)

    expect(await fs.readFile(cache.getCachePath(contentHash))).toEqual(expected)
    expect((await fs.readdir(root)).filter((name) => name.includes(".tmp."))).toEqual([])
  })

  it("verifies a cache object before exposing any bytes to an unresettable sink", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-cache-verify-"))
    roots.push(root)
    const cache = new BinaryContentCache({ cacheDir: root })
    const expected = Buffer.alloc(CHUNK_SIZE_BYTES + 9, 4)
    const contentHash = hash(expected)
    await fs.writeFile(cache.getCachePath(contentHash), Buffer.alloc(expected.length, 5))

    const corruptWrites: Buffer[] = []
    expect(await cache.copyVerifiedTo(contentHash, expected.length, async (chunk) => {
      corruptWrites.push(Buffer.from(chunk))
    })).toBe(false)
    expect(corruptWrites).toEqual([])

    await fs.writeFile(cache.getCachePath(contentHash), expected)
    const verifiedWrites: Buffer[] = []
    expect(await cache.copyVerifiedTo(contentHash, expected.length, async (chunk) => {
      verifiedWrites.push(Buffer.from(chunk))
    })).toBe(true)
    expect(verifiedWrites.map((chunk) => chunk.length)).toEqual([CHUNK_SIZE_BYTES, 9])
    const verified = Buffer.concat(verifiedWrites)
    expect(verified.length).toBe(expected.length)
    expect(verified.equals(expected)).toBe(true)
  })
})
