import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { beforeAll, describe, expect, it } from "vitest"

import { CollaborationSessionHost } from "../../apps/projectd/src/collaboration/CollaborationSessionHost"
import { CHUNK_SIZE_BYTES, type BinaryManifest } from "../../apps/projectd/src/collaboration/BinaryContentCache"
import type { BinaryObjectClient } from "../../apps/projectd/src/collaboration/BinaryObjectStore"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import {
  loadSessionRoomWorker,
  RoomHost,
  sessionTokenFor,
  TEST_PUBLIC_SESSION_ID,
  type SessionRoomWorker,
} from "../helpers/sessionRoomHarness"

/**
 * Phase-1 acceptance rows B01, B02 and B04 against two live hosts.
 *
 * Memory discipline: no test in this file ever holds its large fixtures in a
 * single contiguous Buffer. The 100 MiB asset is generated, uploaded,
 * downloaded and verified incrementally; object chunks spill to disk.
 */
function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

async function waitFor(predicate: () => boolean | Promise<boolean>, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Incremental SHA-256 + size of a disk file; bounded 1 MiB working buffer. */
async function sha256File(absolutePath: string): Promise<{ hash: string; size: number }> {
  const digest = createHash("sha256")
  let size = 0
  const handle = await fs.open(absolutePath, "r")
  try {
    for (;;) {
      const buffer = Buffer.allocUnsafe(1024 * 1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      digest.update(buffer.subarray(0, bytesRead))
      size += bytesRead
    }
  } finally {
    await handle.close()
  }
  return { hash: digest.digest("hex"), size }
}

/** Object store spilling chunks to disk; whole-buffer calls fail loudly. */
class DiskObjects implements BinaryObjectClient {
  uploadCalls = 0
  downloadCalls = 0
  uploadFromCalls = 0
  downloadToCalls = 0
  maxUploadPiece = 0
  maxDownloadPiece = 0
  /** Per-attempt uploaded chunk hashes, in order (attempt 1 is a prefix). */
  readonly uploadedChunkHashes: string[][] = []
  /** First attempt throws after this many chunks; later attempts proceed. */
  failFirstAttemptAfterChunks = Number.POSITIVE_INFINITY
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  async upload(): Promise<never> {
    this.uploadCalls++
    throw new Error("buffered binary upload must not run")
  }

  async download(): Promise<never> {
    this.downloadCalls++
    throw new Error("buffered binary download must not run")
  }

  async uploadFrom(source: { size: number; contentHash: string; read: (offset: number, length: number) => Promise<Buffer> }): Promise<BinaryManifest> {
    this.uploadFromCalls++
    const attempt = this.uploadFromCalls
    const attemptHashes: string[] = []
    const complete = createHash("sha256")
    const chunks: BinaryManifest["chunks"] = []
    let offset = 0
    let index = 0
    while (offset < source.size) {
      const length = Math.min(CHUNK_SIZE_BYTES, source.size - offset)
      const chunk = await source.read(offset, length)
      this.maxUploadPiece = Math.max(this.maxUploadPiece, chunk.length)
      complete.update(chunk)
      const chunkHash = hash(chunk)
      attemptHashes.push(chunkHash)
      chunks.push({ index, hash: chunkHash, size: chunk.length, encryptedRef: `disk:${chunkHash}` })
      await fs.writeFile(path.join(this.dir, `chunk-${index}`), chunk)
      offset += chunk.length
      index += 1
      if (attempt === 1 && index === this.failFirstAttemptAfterChunks) {
        this.uploadedChunkHashes.push(attemptHashes)
        throw new Error("simulated upload outage")
      }
    }
    expect(complete.digest("hex")).toBe(source.contentHash)
    this.uploadedChunkHashes.push(attemptHashes)
    return { contentHash: source.contentHash, size: source.size, chunkSize: CHUNK_SIZE_BYTES, chunks }
  }

  async downloadTo(manifest: BinaryManifest, write: (chunk: Buffer) => Promise<void>): Promise<void> {
    this.downloadToCalls++
    for (const chunk of manifest.chunks) {
      const bytes = await fs.readFile(path.join(this.dir, `chunk-${chunk.index}`))
      this.maxDownloadPiece = Math.max(this.maxDownloadPiece, bytes.length)
      await write(bytes)
    }
  }
}

describe("P11 binary acceptance (B01/B02/B04)", () => {
  let worker: SessionRoomWorker

  beforeAll(async () => {
    worker = await loadSessionRoomWorker()
  })

  function makeHost(
    room: RoomHost,
    name: string,
    root: string,
    db: ProjectdDatabase,
    roomKey: Buffer,
    objects: BinaryObjectClient,
  ): Promise<CollaborationSessionHost> {
    return (async () => new CollaborationSessionHost({
      publicSessionId: TEST_PUBLIC_SESSION_ID,
      workspaceId: `ws_bin_accept_${name}`,
      workspaceRoot: root,
      roomKey,
      ticket: {
        wsUrl: "ws://room.test/collab/sessions/ws",
        token: await sessionTokenFor(worker, `principal_bin_accept_${name}`, { sessionRole: "developer" })(),
        role: "developer",
      },
      db,
      actor: { actorType: "user", principalId: `principal_bin_accept_${name}` },
      connectorFactory: () => room.connector(),
      binaryObjectStore: objects,
      rescanIntervalMs: 100,
      submitDelayMs: 1,
      materializeDelayMs: 1,
      reconnectDelaysMs: [1],
    }))()
  }

  it("B01: peer PNG replacement arrives byte-exact with history retained", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-bin-b01-"))
    const rootA = path.join(tmp, "a")
    const rootB = path.join(tmp, "b")
    await fs.mkdir(rootA, { recursive: true })
    await fs.mkdir(rootB, { recursive: true })
    const png = (seed: number): Buffer => {
      const bytes = randomBytes(200 * 1024)
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0)
      bytes[16] = seed
      return bytes
    }
    const first = png(1)
    const second = png(2)
    await fs.writeFile(path.join(rootA, "photo.png"), first)

    const roomKey = randomBytes(32)
    const objects = new DiskObjects(path.join(tmp, "objects"))
    await fs.mkdir(path.join(tmp, "objects"), { recursive: true })
    const room = new RoomHost(worker)
    const dbA = new ProjectdDatabase(":memory:")
    const dbB = new ProjectdDatabase(":memory:")
    const hostA = await makeHost(room, "a", rootA, dbA, roomKey, objects)
    const hostB = await makeHost(room, "b", rootB, dbB, roomKey, objects)
    const liveBinary = (host: CollaborationSessionHost, filePath: string): boolean =>
      host.replica.tree.listLiveEntries().some((entry) => entry.path === filePath && entry.kind === "binary")
    try {
      await hostA.start()
      await waitFor(() => liveBinary(hostA, "photo.png"), "creator live photo")
      await hostB.start()
      await waitFor(async () => (await fs.readFile(path.join(rootB, "photo.png")).catch(() => null))?.equals(first) ?? false, "joiner first photo bytes")
      await fs.writeFile(path.join(rootA, "photo.png"), second)
      await waitFor(async () => (await fs.readFile(path.join(rootB, "photo.png")).catch(() => null))?.equals(second) ?? false, "joiner replaced photo bytes")
      const entryB = hostB.replica.tree.listLiveEntries().find((entry) => entry.path === "photo.png")!
      expect(hostB.replica.binaryStore.getRevisions(entryB.fileId)).toHaveLength(2)
      expect(hostB.replica.binaryStore.getHeadRevision(entryB.fileId)).toMatchObject({ contentHash: hash(second), size: second.length })
      expect(objects.uploadCalls).toBe(0)
      expect(objects.downloadCalls).toBe(0)
    } finally {
      await hostA.stop()
      await hostB.stop()
      room.dispose()
      dbA.close()
      dbB.close()
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it("B04: text-to-binary reclassification transitions explicitly with bytes exact", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-bin-b04-"))
    const rootA = path.join(tmp, "a")
    const rootB = path.join(tmp, "b")
    await fs.mkdir(rootA, { recursive: true })
    await fs.mkdir(rootB, { recursive: true })
    const text = "session notes\nline two\n"
    // NUL bytes classify as binary regardless of size.
    const binary = Buffer.concat([Buffer.from([0, 137, 80, 78, 71, 0]), randomBytes(4096)])
    await fs.writeFile(path.join(rootA, "notes.dat"), text)

    const roomKey = randomBytes(32)
    const objects = new DiskObjects(path.join(tmp, "objects"))
    await fs.mkdir(path.join(tmp, "objects"), { recursive: true })
    const room = new RoomHost(worker)
    const dbA = new ProjectdDatabase(":memory:")
    const dbB = new ProjectdDatabase(":memory:")
    const hostA = await makeHost(room, "a", rootA, dbA, roomKey, objects)
    const hostB = await makeHost(room, "b", rootB, dbB, roomKey, objects)
    try {
      await hostA.start()
      await waitFor(
        () => hostA.replica.tree.listLiveEntries().some((entry) => entry.path === "notes.dat" && entry.kind === "text"),
        "creator live text entry",
      )
      await hostB.start()
      await waitFor(async () => (await fs.readFile(path.join(rootB, "notes.dat"), "utf8").catch(() => null)) === text, "joiner live text")
      await fs.writeFile(path.join(rootA, "notes.dat"), binary)
      await waitFor(
        () => hostA.replica.tree.listLiveEntries().some((entry) => entry.path === "notes.dat" && entry.kind === "binary"),
        "creator reclassified entry",
      )
      await waitFor(async () => (await fs.readFile(path.join(rootB, "notes.dat")).catch(() => null))?.equals(binary) ?? false, "joiner reclassified bytes")
      expect(hostA.status().state).not.toBe("failed")
      expect(hostB.status().state).not.toBe("failed")
      const entryB = hostB.replica.tree.listLiveEntries().find((entry) => entry.path === "notes.dat")!
      expect(entryB.kind).toBe("binary")
      expect(hostB.replica.binaryStore.getHeadRevision(entryB.fileId)).toMatchObject({ contentHash: hash(binary), size: binary.length })
    } finally {
      await hostA.stop()
      await hostB.stop()
      room.dispose()
      dbA.close()
      dbB.close()
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it("B02: 100 MiB asset survives an interrupted upload and resumes byte-exact", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-bin-b02-"))
    const rootA = path.join(tmp, "a")
    const rootB = path.join(tmp, "b")
    const objDir = path.join(tmp, "objects")
    await fs.mkdir(rootA, { recursive: true })
    await fs.mkdir(rootB, { recursive: true })
    await fs.mkdir(objDir, { recursive: true })
    // Generated and hashed incrementally: peak working set stays 1 MiB.
    const SIZE = 100 * 1024 * 1024
    const expected = createHash("sha256")
    const target = path.join(rootA, "asset.bin")
    const handle = await fs.open(target, "w")
    try {
      for (let done = 0; done < SIZE; done += 1024 * 1024) {
        const block = randomBytes(1024 * 1024)
        expected.update(block)
        await handle.write(block)
      }
      await handle.sync()
    } finally {
      await handle.close()
    }
    const expectedHash = expected.digest("hex")

    const roomKey = randomBytes(32)
    const objects = new DiskObjects(objDir)
    objects.failFirstAttemptAfterChunks = 5
    const room = new RoomHost(worker)
    const dbA = new ProjectdDatabase(path.join(tmp, "a.sqlite"))
    const dbB = new ProjectdDatabase(path.join(tmp, "b.sqlite"))
    // Isolate the binary cache: creator and joiner share the process default,
    // so evict the creator object to force a genuine remote streaming fetch.
    const previousCacheDir = process.env.COZEA_BINARY_CACHE_DIR
    process.env.COZEA_BINARY_CACHE_DIR = path.join(tmp, "binary-cache")
    const hostA = await makeHost(room, "a", rootA, dbA, roomKey, objects)
    const hostB = await makeHost(room, "b", rootB, dbB, roomKey, objects)
    try {
      await hostA.start()
      await waitFor(() => objects.uploadFromCalls >= 1, "first upload attempt")
      await fs.rm(hostA.binaryCache.getCachePath(expectedHash), { force: true })
      await hostB.start()
      await waitFor(async () => {
        const stat = await fs.stat(path.join(rootB, "asset.bin")).catch(() => null)
        if (!stat || stat.size !== SIZE) return false
        return (await sha256File(path.join(rootB, "asset.bin"))).hash === expectedHash
      }, "joiner 100 MiB bytes", 150_000)
      // Resume integrity: attempt 1 uploaded 5 chunks, attempt 2 reproduced them.
      expect(objects.uploadFromCalls).toBe(2)
      expect(objects.uploadedChunkHashes).toHaveLength(2)
      expect(objects.uploadedChunkHashes[1].slice(0, 5)).toEqual(objects.uploadedChunkHashes[0])
      expect(objects.downloadToCalls).toBeGreaterThan(0)
      expect(objects.downloadCalls).toBe(0)
      expect(objects.uploadCalls).toBe(0)
      // Memory gate: no retained piece wider than one object chunk.
      expect(objects.maxUploadPiece).toBeLessThanOrEqual(CHUNK_SIZE_BYTES)
      expect(objects.maxDownloadPiece).toBeLessThanOrEqual(CHUNK_SIZE_BYTES)
      expect(hostA.pendingBinaryStore.count()).toBe(0)
      expect((await fs.readdir(objDir)).filter((name) => name.startsWith("chunk-"))).toHaveLength(25)
      const entryB = hostB.replica.tree.listLiveEntries().find((entry) => entry.path === "asset.bin")!
      expect(hostB.replica.binaryStore.getHeadRevision(entryB.fileId)).toMatchObject({ contentHash: expectedHash, size: SIZE })
    } finally {
      if (previousCacheDir === undefined) delete process.env.COZEA_BINARY_CACHE_DIR
      else process.env.COZEA_BINARY_CACHE_DIR = previousCacheDir
      await hostA.stop()
      await hostB.stop()
      room.dispose()
      dbA.close()
      dbB.close()
      await fs.rm(tmp, { recursive: true, force: true })
    }
  }, 180_000)
})
