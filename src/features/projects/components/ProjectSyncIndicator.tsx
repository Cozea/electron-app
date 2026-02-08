import { useEffect, useState } from "react"
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

function formatPendingCount(count: number): string {
  if (count <= 0) return "0 pending"
  return `${count} pending`
}

function formatProgressCount(current: number, total: number): string {
  if (total <= 0) return `${current}`
  return `${Math.min(current, total)}/${total}`
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
  const pendingCount = Math.max(
    0,
    (syncProgress?.total ?? 0) - (syncProgress?.current ?? 0)
  )
  const isUploading =
    syncProgress?.status === "syncing" && syncProgress.message.startsWith("Uploading")
  const isDownloading =
    syncProgress?.status === "syncing" && syncProgress.message.startsWith("Downloading")

  let state: IndicatorState | null = null
  if (syncContext && syncProgress) {
    if (!isOnline) {
      state = {
        icon: CloudOff,
        label: "Offline",
        detail: "Changes are queued locally",
        toneClassName: "text-amber-600",
      }
    } else if (syncProgress.status === "error") {
      state = {
        icon: AlertTriangle,
        label: "Sync Error",
        detail: syncProgress.message || "Sync failed. Retry from Sync Feed.",
        toneClassName: "text-destructive",
      }
    } else if (syncProgress.status === "checking") {
      state = {
        icon: Loader2,
        label: "Checking",
        detail: "Comparing local and cloud state",
        toneClassName: "text-muted-foreground",
        animate: true,
      }
    } else if (syncProgress.status === "planning") {
      state = {
        icon: Loader2,
        label: "Planning",
        detail: "Preparing reconciliation",
        toneClassName: "text-muted-foreground",
        animate: true,
      }
    } else if (syncProgress.status === "syncing") {
      const liveCount = isDownloading
        ? String(pendingCount)
        : formatProgressCount(syncProgress.current, syncProgress.total)

      state = {
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
    } else if (!isConnected) {
      state = {
        icon: CloudOff,
        label: "Reconnecting",
        detail: "Trying to reach collaboration server",
        toneClassName: "text-muted-foreground",
      }
    } else {
      state = {
        icon: Cloud,
        label: "Synced",
        detail: "Connected to cloud",
        toneClassName: "text-emerald-600",
      }
    }
  }

  if (!state) return null

  const Icon = state.icon
  const iconClassName = cn(
    "h-4 w-4",
    state.toneClassName,
    state.animate && "animate-bounce",
    Icon === Cloud && "fill-current"
  )

  if (variant === "compact") {
    return (
      <div
        className={cn("relative flex h-7 w-7 items-center justify-center rounded-md bg-muted/50", className)}
        title={`${state.label} - ${state.detail}`}
      >
        <Icon className={iconClassName} />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg bg-background/70 px-2.5 py-2",
        className
      )}
      title={state.detail}
    >
      <div className="relative">
        <Icon className={iconClassName} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs font-medium leading-none", state.toneClassName)}>
          {state.label}
        </p>
      </div>
      {state.liveCount && (
        <div className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {state.liveCount}
        </div>
      )}
    </div>
  )
}
