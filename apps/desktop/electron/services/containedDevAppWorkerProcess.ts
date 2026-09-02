import type {
  DevAppContainedRuntimeState,
  DevAppContainedRuntimeTransportEnvelope,
} from "../../../../shared/devAppContainedRuntime"
import type { DevAppWorkerProcess, DevAppWorkerSpawn } from "./DevAppWorkerHost"
import type {
  ContainedRuntimeListener,
  ContainedRuntimeLogEvent,
  ContainedRuntimeMessageEvent,
  ContainedRuntimeStateEvent,
} from "./ContainedDevAppRuntimeService"
import { parseWorkerMessage } from "../../../../shared/devAppWorkerProtocol"

const WORKER_READY_TIMEOUT_MS = 60_000

interface BridgePort {
  postMessage(message: unknown): void
  on(event: "message", listener: (event: { data: unknown }) => void): void
  on(event: "close", listener: () => void): void
  start(): void
  close(): void
}

export interface ContainedDevAppWorkerRuntime {
  on(event: "log", listener: (event: ContainedRuntimeLogEvent) => void): () => void
  on(event: "state", listener: (event: ContainedRuntimeStateEvent) => void): () => void
  on(event: "message", listener: (event: ContainedRuntimeMessageEvent) => void): () => void
  on(event: "log" | "state" | "message", listener: ContainedRuntimeListener): () => void
  sendMessage(runtimeId: string, transport: DevAppContainedRuntimeTransportEnvelope): Promise<void>
  stop(runtimeId: string): Promise<DevAppContainedRuntimeState>
  delete(runtimeId: string): Promise<DevAppContainedRuntimeState | null>
}

export interface ContainedDevAppWorkerStart {
  runtimeId: string
  runtime: ContainedDevAppWorkerRuntime
  start(): Promise<DevAppContainedRuntimeState>
}

export function createContainedDevAppWorkerSpawn(
  resolveStart: (input: {
    entrypoint: string
    packageRoot: string
    publicationId: string
    protocolVersion: number
  }) => ContainedDevAppWorkerStart,
  isRuntimeReady: (runtimeId: string) => boolean = () => false,
  stopRuntime?: (runtimeId: string) => Promise<void>,
): DevAppWorkerSpawn {
  return (input) => {
    const resolved = resolveStart(input)
    const { runtime, runtimeId } = resolved
    const messageListeners = new Set<(message: unknown) => void>()
    const exitListeners = new Set<(code: number | null) => void>()
    const logListeners = new Set<(line: string) => void>()
    const ports = new Map<string, BridgePort>()
    let exited = false
    let runtimeReadySettled = false
    let resolveRuntimeReady!: () => void
    let rejectRuntimeReady!: (error: Error) => void
    const runtimeReady = new Promise<void>((resolve, reject) => {
      resolveRuntimeReady = resolve
      rejectRuntimeReady = reject
    })
    const readyTimer = setTimeout(() => {
      if (runtimeReadySettled) return
      runtimeReadySettled = true
      rejectRuntimeReady(new Error("The contained DevApp worker did not become ready in time."))
    }, WORKER_READY_TIMEOUT_MS)
    void runtimeReady.catch(() => undefined)

    const emitExit = (code: number | null) => {
      if (exited) return
      exited = true
      clearTimeout(readyTimer)
      if (!runtimeReadySettled) {
        runtimeReadySettled = true
        rejectRuntimeReady(new Error("The contained DevApp worker exited before it became ready."))
      }
      for (const remove of removers.splice(0)) remove()
      for (const port of ports.values()) {
        try {
          port.close()
        } catch {
          /* already closed */
        }
      }
      ports.clear()
      for (const listener of exitListeners) listener(code)
    }
    const removers = [
      runtime.on("message", (event) => {
        if (event.runtimeId !== runtimeId) return
        const envelope = event.transport
        if (envelope.channel === "host") {
          const parsed = parseWorkerMessage(envelope.message, input.protocolVersion)
          if (parsed?.kind === "event" && parsed.topic === "runtime.ready") {
            clearTimeout(readyTimer)
            if (!runtimeReadySettled) {
              runtimeReadySettled = true
              resolveRuntimeReady()
            }
          }
          for (const listener of messageListeners) listener(envelope.message)
          return
        }
        if (!envelope.connectionId) return
        const port = ports.get(envelope.connectionId)
        if (!port) return
        if (envelope.close) {
          ports.delete(envelope.connectionId)
          try {
            port.close()
          } catch {
            /* already closed */
          }
        } else {
          try {
            port.postMessage(envelope.message)
          } catch {
            ports.delete(envelope.connectionId)
          }
        }
      }),
      runtime.on("log", (event) => {
        if (event.runtimeId !== runtimeId) return
        for (const listener of logListeners) listener(event.message.slice(0, 2048))
      }),
      runtime.on("state", (event) => {
        if (event.runtimeId !== runtimeId) return
        if (event.state.status === "stopped") emitExit(event.state.exitCode)
        if (event.state.status === "failed") emitExit(event.state.exitCode ?? 1)
      }),
    ]
    if (isRuntimeReady(runtimeId)) {
      clearTimeout(readyTimer)
      if (!runtimeReadySettled) {
        runtimeReadySettled = true
        resolveRuntimeReady()
      }
    }

    const ready = resolved
      .start()
      .then(async (state) => {
        if (state.status !== "running") {
          throw new Error(state.error ?? "The contained DevApp worker did not start.")
        }
        await runtimeReady
      })
      .catch((error) => {
        clearTimeout(readyTimer)
        emitExit(1)
        throw error
      })

    const send = (transport: DevAppContainedRuntimeTransportEnvelope) => {
      void ready
        .then(() => runtime.sendMessage(runtimeId, transport))
        .catch((error) => {
          const message = error instanceof Error ? error.message : "The contained worker transport failed."
          for (const listener of logListeners) listener(message.slice(0, 2048))
        })
    }

    const process: DevAppWorkerProcess = {
      ready,
      postMessage: (message) => send({ channel: "host", message }),
      attachViewPort: (bootstrap, transferable) => {
        if (exited) throw new Error("The contained DevApp worker is unavailable.")
        const port = transferable as BridgePort
        const connectionId = bootstrap.connectionId
        ports.get(connectionId)?.close()
        ports.set(connectionId, port)
        port.on("message", (event) => {
          send({ channel: "view", connectionId, message: event.data })
        })
        port.on("close", () => {
          if (ports.get(connectionId) !== port) return
          ports.delete(connectionId)
          send({ channel: "view", connectionId, close: true })
        })
        port.start()
      },
      onMessage: (listener) => {
        messageListeners.add(listener)
      },
      onExit: (listener) => {
        exitListeners.add(listener)
      },
      onLog: (listener) => {
        logListeners.add(listener)
      },
      kill: () => {
        if (exited) return
        void Promise.resolve()
          .then(async () => {
            if (stopRuntime) {
              await stopRuntime(runtimeId)
              return
            }
            await runtime.stop(runtimeId).catch(() => undefined)
            await runtime.delete(runtimeId).catch(() => undefined)
          })
          .catch(() => undefined)
          .finally(() => emitExit(null))
      },
    }
    return process
  }
}
