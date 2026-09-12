import fs from "node:fs"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { BinaryStore, type BinaryRevision } from "../../apps/projectd/src/collaboration/BinaryStore"
import {
  BinaryContentCache,
  CHUNK_SIZE_BYTES,
} from "../../apps/projectd/src/collaboration/BinaryContentCache"
import { SessionBinaryObjectStore } from "../../apps/projectd/src/collaboration/BinaryObjectStore"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
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

  it("encrypts binary objects outside the room and reconstructs them after a client restart", async () => {
    const roomKey = randomBytes(32)
    const stored = new Map<string, Buffer>()
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input)
      if (init?.method === "PUT") {
        const body = init.body as ArrayBuffer
        stored.set(url, Buffer.from(body))
        return new Response(null, { status: 204 })
      }
      const body = stored.get(url)
      return body
        ? new Response(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, { status: 200 })
        : new Response(null, { status: 404 })
    }
    const options = {
      sessionId: "czs_0123456789abcdef",
      roomKey,
      getRoomUrl: () => "wss://room.example/collab/sessions/ws?sessionId=czs_0123456789abcdef",
      getToken: async () => "session-token",
      fetchFn,
    }
    const writer = new SessionBinaryObjectStore(options)
    // Chunk-size behavior is covered independently above and in binaryObjectStreaming;
    // this regression focuses on encryption, restart reconstruction and integrity.
    const bytes = randomBytes(128 * 1024 + 17)
    const manifest = await writer.upload(bytes)

    expect(manifest.chunks).toHaveLength(1)
    expect(stored.size).toBe(1)
    expect([...stored.values()][0]?.equals(bytes)).toBe(false)

    // A fresh client with no local cache can fetch, authenticate and verify the same objects.
    const reader = new SessionBinaryObjectStore(options)
    expect(await reader.download(manifest)).toEqual(bytes)
    const streamed: Buffer[] = []
    await reader.downloadTo(manifest, async (chunk) => { expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE_BYTES); streamed.push(chunk) })
    expect(Buffer.concat(streamed)).toEqual(bytes)
    await expect(reader.downloadTo(manifest, async () => { throw new Error("sink full") })).rejects.toThrow("sink full")

    const firstUrl = [...stored.keys()][0]!
    const corrupted = Buffer.from(stored.get(firstUrl)!)
    corrupted[corrupted.length - 1] ^= 0xff
    stored.set(firstUrl, corrupted)
    await expect(reader.download(manifest)).rejects.toThrow(/authenticated|verification/i)
  })

  it("exports locally-created binary revision metadata exactly once", () => {
    const replica = new SessionReplica("session_binary_export", "client_binary")
    const entry = replica.createFile({ path: "assets/new.bin", kind: "binary", actor: actor1 })
    const bytes = Buffer.from([0, 1, 2, 3, 4])
    const manifest = cache.createManifest(bytes, "memory:")
    replica.addBinaryRevision({
      revisionId: "rev_local",
      fileId: entry.fileId,
      baseRevisionId: null,
      contentHash: manifest.contentHash,
      manifest,
      encryptedManifestRef: `inline:v1:${manifest.contentHash}`,
      size: bytes.length,
      actor: actor1,
      createdAt: 123,
    })

    const batch = replica.exportBatch()
    expect(batch?.operations.some((operation) => operation.type === "binary-revision")).toBe(true)
    expect(replica.exportBatch()).toBeNull()
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
    expect(resolved.resolvedRevisionIds).toEqual(["rev_1a", "rev_1b"])
    expect(store.detectConcurrentRevisions(fileId)).toBeNull()

    // Head revision is now resolved
    const head = store.getHeadRevision(fileId)
    expect(head?.revisionId).toBe(resolved.revisionId)

    // Historical revisions are completely preserved in the ledger
    const allRevisions = store.getRevisions(fileId)
    expect(allRevisions).toHaveLength(4)
    // A child remains the causal head even when the device clock moves backward.
    const next = { ...resolved, revisionId: "after-resolution", baseRevisionId: resolved.revisionId,
      resolvedRevisionIds: undefined, contentHash: "next", createdAt: 1 }
    store.addRevision(next)
    expect(store.getHeadRevision(fileId)?.revisionId).toBe(next.revisionId)
    // An unseen edit is not covered by the earlier resolution.
    const unseen = { ...rev1A, revisionId: "late-arrival", contentHash: "unseen" }
    store.addRevision(unseen)
    expect(store.detectConcurrentRevisions(fileId)?.conflictingRevisions.map((revision) => revision.revisionId)).toEqual(["after-resolution", "late-arrival"])
    expect(() => store.resolveConflict(fileId, next.revisionId, actor1, [next.revisionId])).toThrow("changed")
    const restored = new BinaryStore()
    for (const revision of [...store.getRevisions(fileId)].reverse()) restored.addRevision(revision)
    expect(restored.detectConcurrentRevisions(fileId)).toEqual(store.detectConcurrentRevisions(fileId))
  })

  it("replicates resolution ancestry and manifests while retaining simultaneous choices", () => {
    const first = new SessionReplica("binary_resolution", "first")
    const entry = first.createFile({ path: "image.bin", kind: "binary", actor: actor1 })
    const revisions = [Buffer.from([0, 1]), Buffer.from([0, 2])].map((bytes, index): BinaryRevision => {
      const manifest = cache.createManifest(bytes)
      return { revisionId: `variant-${index}`, fileId: entry.fileId, baseRevisionId: null,
        contentHash: manifest.contentHash, manifest, encryptedManifestRef: `inline:v1:${manifest.contentHash}`,
        size: bytes.length, actor: actor1, createdAt: index }
    })
    for (const revision of revisions) first.addBinaryRevision(revision)
    const second = new SessionReplica("binary_resolution", "second")
    second.applyBatch(first.exportBatch()!)
    const reviewed = revisions.map((revision) => revision.revisionId)
    const a = first.resolveBinaryConflict(entry.fileId, reviewed[0]!, reviewed, actor1)
    const b = second.resolveBinaryConflict(entry.fileId, reviewed[1]!, reviewed, actor2)
    expect(a.manifest).toEqual(revisions[0]!.manifest)
    expect(first.binaryStore.detectConcurrentRevisions(entry.fileId)).toBeNull()
    const batchA = first.exportBatch()!
    const batchB = second.exportBatch()!
    first.applyBatch(batchB)
    second.applyBatch(batchA)
    expect(first.binaryStore.getFrontier(entry.fileId).map((revision) => revision.revisionId).sort()).toEqual([a.revisionId, b.revisionId].sort())
    expect(first.binaryStore.detectConcurrentRevisions(entry.fileId)).toEqual(second.binaryStore.detectConcurrentRevisions(entry.fileId))
    const resolution = first.resolveBinaryConflict(entry.fileId, a.revisionId, [a.revisionId, b.revisionId], actor1)
    second.applyBatch(first.exportBatch()!)
    const restored = new SessionReplica("binary_resolution", "restored")
    restored.restoreSnapshot(second.captureSnapshot())
    expect(restored.binaryStore.detectConcurrentRevisions(entry.fileId)).toBeNull()
    expect(restored.binaryStore.getHeadRevision(entry.fileId)).toEqual(resolution)
    expect(restored.binaryStore.getRevisions(entry.fileId)).toHaveLength(5)
    expect(restored.binaryStore.getHeadRevision(entry.fileId)?.manifest).toEqual(revisions[0]!.manifest)
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
