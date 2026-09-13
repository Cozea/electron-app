import { FilesystemMaterializer } from "../../apps/projectd/src/filesystem/Materializer"
import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { CloudReplicaStore } from "../../apps/projectd/src/collaboration/CloudReplicaStore"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"

import { IsolatedRebaseResolution } from "../../apps/projectd/src/autogit/IsolatedRebaseResolution"
import { RebaseJournal } from "../../apps/projectd/src/autogit/RebaseJournal"
import type { AutoGitTiming } from "../../apps/projectd/src/autogit/AutoGitAgent"
import { sessionBinaryObjects } from "../helpers/sessionBinaryObjects"
import { CollaborationSessionHost } from "../../apps/projectd/src/collaboration/CollaborationSessionHost"
import type { FileEventSource, NativeFSEventItem } from "../../apps/projectd/src/filesystem/FSEventsClient"
import { GitService } from "../../apps/projectd/src/git/GitService"
import { GitProcess } from "../../apps/projectd/src/git/GitProcess"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import {
  RoomHost,
  TEST_PUBLIC_SESSION_ID,
  loadSessionRoomWorker,
  sessionTokenFor,
  waitFor,
  type SessionRoomWorker,
} from "../helpers/sessionRoomHarness"

/**
 * AutoGit end to end (P16 - P18, and the P19 branch guard): projectd hosts sync
 * real Git checkouts that share a bare remote, through the real session room code
 * in memory. Tests report file events by hand where FSEvents would.
 */

const WS_URL = "ws://room.test/collab/sessions/ws"
const BRANCH = "feat/live"
const GIT_WAIT_MS = 10_000
const FAST: Partial<AutoGitTiming> = {
  renewIntervalMs: 50,
  quietMs: 30,
  maxDirtyMs: 300,
  minIntervalMs: 0,
  retryMs: 50,
  eligibilityRecheckMs: 200,
}
// Saves only when a member asks.
const ON_REQUEST: Partial<AutoGitTiming> = { ...FAST, quietMs: 600_000, maxDirtyMs: 600_000 }

let worker: SessionRoomWorker
const cleanups: Array<() => unknown> = []
const databasesByRoom = new WeakMap<RoomHost, Map<string, string>>()
const binaryObjectsByRoom = new WeakMap<RoomHost, Map<string, Uint8Array>>()

class ManualFileEvents extends EventEmitter implements FileEventSource {
  async start(): Promise<void> {
    // Tests report events themselves
  }

  stop(): void {
    // Nothing to stop
  }

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
  write(relativePath: string, content: string | Buffer): Promise<void>
  remove(relativePath: string): Promise<void>
  symlink(relativePath: string, target: string): Promise<void>
  read(relativePath: string): Promise<string | null>
  /** Reports an externally-made filesystem change, as the OS watcher would. */
  reportExternalChange(relativePath: string): void
}

async function tempFolder(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `cozea-autogit-${name}-`))
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

/** Runs Git as a person at the terminal would, without their hooks or signing; returns trimmed output. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync(
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
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim()
}

/** A bare remote whose session branch holds `files`, the checkout that pushed it, and a clone of it. */
async function setUpRepositories(files: Record<string, string | Buffer>) {
  const remote = await tempFolder("remote")
  git(remote, "init", "-q", "--bare", "-b", BRANCH)
  const creatorRoot = await tempFolder("creator")
  git(creatorRoot, "init", "-q", "-b", BRANCH)
  await writeFiles(creatorRoot, files)
  git(creatorRoot, "add", "-A")
  git(creatorRoot, "commit", "-q", "-m", "Start the session branch")
  git(creatorRoot, "remote", "add", "origin", remote)
  git(creatorRoot, "push", "-q", "-u", "origin", BRANCH)
  const joinerRoot = await tempFolder("joiner")
  git(joinerRoot, "clone", "-q", "-b", BRANCH, remote, ".")
  return { remote, creatorRoot, joinerRoot, initial: git(creatorRoot, "rev-parse", "HEAD") }
}

function remoteHead(remote: string): string {
  return git(remote, "rev-parse", `refs/heads/${BRANCH}`)
}

/** A commit pushed to the session branch by someone outside the session; returns the new head. */
async function pushFromOutside(
  remote: string,
  files: Record<string, string>,
  options: { resetTo?: string } = {},
): Promise<string> {
  const outsideRoot = await tempFolder("outside")
  git(outsideRoot, "clone", "-q", "-b", BRANCH, remote, ".")
  if (options.resetTo) git(outsideRoot, "reset", "-q", "--hard", options.resetTo)
  await writeFiles(outsideRoot, files)
  git(outsideRoot, "add", "-A")
  git(outsideRoot, "commit", "-q", "-m", "Outside the session")
  git(outsideRoot, "push", "-q", ...(options.resetTo ? ["--force"] : []), "origin", BRANCH)
  return remoteHead(remote)
}

/** Creates a target branch from the session's current base and advances it independently. */
async function createTargetBranch(
  remote: string,
  sourceRoot: string,
  files: Record<string, string | Buffer>,
  branch = "main",
): Promise<{ root: string; head: string }> {
  git(sourceRoot, "push", "-q", "origin", `${BRANCH}:refs/heads/${branch}`)
  const root = await tempFolder(`target-${branch}`)
  git(root, "clone", "-q", "-b", branch, remote, ".")
  await writeFiles(root, files)
  git(root, "add", "-A")
  git(root, "commit", "-q", "-m", `Advance ${branch}`)
  git(root, "push", "-q", "origin", branch)
  return { root, head: git(root, "rev-parse", "HEAD") }
}

function newRoom(options: { leaseMs?: number } = {}): RoomHost {
  const room = new RoomHost(worker, options)
  cleanups.push(() => room.dispose())
  return room
}

async function createPeer(
  room: RoomHost,
  name: string,
  roomKey: Buffer,
  options: {
    root: string
    clientId: string
    timing?: Partial<AutoGitTiming>
    shareEnvironmentFiles?: boolean
    targetBranch?: string
    onSyncRequest?: (sequence: number) => void
    sessionRole?: "developer" | "project_manager"
    withoutGit?: boolean
  },
): Promise<Peer> {
  const events = new ManualFileEvents()
  let objects = binaryObjectsByRoom.get(room)
  if (!objects) {
    objects = new Map()
    binaryObjectsByRoom.set(room, objects)
  }
  let databases = databasesByRoom.get(room)
  if (!databases) { databases = new Map(); databasesByRoom.set(room, databases) }
  const databaseKey = `${name}:${options.root}`
  let databasePath = databases.get(databaseKey)
  if (!databasePath) {
    databasePath = path.join(await tempFolder("database"), "projectd.sqlite")
    databases.set(databaseKey, databasePath)
  }
  const db = new ProjectdDatabase(databasePath)
  cleanups.push(() => { if (db.db.isOpen) db.close() })
  const token = await sessionTokenFor(worker, `principal_${name}`, { sessionRole: options.sessionRole })()
  const host = new CollaborationSessionHost({
    publicSessionId: TEST_PUBLIC_SESSION_ID,
    workspaceId: `ws_${name}`,
    workspaceRoot: options.root,
    roomKey,
    binaryObjectStore: sessionBinaryObjects(TEST_PUBLIC_SESSION_ID, roomKey, objects),
    ticket: { wsUrl: WS_URL, token, role: options.sessionRole ?? "developer" },
    db,
    actor: { actorType: "user", principalId: `principal_${name}` },
    gitService: options.withoutGit ? undefined : new GitService(),
    branchName: BRANCH,
    shareEnvironmentFiles: options.shareEnvironmentFiles,
    targetBranch: options.targetBranch,
    clientId: options.clientId,
    autoGitTiming: options.timing ?? FAST,
    gitPollMs: 20,
    connectorFactory: () => room.connector({ onClientMessage: (message) => {
      if (message.type === "sync_request") options.onSyncRequest?.(Number(message.knownSeq))
    } }),
    fileEventSource: events,
    submitDelayMs: 5,
    materializeDelayMs: 5,
    reconnectDelaysMs: [10],
  })
  cleanups.push(() => host.stop())
  return {
    host,
    root: options.root,
    write: async (relativePath, content) => {
      await writeFiles(options.root, { [relativePath]: content })
      events.report(options.root, relativePath)
    },
    remove: async (relativePath) => {
      await fs.rm(path.join(options.root, relativePath))
      events.report(options.root, relativePath)
    },
    symlink: async (relativePath, target) => {
      await fs.rm(path.join(options.root, relativePath), { force: true })
      await fs.symlink(target, path.join(options.root, relativePath))
      events.report(options.root, relativePath)
    },
    read: (relativePath) => fs.readFile(path.join(options.root, relativePath), "utf8").catch(() => null),
    reportExternalChange: (relativePath) => {
      events.report(options.root, relativePath)
    },
  }
}

async function startLive(peer: Peer, label: string): Promise<void> {
  await peer.host.start()
  await waitFor(() => peer.host.state === "live", `${label} to go live`, GIT_WAIT_MS)
}

function autoGitOf(peer: Peer) {
  return peer.host.status().autoGit ?? null
}

function checkpointOf(peer: Peer): string | null {
  return autoGitOf(peer)?.lastCheckpoint?.commitOid ?? null
}

/** The creator leads; the joiner, a clone of the same branch, follows. */
async function startPair(
  room: RoomHost,
  repos: { creatorRoot: string; joinerRoot: string },
  timing = FAST,
  targetBranch?: string,
) {
  const roomKey = randomBytes(32)
  const creator = await createPeer(room, "creator", roomKey, {
    root: repos.creatorRoot,
    clientId: "c_a",
    sessionRole: "project_manager",
    timing,
    targetBranch,
  })
  await startLive(creator, "the creator")
  await waitFor(() => autoGitOf(creator)?.state === "leader", "the creator to lead", GIT_WAIT_MS)
  const joiner = await createPeer(room, "joiner", roomKey, {
    root: repos.joinerRoot,
    clientId: "c_b",
    timing,
    targetBranch,
  })
  await startLive(joiner, "the joiner")
  await waitFor(() => autoGitOf(joiner)?.state === "follower", "the joiner to follow", GIT_WAIT_MS)
  return { creator, joiner, roomKey }
}

