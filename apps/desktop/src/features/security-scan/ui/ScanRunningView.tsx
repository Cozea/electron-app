import type { SecurityScanAgent, SecurityScanRun } from "@shared/securityScanTypes"
import { SECURITY_SEVERITY_ORDER } from "@shared/securityScanTypes"

import { cn } from "@/lib/utils"

import {
  AGENT_ROLE_LABEL,
  AGENT_STATUS_LABEL,
  SEVERITY_LABEL,
  formatClock,
  summarizeFindings,
} from "../model/presentation"
import { AgentGlyph } from "./hud/AgentGlyph"
import { ScanReticle } from "./hud/ScanReticle"

const STATUS_TONE: Record<SecurityScanAgent["status"], string> = {
  running: "text-[color:var(--sscan-cyan)]",
  waiting: "text-[color:var(--sscan-warn)]",
  queued: "text-[color:var(--sscan-text-dim)]",
  done: "text-[color:var(--sscan-ok)]",
  failed: "text-[color:var(--sscan-danger)]",
}

export function ScanRunningView({ run }: { run: SecurityScanRun }) {
  const summary = summarizeFindings(run.findings)

  return (
    <div className="sscan-grid relative flex h-full flex-col overflow-y-auto p-4">
      <div className="flex flex-col items-center py-2">
        <ScanReticle mode="active" label={`${Math.round(run.progress)}%`} size={180} />
        <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.3em] text-[color:var(--sscan-text-dim)]">
          {run.target.label} · {run.backend.label}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {run.agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>

      <div className="mt-3 sscan-panel sscan-bracket flex items-center gap-3 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--sscan-text-dim)]">
          Findings
        </span>
        <span className="font-mono text-sm text-[color:var(--sscan-text)]">{summary.total}</span>
        <div className="ml-auto flex items-center gap-2">
          {SECURITY_SEVERITY_ORDER.map((severity) => (
            <span
              key={severity}
              className="font-mono text-[10px] uppercase tracking-wide text-[color:var(--sscan-text-dim)]"
            >
              {SEVERITY_LABEL[severity][0]}
              <span className="ml-1 text-[color:var(--sscan-text)]">
                {summary.bySeverity[severity]}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function AgentCard({ agent }: { agent: SecurityScanAgent }) {
  const lastLine = agent.activityLog[agent.activityLog.length - 1]
  return (
    <div className="sscan-panel sscan-bracket sscan-rise flex gap-3 p-3">
      <div className="shrink-0">
        <AgentGlyph role={agent.role} status={agent.status} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs uppercase tracking-wide text-[color:var(--sscan-text)]">
            {AGENT_ROLE_LABEL[agent.role]}
          </span>
          <span
            className={cn(
              "ml-auto font-mono text-[10px] uppercase tracking-wide",
              STATUS_TONE[agent.status],
            )}
          >
            {AGENT_STATUS_LABEL[agent.status]}
          </span>
        </div>
        <p className="mt-1 truncate text-[11px] text-[color:var(--sscan-text-dim)]">
          {agent.currentAction}
        </p>
        {lastLine && (
          <p className="mt-1 flex gap-1.5 font-mono text-[10px] text-[color:var(--sscan-text-dim)]">
            <span className="opacity-70">{formatClock(lastLine.at)}</span>
            <span className="min-w-0 flex-1 truncate">{lastLine.text}</span>
          </p>
        )}
      </div>
    </div>
  )
}
