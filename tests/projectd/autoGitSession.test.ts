import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import type { AutoGitTiming } from "../../apps/projectd/src/autogit/AutoGitAgent"
import { CollaborationSessionHost } from "../../apps/projectd/src/collaboration/CollaborationSessionHost"
import type { FileEventSource, NativeFSEventItem } from "../../apps/projectd/src/filesystem/FSEventsClient"
import { GitService } from "../../apps/projectd/src/git/GitService"
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
  write(relativePath: string, content: string): Promise<void>
  remove(relativePath: string): Promise<void>
  read(relativePath: string): Promise<string | null>
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

function newRoom(options: { leaseMs?: number } = {}): RoomHost {
  const room = new RoomHost(worker, options)
  cleanups.push(() => room.dispose())
  return room
}

async function createPeer(
  room: RoomHost,
  name: string,
  roomKey: Buffer,
  options: { root: string; clientId: string; timing?: Partial<AutoGitTiming>; shareEnvironmentFiles?: boolean },
): Promise<Peer> {
  const events = new ManualFileEvents()
  const token = await sessionTokenFor(worker, `principal_${name}`)()
  const host = new CollaborationSessionHost({
    publicSessionId: TEST_PUBLIC_SESSION_ID,
    workspaceId: `ws_${name}`,
    workspaceRoot: options.root,
    roomKey,
    ticket: { wsUrl: WS_URL, token, role: "developer" },
    db: new ProjectdDatabase(":memory:"),
    actor: { actorType: "user", principalId: `principal_${name}` },
    gitService: new GitService(),
    branchName: BRANCH,
    shareEnvironmentFiles: options.shareEnvironmentFiles,
    clientId: options.clientId,
    autoGitTiming: options.timing ?? FAST,
    gitPollMs: 20,
    connectorFactory: () => room.connector(),
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
    read: (relativePath) => fs.readFile(path.join(options.root, relativePath), "utf8").catch(() => null),
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
async function startPair(room: RoomHost, repos: { creatorRoot: string; joinerRoot: string }, timing = FAST) {
  const roomKey = randomBytes(32)
  const creator = await createPeer(room, "creator", roomKey, { root: repos.creatorRoot, clientId: "c_a", timing })
  await startLive(creator, "the creator")
  await waitFor(() => autoGitOf(creator)?.state === "leader", "the creator to lead", GIT_WAIT_MS)
  const joiner = await createPeer(room, "joiner", roomKey, { root: repos.joinerRoot, clientId: "c_b", timing })
  await startLive(joiner, "the joiner")
  await waitFor(() => autoGitOf(joiner)?.state === "follower", "the joiner to follow", GIT_WAIT_MS)
  return { creator, joiner }
}

beforeAll(async () => {
  worker = await loadSessionRoomWorker()
})

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe("AutoGit in projectd", () => {
  it("saves the session to its branch from the leader and moves every member's Git with it", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({
      "README.md": "# Demo\n",
      "src/app.ts": "export const answer = 42\n",
      "logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
    })
    const { creator, joiner } = await startPair(room, repos)

    await joiner.write("src/app.ts", "export const answer = 43\n")
    await waitFor(() => checkpointOf(creator) !== null, "the first checkpoint", GIT_WAIT_MS)
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

  it("saves when any member asks, and stops rather than overwrite commits made outside the session", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST)

    await joiner.write("notes.md", "one\ntwo\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo\n", "the creator to get the edit")
    expect(await joiner.host.checkpointNow()).toMatchObject({ outcome: "requested" })
    await waitFor(() => checkpointOf(joiner) !== null, "the leader to save on request", GIT_WAIT_MS)
    expect(git(repos.remote, "show", `${checkpointOf(joiner)}:notes.md`)).toBe("one\ntwo")

    // Someone pushes to the branch without the session.
    const outsideRoot = await tempFolder("outside")
    git(outsideRoot, "clone", "-q", "-b", BRANCH, repos.remote, ".")
    await writeFiles(outsideRoot, { "CHANGELOG.md": "outside\n" })
    git(outsideRoot, "add", "-A")
    git(outsideRoot, "commit", "-q", "-m", "Outside the session")
    git(outsideRoot, "push", "-q", "origin", BRANCH)
    const outside = remoteHead(repos.remote)

    await joiner.write("notes.md", "one\ntwo\nthree\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo\nthree\n", "the creator to get the next edit")
    await expect(creator.host.checkpointNow()).rejects.toMatchObject({ code: "REMOTE_CHANGED" })
    expect(remoteHead(repos.remote)).toBe(outside)
    expect(autoGitOf(creator)).toMatchObject({
      state: "blocked",
      detail: expect.stringContaining(`${BRANCH} changed on origin outside the session`),
    })
    await waitFor(() => autoGitOf(joiner)?.state === "blocked", "the joiner to hear why saving stopped")
    expect(autoGitOf(joiner)?.detail).toContain("rather than overwrite those commits")
  })

  it("hands saving to another member's Mac when the leader leaves", async () => {
    const room = newRoom({ leaseMs: 400 })
    const repos = await setUpRepositories({ "notes.md": "one\n" })
    const { creator, joiner } = await startPair(room, repos)

    await creator.host.stop()
    await waitFor(() => autoGitOf(joiner)?.state === "leader", "the joiner to take over", GIT_WAIT_MS)

    await joiner.write("notes.md", "one\nfrom the joiner\n")
    await waitFor(() => checkpointOf(joiner) !== null, "the new leader's checkpoint", GIT_WAIT_MS)
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
})
