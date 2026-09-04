import {
  isDevAppCapability,
  normalizeCapabilities,
  type DevAppCapability,
  type DevAppGrant,
} from "./devAppCapabilities"
import { isSupportedDevAppToolInputSchema } from "./devAppToolInputValidation"

/**
 * Native DevApps are trusted React extensions loaded into Cozea's renderer.
 *
 * The manifest describes source and immutable output separately. The renderer bundle runs in
 * Cozea's JavaScript realm, while privileged/background behavior stays in an extension worker or
 * contained service. Web applications remain an optional surface adapter for adopted projects;
 * they are not the default authoring model.
 */

export const NATIVE_DEV_APP_MANIFEST_VERSION = 3
export const NATIVE_DEV_APP_API_VERSION = 1
export const NATIVE_DEV_APP_MANIFEST_FILENAME = "cozea-devapp.json"

export type NativeDevAppRuntimeLocation = "device" | "hosted"
export type NativeDevAppStateScope = "none" | "device" | "organization"

export interface NativeDevAppDiagnostic {
  code:
    | "manifest-unparsable"
    | "manifest-not-object"
    | "manifest-version-unsupported"
    | "manifest-field-invalid"
    | "manifest-unknown-field"
    | "manifest-path-escapes-package"
    | "manifest-reference-missing"
    | "manifest-no-surfaces"
  severity: "blocker" | "warning"
  message: string
  field?: string
  fix?: string
}

export interface NativeDevAppRendererModuleSpec {
  /** TypeScript/TSX source used by the Cozea builder. */
  entry: string
  /** Immutable ESM output loaded by Cozea. */
  output: string
  styles?: {
    entry: string
    output: string
  }
}

export interface NativeDevAppWebApplicationSpec {
  /** Built static entry relative to the package root. */
  entry?: string
  /** A contained service that owns this application's origin. */
  service?: string
  path?: string
  dev?: {
    command?: string
    url?: string
  }
}

export interface NativeDevAppServiceSpec {
  entry: string
  location: NativeDevAppRuntimeLocation
  state: NativeDevAppStateScope
  healthPath?: string
}

export interface NativeDevAppToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface NativeDevAppExtensionSpec {
  entry: string
  output: string
  protocolVersion: number
  capabilities: DevAppCapability[]
  tools: NativeDevAppToolSpec[]
  agentInvocable?: boolean
}

export interface NativeReactSurfaceRenderer {
  kind: "native-react"
  module: string
  component: string
}

export interface WebAppSurfaceRenderer {
  kind: "web-app"
  application: string
}

export type NativeDevAppSurfaceRenderer = NativeReactSurfaceRenderer | WebAppSurfaceRenderer

export interface NativeDevAppSurfaceContribution {
  id: string
  title: string
  default?: boolean
  renderer: NativeDevAppSurfaceRenderer
  placement?: {
    group?: "Development" | "Assistant" | "Utility"
    minimumWidth?: number
    minimumHeight?: number
  }
}

export interface NativeDevAppCommandContribution {
  id: string
  title: string
}

export interface NativeDevAppSkillContribution {
  id: string
  entry: string
  providers?: Array<"codex" | "claude" | "cursor" | "opencode">
}

export interface NativeDevAppManifestV3 {
  manifestVersion: 3
  id: string
  name: string
  version: string
  description?: string
  engines: {
    cozea: string
    nativeApi: 1
  }
  rendererModules?: Record<string, NativeDevAppRendererModuleSpec>
  webApplications?: Record<string, NativeDevAppWebApplicationSpec>
  extension?: NativeDevAppExtensionSpec
  services?: Record<string, NativeDevAppServiceSpec>
  contributes: {
    surfaces: NativeDevAppSurfaceContribution[]
    commands?: NativeDevAppCommandContribution[]
    skills?: NativeDevAppSkillContribution[]
  }
}

export interface NativeDevAppParseResult {
  manifest: NativeDevAppManifestV3 | null
  diagnostics: NativeDevAppDiagnostic[]
}

