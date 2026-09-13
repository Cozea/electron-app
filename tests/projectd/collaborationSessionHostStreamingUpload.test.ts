import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { CollaborationSessionHost } from "../../apps/projectd/src/collaboration/CollaborationSessionHost"
import { CHUNK_SIZE_BYTES, type BinaryManifest } from "../../apps/projectd/src/collaboration/BinaryContentCache"
import type { BinaryObjectClient, BinaryUploadSource } from "../../apps/projectd/src/collaboration/BinaryObjectStore"
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

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for streaming host upload")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

class StreamingOnlyObjects implements BinaryObjectClient {
  uploadCalls = 0
  uploadFromCalls = 0
  readonly reads: Array<{ offset: number; length: number }> = []
  private readonly objects = new Map<string, Buffer>()

  async upload(): Promise<BinaryManifest> {
    this.uploadCalls++
    throw new Error("buffered binary upload must not run")
  }

  async uploadFrom(source: BinaryUploadSource): Promise<BinaryManifest> {
    this.uploadFromCalls++
    const chunks: BinaryManifest["chunks"] = []
    const complete = createHash("sha256")
    let offset = 0
    while (offset < source.size) {
      const length = Math.min(CHUNK_SIZE_BYTES, source.size - offset)
      this.reads.push({ offset, length })
      const chunk = await source.read(offset, length)
      expect(chunk).toHaveLength(length)
      complete.update(chunk)
      const chunkHash = hash(chunk)
      chunks.push({ index: chunks.length, hash: chunkHash, size: chunk.length, encryptedRef: `memory:${chunkHash}` })
      this.objects.set(chunkHash, Buffer.from(chunk))
      offset += chunk.length
    }
    expect(complete.digest("hex")).toBe(source.contentHash)
    return { contentHash: source.contentHash, size: source.size, chunkSize: CHUNK_SIZE_BYTES, chunks }
  }

  async download(manifest: BinaryManifest): Promise<Buffer> {
    return Buffer.concat(manifest.chunks.map((chunk) => this.objects.get(chunk.hash) ?? Buffer.alloc(0)))
  }

  async downloadTo(manifest: BinaryManifest, write: (chunk: Buffer) => Promise<void>): Promise<void> {
    for (const chunk of manifest.chunks) await write(this.objects.get(chunk.hash) ?? Buffer.alloc(0))
  }
}

describe("CollaborationSessionHost streaming binary upload", () => {
  let worker: SessionRoomWorker

  beforeAll(async () => {
    worker = await loadSessionRoomWorker()
  })

  afterAll(() => {
    // RoomHost instances are disposed per test; nothing global remains.
  })

  it("stages a large local binary and uploads the durable capture without calling upload(Buffer)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-host-stream-upload-"))
    const database = new ProjectdDatabase(":memory:")
    const room = new RoomHost(worker)
    const objects = new StreamingOnlyObjects()
    const roomKey = randomBytes(32)
    const binary = Buffer.alloc(600 * 1024 + 19, 0x5a)
    binary[0] = 0
    await fs.writeFile(path.join(root, "asset.bin"), binary)

    const token = await sessionTokenFor(worker, "principal_streaming_upload", { sessionRole: "developer" })()
    const host = new CollaborationSessionHost({
      publicSessionId: TEST_PUBLIC_SESSION_ID,
      workspaceId: "workspace_streaming_upload",
      workspaceRoot: root,
      roomKey,
      ticket: { wsUrl: "ws://room.test/collab/sessions/ws", token, role: "developer" },
      db: database,
      actor: { actorType: "user", principalId: "principal_streaming_upload" },
      connectorFactory: () => room.connector(),
      binaryObjectStore: objects,
      rescanIntervalMs: 0,
      submitDelayMs: 1,
      materializeDelayMs: 1,
      reconnectDelaysMs: [1],
    })

    try {
      await host.start()
      await waitFor(() => host.replica.tree.listLiveEntries().some((entry) => entry.path === "asset.bin" && entry.kind === "binary"))
      expect(objects.uploadCalls).toBe(0)
      expect(objects.uploadFromCalls).toBe(1)
      expect(objects.reads).toEqual([{ offset: 0, length: binary.length }])
      expect(host.pendingBinaryStore.count()).toBe(0)
      const entry = host.replica.tree.listLiveEntries().find((candidate) => candidate.path === "asset.bin")!
      expect(host.replica.binaryStore.getHeadRevision(entry.fileId)).toMatchObject({
        contentHash: hash(binary),
        size: binary.length,
      })
      // NOTE: Buffer.equals, not toEqual — vitest deep-equality on large
      // buffers costs seconds per assertion under full-suite CI load.
      const cached = await host.binaryCache.get(hash(binary))
      expect(cached?.length).toBe(binary.length)
      expect(cached!.equals(binary)).toBe(true)
    } finally {
      await host.stop()
      room.dispose()
      database.close()
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
