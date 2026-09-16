import { useState } from "react"

import { HugeiconsIcon } from "@hugeicons/react"
import { Download04Icon as __DownloadIcon } from "@hugeicons/core-free-icons"

import type {
  SecurityFinding,
  SecurityScanRun,
  SecuritySeverity,
} from "@shared/securityScanTypes"
import { SECURITY_SEVERITY_ORDER } from "@shared/securityScanTypes"

import { cn } from "@/lib/utils"

import { useSecurityScanStore } from "../model/securityScanStore"
import {
  FINDING_STATUS_LABEL,
  SEVERITY_LABEL,
  sortFindings,
  summarizeFindings,
} from "../model/presentation"

const SEVERITY_COLOR: Record<SecuritySeverity, string> = {
  critical: "var(--sscan-danger)",
  high: "#ff8a4c",
  medium: "var(--sscan-warn)",
  low: "var(--sscan-cyan)",
  info: "var(--sscan-text-dim)",
}

const STATUS_LABEL: Record<SecurityScanRun["status"], string> = {
  idle: "Ready",
  preparing: "Preparing",
  running: "Scanning",
  completed: "Scan complete",
  failed: "Scan failed",
  cancelled: "Scan cancelled",
}

export function ScanReportView({ run }: { run: SecurityScanRun }) {
  const exporting = useSecurityScanStore((state) => state.exporting)
  const exportReport = useSecurityScanStore((state) => state.exportReport)
  const summary = summarizeFindings(run.findings)
  const ordered = sortFindings(run.findings)

  return (
    <div className="sscan-grid flex h-full flex-col overflow-y-auto p-4">
      <div className="sscan-panel sscan-bracket flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-[color:var(--sscan-cyan)]">
            {STATUS_LABEL[run.status]}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-[color:var(--sscan-text-dim)]">
            {run.target.label} · {run.backend.label}
          </div>
        </div>
        <button
          type="button"
          onClick={exportReport}
          disabled={exporting || run.findings.length === 0}
          className={cn(
            "inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide transition-colors",
            "border-[color:var(--sscan-line)] text-[color:var(--sscan-cyan)] hover:bg-[color:var(--sscan-line-soft)]",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <HugeiconsIcon icon={__DownloadIcon} className="size-3.5" />
          {exporting ? "Preparing" : "PDF"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-2">
        {SECURITY_SEVERITY_ORDER.map((severity) => (
          <div
            key={severity}
            className="sscan-panel flex flex-col items-center py-2"
            style={{
              borderColor:
                summary.bySeverity[severity] > 0
                  ? SEVERITY_COLOR[severity]
                  : "var(--sscan-line)",
            }}
          >
            <span
              className="font-mono text-lg"
              style={{ color: SEVERITY_COLOR[severity] }}
            >
              {summary.bySeverity[severity]}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-wide text-[color:var(--sscan-text-dim)]">
              {SEVERITY_LABEL[severity]}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {ordered.length === 0 ? (
          <div className="sscan-panel p-6 text-center font-mono text-[11px] text-[color:var(--sscan-text-dim)]">
            No findings. The target held up to the scan.
          </div>
        ) : (
          ordered.map((finding) => <FindingRow key={finding.id} finding={finding} />)
        )}
      </div>
    </div>
  )
}

function FindingRow({ finding }: { finding: SecurityFinding }) {
  const [open, setOpen] = useState(false)
  const color = SEVERITY_COLOR[finding.severity]
  return (
    <div className="sscan-panel">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <span
          className="mt-0.5 shrink-0 border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide"
          style={{ color, borderColor: color }}
        >
          {SEVERITY_LABEL[finding.severity]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs text-[color:var(--sscan-text)]">
              {finding.title}
            </span>
            {typeof finding.cvss === "number" && (
              <span className="shrink-0 font-mono text-[10px] text-[color:var(--sscan-text-dim)]">
                CVSS {finding.cvss.toFixed(1)}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] text-[color:var(--sscan-text-dim)]">
            <span>{finding.category}</span>
            <span className="opacity-50">·</span>
            <span>{finding.location}</span>
          </div>
        </div>
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-[color:var(--sscan-text-dim)]">
          {FINDING_STATUS_LABEL[finding.status]}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-[color:var(--sscan-line-soft)] px-3 py-2.5 text-[11px] text-[color:var(--sscan-text-dim)]">
          <p>{finding.description}</p>
          {finding.evidence && (
            <div>
              <div className="font-mono text-[9px] uppercase tracking-wide opacity-70">
                Evidence
              </div>
              <p className="mt-0.5 font-mono text-[10px]">{finding.evidence}</p>
            </div>
          )}
          {finding.remediation && (
            <div>
              <div className="font-mono text-[9px] uppercase tracking-wide opacity-70">Fix</div>
              <p className="mt-0.5">{finding.remediation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