const ROOT_FIELDS = new Set([
  "manifestVersion",
  "id",
  "name",
  "version",
  "description",
  "engines",
  "rendererModules",
  "webApplications",
  "extension",
  "services",
  "contributes",
])
const ID = /^[a-z0-9][a-z0-9._-]{1,127}$/
const LOCAL_ID = /^[a-z][a-z0-9._-]{0,63}$/
const COMPONENT = /^[A-Z][A-Za-z0-9_$]{0,127}$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const MAX_PATH = 512
const MAX_TEXT = 500
const MAX_SURFACES = 32
const MAX_COMMANDS = 128
const MAX_SKILLS = 64
const MAX_TOOLS = 32

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function diagnostic(
  code: NativeDevAppDiagnostic["code"],
  message: string,
  field?: string,
  fix?: string,
): NativeDevAppDiagnostic {
  return {
    code,
    severity: "blocker",
    message,
    ...(field ? { field } : {}),
    ...(fix ? { fix } : {}),
  }
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
  diagnostics: NativeDevAppDiagnostic[],
): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key))
  if (unknown.length > 0) {
    diagnostics.push(
      diagnostic(
        "manifest-unknown-field",
        `${field} contains unsupported fields: ${unknown.join(", ")}.`,
        field,
      ),
    )
  }
}

export function isNativeDevAppPackagePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH) return false
  if (value.includes("\0") || value.includes("\\")) return false
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false
  return !value.split("/").some((part) => part === ".." || part === "")
}

function parsePath(
  value: unknown,
  field: string,
  diagnostics: NativeDevAppDiagnostic[],
): string | null {
  if (!isNativeDevAppPackagePath(value)) {
    diagnostics.push(
      diagnostic(
        "manifest-path-escapes-package",
        `${field} must be a package-relative path with no traversal segments.`,
        field,
      ),
    )
    return null
  }
  return value
}

function parseNamedMap<T>(
  raw: unknown,
  field: string,
  diagnostics: NativeDevAppDiagnostic[],
  parser: (value: Record<string, unknown>, itemField: string) => T | null,
): Record<string, T> {
  if (raw === undefined) return {}
  if (!isObject(raw)) {
    diagnostics.push(diagnostic("manifest-field-invalid", `${field} must be an object.`, field))
    return {}
  }
  const result: Record<string, T> = {}
  for (const [key, value] of Object.entries(raw)) {
    const itemField = `${field}.${key}`
    if (!LOCAL_ID.test(key)) {
      diagnostics.push(
        diagnostic(
          "manifest-field-invalid",
          `${itemField} uses an invalid identifier.`,
          itemField,
        ),
      )
      continue
    }
    if (!isObject(value)) {
      diagnostics.push(diagnostic("manifest-field-invalid", `${itemField} must be an object.`, itemField))
      continue
    }
    const parsed = parser(value, itemField)
    if (parsed) result[key] = parsed
  }
  return result
}

function parseRendererModules(
  raw: unknown,
  diagnostics: NativeDevAppDiagnostic[],
): Record<string, NativeDevAppRendererModuleSpec> {
  return parseNamedMap(raw, "rendererModules", diagnostics, (value, field) => {
    rejectUnknownFields(value, ["entry", "output", "styles"], field, diagnostics)
    const entry = parsePath(value.entry, `${field}.entry`, diagnostics)
    const output = parsePath(value.output, `${field}.output`, diagnostics)
    let styles: NativeDevAppRendererModuleSpec["styles"]
    if (value.styles !== undefined) {
      if (!isObject(value.styles)) {
        diagnostics.push(
          diagnostic("manifest-field-invalid", `${field}.styles must be an object.`, `${field}.styles`),
        )
      } else {
        rejectUnknownFields(value.styles, ["entry", "output"], `${field}.styles`, diagnostics)
        const styleEntry = parsePath(value.styles.entry, `${field}.styles.entry`, diagnostics)
        const styleOutput = parsePath(value.styles.output, `${field}.styles.output`, diagnostics)
        if (styleEntry && styleOutput) styles = { entry: styleEntry, output: styleOutput }
      }
    }
    return entry && output ? { entry, output, ...(styles ? { styles } : {}) } : null
  })
}

