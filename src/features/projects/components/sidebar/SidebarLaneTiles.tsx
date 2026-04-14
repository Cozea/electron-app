import {
  CommandLineIcon as SquareTerminal,
  ComputerDesktopIcon as ComputerScreen,
  DevicePhoneMobileIcon as Phone,
  GlobeAltIcon as Globe,
} from "@heroicons/react/24/outline"

import {
  ClaudeAI,
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
import { cn } from "@/lib/utils"
import {
  SIDEBAR_PILL_ACTIVE_CLASS,
  SIDEBAR_PILL_NESTED_ROW_CLASS,
  SIDEBAR_WORKBENCH_ROW_CONTENT_CLASS,
} from "@/features/projects/components/sidebar/projectSidebarShared"
import { useStore } from "@/stores/assistant-store"
import type {
  WorkbenchLaneSidebarSummary,
  WorkbenchSidebarSurfaceTileSummary,
} from "@/stores/useProjectWorkbenchStore"

import type { SidebarActiveSelectionLevel } from "./projectSidebarShared"

function SurfaceTileGlyph(props: {
  favicon?: string | null
  type: WorkbenchSidebarSurfaceTileSummary["type"]
  className?: string
}) {
  const className = props.className ?? "size-3.5 shrink-0 text-muted-foreground/75"
  switch (props.type) {
    case "browser":
      if (props.favicon) {
        return (
          <img
            src={props.favicon}
            alt=""
            className={cn("size-3.5 shrink-0 rounded-sm object-contain", className)}
            aria-hidden
          />
        )
      }
      return <Globe className={className} aria-hidden />
    case "devServer":
      return <ComputerScreen className={className} aria-hidden />
    case "mobileSimulator":
      return <Phone className={className} aria-hidden />
    case "terminal":
    default:
      return <SquareTerminal className={className} aria-hidden />
  }
}

interface SidebarAgentStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready"
  colorClass: string
  dotClass: string
  pulse: boolean
}

function ProviderGlyph(props: { provider?: string | null; className?: string }) {
  const className = props.className ?? "size-3.5"

  switch (props.provider) {
    case "claudeAgent":
      return <ClaudeAI className={className} />
    case "gemini":
      return <Gemini className={className} />
    case "openCode":
      return <OpenCodeIcon className={className} />
    case "codex":
    default:
      return <OpenAI className={className} />
  }
}

function hasUnseenCompletion(
  thread: NonNullable<ReturnType<typeof useStore.getState>["threads"][number]>,
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
  thread: NonNullable<ReturnType<typeof useStore.getState>["threads"][number]>
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
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    }
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
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
  const thread = useStore((state) =>
    props.threadId ? (state.threads.find((entry) => entry.id === props.threadId) ?? null) : null,
  )

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
    <span className={cn("inline-flex items-center gap-1 text-[10px]", statusPill.colorClass)}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          statusPill.dotClass,
          statusPill.pulse && "animate-pulse",
        )}
      />
      <span className="hidden md:inline">{statusPill.label}</span>
    </span>
  )
}

interface SidebarLaneTilesProps {
  activeLaneSummary: WorkbenchLaneSidebarSummary | null
  activeSelectionLevel: SidebarActiveSelectionLevel
  activeTileId: string | null
  onOpenLaneWorkbench: (options?: {
    openTile?: "assistantChat" | "terminal"
    focusTileId?: string
  }) => void
}

export function SidebarLaneTiles(props: SidebarLaneTilesProps) {
  const {
    activeLaneSummary,
    activeSelectionLevel,
    activeTileId,
    onOpenLaneWorkbench,
  } = props
  const agents = activeLaneSummary?.agents ?? []
  const surfaces = activeLaneSummary?.surfaces ?? []
  const resolvedActiveTileId = activeSelectionLevel === "tile" ? activeTileId : null

  if (agents.length === 0 && surfaces.length === 0) {
    return null
  }

  return (
    <div className="w-full space-y-0.5 pt-0.5">
      {agents.map((tile) => (
        <button
          key={tile.id}
          type="button"
          className={cn(
            "w-full",
            SIDEBAR_PILL_NESTED_ROW_CLASS,
            resolvedActiveTileId === tile.id && SIDEBAR_PILL_ACTIVE_CLASS,
          )}
          onClick={() => onOpenLaneWorkbench({ focusTileId: tile.id })}
        >
          <div className={SIDEBAR_WORKBENCH_ROW_CONTENT_CLASS}>
            <ProviderGlyph
              provider={tile.provider}
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/75",
                resolvedActiveTileId === tile.id && "text-[var(--sidebar-pill-hover-fg)]",
              )}
            />
            <span className="min-w-0 flex-1 truncate">{tile.title}</span>
          </div>
          <AgentStatusPill threadId={tile.threadId} />
        </button>
      ))}
      {surfaces.map((tile) => (
        <button
          key={tile.id}
          type="button"
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
              type={tile.type}
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/75",
                resolvedActiveTileId === tile.id && "text-[var(--sidebar-pill-hover-fg)]",
              )}
            />
            <span className="min-w-0 flex-1 truncate">{tile.title}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
