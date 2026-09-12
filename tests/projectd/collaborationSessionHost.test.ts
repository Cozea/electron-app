import { execFileSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { ProjectdClient, projectdSessionTopic, type ProjectdSessionStatus } from "@cozea/projectd-protocol"

import { CollaborationSessionHost } from "../../apps/projectd/src/collaboration/CollaborationSessionHost"
import { BinaryContentCache, type BinaryManifest } from "../../apps/projectd/src/collaboration/BinaryContentCache"
import type { BinaryObjectClient } from "../../apps/projectd/src/collaboration/BinaryObjectStore"
import type { RoomConnector } from "../../apps/projectd/src/collaboration/SessionRoomClient"
import type { FileEventSource, NativeFSEventItem } from "../../apps/projectd/src/filesystem/FSEventsClient"
import { GitService } from "../../apps/projectd/src/git/GitService"
import { ProjectdServer } from "../../apps/projectd/src/server/ProjectdServer"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import {
  RoomHost,
  TEST_PUBLIC_SESSION_ID,
  loadSessionRoomWorker,
  sessionTokenFor,
  waitFor,
  type SessionRole,
  type SessionRoomWorker,
} from "../helpers/sessionRoomHarness"

/**
 * projectd hosting a live session end to end: each host syncs its own temporary
 * folder, and all of them talk to the real session room code through the
 * in-memory harness. Tests report file events by hand where FSEvents would.
 */

const WS_URL = "ws://room.test/collab/sessions/ws"
let worker: SessionRoomWorker
const cleanups: Array<() => Promise<unknown>> = []

class ManualFileEvents extends EventEmitter implements FileEventSource {
  async start(): Promise<void> {
    // Tests report events themselves
  }

  stop(): void {
    // Nothing to stop
  }

  /** Tells the watcher these paths changed, after the test changed them on disk. */
  report(root: string, ...relativePaths: string[]): void {
    const items: NativeFSEventItem[] = relativePaths.map((relativePath, id) => ({
      id,
      path: path.join(root, relativePath),
      flags: 0,
      isCreated: false,
      isRemoved: false,
      isRenamed: false,
      isModified: true,
      isDir: false,
      isSymlink: false,
      dropped: false,
    }))
    this.emit("events", items)
  }
}

interface Peer {
  host: CollaborationSessionHost
  root: string
  events: ManualFileEvents
  write(relativePath: string, content: string | Buffer): Promise<void>
  remove(relativePath: string): Promise<void>
  read(relativePath: string): Promise<string | null>
  readBytes(relativePath: string): Promise<Buffer | null>
}

class MemoryBinaryObjects implements BinaryObjectClient {
  private readonly contents = new Map<string, Buffer>()
  private readonly manifests = new BinaryContentCache({ cacheDir: path.join(os.tmpdir(), "unused-binary-manifest-cache") })

  async upload(bytes: Buffer | Uint8Array): Promise<BinaryManifest> {
    const content = Buffer.from(bytes)
    const manifest = this.manifests.createManifest(content, "memory:")
    this.contents.set(manifest.contentHash, content)
    return manifest
  }

  async download(manifest: BinaryManifest): Promise<Buffer> {
    const content = this.contents.get(manifest.contentHash)
    if (!content) throw new Error(`Missing test binary ${manifest.contentHash}`)
    return Buffer.from(content)
  }
}

const roomBinaryObjects = new WeakMap<RoomHost, MemoryBinaryObjects>()

function binaryObjectsFor(room: RoomHost): MemoryBinaryObjects {
  let objects = roomBinaryObjects.get(room)
  if (!objects) {
    objects = new MemoryBinaryObjects()
    roomBinaryObjects.set(room, objects)
  }
  return objects
}

async function tempFolder(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `cozea-session-${name}-`))
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

async function writeFiles(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, content)
  }
}

function readFile(root: string, relativePath: string): Promise<string | null> {
  return fs.readFile(path.join(root, relativePath), "utf8").catch(() => null)
}

function git(root: string, ...args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Cozea Test",
      "-c",
      "user.email=test@cozea.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd: root, stdio: "ignore" },
  )
}

/** Makes the folder a repository whose HEAD holds exactly what is on disk. */
function commitEverything(root: string): void {
  git(root, "init", "-q", "-b", "main")
  git(root, "add", "-A")
  git(root, "commit", "-q", "-m", "checkout")
}

async function createPeer(
  room: RoomHost,
  name: string,
  roomKey: Buffer,
  options: {
    root?: string
    db?: ProjectdDatabase
    role?: SessionRole
    connector?: RoomConnector
    ttlSeconds?: number
    onTicketNeeded?: () => void
    gitService?: GitService
    shareEnvironmentFiles?: boolean
    binaryObjectStore?: BinaryObjectClient
  } = {},
): Promise<Peer> {
  const root = options.root ?? (await tempFolder(name))
  const events = new ManualFileEvents()
  const role = options.role ?? "developer"
  const token = await sessionTokenFor(worker, `principal_${name}`, {
    sessionRole: role,
    ttlSeconds: options.ttlSeconds,
  })()
  const host = new CollaborationSessionHost({
    publicSessionId: TEST_PUBLIC_SESSION_ID,
    workspaceId: `ws_${name}`,
    workspaceRoot: root,
    roomKey,
    ticket: { wsUrl: WS_URL, token, role },
    db: options.db ?? new ProjectdDatabase(":memory:"),
    actor: { actorType: "user", principalId: `principal_${name}` },
    gitService: options.gitService,
    shareEnvironmentFiles: options.shareEnvironmentFiles,
    binaryObjectStore: options.binaryObjectStore ?? binaryObjectsFor(room),
    connectorFactory: () => options.connector ?? room.connector(),
    fileEventSource: events,
    submitDelayMs: 5,
    materializeDelayMs: 5,
    reconnectDelaysMs: [10],
    onTicketNeeded: options.onTicketNeeded,
  })
  cleanups.push(() => host.stop())
  return {
    host,
    root,
    events,
    write: async (relativePath, content) => {
      await writeFiles(root, { [relativePath]: content })
      events.report(root, relativePath)
    },
    remove: async (relativePath) => {
      await fs.rm(path.join(root, relativePath))
      events.report(root, relativePath)
    },
    read: (relativePath) => readFile(root, relativePath),
    readBytes: (relativePath) => fs.readFile(path.join(root, relativePath)).catch(() => null),
  }
}

