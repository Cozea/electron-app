import type { ProviderKind } from "@cozea/assistant-contracts"
import { useMemo, useEffect, useState } from "react"
import { SiOllama } from "react-icons/si"
import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import { ProjectDevAppIcon } from "@/features/devapps/components/ProjectDevAppIcon"
import { PublishedDevAppIcon } from "@/features/devapps/components/PublishedDevAppIcon"
import {
  getDevAppForAssistantProvider,
  getDevAppForSurfaceTileType,
} from "@/features/devapps/registry"
import type { DevAppWorkbenchTileTarget } from "@/features/devapps/registry/types"
import {
  ClaudeAI,
  CursorIcon,
  Gemini,
  OpenAI,
  OpenCodeIcon,
} from "@/features/projects/components/assistant/Icons"
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
} from "@/features/projects/components/assistant/chat/session-logic"
import { usePretextOverflowTitleFor } from "@/hooks/usePretextOverflowTitle"
import { cn, formatRelativeTimeLabel } from "@/lib/utils"
import {
  hasProjectSidebarChildren,
  SIDEBAR_PILL_ACTIVE_CLASS,
  SIDEBAR_PILL_NESTED_ROW_CLASS,
  SIDEBAR_WORKBENCH_ROW_CONTENT_CLASS,
} from "@/features/projects/ui/sidebar/projectSidebarShared"
import { createAssistantThreadSelectorById, useStore } from "@/stores/assistant-store"
import type { Thread as AssistantThread } from "@/stores/types"
import type {
  WorkbenchLaneSidebarSummary,
  WorkbenchSidebarSurfaceTileSummary,
} from "@/features/workbench/model/workbenchStore"
import { getWorkbenchTileDefinition } from "@/features/workbench/model/workbenchTileRegistry"

import type { SidebarActiveSelectionLevel } from "./projectSidebarShared"

import { HugeiconsIcon } from '@hugeicons/react'
import { BrainCircuitIcon as __BrainCircuitHugeIcon, ComputerTerminal01Icon as __ComputerTerminalHugeIcon, CpuChargeIcon as __CpuChargeHugeIcon, DeviceAccessIcon as __PhoneHugeIcon, Globe02Icon as __GlobeHugeIcon, ServerStack02Icon as __ServerStackHugeIcon } from '@hugeicons/core-free-icons'

const SIDEBAR_APP_ICON_CLASS = "size-[18px] shrink-0 overflow-hidden rounded-[4px]"
const SIDEBAR_LANE_LABEL_FONT = "13px Inter"

