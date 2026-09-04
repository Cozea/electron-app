import fs from "node:fs"
import path from "node:path"

import {
  type OrgDevAppDiagnostic,
  type OrgDevAppPreflightReport,
} from "../../../../shared/orgDevAppDiagnostics"
import {
  NATIVE_DEV_APP_MANIFEST_FILENAME,
  parseNativeDevAppManifest,
  type NativeDevAppManifestV3,
} from "../../../../shared/nativeDevAppManifest"

const ENV_FILES = [".env", ".env.local", ".env.production", ".env.production.local"] as const

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function dependencyNames(pkg: Record<string, unknown> | null): Set<string> {
  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return new Set([
    ...Object.keys(asRecord(pkg?.dependencies)),
    ...Object.keys(asRecord(pkg?.devDependencies)),
  ])
}

export function detectFramework(projectRoot: string): string {
  const all = dependencyNames(readJsonObject(path.join(projectRoot, "package.json")))
  if (all.has("next")) return "nextjs"
  if (all.has("nuxt")) return "nuxt"
  if (all.has("astro")) return "astro"
  if (all.has("@remix-run/react") || all.has("react-router")) return "remix"
  if (all.has("@sveltejs/kit")) return "sveltekit"
  if (all.has("vite") && all.has("vue")) return "vite-vue"
  if (all.has("vite") && all.has("svelte")) return "vite-svelte"
  if (all.has("vite")) return "vite-react"
  if (all.has("gatsby")) return "gatsby"
  return "native-react"
}

function publicEnvKeys(projectRoot: string): { file: string; keys: string[] }[] {
  const found: { file: string; keys: string[] }[] = []
  for (const candidate of ENV_FILES) {
    const envPath = path.join(projectRoot, candidate)
    if (!fs.existsSync(envPath)) continue
    let source: string
    try {
      source = fs.readFileSync(envPath, "utf8")
    } catch {
      continue
    }
    const keys = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=", 1)[0]?.trim() ?? "")
      .filter(
        (key) =>
          key.startsWith("NEXT_PUBLIC_") ||
          key.startsWith("VITE_") ||
          key.startsWith("PUBLIC_"),
      )
    if (keys.length > 0) found.push({ file: candidate, keys })
  }
  return found
}

function hasBuildScript(projectRoot: string): boolean {
  const pkg = readJsonObject(path.join(projectRoot, "package.json"))
  const scripts = pkg?.scripts
  const build =
    scripts && typeof scripts === "object" && !Array.isArray(scripts)
      ? (scripts as Record<string, unknown>).build
      : undefined
  return typeof build === "string" && build.trim().length > 0
}

function readManifest(
  projectRoot: string,
  diagnostics: OrgDevAppDiagnostic[],
): NativeDevAppManifestV3 | null {
  const manifestPath = path.join(projectRoot, NATIVE_DEV_APP_MANIFEST_FILENAME)
  if (!fs.existsSync(manifestPath)) {
    diagnostics.push({
      code: "devapp-manifest-invalid",
      severity: "blocker",
      message: "This project has no native DevApp manifest.",
      fix: "Add a manifestVersion 3 cozea-devapp.json or create a native DevApp project.",
      paths: [NATIVE_DEV_APP_MANIFEST_FILENAME],
    })
    return null
  }
  const parsed = parseNativeDevAppManifest(fs.readFileSync(manifestPath, "utf8"))
  if (!parsed.manifest) {
    diagnostics.push({
      code: "devapp-manifest-invalid",
      severity: "blocker",
      message: "cozea-devapp.json is invalid.",
      detail: parsed.diagnostics
        .map((entry) => entry.message)
        .join(" ")
        .slice(0, 1_000),
      fix: "Fix the manifest v3 diagnostics before previewing or publishing.",
      paths: [NATIVE_DEV_APP_MANIFEST_FILENAME],
    })
    return null
  }
  return parsed.manifest
}

function validateDeclaredOutputs(
  projectRoot: string,
  manifest: NativeDevAppManifestV3,
  diagnostics: OrgDevAppDiagnostic[],
): void {
  for (const [id, module] of Object.entries(manifest.rendererModules ?? {})) {
    if (!fs.existsSync(path.join(projectRoot, module.output))) {
      diagnostics.push({
        code: "no-publishable-output",
        severity: "warning",
        message: `Native renderer ${id} has not been built yet.`,
        detail: module.output,
        fix: "Run `bun run build` before publishing.",
        paths: [module.output],
      })
    }
  }
  if (manifest.extension && !fs.existsSync(path.join(projectRoot, manifest.extension.output))) {
    diagnostics.push({
      code: "no-publishable-output",
      severity: "warning",
      message: "The extension worker has not been built yet.",
      detail: manifest.extension.output,
      fix: "Run `bun run build` before publishing.",
      paths: [manifest.extension.output],
    })
  }
  for (const [id, application] of Object.entries(manifest.webApplications ?? {})) {
    if (application.entry && !fs.existsSync(path.join(projectRoot, application.entry))) {
      diagnostics.push({
        code: "no-publishable-output",
        severity: "warning",
        message: `Web application ${id} has not been built yet.`,
        detail: application.entry,
        fix: "Run the declared production build before publishing.",
        paths: [application.entry],
      })
    }
  }
}

/** Static analysis of a DevApp project. Never builds, spawns, or writes. */
export function preflightProject(projectRootInput: string): OrgDevAppPreflightReport {
  const projectRoot = path.resolve(projectRootInput)
  const diagnostics: OrgDevAppDiagnostic[] = []
  const packageJsonPath = path.join(projectRoot, "package.json")

  if (!fs.existsSync(packageJsonPath)) {
    diagnostics.push({
      code: "not-node-project",
      severity: "blocker",
      message: "This folder has no package.json, so Cozea cannot build its DevApp outputs.",
      fix: "Open the directory containing the native DevApp package.json.",
      paths: ["package.json"],
    })
    return { ok: false, framework: "unknown", expectedRuntimeKind: "unknown", diagnostics }
  }

  const manifest = readManifest(projectRoot, diagnostics)
  if (!hasBuildScript(projectRoot)) {
    diagnostics.push({
      code: "no-build-script",
      severity: "blocker",
      message: "This DevApp project has no build script.",
      detail: "Published releases contain immutable ESM/web/service outputs, not source files.",
      fix: 'Add a "build" script, normally "cozea-devapp build".',
      paths: ["package.json"],
    })
  }

  if (manifest) validateDeclaredOutputs(projectRoot, manifest, diagnostics)

  for (const { file, keys } of publicEnvKeys(projectRoot)) {
    diagnostics.push({
      code: "public-env-inlined",
      severity: "warning",
      message: "Public environment values are compiled into an adopted web application.",
      detail: `${file} defines ${keys.join(", ")}. These values cannot be changed per consumer after publication.`,
      fix: "Keep secrets in a contained service or declared runtime configuration.",
      paths: [file],
    })
  }

  const hasServices = manifest ? Object.keys(manifest.services ?? {}).length > 0 : false
  return {
    ok: !diagnostics.some((entry) => entry.severity === "blocker"),
    framework: manifest?.rendererModules ? "native-react" : detectFramework(projectRoot),
    expectedRuntimeKind: hasServices ? "service" : manifest ? "static" : "unknown",
    diagnostics,
  }
}
