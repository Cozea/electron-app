import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon as __StopIcon,
  PlayIcon as __RunIcon,
  Settings01Icon as __SettingsIcon,
} from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

import { canStartScan, isScanRunning, useSecurityScanStore } from "../model/securityScanStore"

/**
 * The scan's run control and setup, in the tile-chrome header beside the window actions.
 * Run flips to Stop while scanning. The gear opens a settings dropdown (model + consent),
 * controlled by the shared store so the welcome screen's "Get started" opens it too.
 */
export function SecurityScanHeaderActions() {
  const running = useSecurityScanStore((state) => isScanRunning(state.run))
  const canStart = useSecurityScanStore(canStartScan)
  const setupOpen = useSecurityScanStore((state) => state.setupOpen)
  const setSetupOpen = useSecurityScanStore((state) => state.setSetupOpen)
  const startScan = useSecurityScanStore((state) => state.startScan)
  const cancelScan = useSecurityScanStore((state) => state.cancelScan)

  const environment = useSecurityScanStore((state) => state.environment)
  const backendOptions = useSecurityScanStore((state) => state.backendOptions)
  const selectedBackendId = useSecurityScanStore((state) => state.selectedBackendId)
  const selectBackend = useSecurityScanStore((state) => state.selectBackend)

  const eligible = backendOptions.filter((option) => option.eligible)

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

      <DropdownMenu open={setupOpen} onOpenChange={setSetupOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Scan setup"
            className={cn(
              "h-7 w-7 rounded-md border-0 shadow-none transition-colors hover:bg-accent",
              setupOpen && "bg-accent text-foreground",
            )}
          >
            <HugeiconsIcon icon={__SettingsIcon} className="size-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
            Model
          </DropdownMenuLabel>
          {eligible.map((option) => {
            const selected = option.id === selectedBackendId
            return (
              <DropdownMenuItem
                key={option.id}
                onSelect={(event) => {
                  event.preventDefault()
                  selectBackend(option.id)
                }}
                className={cn(
                  "items-start rounded-md",
                  selected && "bg-primary/15 text-foreground",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("truncate", selected && "font-medium")}>
                      {option.label}
                    </span>
                    {option.kind === "localModel" && (
                      <span className="shrink-0 rounded bg-secondary px-1 text-[9px] uppercase text-muted-foreground">
                        local
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {option.model}
                  </div>
                </div>
              </DropdownMenuItem>
            )
          })}

          {!environment.dockerAvailable && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400">
                Docker is not running. The scan sandbox needs Docker.
              </div>
            </>
          )}

        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