async function startLive(peer: Peer, label: string): Promise<void> {
  await peer.host.start()
  await waitFor(() => peer.host.state === "live", `${label} to go live`)
}

/** A creator that seeded the room from `files`, and a joiner syncing into an empty folder. */
async function startPair(room: RoomHost, roomKey: Buffer, files: Record<string, string | Buffer>) {
  const creatorRoot = await tempFolder("creator")
  await writeFiles(creatorRoot, files)
  const creator = await createPeer(room, "creator", roomKey, { root: creatorRoot })
  await startLive(creator, "the creator")
  const joiner = await createPeer(room, "joiner", roomKey)
  await startLive(joiner, "the joiner")
  return { creator, joiner }
}

beforeAll(async () => {
  worker = await loadSessionRoomWorker()
})

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe("projectd session host", () => {
  it("prepares Leave with encrypted pending recovery offline and refuses a failed journal write", async () => {
    const room = new RoomHost(worker)
    const key = randomBytes(32)
    const root = await tempFolder("leave-preparation")
    await writeFiles(root, { "notes.md": "before" })
    let offline = false
    const peer = await createPeer(room, "leaving", key, { root,
      connector: (handlers) => {
        if (offline) return Promise.reject(new Error("offline"))
        return room.connector()(handlers)
      },
    })
    await startLive(peer, "the leaving peer")
    await waitFor(() => peer.host.status().pendingBatches === 0, "the seed acknowledgement")
    offline = true
    peer.host.roomClient.disconnect()
    await fs.writeFile(path.join(root, "notes.md"), "retained offline edit")
    const prepared = await peer.host.prepareLeave()
    expect(prepared.pendingBatches).toBeGreaterThan(0)
    expect(peer.host.queue.getPendingBatches(TEST_PUBLIC_SESSION_ID)).toHaveLength(prepared.pendingBatches)
    await fs.writeFile(path.join(root, "notes.md"), "cannot journal this yet")
    const failure = vi.spyOn(peer.host.queue, "enqueue").mockImplementation(() => { throw new Error("disk full") })
    try {
      await expect(peer.host.prepareLeave()).rejects.toThrow("disk full")
      expect(peer.host.replica.hasUnexportedChanges()).toBe(true)
    } finally {
      failure.mockRestore()
    }
  })

  it("restores text, binary history and replay position while the room is unreachable", async () => {
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const db = new ProjectdDatabase(":memory:")
    const root = await tempFolder("snapshot-recovery")
    await writeFiles(root, { "private-name.txt": "private snapshot contents", "asset.bin": Buffer.from([0, 4, 2]) })
    const original = await createPeer(room, "snapshot", roomKey, { root, db })
    await startLive(original, "the snapshot owner")
    await waitFor(() => original.host.status().pendingBatches === 0, "the seed to reach the room")
    await original.host.stop()
    const cursor = original.host.transport.lastAppliedSessionSeq
    expect(cursor).toBeGreaterThan(0)
    const stored = db.db.prepare("SELECT envelope FROM local_replica_snapshots").get() as { envelope: string }
    expect(stored.envelope).not.toContain("private")
    const restored = await createPeer(room, "snapshot", roomKey, {
      root, db, connector: async () => { throw new Error("offline") },
    })
    await restored.host.start(true)
    expect(restored.host.workspaceReady).toBe(true)
    expect(restored.host.transport.lastAppliedSessionSeq).toBe(cursor)
    const entries = restored.host.replica.tree.listLiveEntries()
    const text = entries.find((entry) => entry.path === "private-name.txt")!
    const binary = entries.find((entry) => entry.path === "asset.bin")!
    expect(restored.host.replica.textDocs.getTextContent(text.fileId)).toBe("private snapshot contents")
    expect(restored.host.replica.binaryStore.getHeadRevision(binary.fileId)?.manifest).toBeDefined()
    expect(restored.host.state).not.toBe("live")
    await restored.host.stop()
    db.db.prepare("UPDATE local_replica_snapshots SET session_seq=session_seq+1").run()
    const damaged = db.db.prepare("SELECT envelope FROM local_replica_snapshots").get()
    const failed = await createPeer(room, "snapshot", roomKey, { root, db })
    await failed.host.start()
    expect(failed.host.state).toBe("failed")
    await failed.host.stop()
    expect(db.db.prepare("SELECT envelope FROM local_replica_snapshots").get()).toEqual(damaged)
  })

  it("seeds an empty room from the first folder and fills an empty folder that joins", async () => {
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const creatorRoot = await tempFolder("creator")
    await writeFiles(creatorRoot, {
      "README.md": "# Demo\n",
      "src/app.ts": "export const answer = 42\n",
      "assets/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
      ".git/HEAD": "ref: refs/heads/main\n",
    })
    const creator = await createPeer(room, "creator", roomKey, { root: creatorRoot })
    await startLive(creator, "the creator")
    await waitFor(() => creator.host.status().pendingBatches === 0, "the seed to be acknowledged")

    const joiner = await createPeer(room, "joiner", roomKey)
    await startLive(joiner, "the joiner")

    expect(await joiner.read("README.md")).toBe("# Demo\n")
    expect(await joiner.read("src/app.ts")).toBe("export const answer = 42\n")
    expect(await joiner.readBytes("assets/logo.png")).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
    expect(await joiner.read(".git/HEAD")).toBeNull()
    expect(creator.host.status()).toMatchObject({ fileCount: 3, skippedPaths: [] })
    // A slow disk can split the seed across batches, so compare with what the room stored.
    expect(joiner.host.status()).toMatchObject({ fileCount: 3, lastAppliedSessionSeq: room.storage.batchCount() })
  })

  it("retains failed binary uploads as encrypted versions before recording disk progress", async () => {
    const room = new RoomHost(worker, { binaryObjects: { head: async () => null } })
    const roomKey = randomBytes(32)
    const db = new ProjectdDatabase(":memory:")
    const peer = await createPeer(room, "failed-binary", roomKey, { db,
      binaryObjectStore: { upload: async () => { throw new Error("offline upload") }, download: async () => { throw new Error("offline") } },
    })
    await startLive(peer, "the initially empty peer")
    const first = Buffer.from([0, 12, 31])
    await peer.write("asset.bin", first)
    await waitFor(() => peer.host.pendingBinaryStore.list().length === 1, "first binary staging")
    await peer.host.flush()
    const second = Buffer.from([0, 17, 35])
    await peer.write("asset.bin", second)
    await waitFor(() => peer.host.pendingBinaryStore.list().length === 2, "second binary staging")
    await peer.host.flush()
    const versions = peer.host.pendingBinaryStore.list()
    expect(peer.host.pendingBinaryStore.readBytes(versions[0]).equals(first)).toBe(true)
    expect(peer.host.pendingBinaryStore.readBytes(versions[1]).equals(second)).toBe(true)
    expect(peer.host.replica.tree.listLiveEntries()).toHaveLength(0)
    expect(room.storage.batchCount()).toBe(0)
    await expect(peer.host.publishDurableSnapshot()).rejects.toThrow(/binary versions must finish uploading/)
    await peer.host.stop()
    expect(peer.host.pendingBinaryStore.list()).toHaveLength(2)
    const recovered = await createPeer(room, "failed-binary", roomKey, { db, root: peer.root })
    await startLive(recovered, "the restarted binary peer")
    await waitFor(() => recovered.host.pendingBinaryStore.list().length === 0, "retained binary replay")
    const revisions = recovered.host.replica.tree.listAllEntries().flatMap((entry) => recovered.host.replica.binaryStore.getRevisions(entry.fileId))
    expect(new Set(revisions.map((revision) => revision.revisionId))).toEqual(new Set(versions.map((version) => version.revisionId)))
    for (const revision of revisions) {
      expect(revision.baseRevisionId).toBeNull()
      expect((await recovered.host.binaryObjects.download(revision.manifest!)).equals(
        revision.revisionId === versions[0].revisionId ? first : second)).toBe(true)
    }
    await recovered.host.stop()
  })

  it("exports a cached version above 64 MiB without whole-file reads", async () => {
    const room = new RoomHost(worker)
    const peer = await createPeer(room, "large-export", randomBytes(32))
    await startLive(peer, "large export peer")
    const entry = peer.host.replica.createFile({ path: "large.bin", kind: "binary", actor: { actorType: "user" } })
    const chunk = Buffer.alloc(4 * 1024 * 1024, 7)
    const hash = createHash("sha256")
    for (let i = 0; i < 17; i++) hash.update(chunk)
    const contentHash = hash.digest("hex")
    const cachedPath = peer.host.binaryCache.getCachePath(contentHash)
    await fs.mkdir(path.dirname(cachedPath), { recursive: true })
    const file = await fs.open(cachedPath, "w")
    try { for (let i = 0; i < 17; i++) await file.writeFile(chunk) } finally { await file.close() }
    const base = { fileId: entry.fileId, baseRevisionId: null, actor: { actorType: "user" as const }, createdAt: 1, encryptedManifestRef: "fixture" }
    peer.host.replica.addBinaryRevision({ ...base, revisionId: "large", contentHash, size: chunk.length * 17 })
    peer.host.replica.addBinaryRevision({ ...base, revisionId: "other", contentHash: "other", size: 1 })
    await peer.host.flush()
    const review = (await peer.host.manageBinaryConflicts({ action: "list" })).conflicts[0]!
    const wholeRead = vi.spyOn(peer.host.binaryCache, "get").mockRejectedValue(new Error("whole-file read forbidden"))
    try {
      const exported = await peer.host.manageBinaryConflicts({ action: "export", fileId: entry.fileId, revisionId: "large", fingerprint: review.fingerprint, destinationDirectory: await tempFolder("large-export-output") })
      expect((await fs.stat(exported.exportedPath!)).size).toBe(chunk.length * 17)
      const output = await fs.open(exported.exportedPath!, "r")
      const actual = createHash("sha256")
      try { for (;;) { const { bytesRead } = await output.read(chunk); if (!bytesRead) break; actual.update(chunk.subarray(0, bytesRead)) } } finally { await output.close() }
      expect(actual.digest("hex")).toBe(contentHash)
      expect(wholeRead).not.toHaveBeenCalled()
      const corrupt = await fs.open(cachedPath, "r+")
      try { await corrupt.write(Buffer.from([8]), 0, 1, 0) } finally { await corrupt.close() }
      const failedDestination = await tempFolder("failed-large-export")
      await expect(peer.host.manageBinaryConflicts({ action: "export", fileId: entry.fileId, revisionId: "large", fingerprint: review.fingerprint, destinationDirectory: failedDestination })).rejects.toThrow("does not support streaming export")
      expect(await fs.readdir(failedDestination)).toEqual([])
      expect(wholeRead).not.toHaveBeenCalled()
    } finally { wholeRead.mockRestore() }
  })

  it("replays a retained binary against its captured base after another peer advances the file", async () => {
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const { creator, joiner } = await startPair(room, roomKey, { "asset.bin": Buffer.from([0, 1]) })
    const entry = creator.host.replica.tree.listLiveEntries().find((file) => file.path === "asset.bin")!
    const original = creator.host.replica.binaryStore.getHeadRevision(entry.fileId)!
    const retained = creator.host.pendingBinaryStore.stage({ path: "asset.bin", fileId: entry.fileId,
      baseRevisionId: original.revisionId, mode: entry.mode }, Buffer.from([0, 2]))
    await joiner.write("asset.bin", Buffer.from([0, 3]))
    await waitFor(() => creator.host.replica.binaryStore.getHeadRevision(entry.fileId)?.revisionId !== original.revisionId, "remote revision")
    room.sockets[0].close()
    await waitFor(() => creator.host.pendingBinaryStore.list().length === 0, "retained binary replay after reconnect")
    const revisions = creator.host.replica.binaryStore.getRevisions(entry.fileId)
    expect(revisions.find((revision) => revision.revisionId === retained.revisionId)?.baseRevisionId).toBe(original.revisionId)
    expect(creator.host.replica.binaryStore.detectConcurrentRevisions(entry.fileId)?.conflictingRevisions).toHaveLength(2)
    await waitFor(() => joiner.host.replica.binaryStore.getRevisions(entry.fileId).some((revision) => revision.revisionId === retained.revisionId), "peer to receive retained revision")
    expect(joiner.host.replica.binaryStore.detectConcurrentRevisions(entry.fileId)?.conflictingRevisions).toHaveLength(2)
    const review = (await creator.host.manageBinaryConflicts({ action: "list" })).conflicts[0]!
    expect(review.variants).toHaveLength(2)
    expect(review.path).toBe("asset.bin")
    const viewer = await createPeer(room, "viewer", roomKey, { role: "viewer" })
    await expect(viewer.host.createPullRequest("a".repeat(40), "b".repeat(40))).rejects.toMatchObject({ code: "FORBIDDEN" })
    await startLive(viewer, "conflict viewer")
    expect((await viewer.host.manageBinaryConflicts({ action: "list" })).conflicts).toHaveLength(1)
    const preview = await viewer.host.manageBinaryConflicts({ action: "preview", fileId: entry.fileId, revisionId: retained.revisionId, fingerprint: review.fingerprint })
    expect(preview.preview).toEqual({ revisionId: retained.revisionId, size: 2, hex: "00 02", truncated: false, imageDataUrl: null })
    expect(viewer.host.replica.binaryStore.getRevisions(entry.fileId)).toHaveLength(3)
    const exportDirectory = await tempFolder("binary-export")
    await fs.writeFile(path.join(exportDirectory, "asset.bin"), "existing local file")
    const exportRequest = { action: "export", fileId: entry.fileId, revisionId: retained.revisionId, fingerprint: review.fingerprint, destinationDirectory: exportDirectory }
    await expect(viewer.host.manageBinaryConflicts({ ...exportRequest, destinationDirectory: viewer.root })).rejects.toMatchObject({ code: "INVALID_EXPORT_FOLDER" })
    const exported = await viewer.host.manageBinaryConflicts(exportRequest)
    const another = await viewer.host.manageBinaryConflicts(exportRequest)
    expect(exported.exportedPath).not.toBe(another.exportedPath)
    expect(await fs.readFile(exported.exportedPath!)).toEqual(Buffer.from([0, 2]))
    expect(await fs.readFile(path.join(exportDirectory, "asset.bin"), "utf8")).toBe("existing local file")
    expect((await fs.stat(exported.exportedPath!)).mode & 0o777).toBe(0o600)
    expect(viewer.host.replica.binaryStore.getRevisions(entry.fileId)).toHaveLength(3)
    await expect(viewer.host.manageBinaryConflicts({ action: "resolve", fileId: entry.fileId, revisionId: retained.revisionId, fingerprint: review.fingerprint })).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(creator.host.manageBinaryConflicts({ action: "resolve", fileId: entry.fileId, revisionId: retained.revisionId, fingerprint: "0".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT_CHANGED" })
    const before = await creator.readBytes("asset.bin")
    const cacheRead = vi.spyOn(creator.host.binaryCache, "get").mockResolvedValueOnce(null)
    const download = vi.spyOn(creator.host.binaryObjects, "download").mockRejectedValueOnce(new Error("object unavailable"))
    try {
      await expect(creator.host.manageBinaryConflicts({ action: "resolve", fileId: entry.fileId, revisionId: retained.revisionId, fingerprint: review.fingerprint })).rejects.toThrow("object unavailable")
    } finally { cacheRead.mockRestore(); download.mockRestore() }
    expect(creator.host.replica.binaryStore.detectConcurrentRevisions(entry.fileId)).not.toBeNull()
    const enqueue = vi.spyOn(creator.host.queue, "enqueue").mockImplementationOnce(() => { throw new Error("journal unavailable") })
    try {
      await expect(creator.host.manageBinaryConflicts({ action: "resolve", fileId: entry.fileId, revisionId: retained.revisionId, fingerprint: review.fingerprint })).rejects.toThrow("journal unavailable")
    } finally { enqueue.mockRestore() }
    expect(await creator.readBytes("asset.bin")).toEqual(before)
    expect(creator.host.replica.binaryStore.detectConcurrentRevisions(entry.fileId)).not.toBeNull()
    const resolved = await creator.host.manageBinaryConflicts({ action: "resolve", fileId: entry.fileId, revisionId: retained.revisionId, fingerprint: review.fingerprint })
    expect(resolved.resolvedRevisionId).toBeTruthy()
    for (const peer of [creator, joiner]) {
      await waitFor(async () => (await peer.readBytes("asset.bin"))?.equals(Buffer.from([0, 2])) === true, "resolved binary bytes on both peers")
      expect(peer.host.replica.binaryStore.detectConcurrentRevisions(entry.fileId)).toBeNull()
      expect(peer.host.replica.binaryStore.getRevisions(entry.fileId)).toHaveLength(4)
    }
  })

  it("does not recapture staged disk bytes against a newer remote base on cold restart", async () => {
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const db = new ProjectdDatabase(":memory:")
    const root = await tempFolder("cold-binary")
    await writeFiles(root, { "asset.bin": Buffer.from([0, 1]) })
    const original = await createPeer(room, "cold-binary", roomKey, { root, db })
    await startLive(original, "original binary owner")
    await waitFor(() => original.host.status().pendingBatches === 0, "seed acknowledgement")
    const peer = await createPeer(room, "remote-binary", roomKey)
    await startLive(peer, "remote binary peer")
    const entry = original.host.replica.tree.listLiveEntries().find((file) => file.path === "asset.bin")!
    const base = original.host.replica.binaryStore.getHeadRevision(entry.fileId)!
    await original.host.stop()
    const local = Buffer.from([0, 2])
    await fs.writeFile(path.join(root, "asset.bin"), local)
    const retained = original.host.pendingBinaryStore.stage({ path: "asset.bin", fileId: entry.fileId,
      baseRevisionId: base.revisionId, mode: entry.mode }, local)
    await peer.write("asset.bin", Buffer.from([0, 3]))
    await waitFor(() => peer.host.replica.binaryStore.getHeadRevision(entry.fileId)?.revisionId !== base.revisionId, "remote update")
    await waitFor(() => peer.host.status().pendingBatches === 0, "remote update acknowledgement")
    const restored = await createPeer(room, "cold-binary", roomKey, { root, db })
    await startLive(restored, "restored binary owner")
    const revisions = restored.host.replica.binaryStore.getRevisions(entry.fileId)
    expect(revisions).toHaveLength(3)
    expect(revisions.find((revision) => revision.revisionId === retained.revisionId)?.baseRevisionId).toBe(base.revisionId)
    expect(restored.host.replica.binaryStore.detectConcurrentRevisions(entry.fileId)?.conflictingRevisions).toHaveLength(2)
    expect(restored.host.pendingBinaryStore.count()).toBe(0)
    expect((await restored.readBytes("asset.bin"))?.equals(local)).toBe(true)
  })

  it("carries binary replacements through object storage without room payload bytes", async () => {
    const room = new RoomHost(worker)
    const initial = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03])
    const next = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), randomBytes(1024 * 1024 + 37)])
    const { creator, joiner } = await startPair(room, randomBytes(32), { "assets/logo.png": initial })

    expect(await joiner.readBytes("assets/logo.png")).toEqual(initial)
    await creator.write("assets/logo.png", next)
    await waitFor(
      async () => (await joiner.readBytes("assets/logo.png"))?.equals(next) === true,
      "the binary replacement to reach the joiner",
    )

    const revision = creator.host.replica.binaryStore.getHeadRevision(
      creator.host.replica.tree.listLiveEntries().find((entry) => entry.path === "assets/logo.png")!.fileId,
    )
    expect(revision?.manifest?.size).toBe(next.length)
    expect(revision?.manifest?.chunks.length).toBe(1)
    const latestRoomBatch = [...room.storage.data.entries()]
      .filter(([key]) => key.startsWith("batch:"))
      .map(([, value]) => value as { encryptedPayload?: string })
      .at(-1)
    expect(latestRoomBatch?.encryptedPayload?.length ?? 0).toBeLessThan(100_000)
  })

  it("carries saves both ways and merges concurrent edits to one file", async () => {
    const room = new RoomHost(worker)
    const { creator, joiner } = await startPair(room, randomBytes(32), { "notes.md": "line one\nline two\n" })

    await creator.write("notes.md", "line one\nline two\nfrom creator\n")
    await waitFor(
      async () => (await joiner.read("notes.md")) === "line one\nline two\nfrom creator\n",
      "the creator's save to reach the joiner",
    )

    await joiner.write("notes.md", "LINE ONE\nline two\nfrom creator\n")
    await creator.write("notes.md", "line one\nline two\nfrom creator\nagain from creator\n")
    const merged = "LINE ONE\nline two\nfrom creator\nagain from creator\n"
    await waitFor(
      async () => (await creator.read("notes.md")) === merged && (await joiner.read("notes.md")) === merged,
      "both folders to hold the merge",
    )
  })

  it("carries new files and deletes both ways", async () => {
    const room = new RoomHost(worker)
    const { creator, joiner } = await startPair(room, randomBytes(32), { "README.md": "# Demo\n" })

    await joiner.write("docs/guide.md", "fresh\n")
    await waitFor(async () => (await creator.read("docs/guide.md")) === "fresh\n", "the new file to reach the creator")

    await creator.remove("README.md")
    await waitFor(async () => (await joiner.read("README.md")) === null, "the delete to reach the joiner")
    expect(joiner.host.status().fileCount).toBe(1)
  })

  it("resolves a path collision without overwriting the surviving file", async () => {
    const room = new RoomHost(worker)
    const { creator, joiner } = await startPair(room, randomBytes(32), { "shared.txt": "first" })
    const second = joiner.host.replica.createFile({ path: "shared.txt", kind: "text", content: "second", actor: { actorType: "user", principalId: "principal_joiner" } })
    await joiner.host.flush()
    await waitFor(() => creator.host.replica.detectConflicts().pathCollisions.length === 1, "shared path collision")
    const review = (await creator.host.manageStructuralConflicts({ action: "list" })).conflicts.find((item) => item.fileId === second.fileId)!
    expect(review.kinds).toContain("path_collision")
    expect(review.textPreview).toBe("second")
    await fs.writeFile(path.join(creator.root, "occupied.txt"), "local work")
    await expect(creator.host.manageStructuralConflicts({ action: "resolve", fileId: second.fileId, fingerprint: review.fingerprint, choice: "rename", path: "occupied.txt" })).rejects.toMatchObject({ code: "PATH_OCCUPIED" })
    await expect(creator.host.manageStructuralConflicts({ action: "resolve", fileId: second.fileId, fingerprint: "stale", choice: "rename", path: "second.txt" })).rejects.toMatchObject({ code: "CONFLICT_CHANGED" })
    const enqueue = vi.spyOn(creator.host.queue, "enqueue").mockImplementationOnce(() => { throw new Error("journal failed") })
    try {
      await expect(creator.host.manageStructuralConflicts({ action: "resolve", fileId: second.fileId, fingerprint: review.fingerprint, choice: "rename", path: "second.txt" })).rejects.toThrow("journal failed")
    } finally { enqueue.mockRestore() }
    expect(creator.host.replica.tree.getEntry(second.fileId)?.path).toBe("shared.txt")
    await creator.host.manageStructuralConflicts({ action: "resolve", fileId: second.fileId, fingerprint: review.fingerprint, choice: "rename", path: "second.txt" })
    for (const peer of [creator, joiner]) {
      await waitFor(async () => await peer.read("second.txt") === "second", "resolved destination bytes")
      expect(await peer.read("shared.txt")).toBe("first")
      expect(peer.host.replica.detectConflicts().pathCollisions).toHaveLength(0)
    }
    expect(await creator.read("occupied.txt")).toBe("local work")
  })

  it("restores reviewed delete-versus-edit content to an empty path", async () => {
    const room = new RoomHost(worker)
    const { creator, joiner } = await startPair(room, randomBytes(32), { "notes.txt": "base" })
    const entry = creator.host.replica.tree.listLiveEntries().find((item) => item.path === "notes.txt")!
    creator.host.replica.deleteFile(entry.fileId, { actorType: "user" })
    joiner.host.replica.updateTextContent(entry.fileId, "concurrent edit")
    await creator.host.flush()
    await joiner.host.flush()
    await waitFor(() => creator.host.replica.detectConflicts().deleteModifyConflicts.length === 1, "delete versus edit")
    const review = (await creator.host.manageStructuralConflicts({ action: "list" })).conflicts[0]!
    expect(review.kinds).toContain("delete_modify")
    await creator.host.manageStructuralConflicts({ action: "resolve", fileId: entry.fileId, fingerprint: review.fingerprint, choice: "restore", path: "restored.txt" })
    for (const peer of [creator, joiner]) {
      await waitFor(async () => await peer.read("restored.txt") === "concurrent edit", "restored edited contents")
      expect(peer.host.replica.tree.getEntry(entry.fileId)).toMatchObject({ path: "restored.txt", deleted: false })
      expect(peer.host.replica.detectConflicts().deleteModifyConflicts).toHaveLength(0)
    }
  })

  it("carries a rename as a rename, and keeps the file's identity", async () => {
    const room = new RoomHost(worker)
    const { creator, joiner } = await startPair(room, randomBytes(32), { "docs/draft.md": "# Draft\n" })
    const idOf = (peer: Peer, filePath: string) =>
      peer.host.replica.tree.listLiveEntries().find((entry) => entry.path === filePath)?.fileId ?? null
    await waitFor(() => creator.host.status().pendingBatches === 0, "the seed to be acknowledged")
    const fileId = idOf(creator, "docs/draft.md")
    expect(fileId).not.toBeNull()
    const batches = room.storage.batchCount()

    await fs.rename(path.join(creator.root, "docs/draft.md"), path.join(creator.root, "docs/final.md"))
    creator.events.report(creator.root, "docs/draft.md", "docs/final.md")
    await waitFor(
      async () => (await joiner.read("docs/final.md")) === "# Draft\n" && (await joiner.read("docs/draft.md")) === null,
      "the rename to reach the joiner",
    )
    expect(idOf(joiner, "docs/final.md")).toBe(fileId)
    expect(idOf(creator, "docs/final.md")).toBe(fileId)
    expect(room.storage.batchCount()).toBe(batches + 1)
  })

  it("preserves a dangling symlink identity across a local rename beside identical text", async () => {
    const room = new RoomHost(worker)
    const key = randomBytes(32)
    const root = await tempFolder("symlink-rename")
    await writeFiles(root, { "same.txt": "missing-target" })
    await fs.symlink("missing-target", path.join(root, "old-link"))
    const creator = await createPeer(room, "creator", key, { root })
    await startLive(creator, "symlink creator")
    const joiner = await createPeer(room, "joiner", key)
    await startLive(joiner, "symlink joiner")
    const id = creator.host.replica.tree.listLiveEntries().find((entry) => entry.path === "old-link")!.fileId
    await fs.unlink(path.join(root, "same.txt"))
    await fs.rename(path.join(root, "old-link"), path.join(root, "new-link"))
    creator.events.report(root, "same.txt", "old-link", "new-link")
    await waitFor(async () => await fs.readlink(path.join(joiner.root, "new-link")).catch(() => null) === "missing-target", "renamed dangling link")
    expect(joiner.host.replica.tree.listLiveEntries().find((entry) => entry.path === "new-link")?.fileId).toBe(id)
    await waitFor(async () => await fs.lstat(path.join(joiner.root, "old-link")).catch(() => null) === null, "old link removed")
    await waitFor(() => !joiner.host.replica.tree.listLiveEntries().some((entry) => entry.path === "same.txt"), "same-byte regular file deleted separately")
  })

  it("finds a folder moved while the daemon was down, and moves each file", async () => {
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const creatorRoot = await tempFolder("creator")
    await writeFiles(creatorRoot, { "old/a.md": "alpha\n", "old/b.md": "beta\n" })
    const creatorDb = new ProjectdDatabase(":memory:")
    const creator = await createPeer(room, "creator", roomKey, { root: creatorRoot, db: creatorDb })
    await startLive(creator, "the creator")
    await waitFor(() => creator.host.status().pendingBatches === 0, "the seed to be acknowledged")
    const joiner = await createPeer(room, "joiner", roomKey)
    await startLive(joiner, "the joiner")
    const ids = new Map(joiner.host.replica.tree.listLiveEntries().map((entry) => [entry.path, entry.fileId]))
    await creator.host.stop()

    await fs.rename(path.join(creatorRoot, "old"), path.join(creatorRoot, "new"))
    const restarted = await createPeer(room, "creator", roomKey, { root: creatorRoot, db: creatorDb })
    await startLive(restarted, "the restarted creator")
    await waitFor(
      async () =>
        (await joiner.read("new/a.md")) === "alpha\n" &&
        (await joiner.read("new/b.md")) === "beta\n" &&
        (await joiner.read("old/a.md")) === null,
      "the moved folder to reach the joiner",
    )
    const moved = new Map(joiner.host.replica.tree.listLiveEntries().map((entry) => [entry.path, entry.fileId]))
    expect(moved.get("new/a.md")).toBe(ids.get("old/a.md"))
    expect(moved.get("new/b.md")).toBe(ids.get("old/b.md"))
  })

  it("drains an in-flight binary and queued text into the durable outbox before stopping", async () => {
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const objects = new MemoryBinaryObjects()
    let releaseUpload!: () => void
    let uploadStarted = false
    const uploadGate = new Promise<void>((resolve) => { releaseUpload = resolve })
    const root = await tempFolder("draining")
    await writeFiles(root, { "notes.md": "before\n" })
    let dropAcks = false
    const peer = await createPeer(room, "draining", roomKey, {
      root,
      connector: (handlers) => room.connector({
        dropServerMessage: (message) => dropAcks && message.type === "batch_ack",
      })(handlers),
      binaryObjectStore: {
        upload: async (bytes) => {
          uploadStarted = true
          await uploadGate
          return objects.upload(bytes)
        },
        download: (manifest) => objects.download(manifest),
      },
    })
    await startLive(peer, "the draining peer")
    await waitFor(() => peer.host.status().pendingBatches === 0, "the seed acknowledgement")
    dropAcks = true
    await fs.writeFile(path.join(root, "asset.bin"), Buffer.from([0, 1, 2, 3]))
    await peer.host.rescan()
    await waitFor(() => uploadStarted, "the binary upload to start")
    try {
      await fs.writeFile(path.join(root, "notes.md"), "queued edit\n")
      await peer.host.rescan()
      const stopping = peer.host.stop()
      expect(peer.host.stop()).toBe(stopping)
      releaseUpload()
      await stopping
      const note = peer.host.replica.tree.listLiveEntries().find((entry) => entry.path === "notes.md")!
      expect(peer.host.replica.textDocs.getTextContent(note.fileId)).toBe("queued edit\n")
      expect(peer.host.replica.tree.listLiveEntries().some((entry) => entry.path === "asset.bin")).toBe(true)
      expect(peer.host.queue.getPendingBatches(TEST_PUBLIC_SESSION_ID).length).toBeGreaterThan(0)
      expect(peer.host.state).toBe("stopped")
    } finally {
      releaseUpload()
    }
  })

  it("merges edits made while the daemon was down and resends what the room never acknowledged", async () => {
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const creatorRoot = await tempFolder("creator")
    await writeFiles(creatorRoot, { "plan.md": "alpha\nbeta\n" })
    const creatorDb = new ProjectdDatabase(":memory:")
    let dropAcks = false
    const creatorConnector: RoomConnector = (handlers) =>
      room.connector({ dropServerMessage: (message) => dropAcks && message.type === "batch_ack" })(handlers)

    const creator = await createPeer(room, "creator", roomKey, { root: creatorRoot, db: creatorDb, connector: creatorConnector })
    await startLive(creator, "the creator")
    const joiner = await createPeer(room, "joiner", roomKey)
    await startLive(joiner, "the joiner")

    // The room stores this save, but its acknowledgement never arrives.
    dropAcks = true
    await creator.write("plan.md", "alpha\nbeta\ngamma\n")
    await waitFor(() => room.storage.batchCount() === 2, "the room to store the creator's save")
    expect(creator.host.status().pendingBatches).toBe(1)
    await creator.host.stop()

    // While the creator's daemon is down, a peer edits the file and so does the creator, offline.
    await waitFor(async () => (await joiner.read("plan.md")) === "alpha\nbeta\ngamma\n", "the joiner to get the save")
    await joiner.write("plan.md", "ALPHA\nbeta\ngamma\n")
    await waitFor(() => room.storage.batchCount() === 3, "the joiner's edit to reach the room")
    await writeFiles(creatorRoot, { "plan.md": "alpha\nbeta\ngamma\ndelta\n" })

    dropAcks = false
    const restarted = await createPeer(room, "creator", roomKey, { root: creatorRoot, db: creatorDb, connector: creatorConnector })
    await startLive(restarted, "the restarted creator")

    const merged = "ALPHA\nbeta\ngamma\ndelta\n"
    await waitFor(
      async () => (await restarted.read("plan.md")) === merged && (await joiner.read("plan.md")) === merged,
      "both folders to hold the offline edit merged with the peer's",
    )
    await waitFor(() => restarted.host.status().pendingBatches === 0, "the resent save to be acknowledged")
    expect(room.storage.batchCount()).toBe(4)
  })

  it("refuses a folder with different versions of session files and adopts one that matches", async () => {
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const creatorRoot = await tempFolder("creator")
    await writeFiles(creatorRoot, { "README.md": "# Demo\n" })
    const creator = await createPeer(room, "creator", roomKey, { root: creatorRoot })
    await startLive(creator, "the creator")

    const draftRoot = await tempFolder("draft")
    await writeFiles(draftRoot, { "README.md": "# Local draft\n" })
    const draft = await createPeer(room, "draft", roomKey, { root: draftRoot })
    await draft.host.start()
    await waitFor(() => draft.host.state === "failed", "the folder to be refused")
    expect(draft.host.status().lastError).toMatchObject({ code: "WORKSPACE_CONFLICT" })
    expect(await draft.read("README.md")).toBe("# Local draft\n")

    const cloneRoot = await tempFolder("clone")
    await writeFiles(cloneRoot, { "README.md": "# Demo\n" })
    const clone = await createPeer(room, "clone", roomKey, { root: cloneRoot })
    await startLive(clone, "the matching folder")
    expect(room.storage.batchCount()).toBe(1)
  })

  it("replaces files a clean Git checkout holds and refuses changes Git does not have", async () => {
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const creatorRoot = await tempFolder("creator")
    await writeFiles(creatorRoot, { "README.md": "# Demo v2\n", "src/app.ts": "export const answer = 42\n" })
    const creator = await createPeer(room, "creator", roomKey, { root: creatorRoot })
    await startLive(creator, "the creator")
    await waitFor(() => creator.host.status().pendingBatches === 0, "the seed to be acknowledged")
    const seededBatches = room.storage.batchCount()

    // A checkout of the branch as last committed; the session has moved on since.
    const cloneRoot = await tempFolder("clone")
    await writeFiles(cloneRoot, { "README.md": "# Demo v1\n", "src/app.ts": "export const answer = 42\n" })
    commitEverything(cloneRoot)
    const clone = await createPeer(room, "clone", roomKey, { root: cloneRoot, gitService: new GitService() })
    await startLive(clone, "the clean checkout")
    expect(await clone.read("README.md")).toBe("# Demo v2\n")
    expect(room.storage.batchCount()).toBe(seededBatches)

    // The same checkout with an uncommitted edit holds work only this folder has.
    const editedRoot = await tempFolder("edited")
    await writeFiles(editedRoot, { "README.md": "# Demo v1\n" })
    commitEverything(editedRoot)
    await writeFiles(editedRoot, { "README.md": "# Demo v1, edited here\n" })
    const edited = await createPeer(room, "edited", roomKey, { root: editedRoot, gitService: new GitService() })
    await edited.host.start()
    await waitFor(() => edited.host.state === "failed", "the edited checkout to be refused")
    expect(edited.host.status().lastError).toMatchObject({
      code: "WORKSPACE_CONFLICT",
      message: expect.stringContaining("Commit or stash"),
    })
    expect(await edited.read("README.md")).toBe("# Demo v1, edited here\n")
  })

  it("joins a folder it has not synced before afresh, so files the folder lacks arrive rather than leave", async () => {
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const creatorRoot = await tempFolder("creator")
    await writeFiles(creatorRoot, { "README.md": "# Demo\n", ".env": "GREETING=hello\n" })
    const creator = await createPeer(room, "creator", roomKey, { root: creatorRoot, shareEnvironmentFiles: true })
    await startLive(creator, "the creator")
    await waitFor(() => creator.host.status().pendingBatches === 0, "the seed to be acknowledged")

    const memberDb = new ProjectdDatabase(":memory:")
    const first = await createPeer(room, "member", roomKey, { db: memberDb, shareEnvironmentFiles: true })
    await startLive(first, "the member's first folder")
    expect(await first.read(".env")).toBe("GREETING=hello\n")
    await first.host.stop()
    const batches = room.storage.batchCount()

    // The member links a fresh clone instead: it has what Git has, and no .env.
    const cloneRoot = await tempFolder("clone")
    await writeFiles(cloneRoot, { "README.md": "# Demo\n" })
    const clone = await createPeer(room, "member", roomKey, { root: cloneRoot, db: memberDb, shareEnvironmentFiles: true })
    await startLive(clone, "the member's new folder")
    await waitFor(() => clone.host.status().pendingBatches === 0, "the new folder to settle")

    expect(await clone.read(".env")).toBe("GREETING=hello\n")
    expect(await creator.read(".env")).toBe("GREETING=hello\n")
    expect(room.storage.batchCount()).toBe(batches)
  })

  it("still sends what was deleted in the same folder while the daemon was down", async () => {
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const creatorRoot = await tempFolder("creator")
    await writeFiles(creatorRoot, { "README.md": "# Demo\n", "draft.md": "scratch\n" })
    const creatorDb = new ProjectdDatabase(":memory:")
    const creator = await createPeer(room, "creator", roomKey, { root: creatorRoot, db: creatorDb })
    await startLive(creator, "the creator")
    await waitFor(() => creator.host.status().pendingBatches === 0, "the seed to be acknowledged")
    const joiner = await createPeer(room, "joiner", roomKey)
    await startLive(joiner, "the joiner")
    expect(await joiner.read("draft.md")).toBe("scratch\n")
    await creator.host.stop()

    await fs.rm(path.join(creatorRoot, "draft.md"))
    const restarted = await createPeer(room, "creator", roomKey, { root: creatorRoot, db: creatorDb })
    await startLive(restarted, "the restarted creator")
    await waitFor(async () => (await joiner.read("draft.md")) === null, "the offline delete to reach the joiner")
    expect(await joiner.read("README.md")).toBe("# Demo\n")
  })

  it("asks for a new ticket when the token has expired", async () => {
    const room = new RoomHost(worker)
    let ticketRequests = 0
    const peer = await createPeer(room, "creator", randomBytes(32), {
      ttlSeconds: 10,
      onTicketNeeded: () => {
        ticketRequests += 1
      },
    })

    void peer.host.start()
    await waitFor(() => peer.host.state === "waiting_for_ticket", "the host to ask for a ticket")
    expect(ticketRequests).toBe(1)

    const token = await sessionTokenFor(worker, "principal_creator")()
    peer.host.updateTicket({ wsUrl: WS_URL, token, role: "developer" })
    await waitFor(() => peer.host.state === "live", "the host to connect with the new ticket")
  })

  it("keeps a viewer's folder read-only", async () => {
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const creatorRoot = await tempFolder("creator")
    await writeFiles(creatorRoot, { "README.md": "# Demo\n" })
    const creator = await createPeer(room, "creator", roomKey, { root: creatorRoot })
    await startLive(creator, "the creator")
    const viewer = await createPeer(room, "viewer", roomKey, { role: "viewer" })
    await startLive(viewer, "the viewer")
    expect(await viewer.read("README.md")).toBe("# Demo\n")

    await viewer.write("README.md", "# Edited by a viewer\n")
    await creator.write("README.md", "# Demo\nupdated\n")
    await waitFor(async () => (await viewer.read("README.md")) === "# Demo\nupdated\n", "the viewer to get the update")

    expect(await creator.read("README.md")).toBe("# Demo\nupdated\n")
    expect(room.storage.batchCount()).toBe(2)
  })
})

