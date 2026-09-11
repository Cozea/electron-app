import fs from "node:fs"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { BinaryStore, type BinaryRevision } from "../../apps/projectd/src/collaboration/BinaryStore"
import {
  BinaryContentCache,
  CHUNK_SIZE_BYTES,
} from "../../apps/projectd/src/collaboration/BinaryContentCache"
import { TreeDoc, type ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"

describe("P11 binary live collaboration", () => {
  const actor1: ChangeActor = { actorType: "user", principalId: "user_1" }
  const actor2: ChangeActor = { actorType: "user", principalId: "user_2" }

  const tmpDir = "/tmp"
  let testDbPath: string
  let testCacheDir: string
  let db: ProjectdDatabase
  let cache: BinaryContentCache

  beforeEach(() => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testDbPath = path.join(tmpDir, `test_bin_db_${id}.sqlite`)
    testCacheDir = path.join(tmpDir, `test_bin_cache_${id}`)

    db = new ProjectdDatabase(testDbPath)
    cache = new BinaryContentCache({ cacheDir: testCacheDir, db })
  })

  afterEach(async () => {
    if (db) db.close()
    for (const p of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`, testCacheDir]) {
      try {
        if (fs.existsSync(p)) {
          fs.rmSync(p, { recursive: true, force: true })
        }
      } catch {
        // Ignore
      }
    }
  })

  it("splits large binary into 4 MiB chunks and builds a manifest (Section 11.4)", () => {
    // 9 MiB buffer -> 3 chunks (4MB + 4MB + 1MB)
    const testSize = 9 * 1024 * 1024
    const largeBuffer = randomBytes(testSize)

    const manifest = cache.createManifest(largeBuffer, "r2://blobs/")
    expect(manifest.size).toBe(testSize)
    expect(manifest.chunkSize).toBe(CHUNK_SIZE_BYTES)
    expect(manifest.chunks).toHaveLength(3)

    expect(manifest.chunks[0].size).toBe(4 * 1024 * 1024)
    expect(manifest.chunks[1].size).toBe(4 * 1024 * 1024)
    expect(manifest.chunks[2].size).toBe(1 * 1024 * 1024)
    expect(manifest.chunks[0].encryptedRef).toMatch(/^r2:\/\/blobs\/[a-f0-9]{64}$/)
  })

  it("stores and retrieves binary assets with SHA-256 integrity verification", async () => {
    const sampleBytes = Buffer.from("image PNG binary data simulation 12345")
    const { contentHash, cachedPath } = await cache.put(sampleBytes)

    expect(fs.existsSync(cachedPath)).toBe(true)
    expect(await cache.has(contentHash)).toBe(true)

    const retrieved = await cache.get(contentHash)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.toString("utf8")).toBe("image PNG binary data simulation 12345")
  })

  it("detects and resolves concurrent binary sibling revisions (Section 11.3)", () => {
    const store = new BinaryStore()
    const fileId = "file_banner_png"

    const revBase: BinaryRevision = {
      revisionId: "rev_0",
      fileId,
      baseRevisionId: null,
      contentHash: "hash_v0",
      encryptedManifestRef: "ref_v0",
      size: 1000,
      actor: actor1,
      createdAt: 1000,
    }
    store.addRevision(revBase)

    // Two sibling revisions branched from rev_0
    const rev1A: BinaryRevision = {
      revisionId: "rev_1a",
      fileId,
      baseRevisionId: "rev_0",
      contentHash: "hash_v1a",
      encryptedManifestRef: "ref_v1a",
      size: 1200,
      actor: actor1,
      createdAt: 2000,
    }
    const rev1B: BinaryRevision = {
      revisionId: "rev_1b",
      fileId,
      baseRevisionId: "rev_0",
      contentHash: "hash_v1b",
      encryptedManifestRef: "ref_v1b",
      size: 1400,
      actor: actor2,
      createdAt: 2050,
    }

    store.addRevision(rev1A)
    store.addRevision(rev1B)

    // Conflict detected: both revisions share base rev_0 with distinct hashes
    const conflict = store.detectConcurrentRevisions(fileId)
    expect(conflict).not.toBeNull()
    expect(conflict?.kind).toBe("binary_concurrent_revision")
    expect(conflict?.conflictingRevisions).toHaveLength(2)

    // Resolve conflict by choosing rev_1B
    const resolved = store.resolveConflict(fileId, "rev_1b", actor1)
    expect(resolved.baseRevisionId).toBe("rev_1b")
    expect(resolved.contentHash).toBe("hash_v1b")

    // Head revision is now resolved
    const head = store.getHeadRevision(fileId)
    expect(head?.revisionId).toBe(resolved.revisionId)

    // Historical revisions are completely preserved in the ledger
    const allRevisions = store.getRevisions(fileId)
    expect(allRevisions).toHaveLength(4)
  })

  it("integrates binary entries into TreeDoc without text document overhead (Section 11.1)", () => {
    const tree = new TreeDoc("session_bin_test")

    const entry = tree.createEntry({
      path: "assets/logo.png",
      kind: "binary",
      actor: actor1,
    })

    expect(entry.kind).toBe("binary")
    expect(entry.textDocId).toBeUndefined() // No Yjs text document created for binary asset
    expect(entry.path).toBe("assets/logo.png")
  })
})
