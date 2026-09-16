import { ScanReticle } from "./hud/ScanReticle"

interface ScanWelcomeProps {
  onGetStarted: () => void
}

const STEPS = [
  {
    title: "Point it at your app",
    body: "Your running dev server, or the project on disk.",
  },
  {
    title: "Pick a model",
    body: "An API key you have connected in Cozea, or a local model. Subscriptions cannot back a scan.",
  },
  {
    title: "Run the scan",
    body: "Agents probe for vulnerabilities and report what they can prove, with fixes.",
  },
]

/**
 * First-run state, shown before anything is configured. Explains the surface and routes to
 * setup. A dimmed reticle sits behind the copy so the HUD identity is present from the start.
 */
export function ScanWelcome({ onGetStarted }: ScanWelcomeProps) {
  return (
    <div className="sscan-grid relative flex h-full flex-col items-center justify-center overflow-y-auto p-6">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-25">
        <ScanReticle mode="idle" label="" size={320} />
      </div>

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.4em] text-[color:var(--sscan-cyan)]">
          Security scan
        </div>
        <p className="mt-3 text-sm leading-relaxed text-[color:var(--sscan-text)]">
          An automated security scan of your app. It actively probes for vulnerabilities and
          reports the ones it can prove, scored and with a fix for each.
        </p>

        <div className="mt-6 w-full space-y-2 text-left">
          {STEPS.map((step, index) => (
            <div
              key={step.title}
              className="sscan-panel sscan-bracket flex items-start gap-3 p-3"
            >
              <span className="font-mono text-sm text-[color:var(--sscan-cyan)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <div className="text-xs text-[color:var(--sscan-text)]">{step.title}</div>
                <div className="mt-0.5 text-[11px] text-[color:var(--sscan-text-dim)]">
                  {step.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onGetStarted}
          className="mt-6 w-full border border-[color:var(--sscan-cyan)] bg-[color:var(--sscan-line-soft)] py-2.5 font-mono text-xs uppercase tracking-[0.25em] text-[color:var(--sscan-cyan)] transition-colors hover:bg-[color:var(--sscan-line)]"
        >
          Get started
        </button>
      </div>
    </div>
  )
}
