import fs from "node:fs"
import path from "node:path"

import { type OrgDevAppDiagnostic, type OrgDevAppPreflightReport } from "../../../../shared/orgDevAppDiagnostics"
import { DEV_APP_MANIFEST_FILENAME, parseDevAppPackage, type DevAppPackage } from "../../../../shared/devAppPackage"

/**
 * Everything about a project that can be known before spending minutes on a build.
 *
 * The publish pipeline validates only after building, so a project with three problems
 * costs three builds to discover them. This reports all of them at once, in well under a
 * second, in a form an agent can act on.
 */

const ENV_FILES = [".env", ".env.local", ".env.production", ".env.production.local"] as const
const NEXT_CONFIG_FILES = ["next.config.ts", "next.config.js", "next.config.mjs", "next.config.cjs"] as const

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function dependencyNames(pkg: Record<string, unknown> | null): {
  runtime: Set<string>
  all: Set<string>
} {
  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const runtime = new Set(Object.keys(asRecord(pkg?.dependencies)))
  const all = new Set([...runtime, ...Object.keys(asRecord(pkg?.devDependencies))])
  return { runtime, all }
}

export function detectFramework(projectRoot: string): string {
  const { all } = dependencyNames(readJsonObject(path.join(projectRoot, "package.json")))
  if (all.has("next")) return "nextjs"
  if (all.has("nuxt")) return "nuxt"
  if (all.has("astro")) return "astro"
  if (all.has("@remix-run/react") || all.has("react-router")) return "remix"
  if (all.has("@sveltejs/kit")) return "sveltekit"
  if (all.has("vite") && all.has("vue")) return "vite-vue"
  if (all.has("vite") && all.has("svelte")) return "vite-svelte"
  if (all.has("vite")) return "vite-react"
  if (all.has("gatsby")) return "gatsby"
  return "web"
}

/**
 * Next config is TypeScript more often than not, so it cannot be imported here without a
 * transform. Reading it as text is imprecise by construction: a config that computes its
 * `output` at runtime reads as absent. Both `output` diagnostics are therefore warnings
 * rather than blockers — better a false warning than a false refusal to publish.
 */
