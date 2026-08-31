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

/**
 * Worker protocol versions are monotonic integers, independent from manifest versions.
 *
 * A package targets one exact version. The host never silently downgrades it: doing so
 * could make a worker believe an operation or authorization rule exists when this Cozea
 * build cannot enforce it. Hosts may retain several versions during a migration window;
 * today the first protocol is the only supported one.
 */
export const DEV_APP_WORKER_SUPPORTED_PROTOCOL_VERSIONS: ReadonlyArray<number> = [1]
/** Missing pre-Phase-6 version fields always mean v1, even after newer versions ship. */
export const DEV_APP_WORKER_LEGACY_PROTOCOL_VERSION = 1
export const DEV_APP_WORKER_PROTOCOL_MIN_VERSION = DEV_APP_WORKER_SUPPORTED_PROTOCOL_VERSIONS[0]!
export const DEV_APP_WORKER_PROTOCOL_VERSION = DEV_APP_WORKER_SUPPORTED_PROTOCOL_VERSIONS.at(-1)!

export function supportsDevAppWorkerProtocolVersion(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    DEV_APP_WORKER_SUPPORTED_PROTOCOL_VERSIONS.includes(value)
  )
}

export interface DevAppWorkerPortBootstrap {
  kind: "cozea-devapp-port"
  /** The exact protocol selected from the package manifest. */
  protocolVersion: number
  /** The range this host can execute, for actionable client diagnostics. */
  supportedProtocolVersions: { min: number; max: number }
}

export interface DevAppWorkerRequest {
  kind: "request"
  protocolVersion: number
  /** Correlates a response. Opaque to the host beyond being a bounded string. */
  id: string
  method: string
  params?: unknown
}

export interface DevAppWorkerResponse {
  kind: "response"
  protocolVersion: number
  id: string
  result?: unknown
  error?: DevAppWorkerError
}

/** Host-to-worker or worker-to-host, unacknowledged. */
export interface DevAppWorkerEvent {
  kind: "event"
  protocolVersion: number
  topic: string
  payload?: unknown
}

export type DevAppWorkerMessage = DevAppWorkerRequest | DevAppWorkerResponse | DevAppWorkerEvent

export type DevAppWorkerErrorCode =
  | "unknown-method"
  | "capability-denied"
  | "authorization-expired"
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
  "project.writeFile": "project.write",
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
/** Includes enough room for the host's bounded 5 MiB text-file operations. */
export const MAX_DEV_APP_WORKER_MESSAGE_BYTES = 12 * 1024 * 1024

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Rejects oversized structured-clone graphs before authorization or handler dispatch.
 *
 * The port has already cloned the value by the time main sees it, so this is not an OS-level
 * memory boundary. It does prevent a retained or repeatedly-dispatched graph from multiplying
 * inside the host. Cycles are counted once and exotic cloneable containers are included.
 */
function isWithinMessageBudget(value: unknown): boolean {
  let estimatedBytes = 0
  const pending: unknown[] = [value]
  const seen = new WeakSet<object>()

  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === "string") estimatedBytes += current.length * 2
    else if (typeof current === "number" || typeof current === "bigint") estimatedBytes += 8
    else if (typeof current === "boolean") estimatedBytes += 4
    else if (current && typeof current === "object") {
      if (seen.has(current)) continue
      seen.add(current)
      if (current instanceof ArrayBuffer) estimatedBytes += current.byteLength
      else if (ArrayBuffer.isView(current)) estimatedBytes += current.byteLength
      else if (current instanceof Map) {
        estimatedBytes += current.size * 16
        for (const [key, entry] of current) pending.push(key, entry)
      } else if (current instanceof Set) {
        estimatedBytes += current.size * 8
        for (const entry of current) pending.push(entry)
      } else {
        const entries = Object.entries(current)
        estimatedBytes += entries.length * 8
        for (const [key, entry] of entries) {
          estimatedBytes += key.length * 2
          pending.push(entry)
        }
      }
    }
    if (estimatedBytes > MAX_DEV_APP_WORKER_MESSAGE_BYTES) return false
  }
  return true
}

/**
 * Parses a message off the port, returning null for anything malformed.
 *
 * Deliberately not a type assertion. A worker can send whatever it likes, including a
 * shape that would satisfy TypeScript at compile time and nothing at runtime.
 */
export function parseWorkerMessage(
  value: unknown,
  expectedProtocolVersion: number = DEV_APP_WORKER_PROTOCOL_VERSION,
): DevAppWorkerMessage | null {
  if (!isWithinMessageBudget(value)) return null
  if (!isPlainObject(value)) return null
  if (!supportsDevAppWorkerProtocolVersion(expectedProtocolVersion)) return null
  // Version parsers are intentionally explicit. Extending the supported-version list
  // without adding the corresponding parser must fail closed, not inherit v1 shapes.
  if (expectedProtocolVersion !== DEV_APP_WORKER_LEGACY_PROTOCOL_VERSION) return null

  // Early development workers predated the explicit envelope field. Missing means v1
  // only; no later version inherits this alias, and an explicit mismatch always fails.
  const protocolVersion =
    value.protocolVersion === undefined
      ? DEV_APP_WORKER_LEGACY_PROTOCOL_VERSION
      : value.protocolVersion
  if (protocolVersion !== expectedProtocolVersion) return null

  if (value.kind === "request") {
    if (!isBoundedString(value.id, MAX_ID_LENGTH)) return null
    if (!isBoundedString(value.method, MAX_METHOD_LENGTH)) return null
    return {
      kind: "request",
      protocolVersion,
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
      protocolVersion,
      id: value.id,
      ...(hasResult ? { result: value.result } : {}),
      ...(hasError ? { error: value.error as DevAppWorkerError } : {}),
    }
  }

  if (value.kind === "event") {
    if (!isBoundedString(value.topic, MAX_TOPIC_LENGTH)) return null
    return {
      kind: "event",
      protocolVersion,
      topic: value.topic,
      ...(value.payload === undefined ? {} : { payload: value.payload }),
    }
  }

  return null
}

export function workerErrorResponse(
  id: string,
  error: DevAppWorkerError,
  protocolVersion: number = DEV_APP_WORKER_PROTOCOL_VERSION,
): DevAppWorkerResponse {
  return { kind: "response", protocolVersion, id, error }
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
