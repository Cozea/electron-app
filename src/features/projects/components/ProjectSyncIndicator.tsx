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

import { useYjsProject } from "@/contexts/YjsProjectContextValue"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useAssistantTransportState } from "@/hooks/useAssistantTransportState"
import { useGitRemoteStatus } from "@/hooks/useGitRemoteStatus"
import { resolveConnectionStatusPresentation } from "@/features/projects/lib/connectionStatusModel"
import { useOptionalProjectSyncContext } from "../contexts/ProjectSyncContext"

type ProjectSyncIndicatorVariant = "sidebar" | "compact"

interface ProjectSyncIndicatorProps {
  variant?: ProjectSyncIndicatorVariant
  className?: string
  /** Compact variant: follow parent text color (e.g. sidebar-toned header pill). */
  inheritPillTextColor?: boolean
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
  layerLines: Array<{ title: string; status: string; detail: string }>
}

const INDICATOR_HOLD_MS = 350
const INDICATOR_FADE_MS = 220

function getIndicatorStateKey(state: IndicatorState): string {
  return [
    state.label,
    state.detail,
    state.transfer ?? "",
    state.liveCount ?? "",
    state.motion ?? "",
    state.filled ? "1" : "0",
    ...state.layerLines.map((line) => `${line.title}:${line.status}:${line.detail}`),
  ].join("|")
}

function pickIcon(presentation: {
  primaryLabel: string
  motion?: "spin" | "pulse"
  transfer?: "upload" | "download"
  severity: string
}): IconType {
  if (presentation.severity === "error") return MdWarning
  if (presentation.transfer === "upload") return MdCloudUpload
  if (presentation.transfer === "download") return MdCloudDownload
  if (
    presentation.severity === "unavailable" ||
    presentation.severity === "local" ||
    presentation.primaryLabel === "Offline"
  ) {
    return MdCloudOff
  }
  if (presentation.motion === "spin" || presentation.motion === "pulse") {
    return MdCloudSync
  }
  return MdCloudDone
}

export function ProjectSyncIndicator({
  variant = "sidebar",
  className,
  inheritPillTextColor = false,
}: ProjectSyncIndicatorProps) {
  const syncContext = useOptionalProjectSyncContext()
  const { isConnected } = useYjsProject()
  const assistantTransport = useAssistantTransportState()
  const gitRemote = useGitRemoteStatus(syncContext?.workspaceId ?? null)
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
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

  // Data-sync progress comes from the journal / collab sync coordinator — not
  // Convex `projects.syncStatus`, and not assistant WebSocket transport.
  const presentation = useMemo(
    () =>
      resolveConnectionStatusPresentation({
        assistantTransport,
        syncProgress: syncContext?.syncProgress,
        collabConnected: isConnected,
        isOnline,
        collaborationMode: syncContext?.collaborationMode,
        sharedBranch: syncContext?.sharedBranch,
        gitRemote,
      }),
    [
      assistantTransport,
      gitRemote,
      isConnected,
      isOnline,
      syncContext?.collaborationMode,
      syncContext?.sharedBranch,
      syncContext?.syncProgress,
    ],
  )

  const computedState = useMemo<IndicatorState>(
    () => ({
      icon: pickIcon(presentation),
      label: presentation.primaryLabel,
      detail: presentation.primaryDetail,
      filled: true,
      motion: presentation.motion,
      transfer: presentation.transfer,
      liveCount: presentation.liveCount,
      layerLines: presentation.layers.map((layer) => ({
        title: layer.title,
        status: layer.status,
        detail: layer.detail,
      })),
    }),
    [presentation],
  )

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
  const compactIconToneClass = inheritPillTextColor ? "text-current" : INDICATOR_ICON_CLASS
  const iconClassName = cn(
    "h-4 w-4 shrink-0 transition-colors duration-200 ease-out",
    compactIconToneClass,
    displayState.motion === "spin" && "animate-spin",
    displayState.motion === "pulse" && "animate-pulse",
    displayState.filled && "fill-current",
  )

  const tooltipBody = (
    <div className="flex min-w-[14rem] flex-col gap-1.5">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{displayState.label}</span>
        <span className="text-muted-foreground">{displayState.detail}</span>
      </div>
      <div className="border-t border-border/60 pt-1.5">
        {displayState.layerLines.map((line) => (
          <div key={line.title} className="flex flex-col gap-0.5 py-0.5">
            <span className="text-[11px] font-medium leading-none">
              {line.title}: {line.status}
            </span>
            <span className="text-[11px] leading-snug text-muted-foreground">{line.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )

  if (variant === "compact") {
    const showCompactSpinner = displayState.motion === "spin" || displayState.motion === "pulse"
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "group relative flex h-7 w-7 items-center justify-center rounded-md bg-muted/50 transition-colors duration-200 ease-out",
              className,
            )}
            aria-label={`${displayState.label} - ${displayState.detail}`}
          >
            <div
              className={cn(
                "flex h-4 w-4 items-center justify-center transition-[opacity,transform] duration-200 ease-out",
                isContentVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-0.5",
              )}
            >
              {showCompactSpinner ? (
                <div
                  className={cn(
                    "loader",
                    inheritPillTextColor
                      ? "text-current"
                      : "text-muted-foreground group-hover:text-foreground",
                  )}
                />
              ) : (
                <Icon className={iconClassName} />
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {tooltipBody}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "group flex items-center gap-2 px-1 py-1 transition-colors duration-200 ease-out",
            className,
          )}
          aria-label={`${displayState.label} - ${displayState.detail}`}
        >
          <div
            className={cn(
              "relative flex h-4 w-4 items-center justify-center transition-[opacity,transform] duration-200 ease-out",
              isContentVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-0.5",
            )}
          >
            <Icon className={iconClassName} />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-xs font-medium leading-none transition-[color,opacity,transform] duration-200 ease-out",
                INDICATOR_TEXT_CLASS,
                isContentVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-0.5",
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
                : "opacity-0 translate-y-0.5",
            )}
            aria-hidden={!displayState.liveCount}
          >
            {displayState.liveCount ?? "00"}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {tooltipBody}
      </TooltipContent>
    </Tooltip>
  )
}
