import { isDevAppCapability, type DevAppCapability } from "./devAppCapabilities"
import {
  DEV_APP_MANIFEST_V3,
  DEV_APP_V3_FILENAME,
  type DevAppAuthoringManifestV3,
  type DevAppManifestV3Diagnostic,
  type DevAppManifestV3DiagnosticCode,
  type DevAppManifestV3ParseResult,
  type DevAppReleaseManifestV1,
} from "./devAppManifestV3"

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
  "permissions",
  "build",
  "contributes",
])
const APP_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/
const CONTRIBUTION_ID = /^[a-z][a-z0-9._-]{0,127}$/
const COMPONENT_NAME = /^[A-Z][A-Za-z0-9_$]{0,127}$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const LOCAL_DEV_URL = /^http:\/\/(?:localhost|127\.0\.0\.1|\[?::1\]?)(?::\d{1,5})?(?:\/.*)?$/
const SURFACE_GROUPS = new Set(["Assistant", "Development", "Utility"])
const STATE_SCOPES = new Set(["none", "instance", "device", "project", "organization"])
const SKILL_PROVIDERS = new Set(["codex", "claude", "cursor", "opencode"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function addDiagnostic(
  diagnostics: DevAppManifestV3Diagnostic[],
  code: DevAppManifestV3DiagnosticCode,
  message: string,
  field?: string,
): void {
  diagnostics.push({ code, severity: "blocker", message, ...(field ? { field } : {}) })
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  diagnostics: DevAppManifestV3Diagnostic[],
  field: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    addDiagnostic(
      diagnostics,
      "manifest-unknown-field",
      `${field} contains unsupported fields: ${unknown.join(", ")}.`,
      field,
    )
  }
}

function isNonEmptyString(value: unknown, maxLength = 500): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength
}