beforeAll(async () => {
  worker = await loadSessionRoomWorker()
})

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe("AutoGit in projectd", () => {
  it("publishes an authenticated durable replica at the Git barrier and restores it after room eviction", async () => {
    const objects = new Map<string, Uint8Array>()
    const room = new RoomHost(worker, { binaryObjects: {
      head: async (key) => {
        const bytes = objects.get(`http://room.test/collab/sessions/binary/${key}`)
        return bytes ? { size: bytes.byteLength } : null
      },
    } })
    cleanups.push(() => room.dispose())
    binaryObjectsByRoom.set(room, objects)
    const repos = await setUpRepositories({ "notes.md": "private snapshot text\n" })
    const { creator, joiner, roomKey } = await startPair(room, repos, ON_REQUEST)
    const originalWire = [...room.storage.data.entries()].find(([key]) => key.startsWith("batch:"))![1] as { encryptedPayload: string }
    const originalBatch = creator.host.transport.decryptBatch(originalWire.encryptedPayload)
    // More than one compaction page, with accepted no-op batches between saves.
    for (let index = 0; index < 140; index++) {
      creator.host.roomClient.submitBatch({ batchId: `compact_${index}`, sessionId: TEST_PUBLIC_SESSION_ID,
        clientId: "c_a", createdAt: Date.now(), operations: [] })
    }
    await waitFor(() => creator.host.roomClient.pendingBatchCount === 0, "the room to acknowledge compaction history")
    await creator.host.checkpointNow()
    const snapshot = await joiner.host.roomClient.getSnapshot()
    expect(snapshot).not.toBeNull()
    expect(snapshot!.sessionSeq).toBe(creator.host.transport.lastAppliedSessionSeq)
    expect(room.storage.data.get("replayFloor")).toBe(snapshot!.sessionSeq)
    await waitFor(() => room.storage.batchCount() === 0, "bounded alarm compaction to finish")
    const headBeforeRetry = room.storage.data.get("currentSeq")
    creator.host.roomClient.submitBatch(originalBatch)
    await waitFor(() => creator.host.roomClient.pendingBatchCount === 0, "the compacted receipt to acknowledge a retry")
    expect(room.storage.data.get("currentSeq")).toBe(headBeforeRetry)
    expect(room.storage.batchCount()).toBe(0)
    expect(JSON.stringify(snapshot)).not.toContain("private snapshot text")
    const store = new CloudReplicaStore(TEST_PUBLIC_SESSION_ID, joiner.host.binaryObjects)
    const restored = new SessionReplica(TEST_PUBLIC_SESSION_ID, "restored")
    restored.restoreSnapshot(await store.download(snapshot!))
    const note = restored.tree.listLiveEntries().find((entry) => entry.path === "notes.md")!
    expect(restored.textDocs.getTextContent(note.fileId)).toBe("private snapshot text\n")
    room.evict()
    expect(await joiner.host.roomClient.getSnapshot()).toEqual(snapshot)
    const staleMessages: Array<{ type: string; replayFloor?: number }> = []
    const stale = await room.connector()({ onMessage: (data) => staleMessages.push(JSON.parse(data)), onClose: () => {} })
    stale.send(JSON.stringify({ type: "hello", clientId: "stale_reader", protocolVersion: worker.SESSION_ROOM_PROTOCOL_VERSION,
      token: await sessionTokenFor(worker, "principal_stale", { sessionRole: "viewer" })() }))
    await waitFor(() => staleMessages.some((message) => message.type === "ready"), "the stale reader to authenticate")
    stale.send(JSON.stringify({ type: "sync_request", knownSeq: 0 }))
    await waitFor(() => staleMessages.some((message) => message.type === "snapshot_required"), "snapshot requirement below replay floor")
    expect(staleMessages.find((message) => message.type === "snapshot_required")?.replayFloor).toBe(snapshot!.sessionSeq)
    stale.close()
    const freshRoot = await tempFolder("cloud-bootstrap")
    git(freshRoot, "clone", "-q", repos.remote, ".")
    git(freshRoot, "checkout", "-q", BRANCH)
    const syncRequests: number[] = []
    const fresh = await createPeer(room, "cloud-fresh", roomKey, { root: freshRoot, clientId: "c_fresh", timing: ON_REQUEST,
      withoutGit: true, sessionRole: "project_manager",
      onSyncRequest: (sequence) => syncRequests.push(sequence) })
    await startLive(fresh, "the cloud snapshot newcomer")
    expect(fresh.host.replica.tree.listLiveEntries().find((entry) => entry.path === "notes.md")?.fileId).toBe(note.fileId)
    expect(await fresh.read("notes.md")).toBe("private snapshot text\n")
    expect(syncRequests[0]).toBe(snapshot!.sessionSeq)
    await expect(joiner.host.roomClient.publishSnapshot(creator.host.roomClient.autoGitState!.lease!.generation, snapshot!))
      .rejects.toThrow(/Only the current leader/)
    const missingHash = "a".repeat(64)
    const unavailable = { ...snapshot!, manifest: { ...snapshot!.manifest, contentHash: missingHash,
      chunks: snapshot!.manifest.chunks.map((chunk) => ({ ...chunk,
        encryptedRef: `v1/${snapshot!.keyVersion}/${missingHash}/${chunk.index}/${chunk.hash}` })) } }
    await expect(creator.host.roomClient.publishSnapshot(creator.host.roomClient.autoGitState!.lease!.generation, unavailable))
      .rejects.toThrow(/missing or has the wrong size/)
    expect(await creator.host.roomClient.getSnapshot()).toEqual(snapshot)
    const fence = await creator.host.roomClient.prepareLifecycleFence("pause", snapshot!.barrierId)
    expect(fence.sessionSeq).toBe(snapshot!.sessionSeq)
    expect(fence.gitSavedThroughSeq).toBe(snapshot!.sessionSeq)
    await expect(creator.host.roomClient.publishSnapshot(creator.host.roomClient.autoGitState!.lease!.generation, snapshot!))
      .rejects.toThrow(/lifecycle fence retains/)
    room.evict()
    expect(await creator.host.roomClient.getLifecycleFence()).toEqual(fence)
    await creator.host.roomClient.cancelLifecycleFence(fence.fenceId)
    // A daemon with no Git service can retain exact CRDT state independently
    // of the current AutoGit lease, including an edit whose watcher never fired.
    expect(autoGitOf(fresh)).toBeNull()
    await fs.writeFile(path.join(fresh.root, "no-git.txt"), "cloud durable without Git credentials\n")
    const withoutGitSnapshot = await fresh.host.publishDurableSnapshot()
    const withoutGitReplica = new SessionReplica(TEST_PUBLIC_SESSION_ID, "without-git-restore")
    withoutGitReplica.restoreSnapshot(await store.download(withoutGitSnapshot))
    const withoutGitFile = withoutGitReplica.tree.listLiveEntries().find((entry) => entry.path === "no-git.txt")!
    expect(withoutGitReplica.textDocs.getTextContent(withoutGitFile.fileId)).toBe("cloud durable without Git credentials\n")
    await expect(joiner.host.roomClient.publishSnapshot(0, withoutGitSnapshot)).rejects.toThrow(/Only the current leader/)
    const withoutGitFence = await creator.host.roomClient.prepareLifecycleFence("pause", withoutGitSnapshot.barrierId)
    expect(withoutGitFence.gitSavedThroughSeq).toBeLessThan(withoutGitFence.sessionSeq)
    await expect(fresh.host.publishDurableSnapshot()).rejects.toThrow(/already holds a durable snapshot/)
    await creator.host.roomClient.cancelLifecycleFence(withoutGitFence.fenceId)
    await expect(joiner.host.pauseSession()).rejects.toThrow(/Only a session manager/)
    await fs.writeFile(path.join(fresh.root, "pause.txt"), "capture before global pause\n")
    const publication = vi.spyOn(fresh.host, "publishDurableSnapshot")
    const gitUnavailable = vi.spyOn(fresh.host.roomClient, "requestFreshCheckpoint")
      .mockResolvedValue({ routed: false, serverTime: Date.now() })
    // The actual room/control-plane commit and lost-reply behavior are covered
    // by lifecycleRoomCommit; here only that final network boundary is replaced.
    const commit = vi.spyOn(fresh.host.roomClient, "commitLifecycleFence")
      .mockRejectedValueOnce(new Error("commit reply unavailable"))
      .mockResolvedValue(undefined)
    try {
      await expect(fresh.host.pauseSession()).rejects.toThrow(/commit reply unavailable/)
      const prepared = await fresh.host.roomClient.getLifecycleFence()
      expect(prepared?.intent).toBe("pause")
      expect(await fresh.host.pauseSession()).toEqual({ gitLag: true })
      expect(publication).toHaveBeenCalledTimes(1)
      expect(gitUnavailable).toHaveBeenCalledTimes(1)
      expect(commit).toHaveBeenLastCalledWith(prepared!.fenceId)
      const pausedState = new SessionReplica(TEST_PUBLIC_SESSION_ID, "pause-restore")
      pausedState.restoreSnapshot(await store.download((await fresh.host.roomClient.getSnapshot())!))
      const pausedFile = pausedState.tree.listLiveEntries().find((entry) => entry.path === "pause.txt")!
      expect(pausedState.textDocs.getTextContent(pausedFile.fileId)).toBe("capture before global pause\n")
      await fresh.host.roomClient.cancelLifecycleFence(prepared!.fenceId)
      const review = await fresh.host.prepareClose()
      expect(review).toMatchObject({ publicSessionId: TEST_PUBLIC_SESSION_ID, gitLag: true, merge: null })
      await expect(fresh.host.closeSession({ reviewId: review.reviewId, allowUnpublishedGit: false,
        allowUnresolvedConflicts: false })).rejects.toThrow(/Choose whether to close/)
      await fs.writeFile(path.join(fresh.root, "after-review.txt"), "requires another review\n")
      await expect(fresh.host.closeSession({ reviewId: review.reviewId, allowUnpublishedGit: true,
        allowUnresolvedConflicts: true })).rejects.toThrow(/New changes arrived/)
      const actor = { actorType: "user" as const, principalId: "principal_cloud-fresh" }
      fresh.host.replica.createFile({ path: "collision.ts", kind: "text", content: "first", actor })
      fresh.host.replica.createFile({ path: "collision.ts", kind: "text", content: "second", actor })
      const conflictReview = await fresh.host.prepareClose()
      expect(conflictReview.conflicts.pathCollisions).toBeGreaterThan(0)
      await expect(fresh.host.closeSession({ reviewId: conflictReview.reviewId, allowUnpublishedGit: true,
        allowUnresolvedConflicts: false })).rejects.toThrow(/unresolved conflicts/)
      expect(await fresh.host.closeSession({ reviewId: conflictReview.reviewId, allowUnpublishedGit: true,
        allowUnresolvedConflicts: true })).toEqual({ gitLag: true })
      const closedFence = await fresh.host.roomClient.getLifecycleFence()
      expect(closedFence?.intent).toBe("close")
      await fresh.host.roomClient.cancelLifecycleFence(closedFence!.fenceId)
    } finally {
      publication.mockRestore()
      gitUnavailable.mockRestore()
      commit.mockRestore()
    }
    const damaged = { ...snapshot!, sessionSeq: snapshot!.sessionSeq + 1 }
    await expect(store.download(damaged)).rejects.toThrow(/identity mismatch/)
    const firstChunk = objects.get(`http://room.test/collab/sessions/binary/${TEST_PUBLIC_SESSION_ID}/${snapshot!.manifest.chunks[0].encryptedRef}`)!
    firstChunk[0] ^= 1
    await expect(store.download(snapshot!)).rejects.toThrow(/authenticated/)
  }, 30_000)

  it("reconciles a lost push response without duplicating the checkpoint", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\n" })
    const { creator } = await startPair(room, repos, ON_REQUEST)
    await creator.write("notes.md", "one\ntwo\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo\n", "the edit to land")

    // The push lands on the remote, but its answer never comes back.
    const originalExecute = GitProcess.prototype.execute
    let sabotaged = false
    const execute = vi.spyOn(GitProcess.prototype, "execute").mockImplementation(async function (
      this: GitProcess,
      args: string[],
      options: Parameters<GitProcess["execute"]>[1],
    ) {
      const result = await originalExecute.call(this, args, options)
      if (args[0] === "push" && !sabotaged) {
        sabotaged = true
        throw new Error("simulated lost push response")
      }
      return result
    })
    try {
      const result = await creator.host.checkpointNow()
      expect(result).toMatchObject({ outcome: "saved" })
    } finally {
      execute.mockRestore()
    }
    // Reconciled via ls-remote: exactly one new commit, nothing duplicated.
    const saved = remoteHead(repos.remote)
    expect(saved).not.toBe(repos.initial)
    expect(git(repos.remote, "rev-list", "--count", `${repos.initial}..${saved}`)).toBe("1")
    // Checkpoint text normalizes the trailing newline, matching existing saves.
    expect(git(repos.remote, "show", `${saved}:notes.md`)).toBe("one\ntwo")
  })

  it("adopts a terminal reset --hard as ordinary state without breaking the session", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "base\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST)
    await creator.write("notes.md", "base\nsession edit\n")
    await waitFor(async () => (await joiner.read("notes.md")) === "base\nsession edit\n", "the edit to reach the joiner")

    // The person reverts the folder in the terminal; the session follows the
    // bytes as an ordinary edit instead of failing or mass-deleting state.
    git(creator.root, "reset", "-q", "--hard", "HEAD")
    creator.reportExternalChange("notes.md")
    await waitFor(async () => (await joiner.read("notes.md")) === "base\n", "the reset bytes to converge")
    expect(await creator.read("notes.md")).toBe("base\n")
    expect(creator.host.status().state).not.toBe("failed")
    expect(creator.host.status().lastError).toBeNull()
    // The session itself is intact: new edits still flow afterwards.
    await creator.write("notes.md", "base\nrecovered\n")
    await waitFor(async () => (await joiner.read("notes.md")) === "base\nrecovered\n", "post-reset edits to flow")
  })

  it("leaves terminal-staged and terminal-committed work alone while saving", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "base\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST)
    await creator.write("notes.md", "base\nsession edit\n")
    await waitFor(async () => (await joiner.read("notes.md")) === "base\nsession edit\n", "the edit to reach the joiner")

    // Staging alone changes no worktree bytes, so the session has nothing new.
    const batchesBefore = room.storage.batchCount()
    git(creator.root, "add", "-A")
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(room.storage.batchCount()).toBe(batchesBefore)

    // A terminal commit stays in local history across an explicit save.
    git(creator.root, "commit", "-q", "-m", "terminal snapshot")
    const localCommit = git(creator.root, "rev-parse", "HEAD")
    const result = await creator.host.checkpointNow()
    expect(result).toMatchObject({ outcome: "saved" })
    // The terminal commit already holds the session bytes, so the checkpoint
    // is a content no-op: nothing new is pushed, and the local commit stays
    // reachable exactly where the person left it.
    expect(remoteHead(repos.remote)).toBe(repos.initial)
    expect(git(creator.root, "cat-file", "-e", localCommit)).toBe("")
    expect(git(creator.root, "rev-parse", "HEAD")).toBe(localCommit)
    expect(await creator.read("notes.md")).toBe("base\nsession edit\n")
    expect(await joiner.read("notes.md")).toBe("base\nsession edit\n")
  })

  it("saves the session to its branch from the leader and moves every member's Git with it", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({
      "README.md": "# Demo\n",
      "src/app.ts": "export const answer = 42\n",
      "logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
    })
    const { creator, joiner } = await startPair(room, repos)

    await joiner.write("src/app.ts", "export const answer = 43\n")
    // Before any edit, the session's first save records the branch as it stands.
    await waitFor(() => (checkpointOf(creator) ?? repos.initial) !== repos.initial, "the first checkpoint", GIT_WAIT_MS)
    const first = checkpointOf(creator) ?? ""
    expect(remoteHead(repos.remote)).toBe(first)
    expect(git(repos.remote, "rev-parse", `${first}^`)).toBe(repos.initial)
    expect(git(repos.remote, "show", `${first}:src/app.ts`)).toBe("export const answer = 43")
    // The session never carried the binary, so the checkpoint keeps Git's copy.
    expect(git(repos.remote, "ls-tree", "-r", "--name-only", first).split("\n")).toEqual([
      "README.md",
      "logo.png",
      "src/app.ts",
    ])
    expect(git(repos.remote, "log", "-1", "--format=%B", first)).toContain(`Cozea-Session: ${TEST_PUBLIC_SESSION_ID}`)

    // Each member's branch and index move to the checkpoint; the working trees already match it.
    for (const [peer, label] of [
      [creator, "creator"],
      [joiner, "joiner"],
    ] as const) {
      // update-ref moves the branch a moment before reset moves the index.
      await waitFor(
        () => git(peer.root, "rev-parse", "HEAD") === first && git(peer.root, "status", "--porcelain") === "",
        `the ${label}'s branch and index to move`,
        GIT_WAIT_MS,
      )
    }

    // A file deleted in the session leaves the branch with the next checkpoint.
    await creator.remove("README.md")
    await waitFor(
      () => checkpointOf(joiner) !== null && checkpointOf(joiner) !== first,
      "the second checkpoint",
      GIT_WAIT_MS,
    )
    const second = checkpointOf(joiner) ?? ""
    expect(git(repos.remote, "rev-parse", `${second}^`)).toBe(first)
    expect(git(repos.remote, "ls-tree", "-r", "--name-only", second).split("\n")).toEqual(["logo.png", "src/app.ts"])
  })

  it("shares ignored env files live and never saves them to Git", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ ".gitignore": ".env*\n", "src/app.ts": "export const answer = 42\n" })
    await writeFiles(repos.creatorRoot, { ".env": "API_KEY=creator\n" })
    // The joiner has its own env file: the session's replaces it, and its own stays beside it.
    await writeFiles(repos.joinerRoot, { ".env": "API_KEY=joiner-local\n" })
    const roomKey = randomBytes(32)
    const creator = await createPeer(room, "creator", roomKey, {
      root: repos.creatorRoot,
      clientId: "c_a",
      shareEnvironmentFiles: true,
    })
    await startLive(creator, "the creator")
    await waitFor(() => autoGitOf(creator)?.state === "leader", "the creator to lead", GIT_WAIT_MS)
    const joiner = await createPeer(room, "joiner", roomKey, {
      root: repos.joinerRoot,
      clientId: "c_b",
      shareEnvironmentFiles: true,
    })
    await startLive(joiner, "the joiner")

    expect(await joiner.read(".env")).toBe("API_KEY=creator\n")
    const keptCopies = (await fs.readdir(repos.joinerRoot)).filter((name) => name.startsWith(".env.conflict."))
    expect(keptCopies).toHaveLength(1)
    expect(await joiner.read(keptCopies[0] ?? "")).toBe("API_KEY=joiner-local\n")

    // A change anyone makes reaches everyone.
    await joiner.write(".env", "API_KEY=rotated\n")
    await waitFor(
      async () => (await creator.read(".env")) === "API_KEY=rotated\n",
      "the rotated key to reach the creator",
      GIT_WAIT_MS,
    )

    // Saving the session to Git leaves the env file out.
    await creator.write("src/app.ts", "export const answer = 43\n")
    await waitFor(() => remoteHead(repos.remote) !== repos.initial, "the session to be saved", GIT_WAIT_MS)
    const saved = remoteHead(repos.remote)
    expect(git(repos.remote, "ls-tree", "-r", "--name-only", saved).split("\n")).toEqual([".gitignore", "src/app.ts"])
    expect(git(repos.remote, "show", `${saved}:src/app.ts`)).toBe("export const answer = 43")
  })

  it("saves when any member asks", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST)

    await joiner.write("notes.md", "one\ntwo\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo\n", "the creator to get the edit")
    expect(await joiner.host.checkpointNow()).toMatchObject({ outcome: "requested" })
    await waitFor(() => checkpointOf(joiner) !== null, "the leader to save on request", GIT_WAIT_MS)
    expect(git(repos.remote, "show", `${checkpointOf(joiner)}:notes.md`)).toBe("one\ntwo")

  })

  it("merges commits pushed from outside the session and builds the next save on them", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\ntwo\nthree\nfour\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST)
    await joiner.write("notes.md", "one\ntwo\nthree\nfour\nfive\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo\nthree\nfour\nfive\n", "the creator to get the edit")
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })

    // Outside the session someone changes the first line and adds a file; the session changes the last line.
    const outside = await pushFromOutside(repos.remote, {
      "notes.md": "ONE\ntwo\nthree\nfour\nfive\n",
      "CHANGELOG.md": "outside\n",
    })
    await joiner.write("notes.md", "one\ntwo\nthree\nfour\nFIVE\n")
    await waitFor(
      async () => (await creator.read("notes.md")) === "one\ntwo\nthree\nfour\nFIVE\n",
      "the creator to get the next edit",
    )
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })

    const merged = "ONE\ntwo\nthree\nfour\nFIVE\n"
    for (const [peer, label] of [
      [creator, "creator"],
      [joiner, "joiner"],
    ] as const) {
      await waitFor(
        async () => (await peer.read("notes.md")) === merged && (await peer.read("CHANGELOG.md")) === "outside\n",
        `the ${label}'s folder to hold both sides`,
        GIT_WAIT_MS,
      )
    }
    const saved = remoteHead(repos.remote)
    expect(git(repos.remote, "rev-parse", `${saved}^`)).toBe(outside)
    expect(git(repos.remote, "show", `${saved}:notes.md`)).toBe(merged.trimEnd())
    expect(autoGitOf(creator)).toMatchObject({ state: "leader", lastError: null })
  })

  it("marks lines both sides changed, and saves once the markers are resolved", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\ntwo\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST)

    // Pushed before the session's first save, so that save builds on it.
    const outside = await pushFromOutside(repos.remote, { "notes.md": "one\nTWO from outside\n" })
    await joiner.write("notes.md", "one\ntwo from the session\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo from the session\n", "the creator to get the edit")
    await expect(creator.host.checkpointNow()).rejects.toMatchObject({ code: "CONFLICT_MARKERS" })
    expect(remoteHead(repos.remote)).toBe(outside)

    await waitFor(
      async () => (await joiner.read("notes.md"))?.includes("<<<<<<< live session") === true,
      "the conflict to reach the joiner",
      GIT_WAIT_MS,
    )
    const conflicted = (await joiner.read("notes.md")) ?? ""
    expect(conflicted).toContain("two from the session")
    expect(conflicted).toContain("TWO from outside")
    expect(conflicted).toContain(`>>>>>>> origin/${BRANCH}`)
    await waitFor(() => autoGitOf(joiner)?.detailCode === "CONFLICT_MARKERS", "the joiner to hear why saving waits")

    await joiner.write("notes.md", "one\ntwo from the session\nTWO from outside\n")
    await waitFor(
      async () => (await creator.read("notes.md")) === "one\ntwo from the session\nTWO from outside\n",
      "the creator to get the resolution",
    )
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })
    const saved = remoteHead(repos.remote)
    expect(git(repos.remote, "rev-parse", `${saved}^`)).toBe(outside)
    expect(git(repos.remote, "show", `${saved}:notes.md`)).toBe("one\ntwo from the session\nTWO from outside")
  })

  it("stops rather than overwrite a branch rewritten outside the session", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST)
    await joiner.write("notes.md", "one\ntwo\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo\n", "the creator to get the edit")
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })

    // Someone force-pushes history that drops the session's save.
    const rewritten = await pushFromOutside(repos.remote, { "CHANGELOG.md": "outside\n" }, { resetTo: repos.initial })
    await joiner.write("notes.md", "one\ntwo\nthree\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo\nthree\n", "the creator to get the next edit")
    await expect(creator.host.checkpointNow()).rejects.toMatchObject({ code: "REMOTE_CHANGED" })
    expect(remoteHead(repos.remote)).toBe(rewritten)
    expect(autoGitOf(creator)).toMatchObject({
      state: "blocked",
      detail: expect.stringContaining(`${BRANCH} changed on origin outside the session`),
    })
    await waitFor(() => autoGitOf(joiner)?.state === "blocked", "the joiner to hear why saving stopped")
    expect(autoGitOf(joiner)?.detail).toContain("rather than overwrite those commits")
  })

  it("merges an outside push while nobody edits", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\n" })
    const { creator, joiner } = await startPair(room, repos, { ...FAST, remotePollMs: 100 })
    await waitFor(() => checkpointOf(creator) === repos.initial, "the session's first save", GIT_WAIT_MS)

    const outside = await pushFromOutside(repos.remote, { "CHANGELOG.md": "outside\n" })
    await waitFor(async () => (await joiner.read("CHANGELOG.md")) === "outside\n", "the outside commit to reach the joiner", GIT_WAIT_MS)
    // The session holds exactly that commit, so it becomes the session's save.
    await waitFor(() => checkpointOf(joiner) === outside, "the outside commit to become the session's save", GIT_WAIT_MS)
    expect(remoteHead(repos.remote)).toBe(outside)
  })

  it("hands saving to another member's Mac when the leader leaves", async () => {
    const room = newRoom({ leaseMs: 400 })
    const repos = await setUpRepositories({ "notes.md": "one\n" })
    const { creator, joiner } = await startPair(room, repos)

    await creator.host.stop()
    await waitFor(() => autoGitOf(joiner)?.state === "leader", "the joiner to take over", GIT_WAIT_MS)

    await joiner.write("notes.md", "one\nfrom the joiner\n")
    await waitFor(() => (checkpointOf(joiner) ?? repos.initial) !== repos.initial, "the new leader's checkpoint", GIT_WAIT_MS)
    const saved = checkpointOf(joiner) ?? ""
    expect(remoteHead(repos.remote)).toBe(saved)
    expect(git(repos.remote, "show", `${saved}:notes.md`)).toBe("one\nfrom the joiner")
    expect(git(repos.remote, "log", "-1", "--format=%B", saved)).toContain("Cozea-Lease-Generation: 2")
  })

  it("pauses a folder while another branch is checked out or Git is mid-merge, and catches up after", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "README.md": "# Demo\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST)

    git(repos.joinerRoot, "checkout", "-q", "-b", "experiment")
    await waitFor(() => joiner.host.state === "paused", "the joiner to pause")
    expect(joiner.host.status().pausedReason).toBe(
      `This folder has experiment checked out. Switch back to ${BRANCH} to keep syncing the session.`,
    )

    const before = room.storage.batchCount()
    await creator.write("README.md", "# Demo\nfrom the creator\n")
    await waitFor(
      () => room.storage.batchCount() === before + 1 && joiner.host.status().lastAppliedSessionSeq === before + 1,
      "the joiner to receive the creator's edit",
    )
    await joiner.host.flush()
    expect(await joiner.read("README.md")).toBe("# Demo\n")

    git(repos.joinerRoot, "checkout", "-q", BRANCH)
    await waitFor(() => joiner.host.state === "live", "the joiner to resume", GIT_WAIT_MS)
    await waitFor(async () => (await joiner.read("README.md")) === "# Demo\nfrom the creator\n", "the joiner to catch up")

    const mergeHead = path.join(repos.joinerRoot, ".git", "MERGE_HEAD")
    await fs.writeFile(mergeHead, `${repos.initial}\n`)
    await waitFor(() => joiner.host.state === "paused", "the joiner to pause for the merge")
    expect(joiner.host.status().pausedReason).toContain("in the middle of a merge")
    await fs.rm(mergeHead)
    await waitFor(() => joiner.host.state === "live", "the joiner to resume after the merge", GIT_WAIT_MS)
  })

  it("holds saving while a shared env file isn't ignored, until someone adds it to .gitignore", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "src/app.ts": "export const answer = 42\n" })
    await writeFiles(repos.creatorRoot, { ".env": "API_KEY=creator\n" })
    const roomKey = randomBytes(32)
    const creator = await createPeer(room, "creator", roomKey, {
      root: repos.creatorRoot,
      clientId: "c_a",
      shareEnvironmentFiles: true,
    })
    await startLive(creator, "the creator")
    await waitFor(() => autoGitOf(creator)?.state !== "no_leader", "the creator to lead", GIT_WAIT_MS)
    const joiner = await createPeer(room, "joiner", roomKey, {
      root: repos.joinerRoot,
      clientId: "c_b",
      shareEnvironmentFiles: true,
    })
    await startLive(joiner, "the joiner")

    await creator.write("src/app.ts", "export const answer = 43\n")
    await waitFor(() => autoGitOf(joiner)?.detailCode === "ENV_NOT_IGNORED", "the joiner to hear why saving waits", GIT_WAIT_MS)
    expect(autoGitOf(creator)).toMatchObject({
      state: "blocked",
      detail:
        ".env isn't ignored by Git, so saving the session to Git is on hold rather than commit it. Add it to .gitignore to resume.",
    })
    expect(remoteHead(repos.remote)).toBe(repos.initial)

    expect(await joiner.host.ignoreEnvironmentFiles()).toEqual([".env"])
    await waitFor(() => remoteHead(repos.remote) !== repos.initial, "the session to be saved once .env is ignored", GIT_WAIT_MS)
    const saved = remoteHead(repos.remote)
    expect(git(repos.remote, "ls-tree", "-r", "--name-only", saved).split("\n")).toEqual([".gitignore", "src/app.ts"])
    expect(git(repos.remote, "show", `${saved}:.gitignore`)).toContain("/.env")
    await waitFor(async () => (await creator.read(".gitignore"))?.includes("/.env") === true, "the creator to get .gitignore")
  })

  it("stops counting env-only edits as unsaved once the leader finds nothing new for Git", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ ".gitignore": ".env\n", "src/app.ts": "export const answer = 42\n" })
    await writeFiles(repos.creatorRoot, { ".env": "API_KEY=creator\n" })
    const roomKey = randomBytes(32)
    const creator = await createPeer(room, "creator", roomKey, {
      root: repos.creatorRoot,
      clientId: "c_a",
      shareEnvironmentFiles: true,
    })
    await startLive(creator, "the creator")
    const joiner = await createPeer(room, "joiner", roomKey, {
      root: repos.joinerRoot,
      clientId: "c_b",
      shareEnvironmentFiles: true,
    })
    await startLive(joiner, "the joiner")

    await creator.write("src/app.ts", "export const answer = 43\n")
    await waitFor(
      () =>
        remoteHead(repos.remote) !== repos.initial &&
        checkpointOf(joiner) === remoteHead(repos.remote) &&
        autoGitOf(joiner)?.unsavedChanges === 0,
      "the edit to be saved",
      GIT_WAIT_MS,
    )
    const saved = remoteHead(repos.remote)

    await joiner.write(".env", "API_KEY=rotated\n")
    await waitFor(async () => (await creator.read(".env")) === "API_KEY=rotated\n", "the env edit to reach the creator")
    await waitFor(
      () => autoGitOf(joiner)?.unsavedChanges === 0 && autoGitOf(creator)?.unsavedChanges === 0,
      "both members to see the env edit needs no save",
      GIT_WAIT_MS,
    )
    expect(checkpointOf(joiner)).toBe(saved)
    expect(remoteHead(repos.remote)).toBe(saved)
  })

  it("saves disk edits before watcher delivery from both leader and follower", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "before\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST)
    await fs.writeFile(path.join(creator.root, "notes.md"), "leader save\n")
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })
    expect(git(repos.remote, "show", `${BRANCH}:notes.md`)).toBe("leader save")
    await waitFor(async () => (await joiner.read("notes.md")) === "leader save\n", "leader edit to reach follower")
    await fs.writeFile(path.join(joiner.root, "notes.md"), "follower save\n")
    expect(await joiner.host.checkpointNow()).toMatchObject({ outcome: "requested" })
    await waitFor(
      () => git(repos.remote, "show", `${BRANCH}:notes.md`) === "follower save",
      "follower's immediate save to reach Git",
      GIT_WAIT_MS,
    )
    await fs.rm(path.join(joiner.root, "notes.md"))
    await joiner.host.checkpointNow()
    await waitFor(
      () => git(repos.remote, "ls-tree", "--name-only", BRANCH) === "",
      "immediate save to include deletion before its rename timer expires",
      GIT_WAIT_MS,
    )
  }, 30_000)

  it("previews a fresh checkpoint from a follower, including edits after the previous save", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "before\n" })
    git(repos.creatorRoot, "push", "-q", "origin", `${BRANCH}:refs/heads/main`)
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")
    const first = await creator.host.previewMerge()
    expect(first.checkpointOid).toBe(repos.initial)
    await joiner.write("notes.md", "after\n")
    const preview = await joiner.host.previewMerge()
    expect(preview.checkpointOid).not.toBe(first.checkpointOid)
    expect(git(repos.remote, "show", `${preview.checkpointOid}:notes.md`)).toBe("after")
    expect(preview.unsavedChanges).toBe(0)
    // A new barrier also confirms an unchanged tree, without a redundant commit.
    expect((await joiner.host.previewMerge()).checkpointOid).toBe(preview.checkpointOid)
  }, 30_000)

  it("tells the session how far the branch it merges into moved, and never rebases", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\n" })
    // main starts where the session branch does, then moves on without it.
    git(repos.creatorRoot, "push", "-q", "origin", `${BRANCH}:refs/heads/main`)
    const mainRoot = await tempFolder("main")
    git(mainRoot, "clone", "-q", "-b", "main", repos.remote, ".")
    for (let index = 1; index <= 3; index += 1) {
      await writeFiles(mainRoot, { [`main-${index}.md`]: `${index}\n` })
      git(mainRoot, "add", "-A")
      git(mainRoot, "commit", "-q", "-m", `main ${index}`)
    }
    git(mainRoot, "push", "-q", "origin", "main")

    const creator = await createPeer(room, "creator", randomBytes(32), {
      root: repos.creatorRoot,
      clientId: "c_a",
      targetBranch: "main",
    })
    await startLive(creator, "the creator")
    const before = git(repos.creatorRoot, "rev-parse", BRANCH)

    expect(await creator.host.checkTarget()).toMatchObject({
      branch: "main",
      behind: 3,
      ahead: 0,
      recommended: true,
      reason: "main has 3 commits this session's branch doesn't have.",
      error: null,
    })
    expect(creator.host.status().target).toMatchObject({ behind: 3, recommended: true })
    expect(creator.host.dismissTargetRecommendation()).toMatchObject({ behind: 3, recommended: false, reason: null })
    expect(git(repos.creatorRoot, "rev-parse", BRANCH)).toBe(before)
  })

  it("preserves text and binary identity across Git renames with edits held during adoption", async () => {
    const room = newRoom()
    const bytes = Buffer.from([0, 255, 4])
    const repos = await setUpRepositories({ "old.md": "base\n", "old.bin": bytes })
    const target = await createTargetBranch(repos.remote, repos.creatorRoot, { "target.md": "target\n" })
    git(target.root, "mv", "old.md", "renamed.md")
    git(target.root, "mv", "old.bin", "renamed.bin")
    git(target.root, "commit", "-q", "-m", "Rename shared files")
    git(target.root, "push", "-q", "origin", "main")
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")
    await creator.host.checkpointNow()
    const originalIds = new Map(creator.host.replica.tree.listLiveEntries().map((entry) => [entry.path, entry.fileId]))
    const before = remoteHead(repos.remote)
    const begin = creator.host.roomClient.beginIntegration.bind(creator.host.roomClient)
    let occupied = false
    const collision = vi.spyOn(creator.host.roomClient, "beginIntegration").mockImplementation(async (generation, id) => {
      if (!occupied) {
        occupied = true
        await joiner.write("renamed.md", "unrelated destination\n")
        await waitFor(() => creator.host.replica.tree.listLiveEntries().some((entry) => entry.path === "renamed.md"), "destination created after rename preparation")
      }
      return begin(generation, id)
    })
    try { await expect(creator.host.rebase(false)).rejects.toMatchObject({ code: "REBASE_LIVE_CONFLICT" }) }
    finally { collision.mockRestore() }
    expect(remoteHead(repos.remote)).toBe(before)
    await waitFor(async () => await creator.read("renamed.md") === "unrelated destination\n", "occupied destination preserved")
    expect(await creator.read("old.md")).toBe("base\n")
    await joiner.remove("renamed.md")
    await waitFor(() => !creator.host.replica.tree.listLiveEntries().some((entry) => entry.path === "renamed.md"), "destination conflict resolved")
    const { journals } = await creator.host.manageRebaseRecovery({ action: "list" })
    const finish = creator.host.roomClient.finishIntegration.bind(creator.host.roomClient)
    let edited = false
    const duringRename = vi.spyOn(creator.host.roomClient, "finishIntegration").mockImplementation(async (generation, id, batch) => {
      if (batch && !edited) {
        edited = true
        await joiner.write("old.md", "edited during rename\n")
        await waitFor(() => (room.storage.data.get("integration:active") as { count: number }).count === 1, "held edit to original file identity")
      }
      return finish(generation, id, batch)
    })
    const upload = vi.spyOn(creator.host.binaryObjects, "upload")
    try { expect(await creator.host.manageRebaseRecovery({ action: "apply", recoveryId: journals![0].id })).toMatchObject({ result: { outcome: "rebased" } }); expect(upload).not.toHaveBeenCalled() }
    finally { duringRename.mockRestore(); upload.mockRestore() }
    for (const peer of [creator, joiner]) {
      await waitFor(async () => await peer.read("renamed.md") === "edited during rename\n", "renamed text keeps held edit")
      await waitFor(async () => await peer.read("old.md") === null && await peer.read("old.bin") === null, "old paths removed")
      expect(await fs.readFile(path.join(peer.root, "renamed.bin"))).toEqual(bytes)
      const entries = peer.host.replica.tree.listLiveEntries()
      expect(entries.find((entry) => entry.path === "renamed.md")?.fileId).toBe(originalIds.get("old.md"))
      expect(entries.find((entry) => entry.path === "renamed.bin")?.fileId).toBe(originalIds.get("old.bin"))
    }
    const saved = remoteHead(repos.remote)
    expect(git(repos.remote, "show", `${saved}:renamed.md`)).toBe("edited during rename")
    expect(execFileSync("git", ["show", `${saved}:renamed.bin`], { cwd: repos.remote })).toEqual(bytes)
  })

  it("recomputes at the final frontier and merges edits held during actual host adoption", async () => {
    const room = newRoom()
    const base = "one\nkeep-a\nkeep-b\nmiddle\nkeep-c\nkeep-d\nlast\n"
    const before = base.replace("last", "LAST before barrier")
    const held = before.replace("middle", "MIDDLE during barrier")
    const expected = held.replace("one", "ONE from target")
    const repos = await setUpRepositories({ "notes.md": base })
    await createTargetBranch(repos.remote, repos.creatorRoot, { "notes.md": base.replace("one", "ONE from target") })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")
    await creator.host.checkpointNow()
    const text = () => creator.host.replica.textDocs.getTextContent(creator.host.replica.tree.listLiveEntries().find((entry) => entry.path === "notes.md")!.fileId)
    const begin = creator.host.roomClient.beginIntegration.bind(creator.host.roomClient)
    let begins = 0
    const frontier = vi.spyOn(creator.host.roomClient, "beginIntegration").mockImplementation(async (generation, adoptionId) => {
      if (++begins === 1) {
        await joiner.write("notes.md", before)
        await waitFor(() => text() === before, "edit newer than prepared merge")
      }
      return begin(generation, adoptionId)
    })
    const finish = creator.host.roomClient.finishIntegration.bind(creator.host.roomClient)
    let systemBatchId: string | null = null
    let heldBatchId: string | null = null
    const integration = vi.spyOn(creator.host.roomClient, "finishIntegration").mockImplementation(async (generation, id, batch) => {
      if (batch && !systemBatchId) {
        systemBatchId = batch.batchId
        await joiner.write("notes.md", held)
        await waitFor(() => (room.storage.data.get("integration:active") as { count: number }).count === 1, "peer edit durably held")
        expect(text()).toBe(before)
        heldBatchId = joiner.host.queue.getPendingBatches(TEST_PUBLIC_SESSION_ID)[0].batchId
        room.evict()
      }
      return finish(generation, id, batch)
    })
    try { expect(await creator.host.rebase(false)).toMatchObject({ outcome: "rebased" }) }
    finally { frontier.mockRestore(); integration.mockRestore() }
    expect(begins).toBeGreaterThanOrEqual(2)
    const systemSeq = room.storage.data.get(`batch-id:${systemBatchId}`) as number
    expect(room.storage.data.get(`batch-id:${heldBatchId}`)).toBe(systemSeq + 1)
    for (const peer of [creator, joiner]) await waitFor(async () => await peer.read("notes.md") === expected, "all concurrent edits on disk")
    expect(git(repos.remote, "show", `${remoteHead(repos.remote)}:notes.md`)).toBe(expected.trim())
  })

  it("keeps expired staging out of normal replay and recovers a lost integration reply", async () => {
    const room = newRoom({ leaseMs: 400 })
    const repos = await setUpRepositories({ "notes.md": "base\n" })
    await createTargetBranch(repos.remote, repos.creatorRoot, { "target.md": "target\n" })
    const { creator, joiner, roomKey } = await startPair(room, repos, ON_REQUEST, "main")
    await creator.host.checkpointNow()
    const before = remoteHead(repos.remote)
    const finish = creator.host.roomClient.finishIntegration.bind(creator.host.roomClient)
    let expired = false
    const expiry = vi.spyOn(creator.host.roomClient, "finishIntegration").mockImplementation(async (generation, id, batch) => {
      if (batch && !expired) {
        expired = true
        const barrier = room.storage.data.get("integration:active") as Record<string, unknown>
        room.storage.data.set("integration:active", { ...barrier, expiresAt: Date.now() - 1 })
      }
      return finish(generation, id, batch)
    })
    try { await expect(creator.host.rebase(false)).rejects.toMatchObject({ code: "INTEGRATION_STALE" }) }
    finally { expiry.mockRestore() }
    expect(await creator.read("target.md")).toBeNull()
    expect(creator.host.replica.tree.listLiveEntries().map((entry) => entry.path)).toEqual(["notes.md"])
    expect(creator.host.queue.getIntegrationBatches(TEST_PUBLIC_SESSION_ID)).toHaveLength(1)
    expect(creator.host.queue.getPendingBatches(TEST_PUBLIC_SESSION_ID)).toHaveLength(0)
    const stagedRow = creator.host.queue.getIntegrationBatches(TEST_PUBLIC_SESSION_ID)[0]
    const stored = creator.host.queue.db.db.prepare("SELECT payload_json FROM outbound_batches WHERE batch_id=?").get(stagedRow.batchId) as { payload_json: string }
    expect(stored.payload_json.startsWith("czenc1:")).toBe(true)
    expect(stored.payload_json).not.toContain(stagedRow.integration!.barrierId)
    creator.host.queue.db.db.prepare("UPDATE outbound_batches SET state='pending' WHERE batch_id=?").run(stagedRow.batchId)
    expect(() => creator.host.queue.getPendingBatches(TEST_PUBLIC_SESSION_ID)).toThrow(/Staged integration cannot replay/)
    creator.host.queue.db.db.prepare("UPDATE outbound_batches SET state='integration' WHERE batch_id=?").run(stagedRow.batchId)
    await joiner.host.stop()
    await creator.host.stop()
    room.evict()
    const restored = await createPeer(room, "creator", roomKey, { root: repos.creatorRoot, clientId: "c_a", timing: ON_REQUEST, targetBranch: "main", sessionRole: "project_manager" })
    await startLive(restored, "the staged recovery owner")
    await waitFor(() => autoGitOf(restored)?.isLeader === true, "staged recovery leadership", GIT_WAIT_MS)
    expect(await restored.read("target.md")).toBeNull()
    const { journals } = await restored.host.manageRebaseRecovery({ action: "list" })
    const recoveryId = journals![0].id
    const retry = restored.host.roomClient.finishIntegration.bind(restored.host.roomClient)
    let lost = false
    const reply = vi.spyOn(restored.host.roomClient, "finishIntegration").mockImplementation(async (generation, id, batch) => {
      const result = await retry(generation, id, batch)
      if (batch && !lost) { lost = true; throw new Error("lost integration reply") }
      return result
    })
    try { await expect(restored.host.manageRebaseRecovery({ action: "apply", recoveryId })).rejects.toThrow(/lost integration reply/) }
    finally { reply.mockRestore() }
    expect(remoteHead(repos.remote)).toBe(before)
    await restored.write("notes.md", "edit after accepted adoption\n")
    await waitFor(() => restored.host.replica.textDocs.getTextContent(restored.host.replica.tree.listLiveEntries().find((entry) => entry.path === "notes.md")!.fileId) === "edit after accepted adoption\n", "post-adoption edit")
    expect(await restored.host.manageRebaseRecovery({ action: "apply", recoveryId })).toMatchObject({ result: { outcome: "rebased" } })
    expect(restored.host.queue.getIntegrationBatches(TEST_PUBLIC_SESSION_ID)).toHaveLength(0)
    const saved = remoteHead(repos.remote)
    expect(git(repos.remote, "show", `${saved}:notes.md`)).toBe("edit after accepted adoption")
    expect(git(repos.remote, "show", `${saved}:target.md`)).toBe("target")
  })

  it("journals the complete rebase before a disk projection fails and resumes after restart", async () => {
    const room = newRoom({ leaseMs: 400 })
    const repos = await setUpRepositories({ "notes.md": "base\n" })
    await createTargetBranch(repos.remote, repos.creatorRoot, { "first.md": "first\n", "second.md": "second\n", "asset.bin": Buffer.from([0, 255, 7]) })
    const { creator, joiner, roomKey } = await startPair(room, repos, ON_REQUEST, "main")
    await creator.host.checkpointNow()
    const before = remoteHead(repos.remote)
    const snapshot = creator.host.replica.captureSnapshot()
    const unavailableJournal = vi.spyOn(creator.host.queue, "enqueue").mockImplementationOnce(() => { throw new Error("journal unavailable") })
    try { await expect(creator.host.rebase(false)).rejects.toThrow(/journal unavailable/) }
    finally { unavailableJournal.mockRestore() }
    expect(creator.host.replica.tree.listLiveEntries().map((entry) => entry.path)).toEqual(["notes.md"])
    expect(await creator.read("first.md")).toBeNull()
    expect(remoteHead(repos.remote)).toBe(before)
    const pending = await creator.host.manageRebaseRecovery({ action: "list" })
    const enqueue = vi.spyOn(creator.host.queue, "enqueue")
    const original = FilesystemMaterializer.prototype.materializeFile
    let failed = false
    const projection = vi.spyOn(FilesystemMaterializer.prototype, "materializeFile").mockImplementation(async function (this: FilesystemMaterializer, fileId, at) {
      if (!failed && (this as unknown as { workspaceRoot: string }).workspaceRoot === creator.root && creator.host.replica.tree.getEntry(fileId)?.path !== "notes.md") {
        failed = true
        expect(enqueue).toHaveBeenCalledTimes(1)
        const retained = creator.host.queue.getIntegrationBatches(TEST_PUBLIC_SESSION_ID)
        expect(retained.some((entry) => entry.batchId === enqueue.mock.calls[0][0].batchId)).toBe(true)
        throw new Error("disk projection interrupted")
      }
      return original.call(this, fileId, at)
    })
    try { await expect(creator.host.manageRebaseRecovery({ action: "apply", recoveryId: pending.journals![0].id })).rejects.toThrow(/disk projection interrupted/) }
    finally { projection.mockRestore() }
    expect(failed).toBe(true)
    const replay = new SessionReplica(TEST_PUBLIC_SESSION_ID, "journal-verifier")
    replay.restoreSnapshot(snapshot)
    replay.applyBatch(enqueue.mock.calls[0][0])
    enqueue.mockRestore()
    expect(replay.tree.listLiveEntries().map((entry) => entry.path).sort()).toEqual(["asset.bin", "first.md", "notes.md", "second.md"])
    const binary = replay.tree.listLiveEntries().find((entry) => entry.path === "asset.bin")!
    expect(replay.binaryStore.getHeadRevision(binary.fileId)?.size).toBe(3)
    expect(remoteHead(repos.remote)).toBe(before)
    await creator.host.stop()
    await joiner.host.stop()
    room.evict()
    const restored = await createPeer(room, "creator", roomKey, { root: repos.creatorRoot, clientId: "c_a", timing: ON_REQUEST, targetBranch: "main", sessionRole: "project_manager" })
    await startLive(restored, "the restarted projection owner")
    await waitFor(() => autoGitOf(restored)?.isLeader === true, "projection owner leadership", GIT_WAIT_MS)
    const { journals } = await restored.host.manageRebaseRecovery({ action: "list" })
    expect(await restored.host.manageRebaseRecovery({ action: "apply", recoveryId: journals![0].id })).toMatchObject({ result: { outcome: "rebased" } })
    expect(await restored.read("first.md")).toBe("first\n")
    expect(await restored.read("second.md")).toBe("second\n")
    expect(await fs.readFile(path.join(restored.root, "asset.bin"))).toEqual(Buffer.from([0, 255, 7]))
  })

  it("adopts Git symlink additions and file type changes without dereferencing targets", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "convert": "missing-target", "notes.md": "base\n" })
    const target = await createTargetBranch(repos.remote, repos.creatorRoot, { "target.md": "target\n" })
    await fs.unlink(path.join(target.root, "convert"))
    await fs.symlink("missing-target", path.join(target.root, "convert"))
    await fs.symlink("../outside", path.join(target.root, "added-link"))
    git(target.root, "add", "-A")
    git(target.root, "commit", "-q", "-m", "Add literal symlinks")
    git(target.root, "push", "-q", "origin", "main")
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")
    await creator.host.checkpointNow()
    expect(await creator.host.rebase(false)).toMatchObject({ outcome: "rebased" })
    for (const peer of [creator, joiner]) {
      await waitFor(async () => await fs.readlink(path.join(peer.root, "convert")).catch(() => null) === "missing-target", "Git regular-to-symlink change")
      await waitFor(async () => await fs.readlink(path.join(peer.root, "added-link")).catch(() => null) === "../outside", "Git symlink addition")
    }
    expect(git(repos.remote, "ls-tree", remoteHead(repos.remote), "convert", "added-link").split("\n").every((line) => line.startsWith("120000"))).toBe(true)
    // Same bytes, different kind: the watcher must not suppress this as an echo.
    await joiner.remove("convert")
    await joiner.write("convert", "missing-target")
    await waitFor(async () => (await fs.lstat(path.join(creator.root, "convert")).catch(() => null))?.isFile() === true, "same-byte symlink-to-text change")
    await joiner.symlink("convert", "missing-target")
    await waitFor(async () => (await fs.lstat(path.join(creator.root, "convert")).catch(() => null))?.isSymbolicLink() === true, "same-byte text-to-symlink change")
    await creator.host.checkpointNow()
    expect(git(repos.remote, "show", `${remoteHead(repos.remote)}:convert`)).toBe("missing-target")
    const originalLink = creator.host.replica.tree.listLiveEntries().find((entry) => entry.path === "added-link")!.fileId
    git(target.root, "mv", "added-link", "renamed-link")
    await fs.unlink(path.join(target.root, "convert"))
    await fs.writeFile(path.join(target.root, "convert"), "ordinary text\n")
    git(target.root, "add", "-A")
    git(target.root, "commit", "-q", "-m", "Rename link and restore regular file")
    git(target.root, "push", "-q", "origin", "main")
    expect(await creator.host.rebase(false)).toMatchObject({ outcome: "rebased" })
    for (const peer of [creator, joiner]) {
      await waitFor(async () => await peer.read("convert") === "ordinary text\n", "Git symlink-to-text change")
      await waitFor(async () => await fs.readlink(path.join(peer.root, "renamed-link")).catch(() => null) === "../outside", "Git symlink rename")
      expect(peer.host.replica.tree.listLiveEntries().find((entry) => entry.path === "renamed-link")?.fileId).toBe(originalLink)
      await waitFor(async () => await fs.lstat(path.join(peer.root, "added-link")).catch(() => null) === null, "old link path removed")
    }
    await fs.unlink(path.join(target.root, "renamed-link"))
    await fs.symlink("../remote-target", path.join(target.root, "renamed-link"))
    git(target.root, "add", "-A")
    git(target.root, "commit", "-q", "-m", "Retarget link")
    git(target.root, "push", "-q", "origin", "main")
    const before = remoteHead(repos.remote)
    const begin = creator.host.roomClient.beginIntegration.bind(creator.host.roomClient)
    let raced = false
    const barrier = vi.spyOn(creator.host.roomClient, "beginIntegration").mockImplementation(async (generation, id) => {
      if (!raced) {
        raced = true
        await joiner.symlink("renamed-link", "../peer-target")
        await waitFor(() => creator.host.replica.tree.listLiveEntries().find((entry) => entry.path === "renamed-link")?.symlinkTarget === "../peer-target", "peer retarget after Git merge preparation")
      }
      return begin(generation, id)
    })
    try { await expect(creator.host.rebase(false)).rejects.toMatchObject({ code: "REBASE_LIVE_CONFLICT" }) }
    finally { barrier.mockRestore() }
    expect(remoteHead(repos.remote)).toBe(before)
    await waitFor(async () => await fs.readlink(path.join(creator.root, "renamed-link")) === "../peer-target", "peer link survives refused adoption")
    const { journals } = await creator.host.manageRebaseRecovery({ action: "list" })
    expect(journals).toHaveLength(1)
    await joiner.symlink("renamed-link", "../outside")
    await waitFor(() => creator.host.replica.tree.listLiveEntries().find((entry) => entry.path === "renamed-link")?.symlinkTarget === "../outside", "restore reviewed basis before retry")
    await creator.host.manageRebaseRecovery({ action: "apply", recoveryId: journals![0]!.id })
    for (const peer of [creator, joiner]) {
      await waitFor(async () => await fs.readlink(path.join(peer.root, "renamed-link")) === "../remote-target", "retried symlink target adoption")
      expect(peer.host.replica.tree.listLiveEntries().find((entry) => entry.path === "renamed-link")?.fileId).toBe(originalLink)
    }
  })

  it("shares literal symlinks through import, live retargeting and persistent restart", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "base\n" })
    const outside = path.join(await tempFolder("outside-link"), "private.txt")
    await fs.writeFile(outside, "not collaboration content")
    await fs.symlink(outside, path.join(repos.creatorRoot, "link"))
    const { creator, joiner, roomKey } = await startPair(room, repos, ON_REQUEST)
    const targetAt = (peer: Peer) => fs.readlink(path.join(peer.root, "link")).catch(() => null)
    await waitFor(async () => await targetAt(joiner) === outside, "literal external symlink import")
    const original = creator.host.replica.tree.listLiveEntries().find((entry) => entry.path === "link")!
    expect(original.kind).toBe("symlink")
    await joiner.symlink("link", "missing-relative-target")
    await waitFor(async () => await targetAt(creator) === "missing-relative-target", "live dangling symlink target")
    expect(creator.host.replica.tree.listLiveEntries().find((entry) => entry.path === "link")?.fileId).toBe(original.fileId)
    await creator.host.checkpointNow()
    expect(git(repos.remote, "show", `${remoteHead(repos.remote)}:link`)).toBe("missing-relative-target")
    expect(git(repos.remote, "ls-tree", remoteHead(repos.remote), "link")).toMatch(/^120000 /)
    await joiner.host.stop()
    joiner.host.queue.db.close()
    await fs.unlink(path.join(joiner.root, "link"))
    await fs.symlink("another-missing-target", path.join(joiner.root, "link"))
    const restarted = await createPeer(room, "joiner", roomKey, { root: repos.joinerRoot, clientId: "c_b", timing: ON_REQUEST })
    await startLive(restarted, "peer with offline symlink change")
    await waitFor(async () => await targetAt(creator) === "another-missing-target", "offline symlink target")
    expect(await fs.readFile(outside, "utf8")).toBe("not collaboration content")
    expect(creator.host.replica.tree.listLiveEntries().map((entry) => entry.path)).toEqual(expect.not.arrayContaining(["private.txt"]))
  })

  it("adopts executable-bit-only rebase changes without replacing binary revisions", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "run.sh": "echo hello\n", "asset.bin": Buffer.from([0, 1, 255]) })
    const target = await createTargetBranch(repos.remote, repos.creatorRoot, { "target.md": "target\n" })
    await fs.chmod(path.join(target.root, "run.sh"), 0o755)
    await fs.chmod(path.join(target.root, "asset.bin"), 0o755)
    git(target.root, "add", "-A")
    git(target.root, "commit", "-q", "-m", "Make files executable")
    git(target.root, "push", "-q", "origin", "main")
    const { creator, joiner, roomKey } = await startPair(room, repos, ON_REQUEST, "main")
    await creator.host.checkpointNow()
    const upload = vi.spyOn(creator.host.binaryObjects, "upload")
    try { expect(await creator.host.rebase(false)).toMatchObject({ outcome: "rebased" }); expect(upload).not.toHaveBeenCalled() }
    finally { upload.mockRestore() }
    for (const peer of [creator, joiner]) {
      for (const name of ["run.sh", "asset.bin"]) {
        await waitFor(async () => ((await fs.stat(path.join(peer.root, name))).mode & 0o111) === 0o111, "executable mode on each peer")
      }
      expect(await peer.read("run.sh")).toBe("echo hello\n")
    }
    const saved = remoteHead(repos.remote)
    expect(git(repos.remote, "ls-tree", saved, "run.sh", "asset.bin").split("\n").every((line) => line.startsWith("100755"))).toBe(true)
    const modeUpload = vi.spyOn(joiner.host.binaryObjects, "upload")
    try {
      for (const [name, content] of [["run.sh", "echo hello\n"], ["asset.bin", Buffer.from([0, 1, 255])]] as const) {
        await fs.chmod(path.join(joiner.root, name), 0o644)
        await joiner.write(name, content)
        await waitFor(async () => ((await fs.stat(path.join(creator.root, name))).mode & 0o111) === 0, "local chmod reaches peer")
      }
      expect(modeUpload).not.toHaveBeenCalled()
      await creator.host.checkpointNow()
      expect(git(repos.remote, "ls-tree", remoteHead(repos.remote), "run.sh", "asset.bin").split("\n").every((line) => line.startsWith("100644"))).toBe(true)
    } finally { modeUpload.mockRestore() }
    await joiner.host.stop()
    joiner.host.queue.db.close()
    for (const name of ["run.sh", "asset.bin"]) {
      const beforeMode = await fs.stat(path.join(joiner.root, name))
      await fs.chmod(path.join(joiner.root, name), 0o755)
      expect((await fs.stat(path.join(joiner.root, name))).mtimeMs).toBe(beforeMode.mtimeMs)
    }
    const restarted = await createPeer(room, "joiner", roomKey, { root: repos.joinerRoot, clientId: "c_b", timing: ON_REQUEST, targetBranch: "main" })
    const coldUpload = vi.spyOn(restarted.host.binaryObjects, "upload")
    try {
      await startLive(restarted, "the peer with offline chmod changes")
      for (const name of ["run.sh", "asset.bin"]) await waitFor(async () => ((await fs.stat(path.join(creator.root, name))).mode & 0o111) === 0o111, "offline chmod reaches creator")
      expect(coldUpload).not.toHaveBeenCalled()
      await creator.host.checkpointNow()
      expect(git(repos.remote, "ls-tree", remoteHead(repos.remote), "run.sh", "asset.bin").split("\n").every((line) => line.startsWith("100755"))).toBe(true)
    } finally { coldUpload.mockRestore() }
  })

  it("retains the whole live change set on failed binary rebase upload and retries exact bytes", async () => {
    const room = newRoom()
    const old = Buffer.from([0, 1, 255])
    const next = Buffer.from([0, 7, 254, 9])
    const added = Buffer.from([0, 3, 128])
    const repos = await setUpRepositories({ "notes.md": "base\n", "obsolete.md": "old text\n", "asset.bin": old })
    const target = await createTargetBranch(repos.remote, repos.creatorRoot, { "asset.bin": next, "new.bin": added, "target.md": "target\n" })
    await fs.rm(path.join(target.root, "obsolete.md"))
    git(target.root, "add", "-A")
    git(target.root, "commit", "-q", "-m", "Delete obsolete file")
    git(target.root, "push", "-q", "origin", "main")
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")
    await creator.host.checkpointNow()
    const before = remoteHead(repos.remote)
    const objects = creator.host.binaryObjects
    if (!objects.uploadFrom) throw new Error("test requires a streaming binary object store")
    const streamUpload = objects.uploadFrom.bind(objects)
    let uploads = 0
    const failure = vi.spyOn(objects, "uploadFrom").mockImplementation(async (source) => {
      if (++uploads === 2) throw new Error("interrupted binary upload")
      return streamUpload(source)
    })
    try { await expect(creator.host.rebase(false)).rejects.toThrow(/interrupted binary upload/) }
    finally { failure.mockRestore() }
    expect(remoteHead(repos.remote)).toBe(before)
    expect(await fs.readFile(path.join(creator.root, "asset.bin"))).toEqual(old)
    expect(await creator.read("target.md")).toBeNull()
    const { journals } = await creator.host.manageRebaseRecovery({ action: "list" })
    expect(journals).toHaveLength(1)
    await joiner.write("obsolete.md", "edited while rebase waited\n")
    await waitFor(async () => await creator.read("obsolete.md") === "edited while rebase waited\n", "delete/edit overlap")
    await expect(creator.host.manageRebaseRecovery({ action: "apply", recoveryId: journals![0].id })).rejects.toMatchObject({ code: "REBASE_LIVE_CONFLICT" })
    expect(await creator.read("obsolete.md")).toBe("edited while rebase waited\n")
    expect(remoteHead(repos.remote)).toBe(before)
    await joiner.write("obsolete.md", "old text\n")
    await waitFor(async () => await creator.read("obsolete.md") === "old text\n", "restored deletion basis")
    const concurrent = Buffer.from([0, 22, 33])
    await joiner.write("asset.bin", concurrent)
    await waitFor(async () => (await fs.readFile(path.join(creator.root, "asset.bin"))).equals(concurrent), "concurrent binary edit")
    await expect(creator.host.manageRebaseRecovery({ action: "apply", recoveryId: journals![0].id })).rejects.toMatchObject({ code: "REBASE_LIVE_CONFLICT" })
    expect(remoteHead(repos.remote)).toBe(before)
    expect(await fs.readFile(path.join(creator.root, "asset.bin"))).toEqual(concurrent)
    await joiner.write("asset.bin", old)
    await waitFor(async () => (await fs.readFile(path.join(creator.root, "asset.bin"))).equals(old), "restored binary basis")
    expect(await creator.host.manageRebaseRecovery({ action: "apply", recoveryId: journals![0].id })).toMatchObject({ result: { outcome: "rebased" } })
    for (const peer of [creator, joiner]) {
      await waitFor(async () => (await fs.readFile(path.join(peer.root, "asset.bin"))).equals(next), "rebased binary bytes")
      await waitFor(async () => (await fs.readFile(path.join(peer.root, "new.bin")).catch(() => Buffer.alloc(0))).equals(added), "added binary bytes")
      expect(await peer.read("target.md")).toBe("target\n")
      await waitFor(async () => await peer.read("obsolete.md") === null, "adopted deletion")
    }
    const saved = remoteHead(repos.remote)
    expect(execFileSync("git", ["show", `${saved}:asset.bin`], { cwd: repos.remote })).toEqual(next)
    expect(execFileSync("git", ["show", `${saved}:new.bin`], { cwd: repos.remote })).toEqual(added)
  })

  it("adopts a multi-chunk external binary without buffering Git blobs", async () => {
    const room = newRoom()
    // One full 4 MiB chunk plus a tail: forces multi-range streaming if any
    // code path buffers whole blobs, the failure this test guards against.
    const big = randomBytes(4 * 1024 * 1024 + 512)
    const repos = await setUpRepositories({ "notes.md": "base\n" })
    await createTargetBranch(repos.remote, repos.creatorRoot, { "big.bin": big })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")
    await creator.host.checkpointNow()
    const blobReads: string[][] = []
    const execute = vi.spyOn(GitProcess.prototype, "execute")
    const streams: unknown[][] = []
    const streamBlob = vi.spyOn(GitProcess.prototype, "streamBlob")
    try {
      const result = await creator.host.rebase(false)
      expect(result).toMatchObject({ outcome: "rebased" })
      for (const [args] of execute.mock.calls) {
        if (args[0] === "cat-file" && args[1] === "blob") blobReads.push(args)
      }
      expect(blobReads).toHaveLength(0)
      // Exactly two blob streams for the whole adoption: one hash pass plus
      // one single-pass staging stream. Per-chunk cat-file emulation would
      // show one spawn per retained 4 MiB chunk plus the hash pass.
      for (const call of streamBlob.mock.calls) streams.push(call)
      expect(streams).toHaveLength(2)
    } finally {
      execute.mockRestore()
      streamBlob.mockRestore()
    }
    for (const peer of [creator, joiner]) {
      await waitFor(async () => (await fs.readFile(path.join(peer.root, "big.bin")).catch(() => Buffer.alloc(0))).equals(big), "rebased large binary bytes")
    }
    const saved = remoteHead(repos.remote)
    expect(execFileSync("git", ["show", `${saved}:big.bin`], { cwd: repos.remote, maxBuffer: 16 * 1024 * 1024 }).equals(big)).toBe(true)
  })

  it("adopts an external binary deletion without GIT_UNREADABLE", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "base\n", "asset.bin": Buffer.from([0, 1, 255]) })
    git(repos.creatorRoot, "push", "-q", "origin", `${BRANCH}:refs/heads/main`)
    const targetParent = await tempFolder("target-main")
    const targetRoot = path.join(targetParent, "checkout")
    git(targetParent, "clone", "-q", "-b", "main", repos.remote, targetRoot)
    await fs.rm(path.join(targetRoot, "asset.bin"))
    git(targetRoot, "add", "-A")
    git(targetRoot, "commit", "-q", "-m", "Delete asset")
    git(targetRoot, "push", "-q", "origin", "main")
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")
    await creator.host.checkpointNow()
    const result = await creator.host.rebase(false)
    expect(result).toMatchObject({ outcome: "rebased" })
    for (const peer of [creator, joiner]) {
      await waitFor(async () => await peer.read("asset.bin") === null, "adopted binary deletion")
      expect(peer.host.replica.tree.listLiveEntries().some((entry) => entry.path === "asset.bin")).toBe(false)
      expect(fs.access(path.join(peer.root, "asset.bin")).then(() => false, () => true)).resolves.toBe(true)
    }
  })

  it("rebases the live session onto its target only when explicitly requested", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "base\n" })
    const target = await createTargetBranch(repos.remote, repos.creatorRoot, { "from-main.md": "main\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")

    await joiner.write("notes.md", "base\nsession\n")
    await waitFor(async () => (await creator.read("notes.md")) === "base\nsession\n", "the creator to get the session edit")
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })
    const before = remoteHead(repos.remote)

    const result = await creator.host.rebase(false)
    expect(result).toMatchObject({ outcome: "rebased" })
    const rebased = remoteHead(repos.remote)
    expect(rebased).not.toBe(before)
    expect(result.commitOid).toBe(rebased)
    expect(git(repos.remote, "rev-parse", `${rebased}^`)).toBe(target.head)
    expect(git(repos.remote, "show", `${rebased}:from-main.md`)).toBe("main")
    expect(git(repos.remote, "show", `${rebased}:notes.md`)).toBe("base\nsession")
    expect(git(repos.remote, "merge-base", before, rebased)).toBe(repos.initial)

    for (const [peer, label] of [
      [creator, "creator"],
      [joiner, "joiner"],
    ] as const) {
      await waitFor(
        async () =>
          (await peer.read("from-main.md")) === "main\n" &&
          (await peer.read("notes.md")) === "base\nsession\n" &&
          git(peer.root, "rev-parse", "HEAD") === rebased,
        `the ${label} to adopt the rebased checkpoint`,
        GIT_WAIT_MS,
      )
    }
  })

  it("reports rebase conflicts without changing the live session or remote branch", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\ntwo\n" })
    await createTargetBranch(repos.remote, repos.creatorRoot, { "notes.md": "one\ntwo from main\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")

    await joiner.write("notes.md", "one\ntwo from session\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo from session\n", "the creator to get the session edit")
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })
    const before = remoteHead(repos.remote)

    const result = await creator.host.rebase(false)
    expect(result).toMatchObject({ outcome: "conflicts", conflictingPaths: ["notes.md"], recoveryId: expect.any(String) })
    const common = git(creator.root, "rev-parse", "--path-format=absolute", "--git-common-dir")
    await creator.host.stop()
    const journal = await RebaseJournal.open(common, TEST_PUBLIC_SESSION_ID, result.recoveryId!)
    expect(journal.record).toMatchObject({ state: "conflicted", from: before })
    expect(journal.record.variants.map((variant) => variant.stage)).toEqual([1, 2, 3])
    expect(journal.record.variants.map((variant) => git(creator.root, "cat-file", "blob", variant.oid)))
      .toEqual(["one\ntwo", "one\ntwo from main", "one\ntwo from session"])
    // Resolve through the controlled service after shutdown, retaining real Git rebase semantics.
    const resolutionGit = new GitService()
    const resolver = new IsolatedRebaseResolution(journal, resolutionGit)
    const review = await resolver.review()
    const choice = { path: "notes.md", kind: "content" as const, content: Buffer.from("one\ntwo resolved\n"), executable: false }
    await expect(resolver.resolve("stale", [choice])).rejects.toThrow(/changed/)
    await expect(resolver.resolve(review.fingerprint, [{ ...choice, path: "../escape" }])).rejects.toThrow(/exactly once/)
    const execute = resolutionGit.process.execute.bind(resolutionGit.process)
    const interrupted = vi.spyOn(resolutionGit.process, "execute").mockImplementation(async (args, options) => {
      if (args.includes("checkout-index")) throw new Error("simulated crash after index staging")
      return execute(args, options)
    })
    await expect(resolver.resolve(review.fingerprint, [choice])).rejects.toThrow(/simulated crash/)
    interrupted.mockRestore()
    const stagedJournal = await RebaseJournal.open(common, TEST_PUBLIC_SESSION_ID, result.recoveryId!)
    expect(stagedJournal.record.pendingResolution?.choices).toHaveLength(1)
    const resumedResolver = new IsolatedRebaseResolution(stagedJournal, new GitService())
    const resolution = await resumedResolver.continue()
    expect(resolution.state).toBe("computed")
    if (resolution.state !== "computed") throw new Error("Expected a resolved rebase")
    const computed = resolution.commitOid
    expect(git(journal.worktree, "show", `${computed}:notes.md`)).toBe("one\ntwo resolved")
    expect(git(journal.worktree, "rev-parse", `${computed}^`)).toBe(journal.record.onto)
    expect((await RebaseJournal.open(common, TEST_PUBLIC_SESSION_ID, result.recoveryId!)).record.resultOid).toBe(computed)
    const reopened = new IsolatedRebaseResolution(await RebaseJournal.open(common, TEST_PUBLIC_SESSION_ID, result.recoveryId!), new GitService())
    expect(await reopened.continue()).toEqual({ state: "computed", commitOid: computed })
    await expect(RebaseJournal.open(common, TEST_PUBLIC_SESSION_ID, "../escape")).rejects.toThrow(/Invalid rebase recovery ID/)
    expect(remoteHead(repos.remote)).toBe(before)
    expect(await creator.read("notes.md")).toBe("one\ntwo from session\n")
    expect(await joiner.read("notes.md")).toBe("one\ntwo from session\n")
    expect(await creator.read("notes.md")).not.toContain("<<<<<<<")
  })

  it("resolves rebase conflicts in isolation and applies the reviewed result", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\ntwo\n" })
    const target = await createTargetBranch(repos.remote, repos.creatorRoot, { "notes.md": "one\ntwo from main\n", "from-main.md": "main\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")
    await joiner.write("notes.md", "one\ntwo from session\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo from session\n", "session edit")
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })
    const before = remoteHead(repos.remote)
    const result = await creator.host.rebase(true)
    expect(result).toMatchObject({ outcome: "conflicts", recoveryId: expect.any(String) })
    const request = { recoveryId: result.recoveryId! }
    const { review } = await creator.host.manageRebaseRecovery({ action: "review", ...request })
    expect(review?.variants.map((variant) => variant.text)).toEqual(["one\ntwo\n", "one\ntwo from main\n", "one\ntwo from session\n"])
    expect(await creator.host.manageRebaseRecovery({ action: "resolve", ...request, fingerprint: review!.fingerprint,
      choices: [{ path: "notes.md", kind: "content", text: "one\ntwo from session and main\n", executable: false }] }))
      .toMatchObject({ review: { state: "computed" } })
    expect(remoteHead(repos.remote)).toBe(before)
    expect(await creator.read("notes.md")).toBe("one\ntwo from session\n")
    expect(await joiner.read("notes.md")).toBe("one\ntwo from session\n")
    await joiner.write("notes.md", "new overlapping live edit\n")
    await waitFor(async () => (await creator.read("notes.md")) === "new overlapping live edit\n", "concurrent live edit")
    await expect(creator.host.manageRebaseRecovery({ action: "apply", ...request })).rejects.toMatchObject({ code: "REBASE_LIVE_CONFLICT" })
    expect(await creator.read("notes.md")).toBe("new overlapping live edit\n")
    expect(remoteHead(repos.remote)).toBe(before)
    await joiner.write("notes.md", "one\ntwo from session\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo from session\n", "restored live basis")
    expect(await creator.host.manageRebaseRecovery({ action: "apply", ...request })).toMatchObject({ result: { outcome: "rebased" } })
    await waitFor(async () => (await joiner.read("notes.md")) === "one\ntwo from session and main\n", "resolved rebase adoption")
    const rebased = remoteHead(repos.remote)
    expect(rebased).not.toBe(before)
    expect(git(repos.remote, "rev-parse", `${rebased}^`)).toBe(target.head)
    expect(git(repos.remote, "show", `${rebased}:from-main.md`)).toBe("main")
    expect((await creator.host.manageRebaseRecovery({ action: "list" })).journals).toEqual([])
  })

  it("holds ordinary saves across leader handoff and room eviction during interrupted rebase adoption", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "base\n" })
    await createTargetBranch(repos.remote, repos.creatorRoot, { "notes.md": "target\n" })
    const { creator, joiner, roomKey } = await startPair(room, repos, ON_REQUEST, "main")
    await joiner.write("notes.md", "session\n")
    await waitFor(async () => await creator.read("notes.md") === "session\n", "session edit")
    await creator.host.checkpointNow()
    const before = remoteHead(repos.remote)
    const { recoveryId } = await creator.host.rebase(false)
    const { review } = await creator.host.manageRebaseRecovery({ action: "review", recoveryId })
    await creator.host.manageRebaseRecovery({ action: "resolve", recoveryId, fingerprint: review!.fingerprint,
      choices: [{ path: "notes.md", kind: "content", text: "resolved\n", executable: false }] })
    const crash = vi.spyOn(RebaseJournal.prototype, "markAdopted").mockRejectedValueOnce(new Error("crash after live adoption"))
    try { await expect(creator.host.manageRebaseRecovery({ action: "apply", recoveryId })).rejects.toThrow(/crash after live adoption/) }
    finally { crash.mockRestore() }
    await waitFor(async () => await creator.read("notes.md") === "resolved\n", "adopted local bytes")
    await expect(creator.host.checkpointNow()).rejects.toMatchObject({ code: "REBASE_RECOVERY_REQUIRED" })
    expect(remoteHead(repos.remote)).toBe(before)
    const adoption = creator.host.roomClient.autoGitState?.rebaseAdoption
    expect(adoption?.id).toBe(recoveryId)
    await creator.host.stop()
    await waitFor(() => autoGitOf(joiner)?.isLeader === true, "replacement leader", GIT_WAIT_MS)
    room.evict()
    await expect(joiner.host.checkpointNow()).rejects.toMatchObject({ code: "REBASE_RECOVERY_REQUIRED" })
    const generation = joiner.host.roomClient.autoGitState!.lease!.generation
    await expect(joiner.host.roomClient.requestBarrier(generation)).rejects.toMatchObject({ code: "REBASE_RECOVERY_REQUIRED" })
    await expect(joiner.host.roomClient.requestBarrier(generation, undefined, recoveryId)).rejects.toMatchObject({ code: "REBASE_RECOVERY_REQUIRED" })
    await expect(joiner.host.roomClient.beginRebaseAdoption(generation, { id: recoveryId!, from: before, resultOid: adoption!.resultOid })).rejects.toMatchObject({ code: "REBASE_RECOVERY_REQUIRED" })
    expect(remoteHead(repos.remote)).toBe(before)
    await joiner.host.stop()
    const restored = await createPeer(room, "creator", roomKey, { root: repos.creatorRoot, clientId: "c_a", timing: ON_REQUEST, targetBranch: "main", sessionRole: "project_manager" })
    await startLive(restored, "the restarted adoption owner")
    await waitFor(() => autoGitOf(restored)?.isLeader === true, "restored leadership", GIT_WAIT_MS)
    await expect(restored.host.checkpointNow()).rejects.toMatchObject({ code: "REBASE_RECOVERY_REQUIRED" })
    expect((await restored.host.manageRebaseRecovery({ action: "list" })).journals).toEqual([expect.objectContaining({ id: recoveryId, state: "adopting" })])
    await expect(restored.host.manageRebaseRecovery({ action: "cancel", recoveryId })).rejects.toThrow(/begun adoption/)
    await expect(restored.host.manageRebaseRecovery({ action: "continue", recoveryId })).rejects.toThrow(/begun adoption/)
    const publishCrash = vi.spyOn(restored.host.roomClient, "publishCheckpoint").mockRejectedValueOnce(new Error("crash after Git push"))
    try { await expect(restored.host.manageRebaseRecovery({ action: "apply", recoveryId })).rejects.toThrow(/crash after Git push/) }
    finally { publishCrash.mockRestore() }
    const pushedHead = remoteHead(repos.remote)
    expect(pushedHead).not.toBe(before)
    expect(checkpointOf(restored)).toBe(before)
    await restored.host.stop()
    room.evict()
    const pushed = await createPeer(room, "creator", roomKey, { root: repos.creatorRoot, clientId: "c_a", timing: ON_REQUEST, targetBranch: "main", sessionRole: "project_manager" })
    await startLive(pushed, "the restarted push owner")
    await waitFor(() => autoGitOf(pushed)?.isLeader === true, "push owner leadership", GIT_WAIT_MS)
    const finishCrash = vi.spyOn(RebaseJournal.prototype, "finish").mockRejectedValueOnce(new Error("crash after published checkpoint"))
    try { await expect(pushed.host.manageRebaseRecovery({ action: "apply", recoveryId })).rejects.toThrow(/crash after published checkpoint/) }
    finally { finishCrash.mockRestore() }
    const publishedHead = remoteHead(repos.remote)
    expect(publishedHead).toBe(pushedHead)
    await pushed.host.stop()
    room.evict()
    const successor = await createPeer(room, "joiner", roomKey, { root: repos.joinerRoot, clientId: "c_b", timing: ON_REQUEST, targetBranch: "main" })
    await startLive(successor, "the next checkpoint author")
    await waitFor(() => autoGitOf(successor)?.isLeader === true, "successor leadership", GIT_WAIT_MS)
    expect(await successor.host.roomClient.getRebaseReceipt(recoveryId!)).toBeNull()
    await successor.write("later.md", "saved after the rebase\n")
    await successor.host.checkpointNow()
    const laterHead = remoteHead(repos.remote)
    expect(laterHead).not.toBe(publishedHead)
    expect(successor.host.roomClient.autoGitState?.checkpoint?.rebaseAdoptionId).toBeUndefined()
    await successor.host.stop()
    room.evict()
    const acknowledged = await createPeer(room, "creator", roomKey, { root: repos.creatorRoot, clientId: "c_a", timing: ON_REQUEST, targetBranch: "main", sessionRole: "project_manager" })
    await startLive(acknowledged, "the restarted checkpoint owner")
    await waitFor(() => autoGitOf(acknowledged)?.isLeader === true, "checkpoint owner leadership", GIT_WAIT_MS)
    expect(await acknowledged.host.manageRebaseRecovery({ action: "apply", recoveryId })).toMatchObject({ result: { outcome: "rebased", commitOid: publishedHead } })
    expect(remoteHead(repos.remote)).toBe(laterHead)
    expect((await acknowledged.host.manageRebaseRecovery({ action: "list" })).journals).toEqual([])
    expect(git(repos.remote, "show", `${remoteHead(repos.remote)}:notes.md`)).toBe("resolved")
    await waitFor(() => acknowledged.host.roomClient.autoGitState?.rebaseAdoption === null, "adoption fence cleared by checkpoint")
  })

  it("refuses a pending rebase rewrite when the remote session branch moves", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\ntwo\n" })
    await createTargetBranch(repos.remote, repos.creatorRoot, { "notes.md": "one\ntwo from main\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")

    await joiner.write("notes.md", "one\ntwo from session\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo from session\n", "the creator to get the session edit")
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })
    const rebasing = await creator.host.rebase(true)
    expect(rebasing.outcome).toBe("conflicts")
    const recoveryId = rebasing.recoveryId!
    const { review } = await creator.host.manageRebaseRecovery({ action: "review", recoveryId })
    await creator.host.manageRebaseRecovery({ action: "resolve", recoveryId, fingerprint: review!.fingerprint,
      choices: [{ path: "notes.md", kind: "content", text: "resolved\n", executable: false }] })
    const outside = await pushFromOutside(repos.remote, { "outside.md": "keep me\n" })
    await expect(creator.host.manageRebaseRecovery({ action: "apply", recoveryId })).rejects.toMatchObject({ code: "REMOTE_CHANGED" })

    expect(remoteHead(repos.remote)).toBe(outside)
    expect(git(repos.remote, "show", `${outside}:outside.md`)).toBe("keep me")
  })

  it("refuses a reviewed rebase apply when the target branch moves", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\ntwo\n" })
    await createTargetBranch(repos.remote, repos.creatorRoot, { "notes.md": "one\ntwo from main\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")

    await joiner.write("notes.md", "one\ntwo from session\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo from session\n", "the creator to get the session edit")
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })
    const rebasing = await creator.host.rebase(true)
    expect(rebasing.outcome).toBe("conflicts")
    const recoveryId = rebasing.recoveryId!
    const { review } = await creator.host.manageRebaseRecovery({ action: "review", recoveryId })
    await creator.host.manageRebaseRecovery({ action: "resolve", recoveryId, fingerprint: review!.fingerprint,
      choices: [{ path: "notes.md", kind: "content", text: "resolved\n", executable: false }] })
    // Main advances after the review: the computed result is stale.
    const mainClone = await tempFolder("main-advance")
    git(mainClone, "clone", "-q", "-b", "main", repos.remote, ".")
    await writeFiles(mainClone, { "notes.md": "one\ntwo from main\nv2\n" })
    git(mainClone, "add", "-A")
    git(mainClone, "commit", "-q", "-m", "Advance main")
    git(mainClone, "push", "-q", "origin", "main")
    await expect(creator.host.manageRebaseRecovery({ action: "apply", recoveryId })).rejects.toMatchObject({ code: "TARGET_CHANGED" })

    // Nothing was pushed or adopted from the stale computation.
    expect(await creator.read("notes.md")).toBe("one\ntwo from session\n")
  })

  it("rewrites the session branch only through force-with-lease", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "base\n" })
    const target = await createTargetBranch(repos.remote, repos.creatorRoot, { "from-main.md": "main\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")

    await joiner.write("notes.md", "base\nsession\n")
    await waitFor(async () => (await creator.read("notes.md")) === "base\nsession\n", "the creator to get the session edit")
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })
    const pushes: string[][] = []
    const execute = vi.spyOn(GitProcess.prototype, "execute")
    try {
      const result = await creator.host.rebase(false)
      expect(result).toMatchObject({ outcome: "rebased" })
      for (const [args] of execute.mock.calls) {
        if (args[0] === "push") pushes.push(args)
      }
    } finally {
      execute.mockRestore()
    }
    expect(pushes.length).toBeGreaterThan(0)
    for (const args of pushes) {
      expect(args.some((entry) => entry.startsWith("--force-with-lease="))).toBe(true)
      expect(args).not.toContain("--force")
    }
    const rebased = remoteHead(repos.remote)
    expect(git(repos.remote, "show", `${rebased}:notes.md`)).toBe("base\nsession")
    expect(git(repos.remote, "rev-parse", `${rebased}^`)).toBe(target.head)
  })

  it("adopts external Git result through the production host with full filesystem semantics", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "base\n", "remove.txt": "delete me\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST)

    // Simulate external terminal Git operations: edit text, add binary, add symlink, chmod +x, delete file
    await fs.writeFile(path.join(creator.root, "notes.md"), "base\nterminal edit\n")
    const binPayload = Buffer.from([0, 1, 2, 3, 4, 255])
    await fs.writeFile(path.join(creator.root, "added.bin"), binPayload)
    await fs.symlink("notes.md", path.join(creator.root, "link.lnk"))
    await fs.chmod(path.join(creator.root, "notes.md"), 0o755)
    await fs.rm(path.join(creator.root, "remove.txt"))

    const res = await creator.host.adoptGitResult()
    expect(res.imported).toBe(true)

    // Joiner peer converges to all adopted changes across kinds
    await waitFor(async () => (await joiner.read("notes.md")) === "base\nterminal edit\n", "text adopted")
    await waitFor(async () => (await fs.readFile(path.join(joiner.root, "added.bin")).catch(() => null))?.equals(binPayload) ?? false, "binary adopted")
    await waitFor(async () => (await fs.readlink(path.join(joiner.root, "link.lnk")).catch(() => null)) === "notes.md", "symlink adopted")
    await waitFor(async () => ((await fs.stat(path.join(joiner.root, "notes.md"))).mode & 0o111) === 0o111, "chmod adopted")
    await waitFor(async () => (await joiner.read("remove.txt")) === null, "deletion adopted")
  })

  it("synchronizes external fast-forward commits from GitHub through the production host", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "base\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST)
    const outside = await pushFromOutside(repos.remote, { "from_github.txt": "external commit\n" })

    const res = await creator.host.syncFromGitHub()
    expect(res.status).toBe("fast_forward_integrated")
    expect(res.remoteOid).toBe(outside)

    await waitFor(async () => (await creator.read("from_github.txt")) === "external commit\n", "creator integrated")
    await waitFor(async () => (await joiner.read("from_github.txt")) === "external commit\n", "joiner integrated")
  })

  it("invalidates merge review when a peer edits after preview and requires fresh re-preview", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "base\n" })
    const target = await createTargetBranch(repos.remote, repos.creatorRoot, { "from-main.md": "main\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")

    await creator.write("notes.md", "base\nsession\n")
    await waitFor(async () => (await joiner.read("notes.md")) === "base\nsession\n", "joiner gets edit")
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })

    // Step 1: preview
    const preview1 = await creator.host.previewMerge()
    expect(preview1).toMatchObject({ clean: true, unsavedChanges: 0, targetOid: target.head })

    // Step 2: peer edits afterward
    await joiner.write("notes.md", "base\nsession\npeer edit\n")
    await waitFor(async () => (await creator.read("notes.md")) === "base\nsession\npeer edit\n", "creator gets peer edit")

    // Step 3: attempt merge with old reviewed checkpoint
    const staleMerge = await creator.host.merge("merge", preview1.checkpointOid, preview1.targetOid)
    expect(staleMerge.outcome).toBe("moved")
    // Target is NOT mutated
    expect(git(repos.remote, "rev-parse", "main")).toBe(target.head)

    // Step 4: re-preview
    const preview2 = await creator.host.previewMerge()
    expect(preview2.checkpointOid).not.toBe(preview1.checkpointOid)
    expect(preview2).toMatchObject({ clean: true, unsavedChanges: 0, targetOid: target.head })

    // Step 5: merge with fresh checkpoint
    const mergeResult = await creator.host.merge("merge", preview2.checkpointOid, preview2.targetOid)
    expect(mergeResult).toMatchObject({ outcome: "merged" })

    // Step 6: assert new edit is present in target branch
    expect(git(repos.remote, "show", "main:notes.md")).toBe("base\nsession\npeer edit")
  })
})
