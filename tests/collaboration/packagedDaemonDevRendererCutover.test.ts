import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { WebSocketServer, WebSocket as WsClient } from "ws"
import { beforeAll, describe, expect, it } from "vitest"

import {
  PROJECTD_PROTOCOL_VERSION,
  ProjectdClient,
} from "@cozea/projectd-protocol"
import {
  RoomHost,
  TEST_PUBLIC_SESSION_ID,
  TEST_ROOM_ID,
  loadSessionRoomWorker,
  sessionTokenFor,
  waitFor,
  type SessionRoomWorker,
} from "../helpers/sessionRoomHarness"

/**
 * P23 Advance Condition & Matrix Gate:
 * "gate demonstrated with packaged daemon + dev renderer."
 *
 * Runs the compiled projectd.mjs artifact in an independent child process
 * (matching the packaged LaunchAgent execution mode), connects a dev-renderer
 * client, closes the renderer, proves two-way synchronization continues
 * headlessly, and re-connects a replacement renderer.
 */
describe("P23 packaged daemon + dev renderer cutover", () => {
  let worker: SessionRoomWorker
  const projectdDist = path.resolve(__dirname, "../../apps/projectd/dist/projectd.mjs")

  beforeAll(async () => {
    worker = await loadSessionRoomWorker()
  })

  it("closing dev renderer does not stop live CRDT/session on compiled projectd daemon", async () => {
    // 1. Setup isolated directories and sockets
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-p23-packaged-"))
    const socketPath = path.join(tmp, "projectd.sock")
    const dbPath = path.join(tmp, "projectd.sqlite")
    const collabDir = path.join(tmp, "collab")
    const rawWorkspaceRoot = path.join(tmp, "workspace")
    await fs.mkdir(collabDir, { recursive: true })
    await fs.mkdir(rawWorkspaceRoot, { recursive: true })
    const workspaceRoot = await fs.realpath(rawWorkspaceRoot)
    await fs.writeFile(path.join(workspaceRoot, "notes.md"), "initial content\n")

    // 2. Start loopback WebSocket server bridging into real SessionRoomWorker
    const room = new RoomHost(worker)
    const httpServer = createServer()
    const wss = new WebSocketServer({ server: httpServer })

    // Bridge incoming network WebSockets to the in-memory RoomHost
    wss.on("connection", (ws) => {
      let attachment: unknown = null
      const fakeSocket = {
        closed: false,
        serializeAttachment: (value: unknown) => {
          attachment = structuredClone(value)
        },
        deserializeAttachment: () => structuredClone(attachment),
        send: (data: string) => {
          if (ws.readyState === WsClient.OPEN) ws.send(data)
        },
        close: (code = 1000, reason = "") => {
          ws.close(code, reason)
        },
      };
      (room as any).room.acceptSocket(fakeSocket as any, TEST_ROOM_ID)

      ws.on("message", (data) => {
        void (room as any).deliver(async (r: any) => {
          try {
            await r.webSocketMessage(fakeSocket, data.toString("utf8"))
          } catch (e) {
            console.error("SERVER WS ERR:", e)
          }
        })
      })
      ws.on("close", (code, reason) => {
        fakeSocket.closed = true
        void (room as any).deliver((r: any) => r.webSocketClose(fakeSocket, code, reason.toString("utf8"), true))
      })
    })

    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve))
    const port = (httpServer.address() as { port: number }).port
    const wsUrl = `ws://127.0.0.1:${port}/collab/sessions/ws`

    // 3. Spawn standalone compiled projectd daemon process
    const daemonProc: ChildProcess = spawn("node", [projectdDist], {
      env: {
        ...process.env,
        COZEA_PROJECTD_SOCKET: socketPath,
        COZEA_PROJECTD_DB: dbPath,
        COZEA_COLLAB_REPOS_DIR: collabDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })

    const killDaemon = async () => {
      if (daemonProc.pid) {
        daemonProc.kill("SIGTERM")
        await new Promise((resolve) => setTimeout(resolve, 300))
        try {
          daemonProc.kill("SIGKILL")
        } catch {}
      }
    }

    try {
      // Wait for daemon socket to appear
      await waitFor(() => fs.access(socketPath).then(() => true, () => false), "packaged daemon socket to appear", 10_000)

      const rendererClient = new ProjectdClient({ socketPath, clientName: "dev-renderer-window-1" })
      await rendererClient.connect()
      const health = await rendererClient.health()
      expect(health.status).toBe("healthy")
      expect(health.protocolVersion).toBe(PROJECTD_PROTOCOL_VERSION)

      const roomKey = randomBytes(32)
      const token = await sessionTokenFor(worker, "principal_packaged_daemon", { sessionRole: "developer" })()
      const attached = await rendererClient.attachSession({
        publicSessionId: TEST_PUBLIC_SESSION_ID,
        workspaceId: `ws_collab_${TEST_PUBLIC_SESSION_ID}`,
        projectId: "proj_packaged_gate",
        rootPath: workspaceRoot,
        roomKeyBase64: roomKey.toString("base64"),
        ticket: { wsUrl, token, role: "developer" },
        actor: { principalId: "principal_packaged_daemon" },
      })
      expect(attached).toMatchObject({ publicSessionId: TEST_PUBLIC_SESSION_ID, rootPath: workspaceRoot })

      await waitFor(
        async () => (await rendererClient.getSessionStatus(TEST_PUBLIC_SESSION_ID))?.state === "live",
        "session to reach live state on packaged daemon",
        10_000,
      )

      const { SessionReplica } = await import("../../apps/projectd/src/collaboration/SessionReplica")
      const { SessionTransport } = await import("../../apps/projectd/src/collaboration/SessionTransport")
      const { SessionRoomClient } = await import("../../apps/projectd/src/collaboration/SessionRoomClient")
      const peerReplica = new SessionReplica(TEST_PUBLIC_SESSION_ID, "client_peer_remote")
      const peerTransport = new SessionTransport({ sessionId: TEST_PUBLIC_SESSION_ID, replica: peerReplica, roomKey })
      const peerClient = new SessionRoomClient({
        transport: peerTransport,
        connect: async (handlers) => {
          const ws = new WsClient(wsUrl)
          await new Promise<void>((resolve, reject) => {
            ws.on("open", resolve)
            ws.on("error", reject)
          })
          ws.on("message", (data) => handlers.onMessage(data.toString("utf8")))
          ws.on("close", () => handlers.onClose())
          return {
            send: (data) => ws.send(data),
            close: () => ws.close(),
          }
        },
        getToken: sessionTokenFor(worker, "principal_peer", { sessionRole: "developer" }),
      })
      await peerClient.connect()
      await waitFor(() => peerClient.state === "live", "peer to go live")

      // Master Plan invariant: Closing renderer does not stop live CRDT/session!
      rendererClient.disconnect()

      // Verify packaged daemon process is still running independently
      expect(daemonProc.exitCode).toBeNull()

      peerReplica.createFile({
        path: "from_peer_headless.txt",
        kind: "text",
        content: "written by peer while renderer was closed\n",
        actor: { actorType: "user" },
      })
      peerClient.submitLocalChanges()

      // Packaged daemon headlessly receives batch over WebSocket and materializes file to disk!
      await waitFor(
        async () =>
          (await fs.readFile(path.join(workspaceRoot, "from_peer_headless.txt"), "utf8").catch(() => null)) ===
          "written by peer while renderer was closed\n",
        "packaged daemon to materialize peer file with renderer closed",
        15_000,
      )

      // While renderer is closed, an external local tool edits a file on disk
      await fs.writeFile(path.join(workspaceRoot, "notes.md"), "initial content\nexternal terminal edit while closed\n")

      // Packaged daemon rescans, ingests, and sends batch to room; peer receives it over WebSocket!
      await waitFor(
        () =>
          peerReplica.tree.listLiveEntries().some((e) => e.path === "notes.md") &&
          peerReplica.textDocs.getTextContent(
            peerReplica.tree.listLiveEntries().find((e) => e.path === "notes.md")!.fileId,
          ) === "initial content\nexternal terminal edit while closed\n",
        "peer to receive external edit published by headless daemon",
        15_000,
      )

      // Reopen dev renderer: new ProjectdClient connects to the running daemon
      const reopenedRenderer = new ProjectdClient({ socketPath, clientName: "dev-renderer-window-2" })
      await reopenedRenderer.connect()
      const status = await reopenedRenderer.getSessionStatus(TEST_PUBLIC_SESSION_ID)
      expect(status?.state).toBe("live")
      expect(status?.fileCount).toBeGreaterThanOrEqual(2)

      reopenedRenderer.disconnect()
      peerClient.disconnect()
    } finally {
      await killDaemon()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
      room.dispose()
      await fs.rm(tmp, { recursive: true, force: true })
    }
  }, 60_000)
})
