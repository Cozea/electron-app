import { canStartScan, useSecurityScanStore } from "../model/securityScanStore"
import { ScanReticle } from "./hud/ScanReticle"

/**
 * The armed state: everything is configured, so the surface is the reticle itself. Pressing
 * it starts the scan. Mirrors the Run control in the tile header.
 */
export function ScanLaunchView() {
  const run = useSecurityScanStore((state) => state.run)
  const backendOptions = useSecurityScanStore((state) => state.backendOptions)
  const selectedBackendId = useSecurityScanStore((state) => state.selectedBackendId)
  const ready = useSecurityScanStore(canStartScan)
  const startScan = useSecurityScanStore((state) => state.startScan)

  const backend = backendOptions.find((option) => option.id === selectedBackendId)

  return (
    <div className="sscan-grid relative flex h-full flex-col items-center justify-center gap-6 p-6">
      <div className="absolute left-4 top-4 sscan-panel sscan-bracket px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--sscan-text-dim)]">
        <div className="text-[color:var(--sscan-cyan)]">Target locked</div>
        <div className="mt-1">Dev server · :5173</div>
        <div>{backend ? backend.label : "No model"}</div>
      </div>

      <ScanReticle
        mode="idle"
        label="RUN"
        sublabel="Begin scan"
        onClick={startScan}
        disabled={!ready}
        size={260}
      />

      <p className="max-w-xs text-center font-mono text-[11px] leading-relaxed tracking-wide text-[color:var(--sscan-text-dim)]">
        Press to begin. Agents probe the target for vulnerabilities and report what they can
        prove.
      </p>

      {run?.status === "cancelled" && (
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[color:var(--sscan-warn)]">
          Last scan cancelled
        </div>
      )}
    </div>
  )
}
