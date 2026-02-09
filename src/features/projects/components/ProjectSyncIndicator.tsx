import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Cloud,
  CloudOff,
  Loader2,
  type LucideIcon,
} from "lucide-react"

import { useYjsProject } from "@/contexts/YjsProjectContext"
import { cn } from "@/lib/utils"
import { useOptionalProjectSyncContext } from "../contexts/ProjectSyncContext"

type ProjectSyncIndicatorVariant = "sidebar" | "compact"

interface ProjectSyncIndicatorProps {
  variant?: ProjectSyncIndicatorVariant
  className?: string
}

interface IndicatorState {
  icon: LucideIcon
  label: string
  detail: string
  toneClassName: string
  animate?: boolean
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
  const iconName = state.icon.displayName ?? state.icon.name ?? "icon"
  return [
    iconName,
    state.label,
    state.detail,
    state.toneClassName,
    state.transfer ?? "",
    state.liveCount ?? "",
    state.animate ? "1" : "0",
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
        icon: CloudOff,
        label: "Disconnected",
        detail: "Connecting to collaboration server",
        toneClassName: "text-muted-foreground",
      }
    }

    if (!isOnline) {
      return {
        icon: CloudOff,
        label: "Offline",
        detail: "Changes are queued locally",
        toneClassName: "text-amber-600",
      }
    }

    if (syncStatus === "error") {
      return {
        icon: AlertTriangle,
        label: "Sync Error",
        detail: syncMessage || "Sync failed. Retry from Sync Feed.",
        toneClassName: "text-destructive",
      }
    }

    if (syncStatus === "checking") {
      return {
        icon: Loader2,
        label: "Checking",
        detail: "Comparing local and cloud state",
        toneClassName: "text-muted-foreground",
        animate: true,
      }
    }

    if (syncStatus === "planning") {
      return {
        icon: Loader2,
        label: "Planning",
        detail: "Preparing reconciliation",
        toneClassName: "text-muted-foreground",
        animate: true,
      }
    }

    if (syncStatus === "syncing") {
      const liveCount = isDownloading
        ? String(pendingCount)
        : formatProgressCount(syncCurrent, syncTotal)

      return {
        icon: isDownloading ? ArrowDown : ArrowUp,
        label: isUploading ? "Uploading" : isDownloading ? "Downloading" : "Syncing",
        detail: formatPendingCount(pendingCount),
        toneClassName: isUploading
          ? "text-blue-600"
          : isDownloading
            ? "text-emerald-600"
            : "text-blue-600",
        animate: true,
        transfer: isUploading ? "upload" : isDownloading ? "download" : undefined,
        liveCount,
      }
    }

    if (!isConnected) {
      return {
        icon: CloudOff,
        label: "Reconnecting",
        detail: "Trying to reach collaboration server",
        toneClassName: "text-muted-foreground",
      }
    }

    return {
      icon: Cloud,
      label: "Synced",
      detail: "Connected to cloud",
      toneClassName: "text-emerald-600",
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
    "h-4 w-4 transition-colors duration-200 ease-out",
    displayState.toneClassName,
    displayState.animate && (Icon === Loader2 ? "animate-spin" : "animate-pulse"),
    Icon === Cloud && "fill-current"
  )

  if (variant === "compact") {
    return (
      <div
        className={cn(
          "relative flex h-7 w-7 items-center justify-center rounded-md bg-muted/50 transition-colors duration-200 ease-out",
          className
        )}
        title={`${displayState.label} - ${displayState.detail}`}
      >
        <div
          className={cn(
            "flex h-4 w-4 items-center justify-center transition-[opacity,transform] duration-200 ease-out",
            isContentVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-0.5"
          )}
        >
          <Icon className={iconClassName} />
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-1 py-1 transition-colors duration-200 ease-out",
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
            displayState.toneClassName,
            isContentVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-0.5"
          )}
        >
          {displayState.label}
        </p>
      </div>
      <div
        className={cn(
          "shrink-0 min-w-[2.5rem] text-right text-xs text-muted-foreground tabular-nums transition-[opacity,transform] duration-200 ease-out",
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
