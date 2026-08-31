import path from "node:path"

import {
  grantFingerprint,
  normalizeGrant,
  type DevAppGrant,
} from "../../../../shared/devAppCapabilities"
import {
  DEV_APP_WORKER_PROTOCOL_MIN_VERSION,
  DEV_APP_WORKER_PROTOCOL_VERSION,
  authorizeWorkerMethod,
  parseWorkerMessage,
  supportsDevAppWorkerProtocolVersion,
  workerErrorResponse,
  type DevAppWorkerError,
  type DevAppWorkerMessage,
  type DevAppWorkerRequest,
  type DevAppWorkerResponse,
} from "../../../../shared/devAppWorkerProtocol"

/**
 * Supervises DevApp worker processes and gates everything they ask for.
 *
 * The worker runs out of process so third-party code neither shares a heap with the main
 * process nor outlives the app. Authorization happens here rather than in the worker or
 * the view: a worker asks, the host decides, and a denial is a normal response rather
 * than a crash.
 *
 * The process abstraction is injected so the supervision logic — crash detection,
 * restart, lease lifecycle, log capture — is testable without spawning Electron.
 */

export interface DevAppWorkerProcess {
  postMessage: (message: unknown) => void
  onMessage: (listener: (message: unknown) => void) => void
  onExit: (listener: (code: number | null) => void) => void
  onLog: (listener: (line: string) => void) => void
  kill: () => void
}

export type DevAppWorkerSpawn = (options: {
  entrypoint: string
  packageRoot: string
  publicationId: string
  protocolVersion: number
}) => DevAppWorkerProcess

/**
 * What a worker is bound to for its whole life.
 *
 * Established when the worker starts and never taken from a request. A worker that could
 * name its own workspace could reach past the grant it was approved under, so handlers
 * receive the binding and ignore any workspace the params claim.
 */
export interface DevAppWorkerBinding {
  workspaceId: string
  workspaceRoot: string
  dataDir?: string
}

/** Handles a request the gate has already authorized. */
export type DevAppWorkerMethodHandler = (
  request: DevAppWorkerRequest,
  context: { publicationId: string; binding: DevAppWorkerBinding },
) => Promise<unknown>

export type DevAppWorkerStatus = "starting" | "ready" | "stopped" | "crashed"

export interface DevAppWorkerState {
  publicationId: string
  protocolVersion: number
  status: DevAppWorkerStatus
  restarts: number
  lastError: string | null
  logs: string[]
}

const MAX_LOG_LINES = 200
const MAX_RESTARTS = 3
const MAX_PENDING_REQUESTS = 16
const MAX_ACTIVE_WORKERS = 16
const MAX_LEASES_PER_WORKER = 64

interface ActiveWorker {
  process: DevAppWorkerProcess
  grant: DevAppGrant
  binding: DevAppWorkerBinding
  entrypoint: string
  packageRoot: string
  authorizationExpiresAt: number | null
  state: DevAppWorkerState
  leases: Set<string>
  inFlight: number
  expiryTimer: unknown | null
  disposed: boolean
}

export class DevAppWorkerHost {
  private readonly workers = new Map<string, ActiveWorker>()

