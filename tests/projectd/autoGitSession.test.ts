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
  files: Record<string, string>,
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
  },
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
    targetBranch: options.targetBranch,
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

    expect(await creator.host.rebase(false)).toMatchObject({
      outcome: "conflicts",
      conflictingPaths: ["notes.md"],
    })
    expect(remoteHead(repos.remote)).toBe(before)
    expect(await creator.read("notes.md")).toBe("one\ntwo from session\n")
    expect(await joiner.read("notes.md")).toBe("one\ntwo from session\n")
    expect(await creator.read("notes.md")).not.toContain("<<<<<<<")
  })

  it("can carry explicit rebase conflicts into the live session and publish after resolution", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\ntwo\n" })
    const target = await createTargetBranch(repos.remote, repos.creatorRoot, {
      "notes.md": "one\ntwo from main\n",
      "from-main.md": "main\n",
    })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")

    await joiner.write("notes.md", "one\ntwo from session\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo from session\n", "the creator to get the session edit")
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })
    const before = remoteHead(repos.remote)

    expect(await creator.host.rebase(true)).toMatchObject({ outcome: "held" })
    expect(remoteHead(repos.remote)).toBe(before)
    await waitFor(
      async () =>
        (await joiner.read("notes.md"))?.includes("<<<<<<<") === true &&
        (await joiner.read("from-main.md")) === "main\n",
      "the rebase result to reach the joiner",
      GIT_WAIT_MS,
    )
    const conflicted = (await joiner.read("notes.md")) ?? ""
    expect(conflicted).toContain("two from session")
    expect(conflicted).toContain("two from main")
    expect(conflicted).toContain("=======")
    await waitFor(() => autoGitOf(joiner)?.detailCode === "CONFLICT_MARKERS", "the joiner to see the rebase hold", GIT_WAIT_MS)

    await joiner.write("notes.md", "one\ntwo from session and main\n")
    await waitFor(
      async () => (await creator.read("notes.md")) === "one\ntwo from session and main\n",
      "the creator to get the conflict resolution",
    )
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })
    const rebased = remoteHead(repos.remote)
    expect(rebased).not.toBe(before)
    expect(git(repos.remote, "rev-parse", `${rebased}^`)).toBe(target.head)
    expect(git(repos.remote, "show", `${rebased}:notes.md`)).toBe("one\ntwo from session and main")
    expect(git(repos.remote, "show", `${rebased}:from-main.md`)).toBe("main")
  })

  it("refuses a pending rebase rewrite when the remote session branch moves", async () => {
    const room = newRoom()
    const repos = await setUpRepositories({ "notes.md": "one\ntwo\n" })
    await createTargetBranch(repos.remote, repos.creatorRoot, { "notes.md": "one\ntwo from main\n" })
    const { creator, joiner } = await startPair(room, repos, ON_REQUEST, "main")

    await joiner.write("notes.md", "one\ntwo from session\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\ntwo from session\n", "the creator to get the session edit")
    expect(await creator.host.checkpointNow()).toMatchObject({ outcome: "saved" })
    expect(await creator.host.rebase(true)).toMatchObject({ outcome: "held" })

    const outside = await pushFromOutside(repos.remote, { "outside.md": "keep me\n" })
    await joiner.write("notes.md", "one\nresolved\n")
    await waitFor(async () => (await creator.read("notes.md")) === "one\nresolved\n", "the creator to get the resolution")
    await expect(creator.host.checkpointNow()).rejects.toMatchObject({ code: "REMOTE_CHANGED" })

    expect(remoteHead(repos.remote)).toBe(outside)
    expect(git(repos.remote, "show", `${outside}:outside.md`)).toBe("keep me")
    expect(autoGitOf(creator)).toMatchObject({ state: "blocked", detailCode: "REMOTE_CHANGED" })
  })
})
