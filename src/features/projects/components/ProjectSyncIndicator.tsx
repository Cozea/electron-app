import { useEffect, useMemo, useState } from "react"
import type { IconType } from "react-icons"
import {
  MdCloudDone,
  MdCloudDownload,
  MdCloudOff,
  MdCloudSync,
  MdCloudUpload,
  MdWarning,
} from "react-icons/md"
import { ArrowPathIcon as Loader2 } from "@heroicons/react/24/outline"

import { useYjsProject } from "@/contexts/YjsProjectContext"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useOptionalProjectSyncContext } from "../contexts/ProjectSyncContext"

type ProjectSyncIndicatorVariant = "sidebar" | "compact"

interface ProjectSyncIndicatorProps {
  variant?: ProjectSyncIndicatorVariant
  className?: string
}

/** Match sidebar collapse control: muted, foreground when the control is hovered. */
const INDICATOR_ICON_CLASS = "text-muted-foreground group-hover:text-foreground"
/** Labels / counts: same base tone as the toggle (no hover on non-interactive text). */
const INDICATOR_TEXT_CLASS = "text-muted-foreground"

interface IndicatorState {
  icon: IconType
  label: string
  detail: string
  /** Material cloud icons read `fill` from `currentColor` for solid glyphs */
  filled?: boolean
  motion?: "spin" | "pulse"
  transfer?: "upload" | "download"
  liveCount?: string
}

const INDICATOR_HOLD_MS = 350
const INDICATOR_FADE_MS = 220

function formatPendingCount(count: number): string {
  if (count <= 0) return "0 pending"
  return `${count} pending`
}

function formatProgressCount(current: number, total: number): string {
  if (total <= 0) return `${current}`
  return `${Math.min(current, total)}/${total}`
}

function getIndicatorStateKey(state: IndicatorState): string {
  return [
    state.label,
    state.detail,
    state.transfer ?? "",
    state.liveCount ?? "",
    state.motion ?? "",
    state.filled ? "1" : "0",
  ].join("|")
}

