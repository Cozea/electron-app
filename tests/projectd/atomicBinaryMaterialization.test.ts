import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { writeVerifiedBinaryAtomic } from "../../apps/projectd/src/filesystem/AtomicBinaryMaterialization"

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

describe("writeVerifiedBinaryAtomic", () => {
  const roots: string[] = []
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  })

  it("streams chunks into an atomic replacement and verifies the complete revision", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-materialize-stream-"))
    roots.push(root)
    const destination = path.join(root, "asset.bin")
    await fs.writeFile(destination, "old")
    const chunks = [Buffer.alloc(1024 * 1024, 1), Buffer.alloc(1024 * 1024, 2), Buffer.from("tail")]
    const expected = Buffer.concat(chunks)

    const result = await writeVerifiedBinaryAtomic({
      destinationPath: destination,
      tempIdentity: "file_asset",
      mode: 0o100644,
      expectedSize: expected.length,
      expectedHash: hash(expected),
      stream: async (write) => {
        for (const chunk of chunks) await write(chunk)
      },
    })

    expect(result).toMatchObject({ size: expected.length, contentHash: hash(expected) })
    // NOTE: Buffer.equals, not toEqual — vitest deep-equality on multi-MiB
    // buffers costs seconds per assertion and trips the 20s CI timeout.
    const materialized = await fs.readFile(destination)
    expect(materialized.length).toBe(expected.length)
    expect(materialized.equals(expected)).toBe(true)
    expect((await fs.readdir(root)).filter((name) => name.includes(".tmp."))).toEqual([])
  })

  it("keeps the prior destination and removes temp bytes after interruption or hash mismatch", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-materialize-fail-"))
    roots.push(root)
    const destination = path.join(root, "asset.bin")
    await fs.writeFile(destination, "previous")
    const expected = Buffer.from("expected")

    await expect(writeVerifiedBinaryAtomic({
      destinationPath: destination,
      tempIdentity: "file_asset",
      mode: 0o100644,
      expectedSize: expected.length,
      expectedHash: hash(expected),
      stream: async (write) => {
        await write(Buffer.from("wrong---"))
      },
    })).rejects.toThrow("does not match")
    expect((await fs.readFile(destination, "utf8"))).toBe("previous")
    expect((await fs.readdir(root)).filter((name) => name.includes(".tmp."))).toEqual([])

    await expect(writeVerifiedBinaryAtomic({
      destinationPath: destination,
      tempIdentity: "file_asset",
      mode: 0o100644,
      expectedSize: expected.length,
      expectedHash: hash(expected),
      stream: async (write) => {
        await write(Buffer.from("exp"))
        throw new Error("network interrupted")
      },
    })).rejects.toThrow("network interrupted")
    expect((await fs.readFile(destination, "utf8"))).toBe("previous")
    expect((await fs.readdir(root)).filter((name) => name.includes(".tmp."))).toEqual([])
  })
})
