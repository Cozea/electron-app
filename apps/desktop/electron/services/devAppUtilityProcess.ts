import { MessageChannelMain, utilityProcess } from "electron"

import type { DevAppWorkerProcess, DevAppWorkerSpawn } from "./DevAppWorkerHost"

/**
 * Runs a DevApp worker in an Electron `utilityProcess`.
 *
 * A utility process is the right host for third-party code: it does not share a heap
 * with main the way `worker_threads` would, and unlike `child_process.fork` its lifetime
 * is managed by Electron, so a worker cannot outlive the app that spawned it.
 *
 * This file is the boundary adapter — the only part of the worker system that touches
 * Electron directly. All supervision logic lives in `DevAppWorkerHost` against the
 * `DevAppWorkerProcess` interface, which is what makes crash handling, restarts, leases,
 * and the capability gate testable without spawning anything.
 */

const WORKER_ENV_ALLOWLIST = ["PATH", "HOME", "TMPDIR"] as const

export interface DevAppUtilityProcessOptions {
  /** Absolute path to the worker entrypoint inside the installed package. */
  entrypoint: string
  publicationId: string
  /** The app's own writable directory, the only path it is handed at startup. */
  dataDir: string
}

export function createUtilityProcessSpawn(
  resolveOptions: (input: { entrypoint: string; publicationId: string }) => DevAppUtilityProcessOptions,
): DevAppWorkerSpawn {
  return (input) => {
    const options = resolveOptions(input)
    const channel = new MessageChannelMain()

    // A minimal environment, matching how service releases are started: the worker gets
    // no inherited shell, no credentials, and no project paths it was not granted.
    const child = utilityProcess.fork(options.entrypoint, [], {
      serviceName: `cozea-devapp-${options.publicationId}`,
      stdio: "pipe",
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=512",
        COZEA_DEVAPP_DATA_DIR: options.dataDir,
        ...Object.fromEntries(
          WORKER_ENV_ALLOWLIST.flatMap((name) => {
            const value = process.env[name]
            return value === undefined ? [] : [[name, value]]
          }),
        ),
      },
    })

    // Hand the worker one end of the port; the host keeps the other. Everything the
    // worker asks for travels over this channel and through the capability gate.
    child.postMessage({ kind: "cozea-devapp-port" }, [channel.port2])

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
