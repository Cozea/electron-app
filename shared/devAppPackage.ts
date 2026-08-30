import {
  isDevAppCapability,
  normalizeGrant,
  type DevAppCapability,
  type DevAppGrant,
} from "./devAppCapabilities"

/**
 * The authoring contract: `cozea-devapp.json`, the file that makes a directory a DevApp.
 *
 * This is the one internal source the published JSON Schema and the `@cozea/devapp-api`
 * typings are generated from, so authors, the preview loader, and the publisher cannot
 * drift from each other.
 *
 * Two properties matter more than the shape:
 *
 * The manifest is a *request*, never an authority. Capabilities listed here are what the
 * app asks for. What it holds is a `DevAppGrant` the user approved. Nothing in this file
 * grants anything, which is why parsing an untrusted manifest is safe.
 *
 * It fails closed. An unrecognised capability is a blocker rather than a dropped entry:
 * silently ignoring one would let a package that asks for `fs.write` install as though it
 * had asked for nothing, and the approval prompt would under-report what it does.
 */

export type DevAppPackageDiagnosticCode =
  | "manifest-missing"
  | "manifest-unparsable"
  | "manifest-not-object"
  | "manifest-version-unsupported"
  | "manifest-field-invalid"
  | "manifest-no-parts"
  | "manifest-unknown-capability"
  | "manifest-path-escapes-package"
  | "manifest-unknown-field"

export interface DevAppPackageDiagnostic {
  code: DevAppPackageDiagnosticCode
  severity: "blocker" | "warning"
  /** One sentence, present tense, describing what is wrong. */
  message: string
  /** The manifest path this refers to, dotted — `worker.capabilities[1]`. */
  field?: string
  /** What to change. Omitted when there is no single obvious remedy. */
  fix?: string
}

/** The manifest filename, at the root of the package directory. */
export const DEV_APP_MANIFEST_FILENAME = "cozea-devapp.json"

/** Bumped only for a change old Cozea builds cannot safely ignore. */
export const DEV_APP_MANIFEST_VERSION = 1

export interface DevAppPackageViewSpec {
  /** Entry relative to the package root, served from the app's own origin. */
  entry: string
  /**
   * Where the view comes from while developing. A dev server gives hot reload; without
   * one, development serves the same built output publishing would pack.
   */
  dev?: { command?: string; url?: string }
}

export interface DevAppPackageWorkerSpec {
  entry: string
  /** What the app asks for. The grant it holds is decided by the user, not by this. */
  capabilities: DevAppCapability[]
  /** Whether the worker offers operations agents may call. */
  exposesTools: boolean
}

export interface DevAppPackageServiceSpec {
  runtimeKind: "static" | "node"
  entry?: string
}

export interface DevAppPackage {
  manifestVersion: number
  name: string
  description?: string
  view?: DevAppPackageViewSpec
  worker?: DevAppPackageWorkerSpec
  service?: DevAppPackageServiceSpec
}

export interface DevAppPackageParseResult {
  /** Null whenever any diagnostic is a blocker — a partly-understood manifest is not usable. */
  manifest: DevAppPackage | null
  diagnostics: DevAppPackageDiagnostic[]
}

const KNOWN_ROOT_FIELDS = new Set([
  "manifestVersion",
  "name",
  "description",
  "view",
  "worker",
  "service",
])

const MAX_NAME_LENGTH = 120
const MAX_DESCRIPTION_LENGTH = 500
const MAX_PATH_LENGTH = 512
const MAX_COMMAND_LENGTH = 512

function blocker(
  code: DevAppPackageDiagnosticCode,
  message: string,
  extra: { field?: string; fix?: string } = {},
): DevAppPackageDiagnostic {
  return { code, severity: "blocker", message, ...extra }
}

function warning(
  code: DevAppPackageDiagnosticCode,
  message: string,
  extra: { field?: string; fix?: string } = {},
): DevAppPackageDiagnostic {
  return { code, severity: "warning", message, ...extra }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Accepts only a relative path that stays inside the package.
 *
 * Resolved without touching the filesystem so the same rule holds for a manifest read
 * from a local directory and one read out of an artifact being published — the check must
 * not depend on which files happen to exist.
 */
function isConfinedRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > MAX_PATH_LENGTH) return false
  if (value.includes("\0")) return false
  // Absolute, drive-qualified, and UNC paths all name a location the package does not own.
  if (value.startsWith("/") || value.startsWith("\\")) return false
  if (/^[a-zA-Z]:/.test(value)) return false

  const segments = value.split(/[/\\]/)
  let depth = 0
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      depth -= 1
      // Rejected the moment it would leave, so `a/../../b` cannot pass by ending up level.
      if (depth < 0) return false
      continue
    }
    depth += 1
  }
  return depth > 0
}

