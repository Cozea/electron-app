import { createHash } from "node:crypto"

export type OrgDevAppRuntimeKind = "static" | "service"

export interface ServiceDevAppEnvironmentEntry {
  name: string
  required: boolean
  secret: boolean
  description?: string
}

export interface ServiceDevAppManifest {
  schemaVersion: 2
  kind: "service"
  platform: "linux"
  arch: "multi"
  framework: string
  runtime: {
    kind: "node"
    entrypoint: string
    args: string[]
  }
  server: {
    hostEnv: string
    portEnv: string
    healthPath: string
    startupTimeoutMs: number
  }
  environment: ServiceDevAppEnvironmentEntry[]
  permissions: {
    network: boolean
    persistentData: boolean
  }
}

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9@._+-]+$/
const SAFE_ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
const RESERVED_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "TMPDIR",
  "NODE_OPTIONS",
  "NODE_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "ELECTRON_RUN_AS_NODE",
  "PORT",
  "HOST",
  "HOSTNAME",
])

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function boundedString(value: unknown, label: string, max = 256): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > max || /[\0\r\n]/.test(normalized)) {
    throw new Error(`${label} is invalid.`)
  }
  return normalized
}

export function normalizeServiceDevAppPath(value: unknown, label: string): string {
  const normalized = boundedString(value, label, 512).replace(/\\/g, "/").replace(/^\.\//, "")
  const segments = normalized.split("/")
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === ".." || !SAFE_PATH_SEGMENT.test(segment))
  ) {
    throw new Error(`${label} must stay inside the DevApp artifact.`)
  }
  return segments.join("/")
}

function environmentName(value: unknown, label: string, allowReserved = false): string {
  const name = boundedString(value, label, 64)
  if (!SAFE_ENV_NAME.test(name) || (!allowReserved && (RESERVED_ENV_NAMES.has(name) || name.startsWith("COZEA_")))) {
    throw new Error(`${label} is reserved or invalid.`)
  }
  return name
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field ${key}.`)
  }
}

export function parseServiceDevAppManifest(value: unknown): ServiceDevAppManifest {
  const root = objectValue(value, "DevApp manifest")
  exactKeys(
    root,
    ["schemaVersion", "kind", "platform", "arch", "framework", "runtime", "server", "environment", "permissions"],
    "DevApp manifest",
  )
  if (root.schemaVersion !== 2 || root.kind !== "service" || root.platform !== "linux" || root.arch !== "multi") {
    throw new Error("This Service DevApp manifest version or platform is unsupported.")
  }
  const runtime = objectValue(root.runtime, "runtime")
  exactKeys(runtime, ["kind", "entrypoint", "args"], "runtime")
  if (runtime.kind !== "node") throw new Error("Only the bundled Node runtime is supported.")
  const args = runtime.args
  if (
    !Array.isArray(args) ||
    args.length > 16 ||
    args.some((arg) => typeof arg !== "string" || arg.length > 256 || /[\0\r\n]/.test(arg))
  ) {
    throw new Error("runtime.args is invalid.")
  }
  const server = objectValue(root.server, "server")
  exactKeys(server, ["hostEnv", "portEnv", "healthPath", "startupTimeoutMs"], "server")
  const healthPath = boundedString(server.healthPath, "server.healthPath", 512)
  if (!healthPath.startsWith("/") || healthPath.startsWith("//"))
    throw new Error("server.healthPath must be an origin-relative path.")
  const startupTimeoutMs = server.startupTimeoutMs
  if (
    typeof startupTimeoutMs !== "number" ||
    !Number.isInteger(startupTimeoutMs) ||
    startupTimeoutMs < 1_000 ||
    startupTimeoutMs > 120_000
  ) {
    throw new Error("server.startupTimeoutMs is invalid.")
  }
  if (!Array.isArray(root.environment) || root.environment.length > 32) throw new Error("environment is invalid.")
  const names = new Set<string>()
  const environment = root.environment.map((entry, index) => {
    const item = objectValue(entry, `environment[${index}]`)
    exactKeys(item, ["name", "required", "secret", "description"], `environment[${index}]`)
    const name = environmentName(item.name, `environment[${index}].name`)
    if (names.has(name)) throw new Error(`environment contains duplicate ${name}.`)
    names.add(name)
    if (typeof item.required !== "boolean" || typeof item.secret !== "boolean")
      throw new Error(`environment[${index}] flags are invalid.`)
    return {
      name,
      required: item.required,
      secret: item.secret,
      ...(item.description === undefined
        ? {}
        : {
            description: boundedString(item.description, `environment[${index}].description`, 240),
          }),
    }
  })
  const permissions = objectValue(root.permissions, "permissions")
  exactKeys(permissions, ["network", "persistentData"], "permissions")
  if (typeof permissions.network !== "boolean" || typeof permissions.persistentData !== "boolean") {
    throw new Error("permissions are invalid.")
  }
  return {
    schemaVersion: 2,
    kind: "service",
    platform: "linux",
    arch: "multi",
    framework: boundedString(root.framework, "framework", 80),
    runtime: {
      kind: "node",
      entrypoint: normalizeServiceDevAppPath(runtime.entrypoint, "runtime.entrypoint"),
      args: [...args] as string[],
    },
    server: {
      hostEnv: environmentName(server.hostEnv, "server.hostEnv", true),
      portEnv: environmentName(server.portEnv, "server.portEnv", true),
      healthPath,
      startupTimeoutMs,
    },
    environment,
    permissions: { network: permissions.network, persistentData: permissions.persistentData },
  }
}

export function serviceDevAppPermissionSetHash(manifest: ServiceDevAppManifest): string {
  const canonical = JSON.stringify({
    environment: [...manifest.environment]
      .map(({ name, required, secret }) => ({ name, required, secret }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    permissions: manifest.permissions,
  })
  return createHash("sha256").update(canonical).digest("hex")
}
