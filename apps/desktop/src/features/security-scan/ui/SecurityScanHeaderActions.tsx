import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon as __StopIcon,
  PlayIcon as __RunIcon,
  Settings01Icon as __SettingsIcon,
} from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { canStartScan, isScanRunning, useSecurityScanStore } from "../model/securityScanStore"

/**
 * The scan's run controls and setup toggle, rendered in the tile-chrome header beside the
 * window actions. Reads the shared store so it stays in step with the tile body.
 */
export function SecurityScanHeaderActions() {
  const running = useSecurityScanStore((state) => isScanRunning(state.run))
  const canStart = useSecurityScanStore(canStartScan)
  const setupOpen = useSecurityScanStore((state) => state.setupOpen)
  const startScan = useSecurityScanStore((state) => state.startScan)
  const cancelScan = useSecurityScanStore((state) => state.cancelScan)
  const toggleSetup = useSecurityScanStore((state) => state.toggleSetup)

  return (
    <div className="flex items-center gap-1">
      {running ? (
        <Button
          type="button"
          size="sm"
          variant="destructive-outline"
          onClick={(event) => {
            event.stopPropagation()
            cancelScan()
          }}
        >
          <HugeiconsIcon icon={__StopIcon} className="size-3.5" />
          Stop
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={!canStart}
          onClick={(event) => {
            event.stopPropagation()
            startScan()
          }}
        >
          <HugeiconsIcon icon={__RunIcon} className="size-3.5" />
          Run
        </Button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Scan setup"
        aria-pressed={setupOpen}
        onClick={(event) => {
          event.stopPropagation()
          toggleSetup()
        }}
        className={cn(
          "h-7 w-7 rounded-md border-0 shadow-none transition-colors hover:bg-accent",
          setupOpen && "bg-accent text-foreground",
        )}
      >
        <HugeiconsIcon icon={__SettingsIcon} className="size-4" />
      </Button>
    </div>
  )
}
