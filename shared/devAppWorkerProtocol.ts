import {
  isDevAppCapability,
  type DevAppCapability,
  type DevAppGrant,
} from "./devAppCapabilities"

/**
 * The wire contract between a DevApp worker and its host.
 *
 * Two properties govern everything here. Worker code is authored by org members and by
 * agents, so every message crossing this boundary is untrusted input — nothing is
 * assumed well-formed. And authorization happens at the host: the view never holds
 * capability, the worker never decides what it may do, and a method with no entry in the
 * capability table is denied rather than allowed.
 */

export const DEV_APP_WORKER_PROTOCOL_VERSION = 1

export interface DevAppWorkerRequest {
  kind: "request"
  /** Correlates a response. Opaque to the host beyond being a bounded string. */
  id: string
  method: string
  params?: unknown
}

export interface DevAppWorkerResponse {
  kind: "response"
  id: string
  result?: unknown
  error?: DevAppWorkerError
}

/** Host-to-worker or worker-to-host, unacknowledged. */
export interface DevAppWorkerEvent {
  kind: "event"
  topic: string
  payload?: unknown
}

export type DevAppWorkerMessage = DevAppWorkerRequest | DevAppWorkerResponse | DevAppWorkerEvent

export type DevAppWorkerErrorCode =
  | "unknown-method"
  | "capability-denied"
  | "invalid-params"
  | "invalid-message"
  | "worker-unavailable"
  | "internal-error"

export interface DevAppWorkerError {
  code: DevAppWorkerErrorCode
  message: string
  /** Named only for capability-denied, so an author can see what to declare. */
  requiredCapability?: DevAppCapability
}

/**
 * Every host method a worker may call, and the capability it requires.
 *
 * This table is the authorization boundary. It is exhaustive by construction: a method
 * absent from it cannot be called, so adding a host method without deciding its
 * capability fails closed rather than shipping an ungated one.
 *
 * Method names mirror the existing IPC surface, including its scope split — `project.*`
 * is bounded to the granting workspace and `fs.*` is not, because that is a difference
 * in what the caller can reach, not a naming preference.
 */
export const DEV_APP_METHOD_CAPABILITIES: Readonly<Record<string, DevAppCapability>> = {
  "project.metadata": "project.metadata",
  "project.readFile": "project.read",
  "project.listDirectory": "project.read",
  "project.listFiles": "project.read",
  "project.writeFile": "project.write",

  "git.listBranches": "git.read",
  "git.status": "git.read",
  "git.checkout": "git.write",
  "git.createWorktree": "git.write",

  "fs.readFile": "fs.read",
  "fs.readDir": "fs.read",
  "fs.writeFile": "fs.write",

  "terminal.create": "terminal.spawn",
  "terminal.input": "terminal.spawn",
  "terminal.resize": "terminal.spawn",
  "terminal.kill": "terminal.spawn",

  "process.spawn": "process.spawn",

  "net.fetch": "net.outbound",

  "shell.open": "shell.open",
  "shell.reveal": "shell.reveal",
}

export function capabilityForMethod(method: string): DevAppCapability | null {
  if (typeof method !== "string") return null
  return Object.prototype.hasOwnProperty.call(DEV_APP_METHOD_CAPABILITIES, method)
    ? DEV_APP_METHOD_CAPABILITIES[method]!
    : null
}

export type DevAppAuthorization =
  | { allowed: true; capability: DevAppCapability }
  | { allowed: false; error: DevAppWorkerError }

/**
 * Decides whether a worker holding `grant` may call `method`.
 *
 * Fails closed in both directions: an unrecognized method is refused because it has no
 * capability, and a recognized one is refused unless the grant names its capability
 * exactly. Holding `terminal.spawn` does not imply `fs.read` here — escalation is a
 * truth about consequences, used to describe a grant honestly at approval time, never a
 * rule that widens what the gate lets through.
 */
export function authorizeWorkerMethod(method: string, grant: DevAppGrant): DevAppAuthorization {
  const capability = capabilityForMethod(method)
  if (!capability) {
    return {
      allowed: false,
      error: { code: "unknown-method", message: `${String(method)} is not a DevApp host method.` },
    }
  }
  if (!grant.capabilities.includes(capability)) {
    return {
      allowed: false,
      error: {
        code: "capability-denied",
        message: `This DevApp did not declare ${capability}.`,
        requiredCapability: capability,
      },
    }
  }
  return { allowed: true, capability }
}

const MAX_ID_LENGTH = 128
const MAX_METHOD_LENGTH = 64
const MAX_TOPIC_LENGTH = 64

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Parses a message off the port, returning null for anything malformed.
 *
 * Deliberately not a type assertion. A worker can send whatever it likes, including a
 * shape that would satisfy TypeScript at compile time and nothing at runtime.
 */
export function parseWorkerMessage(value: unknown): DevAppWorkerMessage | null {
  if (!isPlainObject(value)) return null

  if (value.kind === "request") {
    if (!isBoundedString(value.id, MAX_ID_LENGTH)) return null
    if (!isBoundedString(value.method, MAX_METHOD_LENGTH)) return null
    return {
      kind: "request",
      id: value.id,
      method: value.method,
      ...(value.params === undefined ? {} : { params: value.params }),
    }
  }

  if (value.kind === "response") {
    if (!isBoundedString(value.id, MAX_ID_LENGTH)) return null
    // A response carries a result or an error, never both and never neither.
    const hasResult = value.result !== undefined
    const hasError = value.error !== undefined
    if (hasResult === hasError) return null
    if (hasError && !isPlainObject(value.error)) return null
    return {
      kind: "response",
      id: value.id,
      ...(hasResult ? { result: value.result } : {}),
      ...(hasError ? { error: value.error as DevAppWorkerError } : {}),
    }
  }

  if (value.kind === "event") {
    if (!isBoundedString(value.topic, MAX_TOPIC_LENGTH)) return null
    return {
      kind: "event",
      topic: value.topic,
      ...(value.payload === undefined ? {} : { payload: value.payload }),
    }
  }

  return null
}

export function workerErrorResponse(id: string, error: DevAppWorkerError): DevAppWorkerResponse {
  return { kind: "response", id, error }
}

/**
 * The capabilities a worker declared, reduced to those actually reachable.
 *
 * A grant naming a capability no host method requires is not an error — it may be
 * forward-declared against a later protocol version — but it should not be presented to
 * a user as though it grants something today.
 */
export function reachableCapabilities(grant: DevAppGrant): DevAppCapability[] {
  const required = new Set(Object.values(DEV_APP_METHOD_CAPABILITIES))
  return grant.capabilities.filter((capability) => required.has(capability))
}

export function isKnownCapabilityName(value: unknown): value is DevAppCapability {
  return isDevAppCapability(value)
}
