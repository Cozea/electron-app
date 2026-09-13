import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

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

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

type ReadableSource = { size: number; contentHash: string; read: (offset: number, length: number) => Promise<Buffer> }

async function readAll(source: ReadableSource): Promise<{ chunks: BinaryManifest["chunks"]; complete: string }> {
  const chunks: BinaryManifest["chunks"] = []
  const complete = createHash("sha256")
  let offset = 0
  while (offset < source.size) {
    const length = Math.min(CHUNK_SIZE_BYTES, source.size - offset)
    const chunk = await source.read(offset, length)
    complete.update(chunk)
    const chunkHash = hash(chunk)
    chunks.push({ index: chunks.length, hash: chunkHash, size: chunk.length, encryptedRef: `memory:${chunkHash}` })
    offset += chunk.length
  }
  return { chunks, complete: complete.digest("hex") }
}

/** Blocks the first upload attempt forever; later attempts proceed. */
class CrashOnceObjects implements BinaryObjectClient {
  uploadCalls = 0
  uploadFromCalls = 0
  async upload(): Promise<never> {
    this.uploadCalls++
    throw new Error("buffered binary upload must not run")
  }
  async uploadFrom(source: ReadableSource): Promise<BinaryManifest> {
    this.uploadFromCalls++
    if (this.uploadFromCalls === 1) await new Promise<void>(() => undefined)
    const { chunks, complete } = await readAll(source)
    expect(complete).toBe(source.contentHash)
    return { contentHash: source.contentHash, size: source.size, chunkSize: CHUNK_SIZE_BYTES, chunks }
  }
  async download(): Promise<Buffer> { return Buffer.alloc(0) }
  async downloadTo(): Promise<void> { return undefined }
}

/** Fails the first upload attempt transiently; later attempts proceed. */
class FlakyOnceObjects implements BinaryObjectClient {
  uploadCalls = 0
  uploadFromCalls = 0
  readonly uploadedChunkHashes: string[] = []
  async upload(): Promise<never> {
    this.uploadCalls++
    throw new Error("buffered binary upload must not run")
  }
  async uploadFrom(source: ReadableSource): Promise<BinaryManifest> {
    this.uploadFromCalls++
    const { chunks, complete } = await readAll(source)
    expect(complete).toBe(source.contentHash)
    for (const chunk of chunks) {
      if (this.uploadFromCalls > 1) expect(this.uploadedChunkHashes).toContain(chunk.hash)
      this.uploadedChunkHashes.push(chunk.hash)
    }
    if (this.uploadFromCalls === 1) throw new Error("simulated upload outage")
    return { contentHash: source.contentHash, size: source.size, chunkSize: CHUNK_SIZE_BYTES, chunks }
  }
  async download(): Promise<Buffer> { return Buffer.alloc(0) }
  async downloadTo(): Promise<void> { return undefined }
}

