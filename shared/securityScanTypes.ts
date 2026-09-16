/**
 * Cross-process contract for the Security Scan DevApp.
 *
 * The renderer surface, the main-process scan runner, and the model gateway all speak
 * these shapes. Nothing here imports from a process-specific module so both sides can
 * depend on it without pulling the other in.
 *
 * The scan engine is the open-source Strix pentester (Apache-2.0), driven locally in a
 * Docker sandbox. The model behind it is either an API-key provider Cozea already holds
 * or a local model endpoint; subscription logins are never eligible.
 */

export type SecuritySeverity = "critical" | "high" | "medium" | "low" | "info"

export const SECURITY_SEVERITY_ORDER: readonly SecuritySeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
]

/** What the scan is pointed at. A dev server and a directory are the common local cases. */
export type SecurityScanTargetKind = "devServer" | "directory" | "url" | "repo"

export interface SecurityScanTarget {
  kind: SecurityScanTargetKind
  /** For devServer: the local origin (http://127.0.0.1:port). For directory: an absolute path. */
  value: string
  /** Human label shown in the UI, e.g. "Dev server · :5173" or the project name. */
  label: string
}

/**
 * The model backing the scan. Only API keys and local endpoints qualify — a Strix run is
 * token-heavy and talks a raw model API, which a subscription/OAuth agent login cannot serve.
 */
export type SecurityScanBackendKind = "apiKey" | "localModel"

export interface SecurityScanBackend {
  kind: SecurityScanBackendKind
  /** Cozea connection reused for its stored key, when kind is apiKey. */
  connectionId?: string
  /** LiteLLM model slug passed to Strix as STRIX_LLM, e.g. "openai/gpt-5.4". */
  model: string
  /** Display name for the picker, e.g. "OpenRouter" or "Ollama (local)". */
  label: string
  /** Local endpoint (LLM_API_BASE) when kind is localModel. */
  baseUrl?: string
}

/** A connection the user could pick to back a scan, derived from Cozea's providers. */
export interface SecurityScanBackendOption {
  id: string
  kind: SecurityScanBackendKind
  label: string
  /** Default model slug for this option; the user may override. */
  model: string
  baseUrl?: string
  /** False when the connection exists but cannot back a scan (e.g. a subscription login). */
  eligible: boolean
  /** Why it is not eligible, shown inline. */
  ineligibleReason?: string
}

export type SecurityScanStatus =
  | "idle"
  | "preparing"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export type SecurityAgentRole =
  | "orchestrator"
  | "recon"
  | "exploit"
  | "validation"

export type SecurityAgentStatus = "queued" | "running" | "waiting" | "done" | "failed"

export interface SecurityScanAgent {
  id: string
  name: string
  role: SecurityAgentRole
  status: SecurityAgentStatus
  /** One-line description of what the agent is doing right now. */
  currentAction: string
  startedAt: number | null
  updatedAt: number
  /** Findings this agent has raised so far. */
  findingCount: number
  /** Most recent activity lines, newest last; capped by the runner. */
  activityLog: readonly SecurityAgentActivityLine[]
}

export interface SecurityAgentActivityLine {
  at: number
  text: string
}

export type SecurityFindingStatus =
  | "open"
  | "confirmed"
  | "false-positive"
  | "fixed"

export interface SecurityFinding {
  id: string
  title: string
  severity: SecuritySeverity
  /** OWASP category or class, e.g. "A01: Broken Access Control". */
  category: string
  cwe?: string
  /** CVSS base score 0-10 when Strix assigns one. */
  cvss?: number
  status: SecurityFindingStatus
  /** Where it was found: a route, file, or endpoint. */
  location: string
  description: string
  /** Proof-of-concept or reproduction detail. */
  evidence?: string
  remediation?: string
  discoveredByAgentId?: string
  createdAt: number
}

export interface SecurityScanReport {
  id: string
  runId: string
  generatedAt: number
  /** Absolute path on disk once exported. */
  filePath?: string
  format: "pdf"
}

export interface SecurityScanRun {
  id: string
  name: string
  status: SecurityScanStatus
  target: SecurityScanTarget
  backend: SecurityScanBackend
  startedAt: number | null
  finishedAt: number | null
  /** 0-100, best-effort from the runner. */
  progress: number
  agents: readonly SecurityScanAgent[]
  findings: readonly SecurityFinding[]
  reports: readonly SecurityScanReport[]
  error?: string
}

/**
 * Whether the machine can run a scan. The DevApp gates on this rather than degrading:
 * a scan needs Docker for the Strix sandbox and an eligible model backend.
 */
export interface SecurityScanEnvironment {
  dockerAvailable: boolean
  dockerDetail?: string
  strixInstalled: boolean
  strixVersion?: string
  /** True when at least one API-key or local-model backend is available. */
  hasEligibleBackend: boolean
}

export interface SecurityScanStartRequest {
  target: SecurityScanTarget
  backend: SecurityScanBackend
  /** The user has affirmed they own or are authorized to test the target. */
  authorizationAcknowledged: boolean
  /** Optional free-text guidance passed to Strix as --instruction. */
  instruction?: string
}

/** Aggregate counts for the results dashboard. */
export interface SecurityFindingSummary {
  total: number
  bySeverity: Record<SecuritySeverity, number>
  openCount: number
  confirmedCount: number
}