function readPath(
  raw: unknown,
  field: string,
  diagnostics: DevAppPackageDiagnostic[],
): string | null {
  if (typeof raw !== "string") {
    diagnostics.push(blocker("manifest-field-invalid", `${field} must be a string path.`, { field }))
    return null
  }
  if (!isConfinedRelativePath(raw)) {
    diagnostics.push(
      blocker("manifest-path-escapes-package", `${field} must point inside the package.`, {
        field,
        fix: "Use a path relative to the folder holding cozea-devapp.json.",
      }),
    )
    return null
  }
  return raw
}

function parseView(
  raw: unknown,
  diagnostics: DevAppPackageDiagnostic[],
): DevAppPackageViewSpec | undefined {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    diagnostics.push(blocker("manifest-field-invalid", "view must be an object.", { field: "view" }))
    return undefined
  }

  const entry = readPath(raw.entry, "view.entry", diagnostics)
  const view: DevAppPackageViewSpec = { entry: entry ?? "" }

  if (raw.dev !== undefined) {
    if (!isPlainObject(raw.dev)) {
      diagnostics.push(
        blocker("manifest-field-invalid", "view.dev must be an object.", { field: "view.dev" }),
      )
    } else {
      const dev: { command?: string; url?: string } = {}
      if (raw.dev.command !== undefined) {
        if (typeof raw.dev.command !== "string" || raw.dev.command.length > MAX_COMMAND_LENGTH) {
          diagnostics.push(
            blocker("manifest-field-invalid", "view.dev.command must be a string.", {
              field: "view.dev.command",
            }),
          )
        } else {
          dev.command = raw.dev.command
        }
      }
      if (raw.dev.url !== undefined) {
        const url = parseDevUrl(raw.dev.url, diagnostics)
        if (url) dev.url = url
      }
      view.dev = dev
    }
  }

  return entry === null ? undefined : view
}

/**
 * A development view URL must be loopback http.
 *
 * The preview tile loads this into a webview. A manifest that could name any origin would
 * make "open this project" enough to load attacker-controlled content into a surface the
 * user reads as their own app.
 */
function parseDevUrl(raw: unknown, diagnostics: DevAppPackageDiagnostic[]): string | null {
  const field = "view.dev.url"
  if (typeof raw !== "string") {
    diagnostics.push(blocker("manifest-field-invalid", `${field} must be a string.`, { field }))
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    diagnostics.push(blocker("manifest-field-invalid", `${field} must be a URL.`, { field }))
    return null
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
    || parsed.hostname === "[::1]" || parsed.hostname === "::1"
  if (parsed.protocol !== "http:" || !loopback) {
    diagnostics.push(
      blocker("manifest-field-invalid", `${field} must be a http://localhost address.`, {
        field,
        fix: "Development views are served from the machine running Cozea.",
      }),
    )
    return null
  }
  return raw
}

function parseWorker(
  raw: unknown,
  diagnostics: DevAppPackageDiagnostic[],
): DevAppPackageWorkerSpec | undefined {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    diagnostics.push(
      blocker("manifest-field-invalid", "worker must be an object.", { field: "worker" }),
    )
    return undefined
  }

  const entry = readPath(raw.entry, "worker.entry", diagnostics)

  const capabilities: DevAppCapability[] = []
  if (raw.capabilities !== undefined) {
    if (!Array.isArray(raw.capabilities)) {
      diagnostics.push(
        blocker("manifest-field-invalid", "worker.capabilities must be an array.", {
          field: "worker.capabilities",
        }),
      )
    } else {
      raw.capabilities.forEach((candidate, index) => {
        const field = `worker.capabilities[${index}]`
        if (typeof candidate !== "string" || !isDevAppCapability(candidate)) {
          // Fails closed on purpose: dropping it would let the app install asking for
          // less than it does, and the approval prompt would under-report it.
          diagnostics.push(
            blocker(
              "manifest-unknown-capability",
              `${String(candidate)} is not a capability this version of Cozea knows.`,
              { field, fix: "Remove it, or update Cozea if the app needs a newer capability." },
            ),
          )
          return
        }
        if (!capabilities.includes(candidate)) capabilities.push(candidate)
      })
    }
  }

  let exposesTools = false
  if (raw.exposesTools !== undefined) {
    if (typeof raw.exposesTools !== "boolean") {
      diagnostics.push(
        blocker("manifest-field-invalid", "worker.exposesTools must be true or false.", {
          field: "worker.exposesTools",
        }),
      )
    } else {
      exposesTools = raw.exposesTools
    }
  }

  if (entry === null) return undefined
  return { entry, capabilities, exposesTools }
}