function parseWebApplications(
  raw: unknown,
  diagnostics: NativeDevAppDiagnostic[],
): Record<string, NativeDevAppWebApplicationSpec> {
  return parseNamedMap(raw, "webApplications", diagnostics, (value, field) => {
    rejectUnknownFields(value, ["entry", "service", "path", "dev"], field, diagnostics)
    const entry = value.entry === undefined ? undefined : parsePath(value.entry, `${field}.entry`, diagnostics) ?? undefined
    const service = typeof value.service === "string" && LOCAL_ID.test(value.service) ? value.service : undefined
    if (value.service !== undefined && !service) {
      diagnostics.push(
        diagnostic("manifest-field-invalid", `${field}.service must reference a service id.`, `${field}.service`),
      )
    }
    const applicationPath =
      value.path === undefined
        ? undefined
        : typeof value.path === "string" && value.path.startsWith("/") && value.path.length <= 512
          ? value.path
          : null
    if (applicationPath === null) {
      diagnostics.push(
        diagnostic("manifest-field-invalid", `${field}.path must be an absolute URL path.`, `${field}.path`),
      )
    }
    let dev: NativeDevAppWebApplicationSpec["dev"]
    if (value.dev !== undefined) {
      if (!isObject(value.dev)) {
        diagnostics.push(diagnostic("manifest-field-invalid", `${field}.dev must be an object.`, `${field}.dev`))
      } else {
        rejectUnknownFields(value.dev, ["command", "url"], `${field}.dev`, diagnostics)
        const command =
          typeof value.dev.command === "string" && value.dev.command.trim().length > 0 && value.dev.command.length <= 512
            ? value.dev.command.trim()
            : undefined
        let url: string | undefined
        if (value.dev.url !== undefined) {
          try {
            const parsed = new URL(String(value.dev.url))
            if (parsed.protocol !== "http:" || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)) {
              throw new Error("not local")
            }
            url = parsed.toString()
          } catch {
            diagnostics.push(
              diagnostic(
                "manifest-field-invalid",
                `${field}.dev.url must be a loopback HTTP URL.`,
                `${field}.dev.url`,
              ),
            )
          }
        }
        if (command || url) dev = { ...(command ? { command } : {}), ...(url ? { url } : {}) }
      }
    }
    if (!entry && !service && !dev?.url) {
      diagnostics.push(
        diagnostic(
          "manifest-field-invalid",
          `${field} must declare a built entry, contained service, or development URL.`,
          field,
        ),
      )
      return null
    }
    return {
      ...(entry ? { entry } : {}),
      ...(service ? { service } : {}),
      ...(applicationPath ? { path: applicationPath } : {}),
      ...(dev ? { dev } : {}),
    }
  })
}

function parseServices(
  raw: unknown,
  diagnostics: NativeDevAppDiagnostic[],
): Record<string, NativeDevAppServiceSpec> {
  return parseNamedMap(raw, "services", diagnostics, (value, field) => {
    rejectUnknownFields(value, ["entry", "location", "state", "healthPath"], field, diagnostics)
    const entry = parsePath(value.entry, `${field}.entry`, diagnostics)
    const location = value.location === "device" || value.location === "hosted" ? value.location : null
    const state =
      value.state === "none" || value.state === "device" || value.state === "organization"
        ? value.state
        : null
    if (!location) {
      diagnostics.push(
        diagnostic("manifest-field-invalid", `${field}.location must be device or hosted.`, `${field}.location`),
      )
    }
    if (!state) {
      diagnostics.push(
        diagnostic(
          "manifest-field-invalid",
          `${field}.state must be none, device, or organization.`,
          `${field}.state`,
        ),
      )
    }
    if (location === "device" && state === "organization") {
      diagnostics.push(
        diagnostic(
          "manifest-field-invalid",
          `${field} cannot use organization state on a device runtime.`,
          `${field}.state`,
        ),
      )
    }
    if (location === "hosted" && state === "device") {
      diagnostics.push(
        diagnostic(
          "manifest-field-invalid",
          `${field} cannot use device state on a hosted runtime.`,
          `${field}.state`,
        ),
      )
    }
    const healthPath =
      value.healthPath === undefined
        ? undefined
        : typeof value.healthPath === "string" && value.healthPath.startsWith("/") && value.healthPath.length <= 512
          ? value.healthPath
          : null
    if (healthPath === null) {
      diagnostics.push(
        diagnostic(
          "manifest-field-invalid",
          `${field}.healthPath must be an absolute URL path.`,
          `${field}.healthPath`,
        ),
      )
    }
    return entry && location && state
      ? { entry, location, state, ...(healthPath ? { healthPath } : {}) }
      : null
  })
}

