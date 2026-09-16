import type {
  SecurityAgentRole,
  SecurityAgentStatus,
  SecurityFinding,
  SecurityFindingStatus,
  SecurityFindingSummary,
  SecuritySeverity,
} from "@shared/securityScanTypes"
import { SECURITY_SEVERITY_ORDER } from "@shared/securityScanTypes"

export const SEVERITY_LABEL: Record<SecuritySeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
}

/** Tailwind classes for a severity chip. Kept theme-aware via foreground/background tokens. */
export const SEVERITY_CHIP_CLASS: Record<SecuritySeverity, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  medium: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  low: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  info: "bg-muted text-muted-foreground border-border",
}

export const AGENT_ROLE_LABEL: Record<SecurityAgentRole, string> = {
  orchestrator: "Orchestrator",
  recon: "Recon",
  exploit: "Exploitation",
  validation: "Validation",
}

export const AGENT_STATUS_LABEL: Record<SecurityAgentStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting",
  done: "Done",
  failed: "Failed",
}

export const FINDING_STATUS_LABEL: Record<SecurityFindingStatus, string> = {
  open: "Open",
  confirmed: "Confirmed",
  "false-positive": "False positive",
  fixed: "Fixed",
}

export function summarizeFindings(
  findings: readonly SecurityFinding[],
): SecurityFindingSummary {
  const bySeverity: Record<SecuritySeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  }
  let openCount = 0
  let confirmedCount = 0
  for (const finding of findings) {
    bySeverity[finding.severity] += 1
    if (finding.status === "open") openCount += 1
    if (finding.status === "confirmed") confirmedCount += 1
  }
  return { total: findings.length, bySeverity, openCount, confirmedCount }
}

/** Findings ordered most severe first, then most recent. */
export function sortFindings(
  findings: readonly SecurityFinding[],
): SecurityFinding[] {
  const rank = (severity: SecuritySeverity) => SECURITY_SEVERITY_ORDER.indexOf(severity)
  return [...findings].sort((a, b) => {
    const bySeverity = rank(a.severity) - rank(b.severity)
    if (bySeverity !== 0) return bySeverity
    return b.createdAt - a.createdAt
  })
}

export function formatClock(at: number | null): string {
  if (!at) return ""
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