describe("projectd sessions over the local socket", () => {
  it("attaches a folder, reports status events, and detaches", async () => {
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const root = await tempFolder("socket")
    await writeFiles(root, { "README.md": "# Via socket\n" })
    const socketPath = path.join(os.tmpdir(), `cozea-pd-${randomBytes(4).toString("hex")}.sock`)
    const server = new ProjectdServer({
      socketPath,
      database: new ProjectdDatabase(":memory:"),
      sessionConnectorFactory: () => room.connector(),
      fileEventSourceFactory: () => new ManualFileEvents(),
    })
    await server.start()
    cleanups.push(() => server.stop())
    const client = new ProjectdClient({ socketPath, clientName: "session-test" })
    cleanups.push(async () => client.disconnect())

    const statuses: ProjectdSessionStatus[] = []
    await client.subscribe(projectdSessionTopic(TEST_PUBLIC_SESSION_ID), (event) => {
      if (event.event === "status") statuses.push(event.payload as ProjectdSessionStatus)
    })

    const attach = {
      publicSessionId: TEST_PUBLIC_SESSION_ID,
      workspaceId: "ws_socket",
      projectId: "proj_socket",
      rootPath: root,
      roomKeyBase64: roomKey.toString("base64"),
      ticket: { wsUrl: WS_URL, token: await sessionTokenFor(worker, "principal_socket")(), role: "developer" as const },
      actor: { principalId: "principal_socket" },
    }
    const attached = await client.attachSession(attach)
    expect(attached).toMatchObject({ publicSessionId: TEST_PUBLIC_SESSION_ID, rootPath: root })
    await waitFor(() => statuses.some((status) => status.state === "live"), "a live status event")
    expect(await client.listSessions()).toEqual([expect.objectContaining({ state: "live", fileCount: 1 })])
    expect(await client.manageBinaryConflicts(TEST_PUBLIC_SESSION_ID, { action: "list" })).toEqual({ conflicts: [], nextFileId: null })
    expect(await client.manageStructuralConflicts(TEST_PUBLIC_SESSION_ID, { action: "list" })).toEqual({ conflicts: [], nextFileId: null })
    await expect(client.createSessionPullRequest(TEST_PUBLIC_SESSION_ID, "invalid", "b".repeat(40))).rejects.toThrow("checkpointOid")
    await expect(client.createSessionPullRequest(TEST_PUBLIC_SESSION_ID, "a".repeat(40), "invalid")).rejects.toThrow("targetOid")

    const otherRoot = await tempFolder("other")
    await expect(client.attachSession({ ...attach, rootPath: otherRoot })).rejects.toThrow(/already syncs/)
    await expect(
      client.attachSession({ ...attach, publicSessionId: "czs_fedcba9876543210", roomKeyBase64: "c2hvcnQ=" }),
    ).rejects.toThrow(/32-byte room key/)

    await fs.writeFile(path.join(root, "README.md"), "saved immediately before leaving\n")
    expect(await client.prepareSessionLeave(TEST_PUBLIC_SESSION_ID)).toEqual({ pendingBatches: 0, pendingBinaryVersions: 0 })
    const reader = await createPeer(room, "after-leave", roomKey)
    await startLive(reader, "the reader after leave preparation")
    expect(await reader.read("README.md")).toBe("saved immediately before leaving\n")
    expect(await client.detachSession(TEST_PUBLIC_SESSION_ID)).toEqual({ detached: true })
    expect(await client.listSessions()).toEqual([])
    expect(await client.prepareSessionLeave(TEST_PUBLIC_SESSION_ID)).toEqual({ pendingBatches: 0, pendingBinaryVersions: 0 })
  })
})