function isPackagePath(value: unknown): value is string {
  if (!isNonEmptyString(value, 512)) return false
  if (value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return false
  return value
    .replace(/\\/g, "/")
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

function validateDevEndpoint(
  value: unknown,
  diagnostics: DevAppManifestV3Diagnostic[],
  field: string,
): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "manifest-field-invalid", `${field} must be an object.`, field)
    return
  }
  rejectUnknownFields(value, new Set(["command", "url"]), diagnostics, field)
  const commandValid = value.command === undefined || isNonEmptyString(value.command, 512)
  const urlValid = value.url === undefined || (typeof value.url === "string" && LOCAL_DEV_URL.test(value.url))
  if (!commandValid) {
    addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.command is invalid.`, `${field}.command`)
  }
  if (!urlValid) {
    addDiagnostic(
      diagnostics,
      "manifest-field-invalid",
      `${field}.url must be a local development URL.`,
      `${field}.url`,
    )
  }
  if (value.command === undefined && value.url === undefined) {
    addDiagnostic(
      diagnostics,
      "manifest-field-invalid",
      `${field} must declare a command or URL.`,
      field,
    )
  }
}

function validateNamedRecord(
  value: unknown,
  diagnostics: DevAppManifestV3Diagnostic[],
  field: string,
  validate: (entry: Record<string, unknown>, entryField: string) => void,
): Record<string, Record<string, unknown>> {
  if (value === undefined) return {}
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "manifest-field-invalid", `${field} must be an object.`, field)
    return {}
  }
  const entries: Record<string, Record<string, unknown>> = {}
  for (const [id, entry] of Object.entries(value)) {
    const entryField = `${field}.${id}`
    if (!CONTRIBUTION_ID.test(id) || !isRecord(entry)) {
      addDiagnostic(diagnostics, "manifest-field-invalid", `${entryField} is invalid.`, entryField)
      continue
    }
    entries[id] = entry
    validate(entry, entryField)
  }
  return entries
}

function validatePermissions(
  value: unknown,
  diagnostics: DevAppManifestV3Diagnostic[],
): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "manifest-field-invalid", "permissions must be an object.", "permissions")
    return
  }
  rejectUnknownFields(value, new Set(["required", "optional"]), diagnostics, "permissions")
  const readCapabilities = (candidate: unknown, field: string): DevAppCapability[] => {
    if (candidate === undefined) return []
    if (!Array.isArray(candidate) || candidate.some((entry) => !isDevAppCapability(entry))) {
      addDiagnostic(
        diagnostics,
        "manifest-field-invalid",
        `${field} contains an unknown capability.`,
        field,
      )
      return []
    }
    return candidate
  }
  const required = readCapabilities(value.required, "permissions.required")
  const optional = readCapabilities(value.optional, "permissions.optional")
  const overlap = optional.filter((capability) => required.includes(capability))
  if (overlap.length > 0) {
    addDiagnostic(
      diagnostics,
      "manifest-field-invalid",
      `Optional capabilities are already required: ${overlap.join(", ")}.`,
      "permissions.optional",
    )
  }
}

function validatePlacement(
  value: unknown,
  diagnostics: DevAppManifestV3Diagnostic[],
  field: string,
): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "manifest-field-invalid", `${field} must be an object.`, field)
    return
  }
  rejectUnknownFields(
    value,
    new Set(["group", "minimumWidth", "minimumHeight", "defaultWidth", "defaultHeight"]),
    diagnostics,
    field,
  )
  if (value.group !== undefined && !SURFACE_GROUPS.has(String(value.group))) {
    addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.group is invalid.`, `${field}.group`)
  }
  for (const key of ["minimumWidth", "minimumHeight", "defaultWidth", "defaultHeight"] as const) {
    const candidate = value[key]
    if (
      candidate !== undefined &&
      (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 160 || candidate > 4096)
    ) {
      addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.${key} is invalid.`, `${field}.${key}`)
    }
  }
}

function validateSimpleContributions(
  value: unknown,
  diagnostics: DevAppManifestV3Diagnostic[],
  field: string,
  validate: (entry: Record<string, unknown>, entryField: string) => void,
): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    addDiagnostic(diagnostics, "manifest-field-invalid", `${field} must be an array.`, field)
    return
  }
  const ids = new Set<string>()
  value.forEach((entry, index) => {
    const entryField = `${field}[${index}]`
    if (!isRecord(entry) || typeof entry.id !== "string" || !CONTRIBUTION_ID.test(entry.id)) {
      addDiagnostic(diagnostics, "manifest-field-invalid", `${entryField} is invalid.`, entryField)
      return
    }
    if (ids.has(entry.id)) {
      addDiagnostic(
        diagnostics,
        "manifest-duplicate-contribution",
        `${entry.id} is declared more than once.`,
        `${entryField}.id`,
      )
      return
    }
    ids.add(entry.id)
    validate(entry, entryField)
  })
}

export function parseDevAppManifestV3(source: string): DevAppManifestV3ParseResult {
  const diagnostics: DevAppManifestV3Diagnostic[] = []
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    return {
      manifest: null,
      diagnostics: [
        {
          code: "manifest-unparsable",
          severity: "blocker",
          message: `${DEV_APP_V3_FILENAME} is not valid JSON.`,
        },
      ],
    }
  }
  if (!isRecord(raw)) {
    return {
      manifest: null,
      diagnostics: [
        {
          code: "manifest-not-object",
          severity: "blocker",
          message: `${DEV_APP_V3_FILENAME} must contain one JSON object.`,
        },
      ],
    }
  }

  rejectUnknownFields(raw, ROOT_FIELDS, diagnostics, "manifest")
  if (raw.manifestVersion !== DEV_APP_MANIFEST_V3) {
    addDiagnostic(
      diagnostics,
      "manifest-version-unsupported",
      `manifestVersion must be ${DEV_APP_MANIFEST_V3}.`,
      "manifestVersion",
    )
  }
  if (typeof raw.id !== "string" || !APP_ID.test(raw.id)) {
    addDiagnostic(diagnostics, "manifest-field-invalid", "id is invalid.", "id")
  }
  if (!isNonEmptyString(raw.name, 120)) {
    addDiagnostic(diagnostics, "manifest-field-invalid", "name is invalid.", "name")
  }
  if (typeof raw.version !== "string" || !SEMVER.test(raw.version)) {
    addDiagnostic(diagnostics, "manifest-field-invalid", "version is invalid.", "version")
  }
  if (raw.description !== undefined && !isNonEmptyString(raw.description, 500)) {
    addDiagnostic(diagnostics, "manifest-field-invalid", "description is invalid.", "description")
  }

  if (!isRecord(raw.engines)) {
    addDiagnostic(diagnostics, "manifest-field-invalid", "engines must be an object.", "engines")
  } else {
    rejectUnknownFields(raw.engines, new Set(["cozea", "nativeApi"]), diagnostics, "engines")
    if (!isNonEmptyString(raw.engines.cozea, 120)) {
      addDiagnostic(diagnostics, "manifest-field-invalid", "engines.cozea is invalid.", "engines.cozea")
    }
    if (
      typeof raw.engines.nativeApi !== "number" ||
      !Number.isInteger(raw.engines.nativeApi) ||
      raw.engines.nativeApi < 1
    ) {
      addDiagnostic(
        diagnostics,
        "manifest-field-invalid",
        "engines.nativeApi is invalid.",
        "engines.nativeApi",
      )
    }
  }

  const rendererModules = validateNamedRecord(
    raw.rendererModules,
    diagnostics,
    "rendererModules",
    (entry, field) => {
      rejectUnknownFields(entry, new Set(["entry", "styles"]), diagnostics, field)
      if (!isPackagePath(entry.entry)) {
        addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.entry is invalid.`, `${field}.entry`)
      }
      if (entry.styles !== undefined && !isPackagePath(entry.styles)) {
        addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.styles is invalid.`, `${field}.styles`)
      }
    },
  )

  const services = validateNamedRecord(raw.services, diagnostics, "services", (entry, field) => {
    rejectUnknownFields(
      entry,
      new Set(["runtime", "entry", "location", "state", "healthCheck", "dev"]),
      diagnostics,
      field,
    )
    if (entry.runtime !== "node") {
      addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.runtime must be node.`, `${field}.runtime`)
    }
    if (!isPackagePath(entry.entry)) {
      addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.entry is invalid.`, `${field}.entry`)
    }
    if (entry.location !== "device" && entry.location !== "hosted") {
      addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.location is invalid.`, `${field}.location`)
    }
    if (!STATE_SCOPES.has(String(entry.state))) {
      addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.state is invalid.`, `${field}.state`)
    }
    if (entry.location === "device" && entry.state === "organization") {
      addDiagnostic(
        diagnostics,
        "manifest-field-invalid",
        `${field}.state cannot be organization for a device service.`,
        `${field}.state`,
      )
    }
    if (entry.location === "hosted" && (entry.state === "device" || entry.state === "project")) {
      addDiagnostic(
        diagnostics,
        "manifest-field-invalid",
        `${field}.state is incompatible with a hosted service.`,
        `${field}.state`,
      )
    }
    if (
      entry.healthCheck !== undefined &&
      (typeof entry.healthCheck !== "string" || !entry.healthCheck.startsWith("/"))
    ) {
      addDiagnostic(
        diagnostics,
        "manifest-field-invalid",
        `${field}.healthCheck is invalid.`,
        `${field}.healthCheck`,
      )
    }
    validateDevEndpoint(entry.dev, diagnostics, `${field}.dev`)
  })

  const webApplications = validateNamedRecord(
    raw.webApplications,
    diagnostics,
    "webApplications",
    (entry, field) => {
      if (entry.kind === "static") {
        rejectUnknownFields(entry, new Set(["kind", "entry", "dev"]), diagnostics, field)
        if (!isPackagePath(entry.entry)) {
          addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.entry is invalid.`, `${field}.entry`)
        }
        validateDevEndpoint(entry.dev, diagnostics, `${field}.dev`)
        return
      }
      if (entry.kind === "service") {
        rejectUnknownFields(entry, new Set(["kind", "service", "path"]), diagnostics, field)
        if (typeof entry.service !== "string" || !CONTRIBUTION_ID.test(entry.service)) {
          addDiagnostic(
            diagnostics,
            "manifest-field-invalid",
            `${field}.service is invalid.`,
            `${field}.service`,
          )
        } else if (!services[entry.service]) {
          addDiagnostic(
            diagnostics,
            "manifest-reference-missing",
            `Web application ${field} references missing service ${entry.service}.`,
            `${field}.service`,
          )
        }
        if (entry.path !== undefined && (typeof entry.path !== "string" || !entry.path.startsWith("/"))) {
          addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.path is invalid.`, `${field}.path`)
        }
        return
      }
      addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.kind is invalid.`, `${field}.kind`)
    },
  )

  if (raw.extension !== undefined) {
    if (!isRecord(raw.extension)) {
      addDiagnostic(diagnostics, "manifest-field-invalid", "extension must be an object.", "extension")
    } else {
      rejectUnknownFields(raw.extension, new Set(["entry"]), diagnostics, "extension")
      if (!isPackagePath(raw.extension.entry)) {
        addDiagnostic(diagnostics, "manifest-field-invalid", "extension.entry is invalid.", "extension.entry")
      }
    }
  }

  validatePermissions(raw.permissions, diagnostics)

  if (raw.build !== undefined) {
    if (!isRecord(raw.build)) {
      addDiagnostic(diagnostics, "manifest-field-invalid", "build must be an object.", "build")
    } else {
      rejectUnknownFields(raw.build, new Set(["targets"]), diagnostics, "build")
      const targets = validateNamedRecord(
        raw.build.targets,
        diagnostics,
        "build.targets",
        (entry, field) => {
          rejectUnknownFields(entry, new Set(["root", "command", "outputs"]), diagnostics, field)
          if (entry.root !== undefined && !isPackagePath(entry.root)) {
            addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.root is invalid.`, `${field}.root`)
          }
          if (!isNonEmptyString(entry.command, 512)) {
            addDiagnostic(
              diagnostics,
              "manifest-field-invalid",
              `${field}.command is invalid.`,
              `${field}.command`,
            )
          }
          if (
            !Array.isArray(entry.outputs) ||
            entry.outputs.length === 0 ||
            entry.outputs.some((output) => !isPackagePath(output))
          ) {
            addDiagnostic(
              diagnostics,
              "manifest-field-invalid",
              `${field}.outputs is invalid.`,
              `${field}.outputs`,
            )
          }
        },
      )
      if (Object.keys(targets).length === 0) {
        addDiagnostic(
          diagnostics,
          "manifest-field-invalid",
          "build.targets must contain at least one target.",
          "build.targets",
        )
      }
    }
  }

  if (!isRecord(raw.contributes)) {
    addDiagnostic(diagnostics, "manifest-field-invalid", "contributes must be an object.", "contributes")
  } else {
    rejectUnknownFields(
      raw.contributes,
      new Set(["surfaces", "commands", "skills", "settings"]),
      diagnostics,
      "contributes",
    )
    if (!Array.isArray(raw.contributes.surfaces) || raw.contributes.surfaces.length === 0) {
      addDiagnostic(
        diagnostics,
        "manifest-no-surfaces",
        "contributes.surfaces must contain at least one surface.",
        "contributes.surfaces",
      )
    } else {
      const surfaceIds = new Set<string>()
      let defaultCount = 0
      raw.contributes.surfaces.forEach((surface, index) => {
        const field = `contributes.surfaces[${index}]`
        if (!isRecord(surface) || !isRecord(surface.renderer)) {
          addDiagnostic(diagnostics, "manifest-field-invalid", `${field} is invalid.`, field)
          return
        }
        rejectUnknownFields(
          surface,
          new Set(["id", "title", "description", "default", "singleton", "placement", "renderer"]),
          diagnostics,
          field,
        )
        if (typeof surface.id !== "string" || !CONTRIBUTION_ID.test(surface.id)) {
          addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.id is invalid.`, `${field}.id`)
        } else if (surfaceIds.has(surface.id)) {
          addDiagnostic(
            diagnostics,
            "manifest-duplicate-contribution",
            `Surface ${surface.id} is declared more than once.`,
            `${field}.id`,
          )
        } else {
          surfaceIds.add(surface.id)
        }
        if (!isNonEmptyString(surface.title, 120)) {
          addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.title is invalid.`, `${field}.title`)
        }
        if (surface.description !== undefined && !isNonEmptyString(surface.description, 500)) {
          addDiagnostic(
            diagnostics,
            "manifest-field-invalid",
            `${field}.description is invalid.`,
            `${field}.description`,
          )
        }
        if (surface.default === true) defaultCount += 1
        if (surface.default !== undefined && typeof surface.default !== "boolean") {
          addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.default is invalid.`, `${field}.default`)
        }
        if (surface.singleton !== undefined && typeof surface.singleton !== "boolean") {
          addDiagnostic(
            diagnostics,
            "manifest-field-invalid",
            `${field}.singleton is invalid.`,
            `${field}.singleton`,
          )
        }
        validatePlacement(surface.placement, diagnostics, `${field}.placement`)

        if (surface.renderer.kind === "native-react") {
          rejectUnknownFields(
            surface.renderer,
            new Set(["kind", "module", "component"]),
            diagnostics,
            `${field}.renderer`,
          )
          if (
            typeof surface.renderer.module !== "string" ||
            !CONTRIBUTION_ID.test(surface.renderer.module)
          ) {
            addDiagnostic(
              diagnostics,
              "manifest-field-invalid",
              `${field}.renderer.module is invalid.`,
              `${field}.renderer.module`,
            )
          } else if (!rendererModules[surface.renderer.module]) {
            addDiagnostic(
              diagnostics,
              "manifest-reference-missing",
              `Surface ${String(surface.id)} references missing renderer module ${surface.renderer.module}.`,
              `${field}.renderer.module`,
            )
          }
          if (
            typeof surface.renderer.component !== "string" ||
            !COMPONENT_NAME.test(surface.renderer.component)
          ) {
            addDiagnostic(
              diagnostics,
              "manifest-field-invalid",
              `${field}.renderer.component is invalid.`,
              `${field}.renderer.component`,
            )
          }
          return
        }
        if (surface.renderer.kind === "web-app") {
          rejectUnknownFields(
            surface.renderer,
            new Set(["kind", "application"]),
            diagnostics,
            `${field}.renderer`,
          )
          if (
            typeof surface.renderer.application !== "string" ||
            !CONTRIBUTION_ID.test(surface.renderer.application)
          ) {
            addDiagnostic(
              diagnostics,
              "manifest-field-invalid",
              `${field}.renderer.application is invalid.`,
              `${field}.renderer.application`,
            )
          } else if (!webApplications[surface.renderer.application]) {
            addDiagnostic(
              diagnostics,
              "manifest-reference-missing",
              `Surface ${String(surface.id)} references missing web application ${surface.renderer.application}.`,
              `${field}.renderer.application`,
            )
          }
          return
        }
        addDiagnostic(
          diagnostics,
          "manifest-field-invalid",
          `${field}.renderer.kind is invalid.`,
          `${field}.renderer.kind`,
        )
      })
      if (defaultCount > 1) {
        addDiagnostic(
          diagnostics,
          "manifest-field-invalid",
          "Only one surface may be the default.",
          "contributes.surfaces",
        )
      }
    }

    validateSimpleContributions(
      raw.contributes.commands,
      diagnostics,
      "contributes.commands",
      (entry, field) => {
        rejectUnknownFields(entry, new Set(["id", "title", "description"]), diagnostics, field)
        if (!isNonEmptyString(entry.title, 120)) {
          addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.title is invalid.`, `${field}.title`)
        }
        if (entry.description !== undefined && !isNonEmptyString(entry.description, 500)) {
          addDiagnostic(
            diagnostics,
            "manifest-field-invalid",
            `${field}.description is invalid.`,
            `${field}.description`,
          )
        }
      },
    )

    validateSimpleContributions(
      raw.contributes.skills,
      diagnostics,
      "contributes.skills",
      (entry, field) => {
        rejectUnknownFields(entry, new Set(["id", "entry", "providers"]), diagnostics, field)
        if (!isPackagePath(entry.entry)) {
          addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.entry is invalid.`, `${field}.entry`)
        }
        if (
          entry.providers !== undefined &&
          (!Array.isArray(entry.providers) ||
            entry.providers.some((provider) => !SKILL_PROVIDERS.has(String(provider))))
        ) {
          addDiagnostic(
            diagnostics,
            "manifest-field-invalid",
            `${field}.providers is invalid.`,
            `${field}.providers`,
          )
        }
      },
    )

    validateSimpleContributions(
      raw.contributes.settings,
      diagnostics,
      "contributes.settings",
      (entry, field) => {
        rejectUnknownFields(
          entry,
          new Set(["id", "title", "description", "type", "default"]),
          diagnostics,
          field,
        )
        if (!isNonEmptyString(entry.title, 120)) {
          addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.title is invalid.`, `${field}.title`)
        }
        if (!new Set(["string", "number", "boolean"]).has(String(entry.type))) {
          addDiagnostic(diagnostics, "manifest-field-invalid", `${field}.type is invalid.`, `${field}.type`)
        }
        if (entry.default !== undefined && typeof entry.default !== entry.type) {
          addDiagnostic(
            diagnostics,
            "manifest-field-invalid",
            `${field}.default does not match its type.`,
            `${field}.default`,
          )
        }
      },
    )
  }

  return diagnostics.length > 0
    ? { manifest: null, diagnostics }
    : { manifest: raw as unknown as DevAppAuthoringManifestV3, diagnostics: [] }
}

export function requestedDevAppCapabilitiesV3(
  manifest: DevAppAuthoringManifestV3 | DevAppReleaseManifestV1,
): { required: DevAppCapability[]; optional: DevAppCapability[] } {
  const permissions = manifest.permissions ?? {}
  const required = permissions.required ?? []
  const optional = permissions.optional ?? []
  return {
    required: [...new Set(required)].sort(),
    optional: [...new Set(optional.filter((capability) => !required.includes(capability)))].sort(),
  }
}
