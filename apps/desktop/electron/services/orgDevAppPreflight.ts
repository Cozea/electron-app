import fs from "node:fs"
import path from "node:path"

import {
  NATIVE_PACKAGE_ALTERNATIVES,
  NATIVE_RUNTIME_PACKAGES,
  type OrgDevAppDiagnostic,
  type OrgDevAppPreflightReport,
} from "../../../../shared/orgDevAppDiagnostics"

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
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
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

function matchNativePackages(source: string): string[] {
  const hits = new Set<string>()
  for (const name of NATIVE_RUNTIME_PACKAGES) {
    if (source.includes(`/${name}/`) || source.includes(`node_modules/${name}`)) hits.add(name)
  }
  // Platform-specific sibling packages (e.g. @img/sharp-darwin-arm64) imply their parent.
  if (/@img\/sharp/.test(source)) hits.add("sharp")
  return [...hits].sort()
}

/**
 * Evidence that a native package will actually reach the artifact.
 *
 * Next's trace manifest lists what tracing *found*, not what tracing *keeps*:
 * `outputFileTracingExcludes` filters the copy afterwards, so a project that correctly
 * excludes sharp still names it in `next-server.js.nft.json`. Treating the trace as
 * authoritative therefore blocks projects that publish perfectly well.
 *
 * A built `standalone` tree is the ground truth when one exists. Otherwise the trace is
 * suspicion only, and weaker still when the config declares excludes we cannot evaluate
 * statically.
 */
function nativeEvidence(projectRoot: string): { names: string[]; confirmed: boolean } {
  const standaloneRoot = path.join(projectRoot, ".next", "standalone")
  if (fs.existsSync(standaloneRoot)) {
    const found = new Set<string>()
    const stack = [standaloneRoot]
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) continue
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          stack.push(full)
          continue
        }
        if (!/\.(?:node|dylib|so)$/i.test(entry.name)) continue
        for (const name of matchNativePackages(path.relative(standaloneRoot, full))) found.add(name)
      }
    }
    return { names: [...found].sort(), confirmed: true }
  }

  const tracePath = path.join(projectRoot, ".next", "next-server.js.nft.json")
  if (!fs.existsSync(tracePath)) return { names: [], confirmed: false }
  let source: string
  try {
    source = fs.readFileSync(tracePath, "utf8")
  } catch {
    return { names: [], confirmed: false }
  }
  return { names: matchNativePackages(source), confirmed: false }
}

