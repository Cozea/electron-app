import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"

import { ProjectdClient } from "@cozea/projectd-protocol"
import { ProjectdServer } from "../../apps/projectd/src/server/ProjectdServer"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { SessionTransport } from "../../apps/projectd/src/collaboration/SessionTransport"
import { SessionRoomClient } from "../../apps/projectd/src/collaboration/SessionRoomClient"
import {
  RoomHost,
  loadSessionRoomWorker,
  sessionTokenFor,
  TEST_PUBLIC_SESSION_ID,
  waitFor,
} from "../helpers/sessionRoomHarness"
import {
  findOpenSessionById,
  findWorkspaceSession,
  resolveCollaborationGate,
} from "@/features/collaboration/collaborationGate"

describe("P23 collaboration gate", () => {
  it("keeps the shared branch collaborating when no session exists for it", () => {
    expect(resolveCollaborationGate({ activeBranch: "main", sharedBranch: "main", sessions: [] })).toEqual({
      enabled: true,
      reason: "shared-branch",
    })
    // Sessions still loading (or unreadable) behave like none.
    expect(resolveCollaborationGate({ activeBranch: "main", sharedBranch: "main", sessions: undefined }).enabled).toBe(
      true,
    )
  })

  it("keeps other branches local without a session", () => {
    expect(
      resolveCollaborationGate({ activeBranch: "feature/solo", sharedBranch: "main", sessions: [] }),
    ).toEqual({ enabled: false, reason: "private-branch" })
  })

  it("disables legacy collaboration for Session Workbenches even while sessions query is loading", () => {
    // Regression: a Session Workbench on the shared branch must never mount the
    // legacy in-app engine during the loading window before sessions arrive.
    expect(
      resolveCollaborationGate({
        activeBranch: "main",
        sharedBranch: "main",
        sessions: undefined,
        workspaceId: "ws_collab_czs_1234567890abcdef",
      }),
    ).toEqual({ enabled: false, reason: "session-daemon" })

    // Ordinary workspaces retain the shared-branch fallback during loading until P26.
    expect(
      resolveCollaborationGate({
        activeBranch: "main",
        sharedBranch: "main",
        sessions: undefined,
        workspaceId: "ws_ordinary_main",
      }),
    ).toEqual({ enabled: true, reason: "shared-branch" })
  })

  it("leaves a session's branch to the daemon, on the shared branch too", () => {
    for (const lifecycle of ["ACTIVE", "DORMANT", "PAUSED"]) {
      expect(
        resolveCollaborationGate({
          activeBranch: "main",
          sharedBranch: "main",
          sessions: [{ branchName: "main", lifecycle }],
        }),
      ).toEqual({ enabled: false, reason: "session-daemon" })
    }
    // Branches without a session keep the in-app behaviour.
    expect(
      resolveCollaborationGate({ activeBranch: "main", sharedBranch: "main", sessions: [] }),
    ).toEqual({ enabled: true, reason: "shared-branch" })
  })

  it("leaves a session branch to the daemon regardless of fallback flags or lifecycle", () => {
    for (const lifecycle of ["ACTIVE", "DORMANT", "PAUSING", "PAUSED", "CLOSING", "BLOCKED", "CREATING"]) {
      expect(
        resolveCollaborationGate({
          activeBranch: "feature/experiment",
          sharedBranch: "main",
          sessions: [{ branchName: "feature/experiment", lifecycle }],
        }),
      ).toEqual({ enabled: false, reason: "session-daemon" })
    }
  })

  it("ignores closed sessions and sessions on other branches", () => {
    const sessions = [
      { branchName: "main", lifecycle: "CLOSED" },
      { branchName: "feature/other", lifecycle: "ACTIVE" },
    ]
    expect(resolveCollaborationGate({ activeBranch: "main", sharedBranch: "main", sessions }).reason).toBe(
      "shared-branch",
    )
    expect(resolveCollaborationGate({ activeBranch: "feature/solo", sharedBranch: "main", sessions }).enabled).toBe(
      false,
    )
  })
})

describe("P13 session resolution by Workbench identity", () => {
  const sessions = [
    { branchName: "feat/a", lifecycle: "ACTIVE", publicSessionId: "czs_aaaaaaaaaaaaaaaa" },
    { branchName: "feat/b", lifecycle: "DORMANT", publicSessionId: "czs_bbbbbbbbbbbbbbbb" },
    { branchName: "feat/closed", lifecycle: "CLOSED", publicSessionId: "czs_cccccccccccccccc" },
  ]

  it("resolves the session for a Session Workbench regardless of branch", () => {
    expect(findWorkspaceSession(sessions, "ws_collab_czs_aaaaaaaaaaaaaaaa")).toMatchObject({
      branchName: "feat/a",
    })
    expect(findWorkspaceSession(sessions, "ws_collab_czs_bbbbbbbbbbbbbbbb")).toMatchObject({
      branchName: "feat/b",
    })
  })

  it("returns null outside Session Workbenches, for unknown sessions, and closed ones", () => {
    expect(findWorkspaceSession(sessions, "ws_ordinary_123")).toBeNull()
    expect(findWorkspaceSession(sessions, null)).toBeNull()
    expect(findWorkspaceSession(sessions, "ws_collab_czs_missing")).toBeNull()
    expect(findWorkspaceSession(sessions, "ws_collab_czs_cccccccccccccccc")).toBeNull()
    expect(findWorkspaceSession(undefined, "ws_collab_czs_aaaaaaaaaaaaaaaa")).toBeNull()
  })

  it("opens switch targets by session id even when a closed session keeps the branch name", () => {
    const collision = [
      { branchName: "feat/x", lifecycle: "CLOSED", publicSessionId: "czs_closeddddddddddd" },
      { branchName: "feat/x", lifecycle: "ACTIVE", publicSessionId: "czs_activedddddddddd" },
    ]
    // The requested id decides, never array order or the shared branch name.
    expect(findOpenSessionById(collision, "czs_activedddddddddd")).toMatchObject({ lifecycle: "ACTIVE" })
    expect(findOpenSessionById([...collision].reverse(), "czs_activedddddddddd")).toMatchObject({ lifecycle: "ACTIVE" })
    expect(findOpenSessionById(collision, "czs_closeddddddddddd")).toBeNull()
    expect(findOpenSessionById(collision, "czs_missing")).toBeNull()
    expect(findOpenSessionById(undefined, "czs_activedddddddddd")).toBeNull()
  })
})