function SurfaceTileGlyph(props: {
  favicon?: string | null
  devAppId?: string | null
  logoDataUrl?: string | null
  title: string
  type: WorkbenchSidebarSurfaceTileSummary["type"]
  className?: string
}) {
  const className = props.className ?? "size-[18px] shrink-0 text-muted-foreground/75"
  const definition = getWorkbenchTileDefinition(props.type)
  // Neither a published DevApp nor one under development is a built-in, so neither
  // resolves to a built-in glyph.
  const devApp =
    definition.manifestSource === "surface"
      ? getDevAppForSurfaceTileType(props.type as DevAppWorkbenchTileTarget)
      : null

  if (definition.manifestSource === "published") {
    return (
      <span className={SIDEBAR_APP_ICON_CLASS}>
        <PublishedDevAppIcon name={props.title} logoDataUrl={props.logoDataUrl} />
      </span>
    )
  }

  if (definition.fallbackIcon === "devServer" && props.devAppId) {
    return (
      <span className={SIDEBAR_APP_ICON_CLASS}>
        <ProjectDevAppIcon publicationId={props.devAppId} name={props.title} />
      </span>
    )
  }

  switch (definition.fallbackIcon) {
    case "browser":
      if (props.favicon) {
        return (
          <img
            src={props.favicon}
            alt=""
            className={cn("size-[18px] shrink-0 rounded-sm object-contain", className)}
            aria-hidden
          />
        )
      }
      if (devApp) {
        return (
          <span className={SIDEBAR_APP_ICON_CLASS}>
            <DevAppIcon app={devApp} />
          </span>
        )
      }
      return <HugeiconsIcon icon={__GlobeHugeIcon} className={className} aria-hidden />
    case "devServer":
      if (devApp) {
        return (
          <span className={SIDEBAR_APP_ICON_CLASS}>
            <DevAppIcon app={devApp} />
          </span>
        )
      }
      return <HugeiconsIcon icon={__ServerStackHugeIcon} className={className} aria-hidden />
    case "mobileSimulator":
      if (devApp) {
        return (
          <span className={SIDEBAR_APP_ICON_CLASS}>
            <DevAppIcon app={devApp} />
          </span>
        )
      }
      return <HugeiconsIcon icon={__PhoneHugeIcon} className={className} aria-hidden />
    case "llama":
      if (devApp) {
        return (
          <span className={SIDEBAR_APP_ICON_CLASS}>
            <DevAppIcon app={devApp} />
          </span>
        )
      }
      return <SiOllama className={className} aria-hidden />
    case "memory":
      if (devApp) {
        return (
          <span className={SIDEBAR_APP_ICON_CLASS}>
            <DevAppIcon app={devApp} />
          </span>
        )
      }
      return <HugeiconsIcon icon={__BrainCircuitHugeIcon} className={className} aria-hidden />
    case "terminal":
    default:
      if (devApp) {
        return (
          <span className={SIDEBAR_APP_ICON_CLASS}>
            <DevAppIcon app={devApp} />
          </span>
        )
      }
      return <HugeiconsIcon icon={__ComputerTerminalHugeIcon} className={className} aria-hidden />
  }
}

interface SidebarAgentStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Interrupted"
    | "Stopped"
    | "Error"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready"
  colorClass: string
  dotClass: string
  pulse: boolean
}

function ProviderGlyph(props: { provider?: string | null; className?: string }) {
  const className = props.className ?? "size-[18px]"
  const devApp = getDevAppForAssistantProvider(
    typeof props.provider === "string" ? (props.provider as ProviderKind) : null,
  )

  if (devApp) {
    return (
      <span className={SIDEBAR_APP_ICON_CLASS}>
        <DevAppIcon app={devApp} />
      </span>
    )
  }

  switch (props.provider) {
    case "claudeAgent":
      return <ClaudeAI className={className} />
    case "cursor":
      return <CursorIcon className={className} />
    case "gemini":
      return <Gemini className={className} />
    case "opencode":
      return <OpenCodeIcon className={className} />
    case "codex":
    default:
      return <OpenAI className={className} />
  }
}

function providerGlyphColorClass(
  provider: string | null | undefined,
  isActive: boolean,
): string {
  if (getDevAppForAssistantProvider(typeof provider === "string" ? (provider as ProviderKind) : null)) {
    return ""
  }
  switch (provider) {
    case "claudeAgent":
      return isActive ? "text-[#d97757]" : "text-[#d97757]/90"
    case "cursor":
      return isActive ? "text-zinc-600" : "text-zinc-500"
    case "codex":
      return isActive ? "text-foreground" : "text-muted-foreground/90"
    case "gemini":
    case "opencode":
      return ""
    default:
      return isActive ? "text-[var(--sidebar-pill-hover-fg)]" : "text-muted-foreground/75"
  }
}

function hasUnseenCompletion(
  thread: AssistantThread,
): boolean {
  if (!thread.latestTurn?.completedAt) return false
  const completedAt = Date.parse(thread.latestTurn.completedAt)
  if (Number.isNaN(completedAt)) return false
  if (!thread.lastVisitedAt) return true

  const lastVisitedAt = Date.parse(thread.lastVisitedAt)
  if (Number.isNaN(lastVisitedAt)) return true
  return completedAt > lastVisitedAt
}

