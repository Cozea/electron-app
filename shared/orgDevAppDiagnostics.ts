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
  | "devapp-manifest-invalid"
  | "contained-runtime-manifest-missing"
  | "next-missing-standalone"
  | "public-env-inlined"
  // Build output — determinable only after a build.
  | "no-publishable-output"
  | "service-staging-incomplete"
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
