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

async function waitFor(predicate: () => boolean | Promise<boolean>, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/**
 * Streaming-only object store: chunk upload/download work, while any
 * whole-buffer call throws. If production materialization ever selects the
 * buffered fallback, the test fails at the selection point.
 */
class StreamingOnlyObjects implements BinaryObjectClient {
  downloadCalls = 0
  uploadCalls = 0
  private readonly objects = new Map<string, Buffer>()

  async upload(): Promise<never> {
    this.uploadCalls++
    throw new Error("buffered binary upload must not run")
  }

  async download(): Promise<never> {
    this.downloadCalls++
    throw new Error("buffered binary download must not run")
  }

  async uploadFrom(source: { size: number; contentHash: string; read: (offset: number, length: number) => Promise<Buffer> }): Promise<BinaryManifest> {
    const chunks: BinaryManifest["chunks"] = []
    const complete = createHash("sha256")
    let offset = 0
    while (offset < source.size) {
      const length = Math.min(CHUNK_SIZE_BYTES, source.size - offset)
      const chunk = await source.read(offset, length)
      complete.update(chunk)
      const chunkHash = hash(chunk)
      chunks.push({ index: chunks.length, hash: chunkHash, size: chunk.length, encryptedRef: `memory:${chunkHash}` })
      this.objects.set(chunkHash, Buffer.from(chunk))
      offset += chunk.length
    }
    expect(complete.digest("hex")).toBe(source.contentHash)
    return { contentHash: source.contentHash, size: source.size, chunkSize: CHUNK_SIZE_BYTES, chunks }
  }

  async downloadTo(manifest: BinaryManifest, write: (chunk: Buffer) => Promise<void>): Promise<void> {
    for (const chunk of manifest.chunks) {
      const bytes = this.objects.get(chunk.hash)
      if (!bytes) throw new Error(`unknown chunk ${chunk.hash}`)
      await write(bytes)
    }
  }
}

describe("CollaborationSessionHost streaming materialization", () => {
  let worker: SessionRoomWorker

  beforeAll(async () => {
    worker = await loadSessionRoomWorker()
  })

  afterAll(() => {
    // RoomHost instances are disposed per test; nothing global remains.
  })

  it("materializes a peer binary through streaming without buffered download", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-host-stream-materialize-"))
    const creatorRoot = path.join(tmp, "creator")
    const joinerRoot = path.join(tmp, "joiner")
    await fs.mkdir(creatorRoot, { recursive: true })
    await fs.mkdir(joinerRoot, { recursive: true })
    // Two 4 MiB chunks plus a tail, so streaming spans more than one chunk.
    const binary = Buffer.alloc(CHUNK_SIZE_BYTES + 512, 0x5a)
    binary[0] = 0
    await fs.writeFile(path.join(creatorRoot, "asset.bin"), binary)

    const roomKey = randomBytes(32)
    const objects = new StreamingOnlyObjects()
    const room = new RoomHost(worker)
    const makeHost = async (
      name: string,
      root: string,
      db: ProjectdDatabase,
    ): Promise<CollaborationSessionHost> =>
      new CollaborationSessionHost({
        publicSessionId: TEST_PUBLIC_SESSION_ID,
        workspaceId: `ws_stream_materialize_${name}`,
        workspaceRoot: root,
        roomKey,
        ticket: {
          wsUrl: "ws://room.test/collab/sessions/ws",
          token: await sessionTokenFor(worker, `principal_stream_materialize_${name}`, { sessionRole: "developer" })(),
          role: "developer",
        },
        db,
        actor: { actorType: "user", principalId: `principal_stream_materialize_${name}` },
        connectorFactory: () => room.connector(),
        binaryObjectStore: objects,
        rescanIntervalMs: 0,
        submitDelayMs: 1,
        materializeDelayMs: 1,
        reconnectDelaysMs: [1],
      })

    const creatorDb = new ProjectdDatabase(":memory:")
    const joinerDb = new ProjectdDatabase(":memory:")
    const creator = await makeHost("creator", creatorRoot, creatorDb)
    const joiner = await makeHost("joiner", joinerRoot, joinerDb)
    try {
      await creator.start()
      await waitFor(
        () => creator.replica.tree.listLiveEntries().some((entry) => entry.path === "asset.bin" && entry.kind === "binary"),
        "creator live binary entry",
      )
      await joiner.start()
      await waitFor(async () => {
        const disk = await fs.readFile(path.join(joinerRoot, "asset.bin")).catch(() => null)
        return disk !== null && disk.equals(binary)
      }, "joiner materialized bytes")
      // The buffered whole-binary download must never have been selected.
      expect(objects.downloadCalls).toBe(0)
      expect(objects.uploadCalls).toBe(0)
      // Streaming populates the verified cache on the receiving side.
      expect(await joiner.binaryCache.get(hash(binary))).toEqual(binary)
      expect(creator.pendingBinaryStore.count()).toBe(0)
    } finally {
      await creator.stop()
      await joiner.stop()
      room.dispose()
      creatorDb.close()
      joinerDb.close()
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