function parseService(
  raw: unknown,
  diagnostics: DevAppPackageDiagnostic[],
): DevAppPackageServiceSpec | undefined {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    diagnostics.push(
      blocker("manifest-field-invalid", "service must be an object.", { field: "service" }),
    )
    return undefined
  }

  const runtimeKind = raw.runtimeKind
  if (runtimeKind !== "static" && runtimeKind !== "node") {
    diagnostics.push(
      blocker("manifest-field-invalid", "service.runtimeKind must be \"static\" or \"node\".", {
        field: "service.runtimeKind",
      }),
    )
    return undefined
  }

  const service: DevAppPackageServiceSpec = { runtimeKind }
  if (runtimeKind === "node") {
    const entry = readPath(raw.entry, "service.entry", diagnostics)
    if (entry === null) return undefined
    service.entry = entry
  } else if (raw.entry !== undefined) {
    diagnostics.push(
      warning("manifest-unknown-field", "A static service has no entry to run.", {
        field: "service.entry",
      }),
    )
  }
  return service
}

/** Parses a manifest that has already been read off disk. */
export function parseDevAppPackage(source: string): DevAppPackageParseResult {
  const diagnostics: DevAppPackageDiagnostic[] = []

  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch (error) {
    return {
      manifest: null,
      diagnostics: [
        blocker(
          "manifest-unparsable",
          `${DEV_APP_MANIFEST_FILENAME} is not valid JSON.`,
          { fix: error instanceof Error ? error.message : undefined },
        ),
      ],
    }
  }

  if (!isPlainObject(raw)) {
    return {
      manifest: null,
      diagnostics: [
        blocker("manifest-not-object", `${DEV_APP_MANIFEST_FILENAME} must contain an object.`),
      ],
    }
  }

  const version = raw.manifestVersion
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    diagnostics.push(
      blocker("manifest-field-invalid", "manifestVersion must be a positive integer.", {
        field: "manifestVersion",
        fix: `Use ${DEV_APP_MANIFEST_VERSION}.`,
      }),
    )
  } else if (version > DEV_APP_MANIFEST_VERSION) {
    // Refused rather than best-effort read: a newer manifest may express a part or a
    // constraint this build cannot enforce, and a half-understood one is the dangerous case.
    diagnostics.push(
      blocker(
        "manifest-version-unsupported",
        `This DevApp needs a newer Cozea (manifest version ${version}).`,
        { field: "manifestVersion", fix: "Update Cozea." },
      ),
    )
  }

  if (typeof raw.name !== "string" || raw.name.trim().length === 0 || raw.name.length > MAX_NAME_LENGTH) {
    diagnostics.push(
      blocker("manifest-field-invalid", "name must be a non-empty string.", { field: "name" }),
    )
  }
  if (
    raw.description !== undefined
    && (typeof raw.description !== "string" || raw.description.length > MAX_DESCRIPTION_LENGTH)
  ) {
    diagnostics.push(
      blocker("manifest-field-invalid", "description must be a string.", { field: "description" }),
    )
  }

  // Unknown fields are a warning, not a blocker: an older Cozea reading a manifest that
  // gained an optional field should still run the app rather than refuse it.
  for (const key of Object.keys(raw)) {
    if (!KNOWN_ROOT_FIELDS.has(key)) {
      diagnostics.push(
        warning("manifest-unknown-field", `${key} is not a field this version of Cozea reads.`, {
          field: key,
        }),
      )
    }
  }

  const view = parseView(raw.view, diagnostics)
  const worker = parseWorker(raw.worker, diagnostics)
  const service = parseService(raw.service, diagnostics)

  if (!view && !worker && !service && raw.view === undefined && raw.worker === undefined
    && raw.service === undefined) {
    diagnostics.push(
      blocker("manifest-no-parts", "A DevApp needs at least one of view, worker, or service.", {
        fix: "Add a view to render a tile, or a worker to expose operations.",
      }),
    )
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "blocker")) {
    return { manifest: null, diagnostics }
  }

  const manifest: DevAppPackage = {
    manifestVersion: version as number,
    name: (raw.name as string).trim(),
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    ...(view ? { view } : {}),
    ...(worker ? { worker } : {}),
    ...(service ? { service } : {}),
  }
  return { manifest, diagnostics }
}

/**
 * What this package is asking to be allowed to do.
 *
 * Named for what it is. It is the input to an approval prompt, never a substitute for one.
 */
export function requestedGrant(manifest: DevAppPackage): DevAppGrant {
  return normalizeGrant({
    capabilities: manifest.worker?.capabilities ?? [],
    agentInvocable: manifest.worker?.exposesTools ?? false,
  })
}
