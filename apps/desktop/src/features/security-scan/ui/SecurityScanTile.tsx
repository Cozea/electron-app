import { canStartScan, isScanRunning, useSecurityScanStore } from "../model/securityScanStore"
import { ScanLaunchView } from "./ScanLaunchView"
import { ScanReportView } from "./ScanReportView"
import { ScanRunningView } from "./ScanRunningView"
import { ScanWelcome } from "./ScanWelcome"
import "./hud/securityScanHud.css"

/**
 * Phase router for the scan surface. One immersive HUD that moves through: welcome (nothing
 * configured), launch (armed reticle), running (agents at work), report (findings). Setup is
 * a dropdown from the tile-header gear, and Run/Stop live in that header too.
 */
export function SecurityScanTile() {
  const run = useSecurityScanStore((state) => state.run)
  const setSetupOpen = useSecurityScanStore((state) => state.setSetupOpen)
  const ready = useSecurityScanStore(canStartScan)
  const running = isScanRunning(run)

  return (
    <div className="sscan-surface">
      {!run ? (
        ready ? (
          <ScanLaunchView />
        ) : (
          <ScanWelcome onGetStarted={() => setSetupOpen(true)} />
        )
      ) : running ? (
        <ScanRunningView run={run} />
      ) : (
        <ScanReportView run={run} />
      )}
    </div>
  )
}