function resolveAgentStatusPill(input: {
  thread: AssistantThread
  hasPendingApprovals: boolean
  hasPendingUserInput: boolean
}): SidebarAgentStatusPill | null {
  const { hasPendingApprovals, hasPendingUserInput, thread } = input

  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    }
  }

  if (hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    }
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-muted-foreground",
      dotClass: "bg-muted-foreground",
      pulse: true,
    }
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-muted-foreground",
      dotClass: "bg-muted-foreground",
      pulse: true,
    }
  }

  if (thread.session?.status === "error") {
    return {
      label: "Error",
      colorClass: "text-rose-600 dark:text-rose-300/90",
      dotClass: "bg-rose-500 dark:bg-rose-300/90",
      pulse: false,
    }
  }

  if (thread.session?.status === "interrupted") {
    return {
      label: "Interrupted",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    }
  }

  if (thread.session?.status === "stopped") {
    return {
      label: "Stopped",
      colorClass: "text-muted-foreground",
      dotClass: "bg-muted-foreground",
      pulse: false,
    }
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    hasActionableProposedPlan(
      findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null),
    )

  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    }
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    }
  }

  return null
}

function AgentStatusPill(props: { threadId?: string | null }) {
  const threadSelector = useMemo(
    () => createAssistantThreadSelectorById(props.threadId),
    [props.threadId],
  )
  const thread = useStore(threadSelector)

  if (!thread) return null

  const pendingApprovals = derivePendingApprovals(thread.activities ?? [])
  const pendingUserInputs = derivePendingUserInputs(thread.activities ?? [])
  const statusPill = resolveAgentStatusPill({
    thread,
    hasPendingApprovals: pendingApprovals.length > 0,
    hasPendingUserInput: pendingUserInputs.length > 0,
  })

  if (!statusPill) return null

  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px]", statusPill.colorClass)} title={statusPill.label}>
      {statusPill.label === "Working" || statusPill.label === "Connecting" ? (
        <div className="loader" />
      ) : (
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            statusPill.dotClass,
            statusPill.pulse && "animate-pulse",
          )}
        />
      )}
    </span>
  )
}

function AgentTimeLabel(props: { threadId?: string | null }) {
  const threadSelector = useMemo(
    () => createAssistantThreadSelectorById(props.threadId),
    [props.threadId],
  )
  const thread = useStore(threadSelector)

  // Use a simple tick to refresh relative time every minute
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = window.setInterval(() => setTick((c) => c + 1), 60000)
    return () => window.clearInterval(interval)
  }, [])

  if (!thread) return null

  const latestUserMessageAt = (() => {
    const userMessages = thread.messages.filter(m => m.role === "user")
    return userMessages.length > 0 ? userMessages[userMessages.length - 1].createdAt : null
  })()

  const timestamp = latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt
  if (!timestamp) return null

  return (
    <span
      className={cn(
        "text-[10px] ml-auto shrink-0",
        "text-muted-foreground/40 group-hover:text-foreground/72 dark:group-hover:text-foreground/82 transition-colors"
      )}
    >
      {formatRelativeTimeLabel(timestamp)}
    </span>
  )
}

interface SidebarLaneTilesProps {
  activeLaneSummary: WorkbenchLaneSidebarSummary | null
  activeSelectionLevel: SidebarActiveSelectionLevel
  activeTileId: string | null
  hasHeadlessDevServer: boolean
  onOpenLaneWorkbench: (options?: {
    openTile?: "assistantChat" | "devServer" | "terminal"
    focusTileId?: string
  }) => void
}

