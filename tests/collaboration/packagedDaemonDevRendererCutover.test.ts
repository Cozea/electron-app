import { execFile, spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { WebSocketServer, WebSocket as WsClient } from "ws"
import { beforeAll, describe, expect, it } from "vitest"

import {
  RoomHost,
  TEST_PUBLIC_SESSION_ID,
  TEST_ROOM_ID,
  loadSessionRoomWorker,
  sessionTokenFor,
  waitFor,
  type SessionRoomWorker,
} from "../helpers/sessionRoomHarness"

const execute = promisify(execFile)

/**
 * P23 Advance Condition & Matrix Gate:
 * "gate demonstrated with packaged daemon + dev renderer."
 *
 * Runs the compiled projectd.mjs artifact in an independent child process
 * (matching the packaged LaunchAgent execution mode), launches the real Electron
 * application with a native BrowserWindow as the dev renderer, closes Electron,
 * proves two-way synchronization continues headlessly while Electron is completely
 * stopped, and relaunches Electron to confirm seamless live reconnection.
 */
describe("P23 packaged daemon + dev renderer cutover", () => {
  let worker: SessionRoomWorker
  const projectdDist = path.resolve(__dirname, "../../apps/projectd/dist/projectd.mjs")
  const electronBinary = path.resolve(
    __dirname,
    "../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
  )

  beforeAll(async () => {
    worker = await loadSessionRoomWorker()
  })

  it.runIf(process.platform === "darwin")("closing dev renderer does not stop live CRDT/session on compiled projectd daemon", async () => {
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
      }
      ;(room as any).room.acceptSocket(fakeSocket as any, TEST_ROOM_ID)

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

      // Bundle client for Electron to require in main
      const clientBundlePath = path.join(tmp, "client.cjs")
      await execute("bun", [
        "build",
        path.resolve(__dirname, "../../packages/projectd-protocol/src/client.ts"),
        "--target=node",
        "--format=cjs",
        `--outfile=${clientBundlePath}`,
      ])

      const electronEnv = { ...process.env }
      delete electronEnv.ELECTRON_RUN_AS_NODE

      // 4. Launch REAL Electron.app (Dev Renderer 1): attaches session from a native BrowserWindow
      const roomKey = randomBytes(32)
      const token = await sessionTokenFor(worker, "principal_packaged_daemon", { sessionRole: "developer" })()
      const main1Path = path.join(tmp, "main1.cjs")
      await fs.writeFile(main1Path, `
        const { app, BrowserWindow } = require('electron');
        const { ProjectdClient } = require(${JSON.stringify(clientBundlePath)});
        app.setPath('userData', ${JSON.stringify(path.join(tmp, "profile1"))});
        app.whenReady().then(async () => {
          const client = new ProjectdClient({ socketPath: ${JSON.stringify(socketPath)}, clientName: 'dev-renderer-1' });
          await client.connect();
          const win = new BrowserWindow({ show: false, width: 800, height: 600 });
          try {
            const attached = await client.attachSession(${JSON.stringify({
              publicSessionId: TEST_PUBLIC_SESSION_ID,
              workspaceId: `ws_collab_${TEST_PUBLIC_SESSION_ID}`,
              projectId: "proj_packaged_gate",
              rootPath: workspaceRoot,
              roomKeyBase64: roomKey.toString("base64"),
              ticket: { wsUrl, token, role: "developer" },
              actor: { principalId: "principal_packaged_daemon" },
            })});
            for (let i = 0; i < 60; i++) {
              const status = await client.getSessionStatus(${JSON.stringify(TEST_PUBLIC_SESSION_ID)});
              if (status && status.state === 'live') {
                console.log('GUI_ATTACH_OK');
                win.close();
                app.exit(0);
                return;
              }
              await new Promise((r) => setTimeout(r, 100));
            }
            console.error('TIMED_OUT_WAITING_FOR_LIVE');
            app.exit(1);
          } catch (err) {
            console.error('ATTACH_ERROR:', err);
            app.exit(1);
          }
        });
      `)

      const { stdout: stdout1 } = await execute(electronBinary, [main1Path], { env: electronEnv, timeout: 20_000 })
      expect(stdout1).toContain("GUI_ATTACH_OK")

      // 5. Connect a remote peer client via network WebSocket
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

      // 6. Dev renderer process is COMPLETELY CLOSED
      // Invariant: closing renderer must NOT kill the daemon or stop synchronization!
      expect(daemonProc.exitCode).toBeNull()

      // 7. While Electron is closed, peer writes a file edit to the room over network WebSocket
      peerReplica.createFile({
        path: "from_peer_headless.txt",
        kind: "text",
        content: "written by peer while Electron was closed\n",
        actor: { actorType: "user" },
      })
      peerClient.submitLocalChanges()

      // Packaged daemon headlessly receives batch over WebSocket and materializes file to disk!
      await waitFor(
        async () =>
          (await fs.readFile(path.join(workspaceRoot, "from_peer_headless.txt"), "utf8").catch(() => null)) ===
          "written by peer while Electron was closed\n",
        "packaged daemon to materialize peer file with Electron closed",
        15_000,
      )

      // 8. While Electron is closed, an external local tool edits a file on disk
      await fs.writeFile(path.join(workspaceRoot, "notes.md"), "initial content\nexternal terminal edit while Electron closed\n")

      // Packaged daemon rescans, ingests, and sends batch to room; peer receives it over WebSocket!
      await waitFor(
        () =>
          peerReplica.tree.listLiveEntries().some((e) => e.path === "notes.md") &&
          peerReplica.textDocs.getTextContent(
            peerReplica.tree.listLiveEntries().find((e) => e.path === "notes.md")!.fileId,
          ) === "initial content\nexternal terminal edit while Electron closed\n",
        "peer to receive external edit published by headless daemon",
        15_000,
      )

      // 9. Reopen dev renderer: launch REAL Electron.app a second time
      const main2Path = path.join(tmp, "main2.cjs")
      await fs.writeFile(main2Path, `
        const { app, BrowserWindow } = require('electron');
        const { ProjectdClient } = require(${JSON.stringify(clientBundlePath)});
        app.setPath('userData', ${JSON.stringify(path.join(tmp, "profile2"))});
        app.whenReady().then(async () => {
          const client = new ProjectdClient({ socketPath: ${JSON.stringify(socketPath)}, clientName: 'dev-renderer-2' });
          await client.connect();
          const win = new BrowserWindow({ show: false, width: 800, height: 600 });
          try {
            const status = await client.getSessionStatus(${JSON.stringify(TEST_PUBLIC_SESSION_ID)});
            if (status && status.state === 'live' && status.fileCount >= 2) {
              console.log('GUI_REOPEN_OK');
              win.close();
              app.exit(0);
              return;
            }
            console.error('INVALID_STATUS:', JSON.stringify(status));
            app.exit(1);
          } catch (err) {
            console.error('REOPEN_ERROR:', err);
            app.exit(1);
          }
        });
      `)

      const { stdout: stdout2 } = await execute(electronBinary, [main2Path], { env: electronEnv, timeout: 20_000 })
      expect(stdout2).toContain("GUI_REOPEN_OK")

      peerClient.disconnect()
    } finally {
      await killDaemon()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
      room.dispose()
      await fs.rm(tmp, { recursive: true, force: true })
    }
  }, 60_000)
})