export function ProjectSyncIndicator({
  variant = "sidebar",
  className,
}: ProjectSyncIndicatorProps) {
  const syncContext = useOptionalProjectSyncContext()
  const { isConnected } = useYjsProject()
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  )

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  const syncProgress = syncContext?.syncProgress
  const hasSyncProgress = syncProgress !== undefined
  const syncStatus = syncProgress?.status
  const syncMessage = syncProgress?.message ?? ""
  const syncCurrent = syncProgress?.current ?? 0
  const syncTotal = syncProgress?.total ?? 0
  const pendingCount = Math.max(
    0,
    syncTotal - syncCurrent
  )
  const isUploading =
    syncStatus === "syncing" && syncMessage.startsWith("Uploading")
  const isDownloading =
    syncStatus === "syncing" && syncMessage.startsWith("Downloading")

  const computedState = useMemo<IndicatorState>(() => {
    if (!syncContext || !hasSyncProgress) {
      return {
        icon: MdCloudOff,
        label: "Unavailable",
        detail: "Project collaboration is not active here",
        filled: true,
      }
    }

    if (syncContext.collaborationMode === "local") {
      return {
        icon: MdCloudOff,
        label: "Local Branch",
        detail: syncContext.sharedBranch
          ? `Switch back to ${syncContext.sharedBranch} to collaborate live`
          : "Live collaboration is paused on this branch",
        filled: true,
      }
    }

    if (!isOnline) {
      return {
        icon: MdCloudOff,
        label: "Offline",
        detail: "Waiting to reconnect live collaboration",
        filled: true,
      }
    }

    if (syncStatus === "error") {
      return {
        icon: MdWarning,
        label: "Collab Error",
        detail: syncMessage || "Failed to refresh live collaboration.",
        filled: true,
      }
    }

    if (syncStatus === "checking") {
      return {
        icon: MdCloudSync,
        label: "Checking",
        detail: "Checking collaboration session",
        filled: true,
        motion: "spin",
      }
    }

    if (syncStatus === "planning") {
      return {
        icon: MdCloudSync,
        label: "Planning",
        detail: "Preparing collaboration state",
        filled: true,
        motion: "spin",
      }
    }

    if (syncStatus === "syncing") {
      const liveCount = isDownloading
        ? String(pendingCount)
        : formatProgressCount(syncCurrent, syncTotal)

      const transferIcon = isDownloading
        ? MdCloudDownload
        : isUploading
          ? MdCloudUpload
          : MdCloudSync

      return {
        icon: transferIcon,
        label: isUploading ? "Uploading" : isDownloading ? "Downloading" : "Refreshing",
        detail: formatPendingCount(pendingCount),
        filled: true,
        motion: "pulse",
        transfer: isUploading ? "upload" : isDownloading ? "download" : undefined,
        liveCount,
      }
    }

    if (!isConnected) {
      return {
        icon: MdCloudSync,
        label: "Reconnecting",
        detail: "Trying to reach live collaboration",
        filled: true,
        motion: "spin",
      }
    }

      return {
        icon: MdCloudDone,
        label: "Live",
        detail: syncContext.sharedBranch
          ? `Collaborating on ${syncContext.sharedBranch}`
          : "Connected to live collaboration",
        filled: true,
      }
  }, [
    isConnected,
    isDownloading,
    isOnline,
    isUploading,
    pendingCount,
    hasSyncProgress,
    syncContext,
    syncCurrent,
    syncMessage,
    syncStatus,
    syncTotal,
  ])

  const [displayState, setDisplayState] = useState<IndicatorState>(computedState)
  const [isContentVisible, setIsContentVisible] = useState(true)
  const computedStateKey = useMemo(() => getIndicatorStateKey(computedState), [computedState])
  const displayStateKey = useMemo(() => getIndicatorStateKey(displayState), [displayState])

  useEffect(() => {
    if (computedStateKey === displayStateKey) return

    let swapTimer: number | null = null
    const holdTimer = window.setTimeout(() => {
      setIsContentVisible(false)
      swapTimer = window.setTimeout(() => {
        setDisplayState(computedState)
        setIsContentVisible(true)
      }, INDICATOR_FADE_MS)
    }, INDICATOR_HOLD_MS)

    return () => {
      window.clearTimeout(holdTimer)
      if (swapTimer) {
        window.clearTimeout(swapTimer)
      }
    }
  }, [computedState, computedStateKey, displayStateKey])

  const Icon = displayState.icon
  const iconClassName = cn(
    "h-4 w-4 shrink-0 transition-colors duration-200 ease-out",
    INDICATOR_ICON_CLASS,
    displayState.motion === "spin" && "animate-spin",
    displayState.motion === "pulse" && "animate-pulse",
    displayState.filled && "fill-current",
  )

  if (variant === "compact") {
    const showCompactSpinner = displayState.motion === "spin" || displayState.motion === "pulse"
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "group relative flex h-7 w-7 items-center justify-center rounded-md bg-muted/50 transition-colors duration-200 ease-out",
              className
            )}
            aria-label={`${displayState.label} - ${displayState.detail}`}
          >
            <div
              className={cn(
                "flex h-4 w-4 items-center justify-center transition-[opacity,transform] duration-200 ease-out",
                isContentVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-0.5"
              )}
            >
              {showCompactSpinner ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground group-hover:text-foreground" />
              ) : (
                <Icon className={iconClassName} />
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{displayState.label}</span>
            <span className="text-muted-foreground">{displayState.detail}</span>
          </div>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-1 py-1 transition-colors duration-200 ease-out",
        className
      )}
      title={displayState.detail}
    >
      <div
        className={cn(
          "relative flex h-4 w-4 items-center justify-center transition-[opacity,transform] duration-200 ease-out",
          isContentVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-0.5"
        )}
      >
        <Icon className={iconClassName} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-xs font-medium leading-none transition-[color,opacity,transform] duration-200 ease-out",
            INDICATOR_TEXT_CLASS,
            isContentVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-0.5"
          )}
        >
          {displayState.label}
        </p>
      </div>
      <div
        className={cn(
          "shrink-0 min-w-[2.5rem] text-right text-xs tabular-nums transition-[opacity,transform] duration-200 ease-out",
          INDICATOR_TEXT_CLASS,
          displayState.liveCount && isContentVisible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-0.5"
        )}
        aria-hidden={!displayState.liveCount}
      >
        {displayState.liveCount ?? "00"}
      </div>
    </div>
  )
}