function parseTools(raw: unknown, diagnostics: NativeDevAppDiagnostic[]): NativeDevAppToolSpec[] {
  if (!Array.isArray(raw)) {
    diagnostics.push(
      diagnostic("manifest-field-invalid", "extension.tools must be an array.", "extension.tools"),
    )
    return []
  }
  const tools: NativeDevAppToolSpec[] = []
  const names = new Set<string>()
  for (const [index, candidate] of raw.slice(0, MAX_TOOLS).entries()) {
    const field = `extension.tools[${index}]`
    if (!isObject(candidate)) {
      diagnostics.push(diagnostic("manifest-field-invalid", `${field} must be an object.`, field))
      continue
    }
    rejectUnknownFields(candidate, ["name", "description", "inputSchema"], field, diagnostics)
    const name = typeof candidate.name === "string" && LOCAL_ID.test(candidate.name) ? candidate.name : null
    const description =
      typeof candidate.description === "string" && candidate.description.trim().length > 0 && candidate.description.length <= MAX_TEXT
        ? candidate.description.trim()
        : null
    const inputSchema = isObject(candidate.inputSchema) ? candidate.inputSchema : null
    if (!name || names.has(name)) {
      diagnostics.push(
        diagnostic(
          "manifest-field-invalid",
          `${field}.name must be unique and use a lowercase operation id.`,
          `${field}.name`,
        ),
      )
    }
    if (!description) {
      diagnostics.push(
        diagnostic("manifest-field-invalid", `${field}.description is invalid.`, `${field}.description`),
      )
    }
    if (!inputSchema || !isSupportedDevAppToolInputSchema(inputSchema)) {
      diagnostics.push(
        diagnostic(
          "manifest-field-invalid",
          `${field}.inputSchema must use Cozea's bounded object JSON Schema subset.`,
          `${field}.inputSchema`,
        ),
      )
    }
    if (name && !names.has(name) && description && inputSchema && isSupportedDevAppToolInputSchema(inputSchema)) {
      names.add(name)
      tools.push({ name, description, inputSchema })
    }
  }
  if (raw.length > MAX_TOOLS) {
    diagnostics.push(
      diagnostic("manifest-field-invalid", `extension.tools may contain at most ${MAX_TOOLS} tools.`, "extension.tools"),
    )
  }
  return tools
}

function parseExtension(
  raw: unknown,
  diagnostics: NativeDevAppDiagnostic[],
): NativeDevAppExtensionSpec | undefined {
  if (raw === undefined) return undefined
  if (!isObject(raw)) {
    diagnostics.push(diagnostic("manifest-field-invalid", "extension must be an object.", "extension"))
    return undefined
  }
  rejectUnknownFields(
    raw,
    ["entry", "output", "protocolVersion", "capabilities", "tools", "agentInvocable"],
    "extension",
    diagnostics,
  )
  const entry = parsePath(raw.entry, "extension.entry", diagnostics)
  const output = parsePath(raw.output, "extension.output", diagnostics)
  const protocolVersion =
    typeof raw.protocolVersion === "number" && Number.isInteger(raw.protocolVersion) && raw.protocolVersion > 0
      ? raw.protocolVersion
      : null
  if (!protocolVersion) {
    diagnostics.push(
      diagnostic(
        "manifest-field-invalid",
        "extension.protocolVersion must be a positive integer.",
        "extension.protocolVersion",
      ),
    )
  }
  if (!Array.isArray(raw.capabilities) || raw.capabilities.some((value) => !isDevAppCapability(value))) {
    diagnostics.push(
      diagnostic(
        "manifest-field-invalid",
        "extension.capabilities contains an unsupported capability.",
        "extension.capabilities",
      ),
    )
  }
  const capabilities = normalizeCapabilities(Array.isArray(raw.capabilities) ? raw.capabilities : [])
  const tools = parseTools(raw.tools ?? [], diagnostics)
  return entry && output && protocolVersion
    ? {
        entry,
        output,
        protocolVersion,
        capabilities,
        tools,
        ...(raw.agentInvocable === true ? { agentInvocable: true } : {}),
      }
    : undefined
}

