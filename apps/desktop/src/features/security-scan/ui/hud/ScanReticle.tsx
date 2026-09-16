import { cn } from "@/lib/utils"

interface ScanReticleProps {
  mode: "idle" | "active"
  label: string
  sublabel?: string
  onClick?: () => void
  disabled?: boolean
  size?: number
}

const R_PROGRESS = 104
const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * R_PROGRESS
// A short bright segment that sweeps, rather than an arc as long as the percentage.
const ARC_SEGMENT = PROGRESS_CIRCUMFERENCE * 0.22

/**
 * The scan reticle: concentric neon rings spinning at different speeds. Idle, it is the run
 * button; active, it speeds up and traces a progress arc. All motion is transform-only.
 */
export function ScanReticle({
  mode,
  label,
  sublabel,
  onClick,
  disabled,
  size = 240,
}: ScanReticleProps) {
  const active = mode === "active"
  const clickable = Boolean(onClick) && !active

  const content = (
    <span
      className={cn(
        "relative inline-flex items-center justify-center",
        active && "sscan-active",
      )}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 240 240"
        width={size}
        height={size}
        fill="none"
        style={{ color: "var(--sscan-cyan)" }}
      >
        {/* faint field */}
        <circle cx="120" cy="120" r="116" stroke="var(--sscan-line-soft)" strokeWidth="1" />

        {/* outer slow ring with ticks */}
        <g className="sscan-ring sscan-ring-slow">
          <circle
            cx="120"
            cy="120"
            r="110"
            stroke="currentColor"
            strokeOpacity="0.5"
            strokeWidth="1"
            strokeDasharray="2 10"
          />
        </g>

        {/* mid counter-rotating ring, segmented */}
        <g className="sscan-ring sscan-ring-mid">
          <circle
            cx="120"
            cy="120"
            r="88"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="70 40"
            strokeLinecap="round"
            className="sscan-glow"
          />
        </g>

        {/* fast inner ring, short arcs */}
        <g className="sscan-ring sscan-ring-fast">
          <circle
            cx="120"
            cy="120"
            r="66"
            stroke="currentColor"
            strokeOpacity="0.9"
            strokeWidth="2"
            strokeDasharray="24 28"
            strokeLinecap="round"
          />
        </g>

        {/* bright arc segment (active) — sweeps steadily around the center */}
        {active && (
          <g className="sscan-ring sscan-ring-progress">
            <circle
              cx="120"
              cy="120"
              r={R_PROGRESS}
              stroke="#eafcff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${ARC_SEGMENT} ${PROGRESS_CIRCUMFERENCE - ARC_SEGMENT}`}
              transform="rotate(-90 120 120)"
              className="sscan-glow"
            />
          </g>
        )}

        {/* core */}
        <g className="sscan-ring-core">
          <circle
            cx="120"
            cy="120"
            r="46"
            stroke="currentColor"
            strokeOpacity="0.6"
            strokeWidth="1"
          />
          <circle cx="120" cy="120" r="46" fill="url(#sscan-core)" />
        </g>

        <defs>
          <radialGradient id="sscan-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(56,225,255,0.28)" />
            <stop offset="100%" stopColor="rgba(56,225,255,0)" />
          </radialGradient>
        </defs>
      </svg>

      <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={cn(
            "font-mono font-semibold text-[color:var(--sscan-cyan)]",
            active ? "text-2xl tracking-tight" : "text-lg tracking-[0.15em]",
          )}
          style={{ textShadow: "0 0 12px var(--sscan-cyan-dim)" }}
        >
          {label}
        </span>
        {sublabel && (
          <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-[color:var(--sscan-text-dim)]">
            {sublabel}
          </span>
        )}
      </span>
    </span>
  )

  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={sublabel ? `${label} ${sublabel}` : label}
        className="sscan-reticle-btn appearance-none border-0 bg-transparent p-0"
      >
        {content}
      </button>
    )
  }

  return content
}