function readNextOutputMode(projectRoot: string): "standalone" | "export" | "unknown" | "absent" {
  for (const candidate of NEXT_CONFIG_FILES) {
    const configPath = path.join(projectRoot, candidate)
    if (!fs.existsSync(configPath)) continue
    let source: string
    try {
      source = fs.readFileSync(configPath, "utf8")
    } catch {
      return "unknown"
    }
    if (/output\s*:\s*["'`]standalone["'`]/.test(source)) return "standalone"
    if (/output\s*:\s*["'`]export["'`]/.test(source)) return "export"
    // An `output` key whose value we cannot read statically.
    if (/\boutput\s*:/.test(source)) return "unknown"
    return "absent"
  }
  return "absent"
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
      .filter((key) => key.startsWith("NEXT_PUBLIC_") || key.startsWith("VITE_") || key.startsWith("PUBLIC_"))
    if (keys.length > 0) found.push({ file: candidate, keys })
  }
  return found
}

function detectPackageManagerBuild(projectRoot: string): string | null {
  const pkg = readJsonObject(path.join(projectRoot, "package.json"))
  const scripts = pkg?.scripts
  const build =
    scripts && typeof scripts === "object" && !Array.isArray(scripts)
      ? (scripts as Record<string, unknown>).build
      : undefined
  if (typeof build !== "string" || !build.trim()) return null
  if (fs.existsSync(path.join(projectRoot, "bun.lock")) || fs.existsSync(path.join(projectRoot, "bun.lockb"))) {
    return "bun run build"
  }
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm run build"
  if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn build"
  return "npm run build"
}

/** Static analysis of a project root. Never builds, never spawns, never writes. */
export function preflightProject(projectRoot: string): OrgDevAppPreflightReport {
  const resolvedRoot = path.resolve(projectRoot)
  const diagnostics: OrgDevAppDiagnostic[] = []
  const packageJsonPath = path.join(resolvedRoot, "package.json")

  if (!fs.existsSync(packageJsonPath)) {
    diagnostics.push({
      code: "not-node-project",
      severity: "blocker",
      message: "This folder has no package.json, so Cozea cannot build a DevApp from it.",
      fix: "Publish from the directory that contains the project's package.json.",
      paths: ["package.json"],
    })
    return { ok: false, framework: "unknown", expectedRuntimeKind: "unknown", diagnostics }
  }

  const framework = detectFramework(resolvedRoot)
  const buildCommand = detectPackageManagerBuild(resolvedRoot)
  const manifestPath = path.join(resolvedRoot, DEV_APP_MANIFEST_FILENAME)
  let authoredPackage: DevAppPackage | null = null
  if (fs.existsSync(manifestPath)) {
    const parsed = parseDevAppPackage(fs.readFileSync(manifestPath, "utf8"))
    authoredPackage = parsed.manifest
    if (!authoredPackage) {
      diagnostics.push({
        code: "devapp-manifest-invalid",
        severity: "blocker",
        message: "cozea-devapp.json is invalid.",
        detail: parsed.diagnostics
          .map((entry) => entry.message)
          .join(" ")
          .slice(0, 1_000),
        fix: "Fix the v2 DevApp manifest before publishing.",
        paths: [DEV_APP_MANIFEST_FILENAME],
      })
    }
  }

  if (!buildCommand) {
    diagnostics.push({
      code: "no-build-script",
      severity: "blocker",
      message: "This project has no build script.",
      detail: "Org DevApps publish a production artifact, not a localhost preview.",
      fix: 'Add a "build" script to package.json that produces a static UI or a portable service output.',
      paths: ["package.json"],
    })
  }

  let expectedRuntimeKind: OrgDevAppPreflightReport["expectedRuntimeKind"] = "unknown"

  if (authoredPackage?.service?.runtimeKind === "node") {
    expectedRuntimeKind = "service"
  } else if (authoredPackage) {
    expectedRuntimeKind = "static"
  } else if (framework === "nextjs") {
    const outputMode = readNextOutputMode(resolvedRoot)
    if (outputMode === "export") {
      expectedRuntimeKind = "static"
    } else if (outputMode === "standalone") {
      expectedRuntimeKind = "service"
    } else if (outputMode === "absent") {
      expectedRuntimeKind = "service"
      diagnostics.push({
        code: "next-missing-standalone",
        severity: "blocker",
        message: "This Next.js app does not declare a publishable output mode.",
        detail: "Next builds a server that expects the project directory, which never ships to consumers.",
        fix: 'Add output: "standalone" to next.config for a Service DevApp, or output: "export" for a static one.',
        paths: [NEXT_CONFIG_FILES.find((f) => fs.existsSync(path.join(resolvedRoot, f))) ?? "next.config.ts"],
      })
    } else {
      diagnostics.push({
        code: "next-missing-standalone",
        severity: "warning",
        message: "Cozea could not statically determine this Next.js app's output mode.",
        detail: "next.config sets output to a computed value, so publishing may still fail after the build.",
        fix: 'Set output to a literal "standalone" or "export" if publishing fails.',
      })
    }
  } else if (framework === "nuxt") {
    expectedRuntimeKind = "service"
  } else {
    const declaresService = readJsonObject(packageJsonPath)?.cozeaDevApp
    expectedRuntimeKind =
      declaresService && typeof declaresService === "object" && "service" in (declaresService as object)
        ? "service"
        : "static"
  }

  if (expectedRuntimeKind === "service" && !authoredPackage && !fs.existsSync(manifestPath)) {
    diagnostics.push({
      code: "contained-runtime-manifest-missing",
      severity: "blocker",
      message: "Published Service DevApps require an explicit contained-runtime manifest.",
      detail: "A Node service cannot choose device/hosted placement or state ownership by inference.",
      fix: "Add a v2 cozea-devapp.json that declares service.runtimeKind, service.entry, runtime.location, and runtime.state.",
      paths: [DEV_APP_MANIFEST_FILENAME],
    })
  }

  for (const { file, keys } of publicEnvKeys(resolvedRoot)) {
    diagnostics.push({
      code: "public-env-inlined",
      severity: "warning",
      message: "Public environment values are compiled into the artifact at build time.",
      detail: `${file} defines ${keys.join(", ")}. These become constants in the published bundle and cannot be reconfigured per consumer.`,
      fix: "Make sure these hold the values every org member should receive, not this machine's local ones.",
      paths: [file],
    })
  }

  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === "blocker"),
    framework,
    expectedRuntimeKind,
    diagnostics,
  }
}
