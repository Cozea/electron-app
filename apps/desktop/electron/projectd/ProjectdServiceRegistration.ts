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
import { WorkspaceCatalogBridge } from "./WorkspaceCatalogBridge"
import { getCatalogSnapshot, subscribeCatalogSnapshot } from "../workspaces/CatalogSnapshot"
import {
  ensureProjectdRunning,
  type ProjectdLaunchContext,
  type ProjectdLauncherEffects,
  type ProjectdLaunchOutcome,
} from "./ProjectdLauncher"

const PROBE_TIMEOUT_MS = 1_000
let bridge: WorkspaceCatalogBridge | null = null
let bridgeUnsubscribe: (() => void) | null = null
let bridgeTimer: NodeJS.Timeout | null = null
let daemonPid: number | null = null
let bridgeSweepRunning = false

async function reconcileCatalogBridge(): Promise<void> {
  if (bridgeSweepRunning || !bridge) return
  bridgeSweepRunning = true
  const activeBridge = bridge
  try {
    const health = await getSharedProjectdClient().health()
    if (daemonPid !== health.pid) {
      activeBridge.resetAcknowledgments()
      daemonPid = health.pid
    }
    await activeBridge.enqueue(await getCatalogSnapshot())
  } catch {
    // Local projects remain available while the daemon is absent. The next
    // local sweep retries; shared-session entry reports daemon availability.
  } finally { bridgeSweepRunning = false }
}

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
    workspaceCatalogPath: path.join(app.getPath("userData"), "local-workspaces.sqlite"),
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
        const env = { ...process.env, ...options.environment }
        delete env.ELECTRON_RUN_AS_NODE
        if (!app.isPackaged) {
          const devHelper = path.join(findRepoRoot(app.getAppPath()), "build", "projectd-helper", "cozea-projectd-mac-helper")
          if (fs.existsSync(devHelper)) {
            env.COZEA_MAC_HELPER_PATH = devHelper
          }
        }
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
  if (!bridge) {
    const lastErrors = new Map<string, string>()
    bridge = new WorkspaceCatalogBridge({
      register: (request) => client.registerWorkspace(request),
      onError: (workspaceId, error) => {
        if (lastErrors.get(workspaceId) === error) return
        lastErrors.set(workspaceId, error)
        console.warn(`[WorkspaceCatalogBridge] ${workspaceId}: ${error}`)
      },
    })
    bridgeUnsubscribe = subscribeCatalogSnapshot(() => { void reconcileCatalogBridge() })
    bridgeTimer = setInterval(() => { void reconcileCatalogBridge() }, 10_000)
    bridgeTimer.unref()
  }
  try {
    await client.connect()
    const health = await client.health()
    console.log(
      `[Electron] Connected to cozea-projectd on ${client.socketPath} (version: ${health.version}, pid: ${health.pid}, ${outcome})`,
    )
    await reconcileCatalogBridge()
  } catch (err: any) {
    // Non-blocking: the app runs without the daemon, and live sessions report it.
    console.log(`[Electron] cozea-projectd is not reachable (${err?.message})`)
  }
}

export function disposeProjectdService(): void {
  bridge?.stop()
  bridge = null
  bridgeUnsubscribe?.()
  bridgeUnsubscribe = null
  if (bridgeTimer) clearInterval(bridgeTimer)
  bridgeTimer = null
  daemonPid = null
  resetSharedProjectdClient()
}