describe("P23 Electron cutover exit gate", () => {
  it("closing renderer does not stop live CRDT/session", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "cozea-p23-gate-"))
    const socketPath = path.join(tmp, "daemon.sock")
    const workspaceRoot = path.join(tmp, "ws")
    await fsp.mkdir(workspaceRoot, { recursive: true })
    await fsp.writeFile(path.join(workspaceRoot, "notes.md"), "initial\n")

    const worker = await loadSessionRoomWorker()
    const room = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const db = new ProjectdDatabase(":memory:")

    class QuietEvents extends EventEmitter {
      async start(): Promise<void> {}
      stop(): void {}
      report(): void {}
    }
    const events = new QuietEvents()

    const server = new ProjectdServer({
      socketPath,
      database: db,
      sessionConnectorFactory: () => room.connector(),
      fileEventSourceFactory: () => events,
      sessionRescanIntervalMs: 50,
    })
    await server.start()

    // 1. Renderer connects to daemon socket and attaches session
    const rendererClient = new ProjectdClient({ socketPath, clientName: "electron-renderer" })
    await rendererClient.connect()
    const token = await sessionTokenFor(worker, "principal_renderer", { sessionRole: "developer" })()
    const attached = await rendererClient.attachSession({
      publicSessionId: TEST_PUBLIC_SESSION_ID,
      workspaceId: `ws_collab_${TEST_PUBLIC_SESSION_ID}`,
      projectId: "proj_p23",
      rootPath: workspaceRoot,
      roomKeyBase64: roomKey.toString("base64"),
      ticket: { wsUrl: "ws://room.test/collab/sessions/ws", token, role: "developer" },
      actor: { principalId: "principal_renderer" },
    })
    expect(["starting", "connecting", "live"]).toContain(attached.state)

    await waitFor(
      async () => (await rendererClient.getSessionStatus(TEST_PUBLIC_SESSION_ID))?.state === "live",
      "session to go live",
    )

    // 2. Peer connects to room directly
    const peerReplica = new SessionReplica(TEST_PUBLIC_SESSION_ID, "peer_client")
    const peerTransport = new SessionTransport({ sessionId: TEST_PUBLIC_SESSION_ID, replica: peerReplica, roomKey })
    const peerClient = new SessionRoomClient({
      transport: peerTransport,
      connect: room.connector(),
      getToken: sessionTokenFor(worker, "principal_peer", { sessionRole: "developer" }),
    })
    await peerClient.connect()
    await waitFor(() => peerClient.state === "live", "peer to go live")

    // 3. Renderer closes: disconnects from daemon socket
    // Invariant: closing renderer must NOT detach or stop the background session!
    rendererClient.disconnect()

    // 4. While renderer is closed, peer writes an edit to the room
    peerReplica.createFile({
      path: "from_peer.txt",
      kind: "text",
      content: "peer edit while renderer closed\n",
      actor: { actorType: "user" },
    })
    peerClient.submitLocalChanges()

    // The daemon continues running and materializes peer's edit to disk without renderer!
    await waitFor(
      async () =>
        (await fsp.readFile(path.join(workspaceRoot, "from_peer.txt"), "utf8").catch(() => null)) ===
        "peer edit while renderer closed\n",
      "daemon to materialize peer edit with renderer closed",
    )

    // 5. While renderer is closed, an external disk write occurs in the session folder
    await fsp.writeFile(path.join(workspaceRoot, "from_disk.txt"), "external tool write\n")

    // Daemon ingests and submits to room without renderer; peer receives it!
    await waitFor(
      () => peerReplica.tree.listLiveEntries().some((entry) => entry.path === "from_disk.txt"),
      "peer to receive external disk edit with renderer closed",
    )
    const diskEntry = peerReplica.tree.listLiveEntries().find((entry) => entry.path === "from_disk.txt")!
    expect(peerReplica.textDocs.getTextContent(diskEntry.fileId)).toBe("external tool write\n")

    // 6. A replacement renderer reopens and connects to daemon socket
    const newRendererClient = new ProjectdClient({ socketPath, clientName: "electron-renderer-reopened" })
    await newRendererClient.connect()
    const status = await newRendererClient.getSessionStatus(TEST_PUBLIC_SESSION_ID)
    expect(status?.state).toBe("live")
    expect(status?.fileCount).toBeGreaterThanOrEqual(3)

    newRendererClient.disconnect()
    peerClient.disconnect()
    await server.stop()
    room.dispose()
    db.close()
    await fsp.rm(tmp, { recursive: true, force: true })
  })
})
