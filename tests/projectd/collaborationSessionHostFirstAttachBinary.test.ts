import { createHash, randomBytes } from "node:crypto"
import fsp from "node:fs/promises"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

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

class MemoryObjects implements BinaryObjectClient {
  private readonly objects = new Map<string, Buffer>()

  async upload(): Promise<BinaryManifest> {
    throw new Error("buffered binary upload must not run")
  }

  async download(manifest: BinaryManifest): Promise<Buffer> {
    return Buffer.concat(manifest.chunks.map((chunk) => this.objects.get(chunk.hash) ?? Buffer.alloc(0)))
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

describe("CollaborationSessionHost first-attach binary compare", () => {
  let worker: SessionRoomWorker

  beforeAll(async () => {
    worker = await loadSessionRoomWorker()
  })

  afterAll(() => {
    // RoomHost instances are disposed per test; nothing global remains.
  })

  it("adopts a matching binary without reading the whole file, and refuses a differing one", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-host-first-attach-"))
    const creatorRoot = path.join(tmp, "creator")
    const cloneRoot = path.join(tmp, "clone")
    const divergentRoot = path.join(tmp, "divergent")
    await fs.mkdir(creatorRoot, { recursive: true })
    await fs.mkdir(cloneRoot, { recursive: true })
    await fs.mkdir(divergentRoot, { recursive: true })
    // Larger than the 512 KiB text ceiling, so only the binary path applies.
    const binary = Buffer.alloc(CHUNK_SIZE_BYTES + 512, 0x5a)
    binary[0] = 0
    const divergent = Buffer.from(binary)
    divergent[divergent.length - 1] ^= 0xff
    await fs.writeFile(path.join(creatorRoot, "asset.bin"), binary)
    await fs.writeFile(path.join(cloneRoot, "asset.bin"), binary)
    await fs.writeFile(path.join(divergentRoot, "asset.bin"), divergent)

    const roomKey = randomBytes(32)
    const objects = new MemoryObjects()
    const room = new RoomHost(worker)
    const makeHost = async (name: string, root: string, db: ProjectdDatabase): Promise<CollaborationSessionHost> =>
      new CollaborationSessionHost({
        publicSessionId: TEST_PUBLIC_SESSION_ID,
        workspaceId: `ws_first_attach_${name}`,
        workspaceRoot: root,
        roomKey,
        ticket: {
          wsUrl: "ws://room.test/collab/sessions/ws",
          token: await sessionTokenFor(worker, `principal_first_attach_${name}`, { sessionRole: "developer" })(),
          role: "developer",
        },
        db,
        actor: { actorType: "user", principalId: `principal_first_attach_${name}` },
        connectorFactory: () => room.connector(),
        binaryObjectStore: objects,
        rescanIntervalMs: 0,
        submitDelayMs: 1,
        materializeDelayMs: 1,
        reconnectDelaysMs: [1],
      })

    const readFileSpy = vi.spyOn(fsp, "readFile")
    const creatorDb = new ProjectdDatabase(":memory:")
    const cloneDb = new ProjectdDatabase(":memory:")
    const divergentDb = new ProjectdDatabase(":memory:")
    const creator = await makeHost("creator", creatorRoot, creatorDb)
    const clone = await makeHost("clone", cloneRoot, cloneDb)
    const divergentPeer = await makeHost("divergent", divergentRoot, divergentDb)
    try {
      await creator.start()
      await waitFor(
        () => creator.replica.tree.listLiveEntries().some((entry) => entry.path === "asset.bin" && entry.kind === "binary"),
        "creator live binary entry",
      )
      readFileSpy.mockClear()

      await clone.start()
      await waitFor(() => (clone as unknown as { hostState: string }).hostState === "live", "clone to go live")
      expect((clone as unknown as { hostState: string }).hostState).not.toBe("failed")
      // The matching multi-megabyte binary is adopted with zero whole-file reads.
      expect(readFileSpy.mock.calls.filter(([p]) => String(p).includes(cloneRoot))).toHaveLength(0)

      await divergentPeer.start()
      await waitFor(
        () => (divergentPeer as unknown as { hostState: string }).hostState === "failed",
        "the divergent folder to be refused",
      )
      expect(divergentPeer.status().lastError).toMatchObject({ code: "WORKSPACE_CONFLICT" })
      // Refusal still holds the local bytes; the session never overwrote them.
      expect((await fs.readFile(path.join(divergentRoot, "asset.bin"))).equals(divergent)).toBe(true)
    } finally {
      vi.restoreAllMocks()
      await creator.stop()
      await clone.stop().catch(() => undefined)
      await divergentPeer.stop().catch(() => undefined)
      room.dispose()
      creatorDb.close()
      cloneDb.close()
      divergentDb.close()
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
