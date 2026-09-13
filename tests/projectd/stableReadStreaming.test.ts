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
