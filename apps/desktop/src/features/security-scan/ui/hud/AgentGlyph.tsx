import type { SecurityAgentRole, SecurityAgentStatus } from "@shared/securityScanTypes"

import { cn } from "@/lib/utils"

interface AgentGlyphProps {
  role: SecurityAgentRole
  status: SecurityAgentStatus
  size?: number
}

/**
 * Purpose-built animated glyphs, one per agent role, that depict the work rather than label
 * it: recon sweeps like radar, exploitation locks onto a target, the orchestrator pulses a
 * mesh of nodes, validation runs a scan bar. They animate while the agent is running and
 * hold still, dimmed, otherwise.
 */
export function AgentGlyph({ role, status, size = 44 }: AgentGlyphProps) {
  const running = status === "running"
  const tone =
    status === "failed"
      ? "var(--sscan-danger)"
      : status === "done"
        ? "var(--sscan-ok)"
        : "var(--sscan-cyan)"

  return (
    <span
      className={cn("inline-flex", !running && "sscan-glyph-idle")}
      style={{ width: size, height: size, color: tone }}
    >
      <svg viewBox="0 0 48 48" width={size} height={size} fill="none">
        {role === "recon" && <ReconGlyph />}
        {role === "exploit" && <ExploitGlyph />}
        {role === "orchestrator" && <OrchestratorGlyph />}
        {role === "validation" && <ValidationGlyph />}
      </svg>
    </span>
  )
}

function ReconGlyph() {
  return (
    <g stroke="currentColor" fill="none">
      <circle cx="24" cy="24" r="20" strokeOpacity="0.3" />
      <circle cx="24" cy="24" r="13" strokeOpacity="0.3" />
      <circle cx="24" cy="24" r="6" strokeOpacity="0.3" />
      {/* rotating sweep wedge */}
      <g className="sscan-sweep">
        <path d="M24 24 L24 4 A20 20 0 0 1 41 15 Z" fill="url(#sscan-sweep-grad)" stroke="none" />
        <line x1="24" y1="24" x2="24" y2="4" strokeWidth="1.5" className="sscan-glow" />
      </g>
      {/* blips */}
      <circle cx="33" cy="17" r="1.6" fill="currentColor" stroke="none" className="sscan-blink" />
      <circle
        cx="16"
        cy="30"
        r="1.6"
        fill="currentColor"
        stroke="none"
        className="sscan-blink sscan-node-3"
      />
      <defs>
        <linearGradient id="sscan-sweep-grad" x1="24" y1="24" x2="24" y2="4">
          <stop offset="0%" stopColor="rgba(56,225,255,0.4)" />
          <stop offset="100%" stopColor="rgba(56,225,255,0)" />
        </linearGradient>
      </defs>
    </g>
  )
}

function ExploitGlyph() {
  return (
    <g stroke="currentColor" fill="none">
      {/* locking brackets */}
      <g className="sscan-lock" strokeWidth="2" strokeLinecap="round">
        <path d="M10 16 L10 10 L16 10" />
        <path d="M38 16 L38 10 L32 10" />
        <path d="M10 32 L10 38 L16 38" />
        <path d="M38 32 L38 38 L32 38" />
      </g>
      {/* crosshair */}
      <circle cx="24" cy="24" r="8" strokeOpacity="0.7" className="sscan-glow" />
      <line x1="24" y1="12" x2="24" y2="20" strokeWidth="1.5" />
      <line x1="24" y1="28" x2="24" y2="36" strokeWidth="1.5" />
      <line x1="12" y1="24" x2="20" y2="24" strokeWidth="1.5" />
      <line x1="28" y1="24" x2="36" y2="24" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="2" fill="currentColor" stroke="none" className="sscan-blink" />
    </g>
  )
}

function OrchestratorGlyph() {
  return (
    <g stroke="currentColor" fill="none">
      {/* connectors */}
      <g strokeOpacity="0.4">
        <line x1="24" y1="24" x2="24" y2="8" />
        <line x1="24" y1="24" x2="39" y2="33" />
        <line x1="24" y1="24" x2="9" y2="33" />
      </g>
      {/* central hub */}
      <circle cx="24" cy="24" r="5" strokeWidth="2" className="sscan-glow sscan-ring-core" />
      {/* satellite nodes pulsing in sequence */}
      <circle cx="24" cy="8" r="3" fill="currentColor" stroke="none" className="sscan-node" />
      <circle
        cx="39"
        cy="33"
        r="3"
        fill="currentColor"
        stroke="none"
        className="sscan-node sscan-node-2"
      />
      <circle
        cx="9"
        cy="33"
        r="3"
        fill="currentColor"
        stroke="none"
        className="sscan-node sscan-node-4"
      />
    </g>
  )
}

function ValidationGlyph() {
  return (
    <g stroke="currentColor" fill="none">
      <rect x="6" y="6" width="36" height="36" rx="4" strokeOpacity="0.3" />
      {/* scanning bars */}
      <g strokeWidth="0" fill="currentColor">
        <rect x="13" y="18" width="3" height="12" rx="1.5" className="sscan-bar" />
        <rect x="19" y="18" width="3" height="12" rx="1.5" className="sscan-bar sscan-bar-2" />
        <rect x="25" y="18" width="3" height="12" rx="1.5" className="sscan-bar sscan-bar-3" />
        <rect x="31" y="18" width="3" height="12" rx="1.5" className="sscan-bar sscan-bar-4" />
      </g>
      {/* confirm check */}
      <path
        d="M17 24 L22 29 L32 18"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        stroke="currentColor"
        opacity="0.9"
        className="sscan-glow"
      />
    </g>
  )
}