function parseSurfaces(
  raw: unknown,
  rendererModules: Record<string, NativeDevAppRendererModuleSpec>,
  webApplications: Record<string, NativeDevAppWebApplicationSpec>,
  diagnostics: NativeDevAppDiagnostic[],
): NativeDevAppSurfaceContribution[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    diagnostics.push(
      diagnostic(
        "manifest-no-surfaces",
        "contributes.surfaces must declare at least one DevApp surface.",
        "contributes.surfaces",
      ),
    )
    return []
  }
  if (raw.length > MAX_SURFACES) {
    diagnostics.push(
      diagnostic(
        "manifest-field-invalid",
        `contributes.surfaces may contain at most ${MAX_SURFACES} surfaces.`,
        "contributes.surfaces",
      ),
    )
  }
  const result: NativeDevAppSurfaceContribution[] = []
  const ids = new Set<string>()
  let defaults = 0
  for (const [index, candidate] of raw.slice(0, MAX_SURFACES).entries()) {
    const field = `contributes.surfaces[${index}]`
    if (!isObject(candidate)) {
      diagnostics.push(diagnostic("manifest-field-invalid", `${field} must be an object.`, field))
      continue
    }
    rejectUnknownFields(candidate, ["id", "title", "default", "renderer", "placement"], field, diagnostics)
    const id = typeof candidate.id === "string" && LOCAL_ID.test(candidate.id) ? candidate.id : null
    const title =
      typeof candidate.title === "string" && candidate.title.trim().length > 0 && candidate.title.length <= 120
        ? candidate.title.trim()
        : null
    if (!id || ids.has(id)) {
      diagnostics.push(
        diagnostic("manifest-field-invalid", `${field}.id must be a unique surface id.`, `${field}.id`),
      )
    }
    if (!title) {
      diagnostics.push(
        diagnostic("manifest-field-invalid", `${field}.title must be a non-empty label.`, `${field}.title`),
      )
    }
    let renderer: NativeDevAppSurfaceRenderer | null = null
    if (!isObject(candidate.renderer)) {
      diagnostics.push(
        diagnostic("manifest-field-invalid", `${field}.renderer must be an object.`, `${field}.renderer`),
      )
    } else if (candidate.renderer.kind === "native-react") {
      rejectUnknownFields(candidate.renderer, ["kind", "module", "component"], `${field}.renderer`, diagnostics)
      const module = typeof candidate.renderer.module === "string" ? candidate.renderer.module : ""
      const component = typeof candidate.renderer.component === "string" ? candidate.renderer.component : ""
      if (!rendererModules[module]) {
        diagnostics.push(
          diagnostic(
            "manifest-reference-missing",
            `${field}.renderer.module does not reference rendererModules.`,
            `${field}.renderer.module`,
          ),
        )
      } else if (!COMPONENT.test(component)) {
        diagnostics.push(
          diagnostic(
            "manifest-field-invalid",
            `${field}.renderer.component must be an exported PascalCase component name.`,
            `${field}.renderer.component`,
          ),
        )
      } else {
        renderer = { kind: "native-react", module, component }
      }
    } else if (candidate.renderer.kind === "web-app") {
      rejectUnknownFields(candidate.renderer, ["kind", "application"], `${field}.renderer`, diagnostics)
      const application = typeof candidate.renderer.application === "string" ? candidate.renderer.application : ""
      if (!webApplications[application]) {
        diagnostics.push(
          diagnostic(
            "manifest-reference-missing",
            `${field}.renderer.application does not reference webApplications.`,
            `${field}.renderer.application`,
          ),
        )
      } else {
        renderer = { kind: "web-app", application }
      }
    } else {
      diagnostics.push(
        diagnostic(
          "manifest-field-invalid",
          `${field}.renderer.kind must be native-react or web-app.`,
          `${field}.renderer.kind`,
        ),
      )
    }
    let placement: NativeDevAppSurfaceContribution["placement"]
    if (candidate.placement !== undefined) {
      if (!isObject(candidate.placement)) {
        diagnostics.push(
          diagnostic("manifest-field-invalid", `${field}.placement must be an object.`, `${field}.placement`),
        )
      } else {
        rejectUnknownFields(candidate.placement, ["group", "minimumWidth", "minimumHeight"], `${field}.placement`, diagnostics)
        const group =
          candidate.placement.group === "Development" ||
          candidate.placement.group === "Assistant" ||
          candidate.placement.group === "Utility"
            ? candidate.placement.group
            : undefined
        const minimumWidth = boundedDimension(candidate.placement.minimumWidth)
        const minimumHeight = boundedDimension(candidate.placement.minimumHeight)
        if (candidate.placement.group !== undefined && !group) {
          diagnostics.push(
            diagnostic("manifest-field-invalid", `${field}.placement.group is invalid.`, `${field}.placement.group`),
          )
        }
        if (candidate.placement.minimumWidth !== undefined && minimumWidth === undefined) {
          diagnostics.push(
            diagnostic(
              "manifest-field-invalid",
              `${field}.placement.minimumWidth must be between 160 and 4096.`,
              `${field}.placement.minimumWidth`,
            ),
          )
        }
        if (candidate.placement.minimumHeight !== undefined && minimumHeight === undefined) {
          diagnostics.push(
            diagnostic(
              "manifest-field-invalid",
              `${field}.placement.minimumHeight must be between 120 and 4096.`,
              `${field}.placement.minimumHeight`,
            ),
          )
        }
        placement = {
          ...(group ? { group } : {}),
          ...(minimumWidth ? { minimumWidth } : {}),
          ...(minimumHeight ? { minimumHeight } : {}),
        }
      }
    }
    const isDefault = candidate.default === true
    if (isDefault) defaults += 1
    if (id && !ids.has(id) && title && renderer) {
      ids.add(id)
      result.push({ id, title, ...(isDefault ? { default: true } : {}), renderer, ...(placement ? { placement } : {}) })
    }
  }
  if (defaults > 1) {
    diagnostics.push(
      diagnostic(
        "manifest-field-invalid",
        "Only one contributed surface may be the default.",
        "contributes.surfaces",
      ),
    )
  }
  return result
}