  private readonly spawn: DevAppWorkerSpawn
  private readonly handlers: Readonly<Record<string, DevAppWorkerMethodHandler>>
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, milliseconds: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(
    spawn: DevAppWorkerSpawn,
    handlers: Readonly<Record<string, DevAppWorkerMethodHandler>>,
    now: () => number = () => Date.now(),
    timers: {
      set: (callback: () => void, milliseconds: number) => unknown
      clear: (handle: unknown) => void
    } = {
      set: (callback, milliseconds) => setTimeout(callback, milliseconds),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  ) {
    this.spawn = spawn
    this.handlers = handlers
    this.now = now
    this.setTimer = timers.set
    this.clearTimer = timers.clear
  }

  /**
   * Starts a worker, or joins one already running.
   *
   * A lease is what keeps it alive: a tile holds one while open, an agent session holds
   * one for the duration of a call, and a user pin holds one indefinitely. The worker
   * stops when the last lease is released, which is how one mechanism serves the tile,
   * agent, and background surfaces alike.
   */
  start(options: {
    publicationId: string
    entrypoint: string
    packageRoot: string
    protocolVersion: number
    grant: DevAppGrant
    authorizationExpiresAt: number | null
    binding: DevAppWorkerBinding
    leaseId: string
  }): DevAppWorkerState {
    assertWorkerIdentity(options.publicationId, options.leaseId)
    if (!supportsDevAppWorkerProtocolVersion(options.protocolVersion)) {
      throw new RangeError(
        `Unsupported DevApp worker protocol ${String(options.protocolVersion)}; supported range is ${DEV_APP_WORKER_PROTOCOL_MIN_VERSION}-${DEV_APP_WORKER_PROTOCOL_VERSION}.`,
      )
    }
    const entrypoint = path.resolve(options.entrypoint)
    const packageRoot = path.resolve(options.packageRoot)
    if (!isPathInside(packageRoot, entrypoint)) {
      throw new Error("The DevApp worker entrypoint must be inside its package.")
    }
    if (
      options.authorizationExpiresAt !== null &&
      (!Number.isFinite(options.authorizationExpiresAt) || options.authorizationExpiresAt <= 0)
    ) {
      throw new Error("The DevApp worker authorization expiry is invalid.")
    }
    if (
      options.authorizationExpiresAt !== null &&
      options.authorizationExpiresAt <= this.now()
    ) {
      throw new Error("The DevApp worker authorization has expired.")
    }
    const normalizedOptions = {
      ...options,
      entrypoint,
      packageRoot,
      grant: normalizeGrant(options.grant),
    }
    const existing = this.workers.get(options.publicationId)
    if (existing && !existing.disposed) {
      if (existing.state.protocolVersion !== normalizedOptions.protocolVersion) {
        throw new Error("A running DevApp worker cannot change protocol versions in place.")
      }
      if (!sameBinding(existing.binding, normalizedOptions.binding)) {
        throw new Error("A running DevApp worker cannot change workspace bindings in place.")
      }
      const executionChanged =
        existing.entrypoint !== normalizedOptions.entrypoint ||
        existing.packageRoot !== normalizedOptions.packageRoot ||
        grantFingerprint(existing.grant) !== grantFingerprint(normalizedOptions.grant) ||
        existing.authorizationExpiresAt !== normalizedOptions.authorizationExpiresAt
      if (executionChanged) {
        const leases = new Set(existing.leases)
        leases.add(normalizedOptions.leaseId)
        if (leases.size > MAX_LEASES_PER_WORKER) {
          throw new Error("This DevApp worker has too many active leases.")
        }
        this.stop(normalizedOptions.publicationId)
        const state = this.launch(
          { ...normalizedOptions, leaseId: leases.values().next().value! },
          0,
        )
        const replacement = this.workers.get(normalizedOptions.publicationId)
        if (replacement) for (const lease of leases) replacement.leases.add(lease)
        return state
      }
      if (
        !existing.leases.has(normalizedOptions.leaseId) &&
        existing.leases.size >= MAX_LEASES_PER_WORKER
      ) {
        throw new Error("This DevApp worker has too many active leases.")
      }
      existing.leases.add(normalizedOptions.leaseId)
      return existing.state
    }
    if (this.workers.size >= MAX_ACTIVE_WORKERS) {
      throw new Error("Too many DevApp workers are active.")
    }
    return this.launch(normalizedOptions, 0)
  }

  private launch(
    options: {
      publicationId: string
      entrypoint: string
      packageRoot: string
      protocolVersion: number
      grant: DevAppGrant
      authorizationExpiresAt: number | null
      binding: DevAppWorkerBinding
      leaseId: string
    },
    restarts: number,
  ): DevAppWorkerState {
    const state: DevAppWorkerState = {
      publicationId: options.publicationId,
      protocolVersion: options.protocolVersion,
      status: "starting",
      restarts,
      lastError: null,
      logs: [],
    }

    const process = this.spawn({
      entrypoint: options.entrypoint,
      packageRoot: options.packageRoot,
      publicationId: options.publicationId,
      protocolVersion: options.protocolVersion,
    })
    const worker: ActiveWorker = {
      process,
      grant: options.grant,
      binding: options.binding,
      entrypoint: options.entrypoint,
      packageRoot: options.packageRoot,
      authorizationExpiresAt: options.authorizationExpiresAt,
      state,
      leases: new Set([options.leaseId]),
      inFlight: 0,
      expiryTimer: null,
      disposed: false,
    }
    this.workers.set(options.publicationId, worker)
    this.scheduleAuthorizationExpiry(options.publicationId, worker)

    process.onLog((line) => {
      this.appendLog(state, line)
    })

    process.onMessage((raw) => {
      void this.handleMessage(options.publicationId, raw)
    })

    process.onExit((code) => {
      const current = this.workers.get(options.publicationId)
      if (!current || current.process !== process) return
      if (current.disposed) {
        current.state.status = "stopped"
        return
      }
      if (current.expiryTimer !== null) {
        this.clearTimer(current.expiryTimer)
        current.expiryTimer = null
      }
      // An exit nobody asked for is a crash. Restart while leases are still held, so a
      // worker dying does not take down the tile that is holding it open.
      current.state.status = "crashed"
      current.state.lastError = `Worker exited with code ${code ?? "unknown"}.`
      if (current.leases.size > 0 && restarts < MAX_RESTARTS) {
        const leases = [...current.leases]
        const relaunched = this.launch({ ...options, leaseId: leases[0]! }, restarts + 1)
        const next = this.workers.get(options.publicationId)
        if (next) for (const lease of leases) next.leases.add(lease)
        for (const line of current.state.logs.slice(-20)) this.appendLog(relaunched, line)
      }
    })

    state.status = "ready"
    return state
  }

  /** Releases a lease; the worker stops when the last one goes. */
  release(publicationId: string, leaseId: string): void {
    const worker = this.workers.get(publicationId)
    if (!worker) return
    worker.leases.delete(leaseId)
    if (worker.leases.size === 0) this.stop(publicationId)
  }

  stop(publicationId: string): void {
    const worker = this.workers.get(publicationId)
    if (!worker) return
    worker.disposed = true
    worker.state.status = "stopped"
    worker.leases.clear()
    if (worker.expiryTimer !== null) this.clearTimer(worker.expiryTimer)
    worker.expiryTimer = null
    worker.process.kill()
    this.workers.delete(publicationId)
  }

  getState(publicationId: string): DevAppWorkerState | null {
    return this.workers.get(publicationId)?.state ?? null
  }

  private scheduleAuthorizationExpiry(publicationId: string, worker: ActiveWorker): void {
    if (worker.authorizationExpiresAt === null) return
    const remaining = worker.authorizationExpiresAt - this.now()
    const delay = Math.max(0, Math.min(remaining, 2_147_483_647))
    worker.expiryTimer = this.setTimer(() => {
      const current = this.workers.get(publicationId)
      if (!current || current !== worker || current.disposed) return
      current.expiryTimer = null
      if (current.authorizationExpiresAt !== null && current.authorizationExpiresAt <= this.now()) {
        this.appendLog(current.state, "Stopped after its authorization expired.")
        this.stop(publicationId)
      } else {
        this.scheduleAuthorizationExpiry(publicationId, current)
      }
    }, delay)
  }

  private async handleMessage(publicationId: string, raw: unknown): Promise<void> {
    const worker = this.workers.get(publicationId)
    if (!worker || worker.disposed) return

    const message: DevAppWorkerMessage | null = parseWorkerMessage(
      raw,
      worker.state.protocolVersion,
    )
    if (!message) {
      // A malformed message is dropped rather than answered: there is no id to reply to,
      // and echoing unparsed input back would be its own hazard.
      this.appendLog(worker.state, "Dropped a malformed message from the worker.")
      return
    }
    if (message.kind !== "request") return

    if (
      worker.authorizationExpiresAt !== null &&
      worker.authorizationExpiresAt <= this.now()
    ) {
      this.respond(
        worker,
        workerErrorResponse(
          message.id,
          {
            code: "authorization-expired",
            message: "This DevApp's authorization has expired.",
          },
          worker.state.protocolVersion,
        ),
      )
      this.appendLog(worker.state, "Stopped after its authorization expired.")
      this.stop(publicationId)
      return
    }

    if (worker.inFlight >= MAX_PENDING_REQUESTS) {
      this.respond(
        worker,
        workerErrorResponse(
          message.id,
          {
            code: "internal-error",
            message: "Too many requests in flight.",
          },
          worker.state.protocolVersion,
        ),
      )
      return
    }

    const authorization = authorizeWorkerMethod(message.method, worker.grant)
    if (!authorization.allowed) {
      // A denial is an ordinary response. Killing the worker for asking would make an
      // over-broad manifest an outage rather than a fixable mistake.
      this.respond(
        worker,
        workerErrorResponse(message.id, authorization.error, worker.state.protocolVersion),
      )
      return
    }

    const handler = this.handlers[message.method]
    if (!handler) {
      this.respond(
        worker,
        workerErrorResponse(
          message.id,
          {
            code: "unknown-method",
            message: `${message.method} has no handler.`,
          },
          worker.state.protocolVersion,
        ),
      )
      return
    }

    worker.inFlight += 1
    try {
      const result = await handler(message, { publicationId, binding: worker.binding })
      this.respond(worker, {
        kind: "response",
        protocolVersion: worker.state.protocolVersion,
        id: message.id,
        result: result ?? null,
      })
    } catch (error) {
      // Handler failures must not leak host internals to worker code.
      const detail = error instanceof Error ? error.message : "The request failed."
      const responseError: DevAppWorkerError = {
        code: "internal-error",
        message: "The host could not complete this request.",
      }
      this.appendLog(worker.state, `${message.method} failed: ${detail}`)
      this.respond(
        worker,
        workerErrorResponse(message.id, responseError, worker.state.protocolVersion),
      )
    } finally {
      worker.inFlight -= 1
    }
  }

  private respond(worker: ActiveWorker, response: DevAppWorkerResponse): void {
    if (worker.disposed) return
    try {
      worker.process.postMessage(response)
    } catch {
      // The port closed between dispatch and reply; the exit handler owns recovery.
    }
  }

  private appendLog(state: DevAppWorkerState, line: string): void {
    state.logs.push(line.slice(0, 2048))
    if (state.logs.length > MAX_LOG_LINES) {
      state.logs.splice(0, state.logs.length - MAX_LOG_LINES)
    }
  }

  dispose(): void {
    // Snapshot first: stop() deletes from the map being iterated.
    for (const publicationId of Array.from(this.workers.keys())) this.stop(publicationId)
  }
}

function isPathInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

function sameBinding(left: DevAppWorkerBinding, right: DevAppWorkerBinding): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    path.resolve(left.workspaceRoot) === path.resolve(right.workspaceRoot) &&
    (left.dataDir ? path.resolve(left.dataDir) : null) ===
      (right.dataDir ? path.resolve(right.dataDir) : null)
  )
}

function assertWorkerIdentity(publicationId: string, leaseId: string): void {
  const validPublication =
    /^[A-Za-z0-9_-]{1,128}$/.test(publicationId) || /^dev:[0-9a-f]{32}$/.test(publicationId)
  if (!validPublication) throw new Error("The DevApp worker identity is invalid.")
  if (typeof leaseId !== "string" || leaseId.length === 0 || leaseId.length > 192) {
    throw new Error("The DevApp worker lease is invalid.")
  }
}
