/**
 * Connects Electron Main to cozea-projectd, starting the daemon first when nothing
 * answers on its socket.
 *
 * Master Specification: docs/collaboration/collaboration-autogit-master-plan.md
 * Phase: P02, P03
 *
 * Invariant: Electron is a client and does not own the daemon's lifetime. The packaged
 * app registers the daemon with launchd, and a development build starts a detached
 * copy from source (see ProjectdLauncher). Quitting the app leaves the daemon running.
 */

import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { app } from "electron"
import { ProjectdClient } from "@cozea/projectd-protocol"

import { getSharedProjectdClient, resetSharedProjectdClient } from "./ProjectdClient"
import {
  ensureProjectdRunning,
  type ProjectdLaunchContext,
  type ProjectdLauncherEffects,
  type ProjectdLaunchOutcome,
} from "./ProjectdLauncher"

const PROBE_TIMEOUT_MS = 1_000

/** The checkout root in development: the nearest folder above the app that holds projectd's source. */
function findRepoRoot(start: string): string {
  let dir = start
  for (let depth = 0; depth < 6; depth += 1) {
    if (fs.existsSync(path.join(dir, "apps", "projectd", "src", "main.ts"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return start
}

function launchContext(socketPath: string): ProjectdLaunchContext {
  return {
    platform: process.platform,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    repoRoot: findRepoRoot(app.getAppPath()),
    appVersion: app.getVersion(),
    homeDir: os.homedir(),
    tmpDir: os.tmpdir(),
    uid: typeof process.getuid === "function" ? process.getuid() : 0,
    socketPath,
    env: process.env,
  }
}

function launcherEffects(socketPath: string): ProjectdLauncherEffects {
  return {
    probe: async () => {
      const client = new ProjectdClient({ socketPath, clientName: "cozea-desktop-launcher", timeoutMs: PROBE_TIMEOUT_MS })
      try {
        await client.connect()
        await client.health()
        return true
      } catch {
        return false
      } finally {
        client.disconnect()
      }
    },
    exists: (filePath) => fs.existsSync(filePath),
    readFile: (filePath) => {
      try {
        return fs.readFileSync(filePath, "utf8")
      } catch {
        return null
      }
    },
    writeFile: (filePath, content) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, content, "utf8")
    },
    mkdir: (dirPath) => {
      fs.mkdirSync(dirPath, { recursive: true })
    },
    launchctl: (args) =>
      new Promise((resolve) => {
        execFile("/bin/launchctl", args, (error, stdout, stderr) => {
          resolve({ ok: !error, output: `${stdout}${stderr}`.trim() })
        })
      }),
    spawnDetached: (command, args, options) =>
      new Promise((resolve, reject) => {
        const log = fs.openSync(options.logPath, "a")
        const env = { ...process.env }
        delete env.ELECTRON_RUN_AS_NODE
        const child = spawn(command, args, { cwd: options.cwd, env, detached: true, stdio: ["ignore", log, log] })
        child.once("error", (error) => {
          fs.closeSync(log)
          reject(error)
        })
        child.once("spawn", () => {
          fs.closeSync(log)
          child.unref()
          resolve()
        })
      }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (message) => console.log(`[Electron] ${message}`),
  }
}

export async function initProjectdService(): Promise<void> {
  const client = getSharedProjectdClient()
  const outcome: ProjectdLaunchOutcome = await ensureProjectdRunning(
    launchContext(client.socketPath),
    launcherEffects(client.socketPath),
  ).catch((error: unknown) => {
    console.log(`[Electron] Starting cozea-projectd failed (${error instanceof Error ? error.message : String(error)})`)
    return "failed"
  })
  try {
    await client.connect()
    const health = await client.health()
    console.log(
      `[Electron] Connected to cozea-projectd on ${client.socketPath} (version: ${health.version}, pid: ${health.pid}, ${outcome})`,
    )
  } catch (err: any) {
    // Non-blocking: the app runs without the daemon, and live sessions report it.
    console.log(`[Electron] cozea-projectd is not reachable (${err?.message})`)
  }
}

export function disposeProjectdService(): void {
  resetSharedProjectdClient()
}