function boundedDimension(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 120 && value <= 4096
    ? value
    : undefined
}

function parseCommands(raw: unknown, diagnostics: NativeDevAppDiagnostic[]): NativeDevAppCommandContribution[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length > MAX_COMMANDS) {
    diagnostics.push(
      diagnostic(
        "manifest-field-invalid",
        `contributes.commands must be an array with at most ${MAX_COMMANDS} entries.`,
        "contributes.commands",
      ),
    )
    return undefined
  }
  const ids = new Set<string>()
  const result: NativeDevAppCommandContribution[] = []
  for (const [index, candidate] of raw.entries()) {
    const field = `contributes.commands[${index}]`
    if (!isObject(candidate)) {
      diagnostics.push(diagnostic("manifest-field-invalid", `${field} must be an object.`, field))
      continue
    }
    rejectUnknownFields(candidate, ["id", "title"], field, diagnostics)
    const id = typeof candidate.id === "string" && ID.test(candidate.id) ? candidate.id : null
    const title = typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim() : null
    if (!id || ids.has(id) || !title) {
      diagnostics.push(
        diagnostic("manifest-field-invalid", `${field} must have a unique id and title.`, field),
      )
      continue
    }
    ids.add(id)
    result.push({ id, title })
  }
  return result
}

function parseSkills(raw: unknown, diagnostics: NativeDevAppDiagnostic[]): NativeDevAppSkillContribution[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length > MAX_SKILLS) {
    diagnostics.push(
      diagnostic(
        "manifest-field-invalid",
        `contributes.skills must be an array with at most ${MAX_SKILLS} entries.`,
        "contributes.skills",
      ),
    )
    return undefined
  }
  const ids = new Set<string>()
  const result: NativeDevAppSkillContribution[] = []
  for (const [index, candidate] of raw.entries()) {
    const field = `contributes.skills[${index}]`
    if (!isObject(candidate)) {
      diagnostics.push(diagnostic("manifest-field-invalid", `${field} must be an object.`, field))
      continue
    }
    rejectUnknownFields(candidate, ["id", "entry", "providers"], field, diagnostics)
    const id = typeof candidate.id === "string" && LOCAL_ID.test(candidate.id) ? candidate.id : null
    const entry = parsePath(candidate.entry, `${field}.entry`, diagnostics)
    const providers = Array.isArray(candidate.providers)
      ? candidate.providers.filter(
          (provider): provider is "codex" | "claude" | "cursor" | "opencode" =>
            provider === "codex" || provider === "claude" || provider === "cursor" || provider === "opencode",
        )
      : undefined
    if (candidate.providers !== undefined && (!Array.isArray(candidate.providers) || providers?.length !== candidate.providers.length)) {
      diagnostics.push(
        diagnostic("manifest-field-invalid", `${field}.providers contains an unsupported provider.`, `${field}.providers`),
      )
    }
    if (!id || ids.has(id) || !entry) {
      diagnostics.push(
        diagnostic("manifest-field-invalid", `${field} must have a unique id and valid entry.`, field),
      )
      continue
    }
    ids.add(id)
    result.push({ id, entry, ...(providers ? { providers } : {}) })
  }
  return result
}