function declaresTracingExcludes(projectRoot: string): boolean {
  for (const candidate of NEXT_CONFIG_FILES) {
    const configPath = path.join(projectRoot, candidate)
    if (!fs.existsSync(configPath)) continue
    try {
      return /outputFileTracingExcludes/.test(fs.readFileSync(configPath, "utf8"))
    } catch {
      return false
    }
  }
  return false
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

  if (framework === "nextjs") {
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

  const { runtime } = dependencyNames(readJsonObject(packageJsonPath))
  const evidence = nativeEvidence(resolvedRoot)
  const excludesDeclared = declaresTracingExcludes(resolvedRoot)

  if (expectedRuntimeKind === "service") {
    if (evidence.confirmed) {
      // A built output exists and is authoritative in both directions: what it contains
      // is a blocker, and what it omits is settled — no suspicion from stale traces.
      for (const name of evidence.names) {
        const alternative = NATIVE_PACKAGE_ALTERNATIVES[name]
        diagnostics.push({
          code: "native-runtime-dependency",
          severity: "blocker",
          message: `${name} ships native binaries, which a Service DevApp cannot load.`,
          detail: "Present in this project's built .next/standalone output.",
          fix: alternative
            ? `Replace it with ${alternative}, or exclude it via outputFileTracingExcludes.`
            : "Exclude it from the build output, or move the work to an external HTTPS service.",
        })
      }
    } else {
      const suspected = [...new Set([
        ...evidence.names,
        ...NATIVE_RUNTIME_PACKAGES.filter((name) => runtime.has(name)),
      ])].sort()
      for (const name of suspected) {
        const alternative = NATIVE_PACKAGE_ALTERNATIVES[name]
        diagnostics.push({
          code: "native-runtime-dependency",
          severity: "warning",
          message: `${name} ships native binaries, which a Service DevApp cannot load.`,
          detail: excludesDeclared
            ? "next.config declares outputFileTracingExcludes, so this may already be excluded — build to confirm."
            : "Whether it reaches the artifact depends on the build; build once to confirm.",
          fix: alternative
            ? `Replace it with ${alternative}, or exclude it via outputFileTracingExcludes.`
            : "Exclude it from the build output, or move the work to an external HTTPS service.",
        })
      }
    }
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

export interface OutputScanOptions {
  /** Service outputs must be free of native code; static outputs are only files. */
  runtimeKind: "static" | "service"
}

/**
 * Scans a built output tree for everything that would make packing fail.
 *
 * The packer throws on the first problem it meets, so a tree with four faults needs four
 * builds to clear. This collects them in one pass and never throws — a broken symlink
 * becomes a diagnostic instead of a bare ENOENT from `realpathSync`.
 */
export function scanOutputTree(root: string, options: OutputScanOptions): OrgDevAppDiagnostic[] {
  const diagnostics: OrgDevAppDiagnostic[] = []
  if (!fs.existsSync(root)) {
    return [{
      code: "no-publishable-output",
      severity: "blocker",
      message: "The build produced no output directory to publish.",
      detail: `Expected a directory at ${root}.`,
    }]
  }

  const resolvedRoot = fs.realpathSync(root)
  const rootPrefix = `${resolvedRoot}${path.sep}`
  const machOMagic = [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe]
  const dangling: string[] = []
  const escaping: string[] = []
  const native: string[] = []
  const visited = new Set<string>()
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    let realCurrent: string
    try {
      realCurrent = fs.realpathSync(current)
    } catch {
      continue
    }
    if (visited.has(realCurrent)) continue
    visited.add(realCurrent)

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name)
      const relative = path.relative(root, full)

      if (entry.isSymbolicLink()) {
        let target: string
        try {
          target = fs.realpathSync(full)
        } catch {
          dangling.push(relative)
          continue
        }
        if (target !== resolvedRoot && !target.startsWith(rootPrefix)) escaping.push(relative)
      }

      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!stat.isFile()) continue

      if (options.runtimeKind !== "service") continue
      if (/\.(?:node|dylib|so)$/i.test(entry.name)) {
        native.push(relative)
        continue
      }
      let handle: number
      try {
        handle = fs.openSync(full, "r")
      } catch {
        continue
      }
      try {
        const magic = Buffer.alloc(4)
        if (fs.readSync(handle, magic, 0, 4, 0) === 4 && machOMagic.includes(magic.readUInt32BE(0))) {
          native.push(relative)
        }
      } catch {
        // Unreadable file — the packer will surface it with its own error.
      } finally {
        fs.closeSync(handle)
      }
    }
  }

  if (dangling.length > 0) {
    diagnostics.push({
      code: "dangling-symlink",
      severity: "blocker",
      message: "The build output contains symbolic links with no target.",
      detail: `${dangling.length} broken link(s). pnpm leaves these for packages the build did not trace.`,
      fix: "Remove dangling links from the output after building.",
      paths: dangling.slice(0, 10),
    })
  }
  if (escaping.length > 0) {
    diagnostics.push({
      code: "symlink-escapes-output",
      severity: "blocker",
      message: "The build output links to files outside itself.",
      detail: "A published artifact must be self-contained.",
      paths: escaping.slice(0, 10),
    })
  }
  if (native.length > 0) {
    diagnostics.push({
      code: "native-code-in-output",
      severity: "blocker",
      message: "The build output contains native code, which a Service DevApp cannot load.",
      detail: `${native.length} native file(s) found.`,
      fix: "Exclude the owning packages from the build output, or replace them with pure-JavaScript equivalents.",
      paths: native.slice(0, 10),
    })
  }
  return diagnostics
}
