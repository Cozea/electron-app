import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { StableFileReader } from "../../apps/projectd/src/filesystem/StableRead"

describe("StableFileReader metadata streaming", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  })

  it("hashes a multi-megabyte regular file without returning its payload bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-stable-meta-"))
    roots.push(root)
    const file = path.join(root, "large.bin")
    // Just over two 1 MiB hash chunks proves bounded streaming without turning
    // this contract test into a large-file throughput benchmark under parallel CI.
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 37, 0xa5)
    await fs.writeFile(file, bytes)

    const reader = new StableFileReader({ settleDelayMs: 0 })
    const metadata = await reader.readMetadata(file)
    expect(metadata.exists).toBe(true)
    expect(metadata.bytes).toBeUndefined()
    expect(metadata.size).toBe(bytes.length)
    expect(metadata.contentHash).toBe(createHash("sha256").update(bytes).digest("hex"))

    const complete = await reader.read(file)
    // NOTE: Buffer.equals, not toEqual — vitest deep-equality on multi-MiB
    // buffers costs seconds per assertion and trips the 20s CI timeout.
    expect(Buffer.isBuffer(complete.bytes)).toBe(true)
    const payload = complete.bytes as Buffer
    expect(payload.length).toBe(bytes.length)
    expect(payload.equals(bytes)).toBe(true)
    expect(complete.contentHash).toBe(metadata.contentHash)
  })

  it("refuses a bounded whole read past maxBytes without allocating", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-stable-bound-"))
    roots.push(root)
    const file = path.join(root, "grown.bin")
    await fs.writeFile(file, Buffer.alloc(4096, 0xa5))

    const reader = new StableFileReader({ settleDelayMs: 0 })
    const bounded = await reader.read(file, { skipInitialDelay: true, maxBytes: 1024 })
    expect(bounded.exists).toBe(true)
    expect(bounded.exceedsMaxBytes).toBe(true)
    expect(bounded.bytes).toBeUndefined()

    const allowed = await reader.read(file, { skipInitialDelay: true, maxBytes: 8192 })
    expect(allowed.exceedsMaxBytes).toBeUndefined()
    expect(allowed.bytes?.length).toBe(4096)
  })

  it("returns bytes exactly at the bound and rejects invalid bounds", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-stable-edge-"))
    roots.push(root)
    const file = path.join(root, "edge.bin")
    await fs.writeFile(file, Buffer.alloc(1024, 0xa5))

    const reader = new StableFileReader({ settleDelayMs: 0 })
    const exact = await reader.read(file, { skipInitialDelay: true, maxBytes: 1024 })
    expect(exact.exceedsMaxBytes).toBeUndefined()
    expect(exact.bytes?.length).toBe(1024)

    const zero = await reader.read(file, { skipInitialDelay: true, maxBytes: 0 })
    expect(zero.exceedsMaxBytes).toBe(true)
    expect(zero.bytes).toBeUndefined()

    await expect(reader.read(file, { skipInitialDelay: true, maxBytes: -1 })).rejects.toThrow("Invalid maxBytes")
    await expect(reader.read(file, { skipInitialDelay: true, maxBytes: 1.5 })).rejects.toThrow("Invalid maxBytes")
  })

  it("never returns more than maxBytes while the file churns", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-stable-churn-"))
    roots.push(root)
    const file = path.join(root, "churn.bin")
    await fs.writeFile(file, Buffer.alloc(512, 0xa5))

    const reader = new StableFileReader({ settleDelayMs: 0 })
    const stop = { done: false }
    const churner = (async () => {
      while (!stop.done) {
        await fs.appendFile(file, Buffer.alloc(64 * 1024, 0x5a)).catch(() => undefined)
      }
    })()
    try {
      for (let i = 0; i < 10; i++) {
        const result = await reader.read(file, { skipInitialDelay: true, maxBytes: 4096 })
        // Whatever the outcome — bounded bytes, exceeds marker, or a
        // stability retry surfaced as missing — the bound must hold.
        expect(!result.bytes || result.bytes.length <= 4096).toBe(true)
        if (result.bytes) {
          expect(result.contentHash).toBe(createHash("sha256").update(result.bytes).digest("hex"))
        }
      }
    } finally {
      stop.done = true
      await churner
    }
  })

  it("preserves literal symlink metadata without reading the target", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-stable-link-"))
    roots.push(root)
    const link = path.join(root, "outside")
    await fs.symlink("../does-not-need-to-exist", link)
    const metadata = await new StableFileReader({ settleDelayMs: 0 }).readMetadata(link)
    expect(metadata.isSymlink).toBe(true)
    expect(metadata.symlinkTarget).toBe("../does-not-need-to-exist")
    expect(metadata.bytes).toBeUndefined()
  })
})