describe("CollaborationSessionHost restart binary upload", () => {
  let worker: SessionRoomWorker

  beforeAll(async () => {
    worker = await loadSessionRoomWorker()
  })

  afterAll(() => {
    // RoomHost instances are disposed per test; nothing global remains.
  })

  function makeHost(
    database: ProjectdDatabase,
    room: RoomHost,
    objects: BinaryObjectClient,
    token: string,
    root: string,
    workspaceId: string,
    roomKey: Buffer,
  ): CollaborationSessionHost {
    return new CollaborationSessionHost({
      publicSessionId: TEST_PUBLIC_SESSION_ID,
      workspaceId,
      workspaceRoot: root,
      roomKey,
      ticket: { wsUrl: "ws://room.test/collab/sessions/ws", token, role: "developer" },
      db: database,
      actor: { actorType: "user", principalId: "principal_restart_upload" },
      connectorFactory: () => room.connector(),
      binaryObjectStore: objects,
      rescanIntervalMs: 0,
      submitDelayMs: 1,
      materializeDelayMs: 1,
      reconnectDelaysMs: [1],
    })
  }

  it("resumes a staged binary upload after a crash from the durable capture", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-host-restart-upload-"))
    const root = path.join(tmp, "ws")
    await fs.mkdir(root, { recursive: true })
    const dbPath = path.join(tmp, "projectd.sqlite")
    // Two 4 MiB chunks plus a tail, so resume spans more than one chunk.
    const binary = Buffer.alloc(CHUNK_SIZE_BYTES + 512, 0x5a)
    binary[0] = 0
    await fs.writeFile(path.join(root, "asset.bin"), binary)

    const roomKey = randomBytes(32)
    const objects = new CrashOnceObjects()
    const databaseA = new ProjectdDatabase(dbPath)
    const roomA = new RoomHost(worker)
    const hostA = makeHost(
      databaseA, roomA, objects,
      await sessionTokenFor(worker, "principal_restart_upload", { sessionRole: "developer" })(),
      root, "workspace_restart_upload", roomKey,
    )
    // Crash simulation: never stop host A gracefully and never await its start,
    // which stays parked inside the blocked first upload. Close only the
    // database handle, as an unclean process exit would leave it.
    void hostA.start()
    await waitFor(
      () => objects.uploadFromCalls >= 1 && hostA.pendingBinaryStore.count() === 1,
      "first upload attempt + staged record",
    )
    roomA.dispose()
    databaseA.close()

    const databaseB = new ProjectdDatabase(dbPath)
    const roomB = new RoomHost(worker)
    const hostB = makeHost(
      databaseB, roomB, objects,
      await sessionTokenFor(worker, "principal_restart_upload", { sessionRole: "developer" })(),
      root, "workspace_restart_upload", roomKey,
    )
    try {
      await hostB.start()
      await waitFor(() => objects.uploadFromCalls >= 2, "replay upload attempt")
      await waitFor(
        () => hostB.replica.tree.listLiveEntries().some((entry) => entry.path === "asset.bin" && entry.kind === "binary"),
        "live binary entry",
      )
      expect(objects.uploadCalls).toBe(0)
      expect(hostB.pendingBinaryStore.count()).toBe(0)
      const entry = hostB.replica.tree.listLiveEntries().find((candidate) => candidate.path === "asset.bin")!
      expect(hostB.replica.binaryStore.getHeadRevision(entry.fileId)).toMatchObject({
        contentHash: hash(binary),
        size: binary.length,
      })
      expect(await hostB.binaryCache.get(hash(binary))).toEqual(binary)
    } finally {
      await hostB.stop()
      roomB.dispose()
      databaseB.close()
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it("defers a failed seed upload to replay instead of failing the host", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-host-upload-defer-"))
    const root = path.join(tmp, "ws")
    await fs.mkdir(root, { recursive: true })
    const binary = Buffer.alloc(CHUNK_SIZE_BYTES + 512, 0x5a)
    binary[0] = 0
    await fs.writeFile(path.join(root, "asset.bin"), binary)

    const objects = new FlakyOnceObjects()
    const database = new ProjectdDatabase(":memory:")
    const room = new RoomHost(worker)
    const host = makeHost(
      database, room, objects,
      await sessionTokenFor(worker, "principal_restart_upload", { sessionRole: "developer" })(),
      root, "workspace_upload_defer", randomBytes(32),
    )
    try {
      await host.start()
      await waitFor(
        () => host.replica.tree.listLiveEntries().some((entry) => entry.path === "asset.bin" && entry.kind === "binary"),
        "live binary entry after deferred retry",
      )
      expect((host as unknown as { hostState: string }).hostState).not.toBe("failed")
      expect(objects.uploadFromCalls).toBeGreaterThanOrEqual(2)
      expect(objects.uploadCalls).toBe(0)
      expect(host.pendingBinaryStore.count()).toBe(0)
    } finally {
      await host.stop()
      room.dispose()
      database.close()
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
