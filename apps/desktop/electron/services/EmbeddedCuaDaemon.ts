import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { resolveUnpackagedBuildDir } from '../runtime/runtimeManifest'
import { CuaSocketClient } from './CuaSocketClient'

// Must match scripts/prepare-computer-use-runtime.mjs CUA_VERSION and the
// manifest the staging step writes. A version-skewed driver fails fast at
// startup instead of serving a mismatched socket dialect.
export const EXPECTED_CUA_DRIVER_VERSION = '0.28.1'

const require = createRequire(import.meta.url)
let electronApp: { on?: (event: string, listener: () => void) => void; getAppPath?: () => string } | undefined
try {
  const electron = require('electron')
  if (electron && typeof electron === 'object' && electron.app) {
    electronApp = electron.app
  }
} catch {}

export class EmbeddedCuaDaemon {
  private static instance: EmbeddedCuaDaemon | null = null

  static getInstance(): EmbeddedCuaDaemon {
    if (!this.instance) {
      this.instance = new EmbeddedCuaDaemon()
    }
    return this.instance
  }

  private child: ChildProcess | null = null
  private socketPath: string | null = null
  private startPromise: Promise<string> | null = null
  private ready = false
  // Bumped by every stop() so a start racing with teardown can detect that
  // its child is already orphaned instead of adopting it as the live daemon.
  private generation = 0

  constructor() {
    // Ensure clean teardown when Electron exits
    if (electronApp && typeof electronApp.on === 'function') {
      electronApp.on('will-quit', () => {
        void this.stop()
      })
    }
  }

  resolveExecutablePath(): string | null {
    if (process.platform !== 'darwin') return null

    // 1. Packaged Electron app resources
    if (process.resourcesPath) {
      const packaged = path.join(process.resourcesPath, 'computer-use-runtime', 'cua-driver')
      if (fs.existsSync(packaged)) return packaged
    }

    // 2. Unpackaged build directory
    try {
      const buildDir = resolveUnpackagedBuildDir('computer-use-runtime')
      const unpackaged = path.join(buildDir, 'cua-driver')
      if (fs.existsSync(unpackaged)) return unpackaged
    } catch {}

    // 3. Repository workspace root fallback
    const workspaceFallback = path.resolve(process.cwd(), 'build', 'computer-use-runtime', 'cua-driver')
    if (fs.existsSync(workspaceFallback)) return workspaceFallback

    return null
  }

  isInstalled(): boolean {
    return this.resolveExecutablePath() !== null
  }

  isReady(): boolean {
    return this.ready && this.child !== null && !this.child.killed && this.socketPath !== null
  }

  getSocketPath(): string | null {
    return this.socketPath
  }

  async ensureDaemon(): Promise<string> {
    if (this.isReady() && this.socketPath) {
      return this.socketPath
    }
    if (this.startPromise) {
      return this.startPromise
    }
    this.startPromise = this.start()
    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private async start(): Promise<string> {
    if (process.platform !== 'darwin') {
      throw new Error('Computer Use is currently available on macOS only.')
    }

    const binPath = this.resolveExecutablePath()
    if (!binPath) {
      throw new Error('Computer Use native runtime is not prepared. Run bun run prepare:computer-use.')
    }

    await this.stop()
    const myGeneration = this.generation

    // Generate short socket path (<80 chars to satisfy macOS sockaddr_un sun_path limit)
    const socketName = `cz-cua-${process.pid}-${randomBytes(3).toString('hex')}.sock`
    const targetSocket = path.join('/tmp', socketName)

    try {
      fs.unlinkSync(targetSocket)
    } catch {}

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CUA_DRIVER_EMBEDDED: '1',
      CUA_DRIVER_HOST_BUNDLE_ID: 'com.cozea.desktop',
      CUA_DRIVER_PERMISSION_MODE: 'standard',
      CUA_TELEMETRY_DISABLED: '1',
      DO_NOT_TRACK: '1',
    }

    const child = spawn(
      binPath,
      ['serve', '--embedded', '--socket', targetSocket, '--cursor-theme', 'cua.default'],
      {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    // A stop() racing with spawn must not orphan this child: if the
    // generation moved, kill it immediately instead of adopting it.
    if (myGeneration !== this.generation) {
      child.kill('SIGKILL')
      throw new Error('Cua Driver startup was superseded by teardown.')
    }
    this.child = child
    this.socketPath = targetSocket
    this.ready = false

    let stderrOutput = ''
    child.stderr?.on('data', (chunk) => {
      stderrOutput += chunk.toString('utf8')
    })

    child.on('exit', () => {
      // Only clear fields still pointing at this child: a late exit event
      // from a previous generation must not clobber its replacement.
      if (this.child !== child) return
      this.ready = false
      this.child = null
      try {
        fs.unlinkSync(targetSocket)
      } catch {}
      if (this.socketPath === targetSocket) this.socketPath = null
    })

    // Poll until UNIX socket accepts connections (up to 10 seconds)
    const startTime = Date.now()
    const maxWaitMs = 10_000

    while (Date.now() - startTime < maxWaitMs) {
      if (myGeneration !== this.generation) {
        child.kill('SIGKILL')
        throw new Error('Cua Driver startup was superseded by teardown.')
      }
      if (child.exitCode !== null) {
        const detail = stderrOutput.trim() || 'unknown error'
        const headlessHint =
          /NSPasteboard|generalPasteboard/.test(detail)
            ? ' The embedded driver needs a logged-in macOS GUI session.'
            : ''
        throw new Error(`Cua Driver daemon exited prematurely (code ${child.exitCode}): ${detail}.${headlessHint}`)
      }

      const connected = await new Promise<boolean>((resolve) => {
        const probe = net.createConnection(targetSocket)
        probe.once('connect', () => {
          probe.destroy()
          resolve(true)
        })
        probe.once('error', () => {
          probe.destroy()
          resolve(false)
        })
      })

      if (connected) {
        if (myGeneration !== this.generation || this.child !== child) {
          child.kill('SIGKILL')
          throw new Error('Cua Driver startup was superseded by teardown.')
        }
        // Fail fast on a version-skewed driver instead of serving a
        // mismatched socket dialect from a stale staged binary.
        let driverVersion: unknown
        try {
          const metadata = await CuaSocketClient.getMetadata(targetSocket)
          driverVersion = metadata.driver_version
        } catch (error) {
          child.kill('SIGKILL')
          throw new Error(
            `Cua Driver daemon did not answer metadata: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        if (driverVersion !== EXPECTED_CUA_DRIVER_VERSION) {
          child.kill('SIGKILL')
          throw new Error(
            `Staged Cua Driver is v${String(driverVersion)}, expected v${EXPECTED_CUA_DRIVER_VERSION}. Re-run bun run prepare:computer-use.`,
          )
        }
        this.ready = true
        return targetSocket
      }

      await new Promise((r) => setTimeout(r, 50))
    }

    child.kill('SIGKILL')
    throw new Error('Timed out waiting for Cua Driver daemon to bind to domain socket.')
  }

  async stop(): Promise<void> {
    this.generation += 1
    this.ready = false
    const child = this.child
    const socket = this.socketPath
    this.child = null
    this.socketPath = null

    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {}
          resolve()
        }, 1500)

        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }

    if (socket) {
      try {
        fs.unlinkSync(socket)
      } catch {}
    }
  }
}
