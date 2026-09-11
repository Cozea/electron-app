import { randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { ProjectdClient, projectdSessionTopic, type ProjectdSessionStatus } from "@cozea/projectd-protocol"

import { CollaborationSessionHost } from "../../apps/projectd/src/collaboration/CollaborationSessionHost"
import type { RoomConnector } from "../../apps/projectd/src/collaboration/SessionRoomClient"
import type { FileEventSource, NativeFSEventItem } from "../../apps/projectd/src/filesystem/FSEventsClient"
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
  write(relativePath: string, content: string): Promise<void>
  remove(relativePath: string): Promise<void>
  read(relativePath: string): Promise<string | null>
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
  }
}

async function startLive(peer: Peer, label: string): Promise<void> {
  await peer.host.start()
  await waitFor(() => peer.host.state === "live", `${label} to go live`)
}

/** A creator that seeded the room from `files`, and a joiner syncing into an empty folder. */
async function startPair(room: RoomHost, roomKey: Buffer, files: Record<string, string>) {
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
    expect(await joiner.read("assets/logo.png")).toBeNull()
    expect(await joiner.read(".git/HEAD")).toBeNull()
    expect(creator.host.status()).toMatchObject({ fileCount: 2, skippedPaths: ["assets/logo.png"] })
    // A slow disk can split the seed across batches, so compare with what the room stored.
    expect(joiner.host.status()).toMatchObject({ fileCount: 2, lastAppliedSessionSeq: room.storage.batchCount() })
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

    const otherRoot = await tempFolder("other")
    await expect(client.attachSession({ ...attach, rootPath: otherRoot })).rejects.toThrow(/already syncs/)
    await expect(
      client.attachSession({ ...attach, publicSessionId: "czs_fedcba9876543210", roomKeyBase64: "c2hvcnQ=" }),
    ).rejects.toThrow(/32-byte room key/)

    expect(await client.detachSession(TEST_PUBLIC_SESSION_ID)).toEqual({ detached: true })
    expect(await client.listSessions()).toEqual([])
  })
})
