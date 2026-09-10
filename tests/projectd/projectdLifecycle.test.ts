import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  PROJECTD_PROTOCOL_VERSION,
  ProjectdClient,
} from "@cozea/projectd-protocol"
import { ProjectdServer } from "../../apps/projectd/src/server/ProjectdServer"

describe("P02 projectd daemon & client protocol lifecycle", () => {
  const testSocketDir = "/tmp"
  let testSocketPath: string
  let server: ProjectdServer | null = null

  beforeEach(() => {
    testSocketPath = path.join(
      testSocketDir,
      `test-projectd-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`,
    )
  })

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
    try {
      if (fs.existsSync(testSocketPath)) {
        fs.unlinkSync(testSocketPath)
      }
    } catch {
      // Ignore
    }
  })

  // ─── Checkpoint P02-A: Daemon runs from source without Electron ───────────────
  describe("Checkpoint P02-A: in-process / source daemon", () => {
    it("starts server, enforces socket permissions 0600, and performs handshake", async () => {
      server = new ProjectdServer({ socketPath: testSocketPath })
      await server.start()

      expect(fs.existsSync(testSocketPath)).toBe(true)
      const stats = fs.statSync(testSocketPath)
      // Check permission bits (0600 = 0o600 in octal = 384 in decimal)
      // eslint-disable-next-line no-bitwise
      const mode = stats.mode & 0o777
      expect(mode).toBe(0o600)

      const client = new ProjectdClient({ socketPath: testSocketPath, clientName: "test-client" })
      await client.connect()
      expect(client.connected).toBe(true)

      const health = await client.health()
      expect(health.status).toBe("healthy")
      expect(health.protocolVersion).toBe(PROJECTD_PROTOCOL_VERSION)
      expect(health.pid).toBe(process.pid)
      expect(health.activeConnections).toBe(1)

      client.disconnect()
      expect(client.connected).toBe(false)
    })

    it("enforces single-instance guard on socket path", async () => {
      server = new ProjectdServer({ socketPath: testSocketPath })
      await server.start()

      const secondServer = new ProjectdServer({ socketPath: testSocketPath })
      await expect(secondServer.start()).rejects.toThrow(/already running/)
    })

    it("supports event subscriptions and server broadcast", async () => {
      server = new ProjectdServer({ socketPath: testSocketPath })
      await server.start()

      const client = new ProjectdClient({ socketPath: testSocketPath })
      await client.connect()

      const received: any[] = []
      const unsubscribe = await client.subscribe("workspace:changes", (evt) => {
        received.push(evt)
      })

      server.broadcast("workspace:changes", "file_modified", { path: "src/main.ts" })

      // Small delay for socket delivery
      await new Promise((r) => setTimeout(r, 50))

      expect(received).toHaveLength(1)
      expect(received[0].topic).toBe("workspace:changes")
      expect(received[0].event).toBe("file_modified")
      expect(received[0].payload).toEqual({ path: "src/main.ts" })

      // Unsubscribe and verify no more events received
      unsubscribe()
      server.broadcast("workspace:changes", "file_modified", { path: "src/other.ts" })
      await new Promise((r) => setTimeout(r, 50))
      expect(received).toHaveLength(1)

      client.disconnect()
    })

    it("handles graceful shutdown via client request", async () => {
      server = new ProjectdServer({ socketPath: testSocketPath })
      await server.start()

      const client = new ProjectdClient({ socketPath: testSocketPath })
      await client.connect()

      const res = await client.shutdown("test shutdown")
      expect(res.shuttingDown).toBe(true)

      // Wait for server to stop
      await new Promise((r) => setTimeout(r, 100))
      expect(fs.existsSync(testSocketPath)).toBe(false)
    })
  })

  // ─── Checkpoint P02-B: Standalone compiled artifact runs ─────────────────────
  describe("Checkpoint P02-B: standalone compiled artifact and projectctl", () => {
    it("runs compiled projectd.cjs and verifies cozea-projectctl health and shutdown", async () => {
      const projectdDist = path.resolve(__dirname, "../../apps/projectd/dist/projectd.mjs")
      const projectctlDist = path.resolve(
        __dirname,
        "../../apps/projectd/dist/cozea-projectctl.mjs",
      )

      expect(fs.existsSync(projectdDist)).toBe(true)
      expect(fs.existsSync(projectctlDist)).toBe(true)

      // Spawn standalone projectd process
      const daemonProc = spawn("node", [projectdDist], {
        env: {
          ...process.env,
          COZEA_PROJECTD_SOCKET: testSocketPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      })

      try {
        // Wait for socket to appear
        let ready = false
        for (let i = 0; i < 30; i++) {
          if (fs.existsSync(testSocketPath)) {
            ready = true
            break
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        expect(ready).toBe(true)

        // Run cozea-projectctl health --json
        const healthOutput = await new Promise<string>((resolve, reject) => {
          const ctl = spawn("node", [projectctlDist, "health", "--socket", testSocketPath, "--json"])
          let stdout = ""
          let stderr = ""
          ctl.stdout.on("data", (d) => (stdout += d.toString()))
          ctl.stderr.on("data", (d) => (stderr += d.toString()))
          ctl.on("close", (code) => {
            if (code === 0) resolve(stdout)
            else reject(new Error(`ctl health failed (exit ${code}): ${stderr}`))
          })
        })

        const health = JSON.parse(healthOutput)
        expect(health.status).toBe("healthy")
        expect(health.protocolVersion).toBe(PROJECTD_PROTOCOL_VERSION)
        expect(health.pid).toBe(daemonProc.pid)

        // Run cozea-projectctl shutdown
        await new Promise<void>((resolve, reject) => {
          const ctl = spawn("node", [
            projectctlDist,
            "shutdown",
            "--socket",
            testSocketPath,
            "--json",
          ])
          ctl.on("close", (code) => {
            if (code === 0) resolve()
            else reject(new Error(`ctl shutdown failed with code ${code}`))
          })
        })

        // Daemon should exit cleanly
        await new Promise<void>((resolve) => {
          daemonProc.on("close", () => resolve())
          setTimeout(() => {
            try {
              daemonProc.kill("SIGKILL")
            } catch {
              // Ignore
            }
            resolve()
          }, 1000)
        })

        expect(fs.existsSync(testSocketPath)).toBe(false)
      } finally {
        try {
          daemonProc.kill("SIGKILL")
        } catch {
          // Ignore
        }
      }
    })
  })

  // ─── Checkpoint P02-C: Electron client connect/disconnect without owning lifecycle ──
  describe("Checkpoint P02-C: Electron client lifecycle independence", () => {
    it("connects, disconnects, and reconnects without altering daemon state", async () => {
      server = new ProjectdServer({ socketPath: testSocketPath })
      await server.start()

      // Client 1 connects
      const client1 = new ProjectdClient({ socketPath: testSocketPath, clientName: "electron-main" })
      await client1.connect()
      let health = await client1.health()
      expect(health.activeConnections).toBe(1)

      // Client 2 connects simultaneously
      const client2 = new ProjectdClient({ socketPath: testSocketPath, clientName: "ctl" })
      await client2.connect()
      health = await client1.health()
      expect(health.activeConnections).toBe(2)

      // Client 1 disconnects gracefully (e.g. Electron quits or window closes)
      client1.disconnect()
      expect(client1.connected).toBe(false)
      await new Promise((r) => setTimeout(r, 50))

      // Server is still alive and serving Client 2
      health = await client2.health()
      expect(health.activeConnections).toBe(1)

      // Client 1 reconnects (e.g. Electron restarts)
      await client1.connect()
      expect(client1.connected).toBe(true)
      health = await client1.health()
      expect(health.activeConnections).toBe(2)

      client1.disconnect()
      client2.disconnect()
    })

    it("handles unreachable daemon gracefully without crashing", async () => {
      const nonExistentSocket = `/tmp/non-existent-${Date.now()}.sock`
      const client = new ProjectdClient({ socketPath: nonExistentSocket, timeoutMs: 300 })

      await expect(client.connect()).rejects.toThrow()
      expect(client.connected).toBe(false)
    })
  })
})