export function SidebarLaneTiles(props: SidebarLaneTilesProps) {
  const {
    activeLaneSummary,
    activeSelectionLevel,
    activeTileId,
    hasHeadlessDevServer,
    onOpenLaneWorkbench,
  } = props
  const agents = activeLaneSummary?.agents ?? []
  const surfaces = activeLaneSummary?.surfaces ?? []
  const resolvedActiveTileId = activeSelectionLevel === "tile" ? activeTileId : null
  const { containerRef: rootRef, getOverflowTitle } = usePretextOverflowTitleFor<HTMLDivElement>({
    font: SIDEBAR_LANE_LABEL_FONT,
  })

  if (!hasProjectSidebarChildren(activeLaneSummary, hasHeadlessDevServer)) {
    return null
  }

  const shouldShowAgentTitle = (title: string): boolean => {
    const reservedWidth = 24 + 12 + 84
    return Boolean(getOverflowTitle(title, reservedWidth))
  }

  const shouldShowSurfaceTitle = (title: string): boolean => {
    const reservedWidth = 24 + 12
    return Boolean(getOverflowTitle(title, reservedWidth))
  }

  return (
    <div ref={rootRef} className="w-full space-y-0.5 pt-0.5">
      {agents.map((tile) => (
        <button
          key={tile.id}
          type="button"
          data-sidebar-tile-row={tile.id}
          data-sidebar-tile-type="assistantChat"
          data-sidebar-tile-active={resolvedActiveTileId === tile.id || undefined}
          className={cn(
            "relative w-full",
            SIDEBAR_PILL_NESTED_ROW_CLASS,
            resolvedActiveTileId === tile.id && SIDEBAR_PILL_ACTIVE_CLASS,
          )}
          onClick={() => onOpenLaneWorkbench({ focusTileId: tile.id })}
        >
          <div className="absolute left-[16px] top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
            <AgentStatusPill threadId={tile.threadId} />
          </div>
          <div className={SIDEBAR_WORKBENCH_ROW_CONTENT_CLASS}>
            <ProviderGlyph
              provider={tile.provider}
              className={cn(
                "size-[18px] shrink-0",
                providerGlyphColorClass(tile.provider, resolvedActiveTileId === tile.id),
              )}
            />
            <span className="min-w-0 flex-1 truncate" title={shouldShowAgentTitle(tile.title) ? tile.title : undefined}>
              {tile.title}
            </span>
            <AgentTimeLabel threadId={tile.threadId} />
          </div>
        </button>
      ))}
      {surfaces.map((tile) => (
        <button
          key={tile.id}
          type="button"
          data-sidebar-tile-row={tile.id}
          data-sidebar-tile-type={tile.type}
          data-sidebar-tile-active={resolvedActiveTileId === tile.id || undefined}
          className={cn(
            "w-full",
            SIDEBAR_PILL_NESTED_ROW_CLASS,
            resolvedActiveTileId === tile.id && SIDEBAR_PILL_ACTIVE_CLASS,
          )}
          onClick={() => onOpenLaneWorkbench({ focusTileId: tile.id })}
        >
          <div className={SIDEBAR_WORKBENCH_ROW_CONTENT_CLASS}>
            <SurfaceTileGlyph
              favicon={tile.favicon}
              devAppId={tile.devAppId}
              logoDataUrl={tile.logoDataUrl}
              title={tile.title}
              type={tile.type}
              className={cn(
                "size-[18px] shrink-0 text-muted-foreground/75",
                resolvedActiveTileId === tile.id && "text-[var(--sidebar-pill-hover-fg)]",
              )}
            />
            <span className="min-w-0 flex-1 truncate" title={shouldShowSurfaceTitle(tile.title) ? tile.title : undefined}>
              {tile.title}
            </span>
          </div>
        </button>
      ))}
      {hasHeadlessDevServer ? (
        <button
          type="button"
          data-sidebar-tile-type="devServer"
          data-sidebar-headless-dev-server
          className={cn("w-full", SIDEBAR_PILL_NESTED_ROW_CLASS)}
          onClick={() => onOpenLaneWorkbench({ openTile: "devServer" })}
          aria-label="Open running Dev Server"
        >
          <div className={SIDEBAR_WORKBENCH_ROW_CONTENT_CLASS}>
            <SurfaceTileGlyph
              title="Dev Server"
              type="devServer"
              className="size-[18px] shrink-0 text-muted-foreground/75"
            />
            <span className="min-w-0 flex-1 truncate">Dev Server</span>
            <span className="shrink-0 text-[10px] text-muted-foreground/55">Running</span>
          </div>
        </button>
      ) : null}
    </div>
  )
}