export function parseNativeDevAppManifest(source: string | unknown): NativeDevAppParseResult {
  const diagnostics: NativeDevAppDiagnostic[] = []
  let raw: unknown = source
  if (typeof source === "string") {
    try {
      raw = JSON.parse(source)
    } catch {
      return {
        manifest: null,
        diagnostics: [diagnostic("manifest-unparsable", "cozea-devapp.json is not valid JSON.")],
      }
    }
  }
  if (!isObject(raw)) {
    return {
      manifest: null,
      diagnostics: [diagnostic("manifest-not-object", "cozea-devapp.json must contain one JSON object.")],
    }
  }
  if (raw.manifestVersion !== NATIVE_DEV_APP_MANIFEST_VERSION) {
    return {
      manifest: null,
      diagnostics: [
        diagnostic(
          "manifest-version-unsupported",
          `Native React DevApps require manifestVersion ${NATIVE_DEV_APP_MANIFEST_VERSION}.`,
          "manifestVersion",
        ),
      ],
    }
  }
  rejectUnknownFields(raw, [...ROOT_FIELDS], "manifest", diagnostics)
  const id = typeof raw.id === "string" && ID.test(raw.id) ? raw.id : null
  const name = typeof raw.name === "string" && raw.name.trim().length > 0 && raw.name.length <= 120 ? raw.name.trim() : null
  const version = typeof raw.version === "string" && VERSION.test(raw.version) ? raw.version : null
  const description =
    raw.description === undefined
      ? undefined
      : typeof raw.description === "string" && raw.description.length <= MAX_TEXT
        ? raw.description.trim()
        : null
  if (!id) diagnostics.push(diagnostic("manifest-field-invalid", "id must be a stable reverse-domain style id.", "id"))
  if (!name) diagnostics.push(diagnostic("manifest-field-invalid", "name must be a non-empty label.", "name"))
  if (!version) diagnostics.push(diagnostic("manifest-field-invalid", "version must be semantic version text.", "version"))
  if (description === null) diagnostics.push(diagnostic("manifest-field-invalid", `description may contain at most ${MAX_TEXT} characters.`, "description"))

  let engines: NativeDevAppManifestV3["engines"] | null = null
  if (!isObject(raw.engines)) {
    diagnostics.push(diagnostic("manifest-field-invalid", "engines must be an object.", "engines"))
  } else {
    rejectUnknownFields(raw.engines, ["cozea", "nativeApi"], "engines", diagnostics)
    const cozea = typeof raw.engines.cozea === "string" && raw.engines.cozea.trim() ? raw.engines.cozea.trim() : null
    if (!cozea || raw.engines.nativeApi !== NATIVE_DEV_APP_API_VERSION) {
      diagnostics.push(
        diagnostic(
          "manifest-field-invalid",
          `engines must declare cozea compatibility and nativeApi ${NATIVE_DEV_APP_API_VERSION}.`,
          "engines",
        ),
      )
    } else {
      engines = { cozea, nativeApi: NATIVE_DEV_APP_API_VERSION }
    }
  }

  const rendererModules = parseRendererModules(raw.rendererModules, diagnostics)
  const webApplications = parseWebApplications(raw.webApplications, diagnostics)
  const services = parseServices(raw.services, diagnostics)
  const extension = parseExtension(raw.extension, diagnostics)

  if (!isObject(raw.contributes)) {
    diagnostics.push(diagnostic("manifest-field-invalid", "contributes must be an object.", "contributes"))
  }
  const contributesRaw = isObject(raw.contributes) ? raw.contributes : {}
  rejectUnknownFields(contributesRaw, ["surfaces", "commands", "skills"], "contributes", diagnostics)
  const surfaces = parseSurfaces(contributesRaw.surfaces, rendererModules, webApplications, diagnostics)
  const commands = parseCommands(contributesRaw.commands, diagnostics)
  const skills = parseSkills(contributesRaw.skills, diagnostics)

  for (const [name, application] of Object.entries(webApplications)) {
    if (application.service && !services[application.service]) {
      diagnostics.push(
        diagnostic(
          "manifest-reference-missing",
          `webApplications.${name}.service does not reference services.`,
          `webApplications.${name}.service`,
        ),
      )
    }
  }

  if (diagnostics.some((entry) => entry.severity === "blocker") || !id || !name || !version || !engines) {
    return { manifest: null, diagnostics }
  }
  return {
    manifest: {
      manifestVersion: NATIVE_DEV_APP_MANIFEST_VERSION,
      id,
      name,
      version,
      ...(description ? { description } : {}),
      engines,
      ...(Object.keys(rendererModules).length > 0 ? { rendererModules } : {}),
      ...(Object.keys(webApplications).length > 0 ? { webApplications } : {}),
      ...(extension ? { extension } : {}),
      ...(Object.keys(services).length > 0 ? { services } : {}),
      contributes: {
        surfaces,
        ...(commands ? { commands } : {}),
        ...(skills ? { skills } : {}),
      },
    },
    diagnostics,
  }
}

