/**
 * Structured diagnostics for Org DevApp publishing.
 *
 * Publishing failures must be machine-readable before they are human-readable: agents
 * author and publish DevApps, and an agent cannot act on dialog prose. Every check
 * reports a `OrgDevAppDiagnosticCode`; the renderer renders those, and never the other
 * way around.
 */

export type OrgDevAppDiagnosticCode =
  // Project shape — determinable without building.
  | "not-node-project"
  | "no-build-script"
  | "next-missing-standalone"
  | "native-runtime-dependency"
  | "public-env-inlined"
  // Build output — determinable only after a build.
  | "no-publishable-output"
  | "service-staging-incomplete"
  | "native-code-in-output"
  | "dangling-symlink"
  | "symlink-escapes-output"
  | "artifact-limit-exceeded"

export type OrgDevAppDiagnosticSeverity = "blocker" | "warning"

export interface OrgDevAppDiagnostic {
  code: OrgDevAppDiagnosticCode
  severity: OrgDevAppDiagnosticSeverity
  /** One sentence, present tense, describing what is wrong. */
  message: string
  /** The specific evidence — a path, a package name, a measured value. */
  detail?: string
  /** What to change. Omitted when there is no single obvious remedy. */
  fix?: string
  /** Project-relative paths this diagnostic refers to, when it refers to files. */
  paths?: string[]
}

export interface OrgDevAppPreflightReport {
  /** False when any diagnostic is a blocker. */
  ok: boolean
  framework: string
  /** What this project would publish as, so far as can be told without building. */
  expectedRuntimeKind: "static" | "service" | "unknown"
  diagnostics: OrgDevAppDiagnostic[]
}

export function isBlocking(report: OrgDevAppPreflightReport): boolean {
  return report.diagnostics.some((diagnostic) => diagnostic.severity === "blocker")
}

export function blockers(report: OrgDevAppPreflightReport): OrgDevAppDiagnostic[] {
  return report.diagnostics.filter((diagnostic) => diagnostic.severity === "blocker")
}

/**
 * Packages that ship prebuilt native binaries and are reached at runtime rather than
 * only during a build. A Service DevApp runs under Electron's Node ABI, so these cannot
 * load even when they install cleanly on the publishing machine.
 *
 * Build-time native tooling (`@swc/core`, `lightningcss`, `@tailwindcss/oxide`,
 * `@next/swc`, `fsevents`) is deliberately absent — it never reaches the artifact.
 */
export const NATIVE_RUNTIME_PACKAGES: ReadonlyArray<string> = [
  "sharp",
  "better-sqlite3",
  "sqlite3",
  "bcrypt",
  "canvas",
  "duckdb",
  "node-pty",
  "@prisma/engines",
  "prisma",
  "@napi-rs/canvas",
  "grpc",
  "@grpc/grpc-js-core",
  "zeromq",
  "usb",
  "serialport",
]

/** Pure-JS replacements worth naming when a native dependency blocks publishing. */
export const NATIVE_PACKAGE_ALTERNATIVES: Readonly<Record<string, string>> = {
  "better-sqlite3": "node:sqlite (built into the service runtime's Node 24)",
  sqlite3: "node:sqlite (built into the service runtime's Node 24)",
  bcrypt: "bcryptjs",
  sharp: "disable image optimization, or precompute images at build time",
  canvas: "@resvg/resvg-js is also native — prefer server-side SVG without rasterizing",
}
