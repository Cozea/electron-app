import type { SecurityScanBackendOption } from "@shared/securityScanTypes"

import { cn } from "@/lib/utils"

import { canStartScan, useSecurityScanStore } from "../model/securityScanStore"

export function ScanSetupPanel() {
  const environment = useSecurityScanStore((state) => state.environment)
  const backendOptions = useSecurityScanStore((state) => state.backendOptions)
  const selectedBackendId = useSecurityScanStore((state) => state.selectedBackendId)
  const acknowledged = useSecurityScanStore((state) => state.acknowledged)
  const selectBackend = useSecurityScanStore((state) => state.selectBackend)
  const setAcknowledged = useSecurityScanStore((state) => state.setAcknowledged)
  const ready = useSecurityScanStore(canStartScan)

  return (
    <div className="sscan-grid flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Section title="Target">
        <div className="sscan-panel sscan-bracket p-3">
          <div className="text-sm text-[color:var(--sscan-text)]">Dev server · :5173</div>
          <div className="mt-0.5 font-mono text-[10px] text-[color:var(--sscan-text-dim)]">
            http://127.0.0.1:5173
          </div>
        </div>
      </Section>

      <Section title="Model">
        <div className="flex flex-col gap-2">
          {backendOptions.map((option) => (
            <BackendRow
              key={option.id}
              option={option}
              selected={option.id === selectedBackendId}
              onSelect={() => option.eligible && selectBackend(option.id)}
            />
          ))}
        </div>
        <p className="mt-2 font-mono text-[10px] text-[color:var(--sscan-text-dim)]">
          API keys and local models can back a scan. Subscription logins cannot.
        </p>
      </Section>

      {!environment.dockerAvailable && (
        <div className="sscan-panel p-3 text-[11px] text-[color:var(--sscan-warn)]">
          Docker is not running. The scan sandbox needs Docker. Start Docker and reopen this
          panel.
        </div>
      )}

      <label className="flex items-start gap-2 text-[11px] text-[color:var(--sscan-text-dim)]">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-0.5 size-3.5"
          style={{ accentColor: "var(--sscan-cyan)" }}
        />
        <span>
          I own this target or have written permission to test it. The scan actively probes for
          vulnerabilities.
        </span>
      </label>

      <div
        className="sscan-panel p-3 text-center font-mono text-[10px] uppercase tracking-[0.2em]"
        style={{ color: ready ? "var(--sscan-ok)" : "var(--sscan-text-dim)" }}
      >
        {ready ? "Ready. Press Run to begin." : "Pick a model and confirm authorization"}
      </div>
    </div>
  )
}

function BackendRow({
  option,
  selected,
  onSelect,
}: {
  option: SecurityScanBackendOption
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!option.eligible}
      className={cn(
        "sscan-panel flex items-start gap-3 p-3 text-left transition-colors",
        option.eligible ? "hover:bg-[color:var(--sscan-line-soft)]" : "cursor-not-allowed opacity-50",
      )}
      style={selected ? { borderColor: "var(--sscan-cyan)" } : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-[color:var(--sscan-text)]">{option.label}</span>
          {option.kind === "localModel" && (
            <span className="shrink-0 border border-[color:var(--sscan-line)] px-1 font-mono text-[9px] uppercase text-[color:var(--sscan-text-dim)]">
              local
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-[color:var(--sscan-text-dim)]">
          {option.model}
        </div>
        {!option.eligible && option.ineligibleReason && (
          <div className="mt-1 font-mono text-[10px] text-[color:var(--sscan-warn)]">
            {option.ineligibleReason}
          </div>
        )}
      </div>
      {selected && option.eligible && (
        <span
          className="mt-1 size-2 shrink-0 rounded-full"
          style={{ backgroundColor: "var(--sscan-cyan)" }}
        />
      )}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--sscan-text-dim)]">
        {title}
      </div>
      {children}
    </div>
  )
}
