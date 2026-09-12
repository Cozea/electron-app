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
    const bytes = Buffer.alloc(6 * 1024 * 1024 + 37)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
    await fs.writeFile(file, bytes)

    const reader = new StableFileReader({ settleDelayMs: 0 })
    const metadata = await reader.readMetadata(file)
    expect(metadata.exists).toBe(true)
    expect(metadata.bytes).toBeUndefined()
    expect(metadata.size).toBe(bytes.length)
    expect(metadata.contentHash).toBe(createHash("sha256").update(bytes).digest("hex"))

    const complete = await reader.read(file)
    expect(complete.bytes).toEqual(bytes)
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
