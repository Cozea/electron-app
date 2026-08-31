import fs from "node:fs"
import path from "node:path"

import { MessageChannelMain, utilityProcess } from "electron"

import {
  DEV_APP_WORKER_PROTOCOL_MIN_VERSION,
  DEV_APP_WORKER_PROTOCOL_VERSION,
  type DevAppWorkerPortBootstrap,
} from "../../../../shared/devAppWorkerProtocol"
import type { DevAppWorkerProcess, DevAppWorkerSpawn } from "./DevAppWorkerHost"

/**
 * Runs a DevApp worker in an Electron `utilityProcess`.
 *
 * A utility process gives local development workers a separate heap and an
 * Electron-managed lifetime. It is not an OS sandbox and is not the production runtime
 * for third-party published workers; that path remains blocked on the container phase.
 *
 * This file is the boundary adapter — the only part of the worker system that touches
 * Electron directly. All supervision logic lives in `DevAppWorkerHost` against the
 * `DevAppWorkerProcess` interface, which is what makes crash handling, restarts, leases,
 * and the capability gate testable without spawning anything.
 */

export interface DevAppUtilityProcessOptions {
  /** Absolute path to the worker entrypoint inside the installed package. */
  entrypoint: string
  /** Real package root; the worker may read its own bundled code and assets only. */
  packageRoot: string
  publicationId: string
  /** The app's own writable directory, the only path it is handed at startup. */
  dataDir: string
}

export function createUtilityProcessSpawn(
  resolveOptions: (input: {
    entrypoint: string
    packageRoot: string
    publicationId: string
    protocolVersion: number
  }) => DevAppUtilityProcessOptions,
): DevAppWorkerSpawn {
  return (input) => {
    const options = resolveOptions(input)
    const channel = new MessageChannelMain()
    const packageRoot = fs.realpathSync.native(options.packageRoot)
    const entrypoint = fs.realpathSync.native(options.entrypoint)
    const dataDir = fs.realpathSync.native(options.dataDir)
    if (!isInside(packageRoot, entrypoint)) {
      throw new Error("The DevApp worker entrypoint is outside its package.")
    }

    // The Node permission model is defense in depth around the capability port: direct
    // filesystem access is confined to the package and app-owned data, while direct
    // child-process, worker-thread, native-addon, inspector, and WASI access remains
    // denied. Electron 40's bundled Node does not permission-gate network access.
    // Published third-party workers therefore still require the container runtime;
    // Node's model is not represented as an OS sandbox.
    const child = utilityProcess.fork(entrypoint, [], {
      serviceName: `cozea-devapp-${options.publicationId}`,
      stdio: "pipe",
      cwd: packageRoot,
      execArgv: [
        "--max-old-space-size=512",
        "--permission",
        `--allow-fs-read=${packageRoot}`,
        `--allow-fs-read=${dataDir}`,
        `--allow-fs-write=${dataDir}`,
      ],
      env: {
        NODE_ENV: "production",
        COZEA_DEVAPP_DATA_DIR: dataDir,
      },
    })

    // Hand the worker one end of the port; the host keeps the other. Everything the
    // worker asks for travels over this channel and through the capability gate.
    const bootstrap: DevAppWorkerPortBootstrap = {
      kind: "cozea-devapp-port",
      protocolVersion: input.protocolVersion,
      supportedProtocolVersions: {
        min: DEV_APP_WORKER_PROTOCOL_MIN_VERSION,
        max: DEV_APP_WORKER_PROTOCOL_VERSION,
      },
    }
    child.postMessage(bootstrap, [channel.port2])

    let exited = false
    const process_: DevAppWorkerProcess = {
      postMessage: (message) => {
        if (!exited) channel.port1.postMessage(message)
      },
      onMessage: (listener) => {
        channel.port1.on("message", (event) => listener(event.data))
        channel.port1.start()
      },
      onExit: (listener) => {
        child.once("exit", (code) => {
          exited = true
          listener(typeof code === "number" ? code : null)
        })
      },
      onLog: (listener) => {
        const forward = (chunk: Buffer | string) => {
          for (const line of chunk.toString().split(/\r?\n/)) {
            if (line.length > 0) listener(line.slice(0, 2048))
          }
        }
        child.stdout?.on("data", forward)
        child.stderr?.on("data", forward)
      },
      kill: () => {
        exited = true
        try {
          channel.port1.close()
        } catch {
          // Already closed; the exit handler owns the rest.
        }
        child.kill()
      },
    }
    return process_
  }
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}