export function isNativeDevAppManifest(value: unknown): value is NativeDevAppManifestV3 {
  return isObject(value) && value.manifestVersion === NATIVE_DEV_APP_MANIFEST_VERSION
}

export function requestedNativeDevAppGrant(manifest: NativeDevAppManifestV3): DevAppGrant {
  return {
    capabilities: normalizeCapabilities(manifest.extension?.capabilities ?? []),
    agentInvocable: manifest.extension?.agentInvocable === true,
  }
}

export function defaultNativeDevAppSurface(
  manifest: NativeDevAppManifestV3,
): NativeDevAppSurfaceContribution {
  const explicit = manifest.contributes.surfaces.find((surface) => surface.default)
  return explicit ?? manifest.contributes.surfaces[0]!
}

export function rendererModuleForSurface(
  manifest: NativeDevAppManifestV3,
  surface: NativeDevAppSurfaceContribution,
): NativeDevAppRendererModuleSpec | null {
  if (surface.renderer.kind !== "native-react") return null
  return manifest.rendererModules?.[surface.renderer.module] ?? null
}

export const NATIVE_DEV_APP_MANIFEST_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Cozea native React DevApp",
  type: "object",
  additionalProperties: false,
  required: ["manifestVersion", "id", "name", "version", "engines", "contributes"],
  properties: {
    manifestVersion: { const: NATIVE_DEV_APP_MANIFEST_VERSION },
    id: { type: "string", pattern: ID.source },
    name: { type: "string", minLength: 1, maxLength: 120 },
    version: { type: "string", pattern: VERSION.source },
    description: { type: "string", maxLength: MAX_TEXT },
    engines: {
      type: "object",
      additionalProperties: false,
      required: ["cozea", "nativeApi"],
      properties: {
        cozea: { type: "string", minLength: 1 },
        nativeApi: { const: NATIVE_DEV_APP_API_VERSION },
      },
    },
    rendererModules: { type: "object" },
    webApplications: { type: "object" },
    extension: { type: "object" },
    services: { type: "object" },
    contributes: {
      type: "object",
      additionalProperties: false,
      required: ["surfaces"],
      properties: {
        surfaces: { type: "array", minItems: 1, maxItems: MAX_SURFACES },
        commands: { type: "array", maxItems: MAX_COMMANDS },
        skills: { type: "array", maxItems: MAX_SKILLS },
      },
    },
  },
} as const
