import { memo } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  cancelProjectMemoryUpdate,
  clearProjectMemoryError,
} from "@/features/project-memory/projectMemoryStore"
import {
  MEMORY_LEGEND_POSITIONS,
  type MemoryLegendPosition,
} from "@/features/project-memory/memorySettingsStore"
import { useMemoryControls } from "@/features/project-memory/useMemoryControls"
import { useTranslation, type TranslationKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  RefreshIcon as __RefreshHugeIcon,
  Settings02Icon as __SettingsHugeIcon,
} from "@hugeicons/core-free-icons"

const LEGEND_POSITION_LABEL_KEYS: Record<MemoryLegendPosition, TranslationKey> = {
  top: "workbench.memory.legend.top",
  bottom: "workbench.memory.legend.bottom",
  left: "workbench.memory.legend.left",
  right: "workbench.memory.legend.right",
}

interface WorkbenchMemoryTileHeaderActionsProps {
  projectId: string
  workspaceId: string | null
  laneId: string | null
}

/**
 * Refresh and settings live in the tile chrome, on the same row as the window
 * buttons, rather than in a second strip inside the tile body.
 */
export const WorkbenchMemoryTileHeaderActions = memo(function WorkbenchMemoryTileHeaderActions({
  projectId,
  workspaceId,
  laneId,
}: WorkbenchMemoryTileHeaderActionsProps) {
  const { t } = useTranslation()
  const { key, run, agents, defaultAgent, settings, requestUpdate, dispatchError } =
    useMemoryControls({ projectId, workspaceId, laneId })

  if (!workspaceId) return null

  return (
    <>
      {dispatchError ? (
        <span className="mr-1 text-[11px] text-destructive">
          {t("workbench.memory.update.unreachable")}
        </span>
      ) : run.error && !run.updating ? (
        // The agent stopped rather than finished — usually a usage limit.
        <button
          type="button"
          className="mr-1 max-w-56 truncate text-[11px] text-destructive underline-offset-2 hover:underline"
          title={run.error}
          onClick={() => key && clearProjectMemoryError(key)}
        >
          {t("workbench.memory.update.failed")}
        </button>
      ) : null}

      {run.updating ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md border-0 shadow-none"
          aria-label={t("workbench.memory.update.stopWaiting")}
          title={`${run.updating.agentName} ${t("workbench.memory.update.working")}`}
          onClick={() => key && cancelProjectMemoryUpdate(key)}
        >
          <span className="cozea-loader size-3.5" aria-hidden />
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md border-0 shadow-none"
          disabled={!defaultAgent}
          aria-label={t("workbench.memory.update.action")}
          title={
            defaultAgent
              ? `${t("workbench.memory.update.action")} — ${defaultAgent.name}`
              : t("workbench.memory.update.noAgents")
          }
          onClick={() => defaultAgent && requestUpdate(defaultAgent)}
        >
          <HugeiconsIcon icon={__RefreshHugeIcon} className="size-3.5" />
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md border-0 shadow-none"
            aria-label={t("workbench.memory.settings")}
            title={t("workbench.memory.settings")}
          >
            <HugeiconsIcon icon={__SettingsHugeIcon} className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
            {agents.length > 0
              ? t("workbench.memory.settings.defaultAgent")
              : t("workbench.memory.update.noAgents")}
          </DropdownMenuLabel>
          {agents.map((agent) => (
            <DropdownMenuItem
              key={agent.tileId}
              onSelect={() => settings.setDefaultAgent(workspaceId, agent.agentKey)}
            >
              <span className="flex-1 truncate">{agent.name}</span>
              {defaultAgent?.tileId === agent.tileId ? <span aria-hidden>✓</span> : null}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
            {t("workbench.memory.legend.position")}
          </DropdownMenuLabel>
          {/* Four short words do not need four full rows; a 2x2 grid reads as
              one control and halves the menu's height. Selection is shown by
              filling the cell rather than by a tick, which would crowd it. */}
          <div className="grid grid-cols-2 gap-1 px-1 py-0.5">
            {MEMORY_LEGEND_POSITIONS.map((position) => {
              const active = settings.legendPosition === position
              return (
                <DropdownMenuItem
                  key={position}
                  aria-checked={active}
                  className={cn(
                    "justify-center rounded-md px-2 py-1 text-center",
                    active && "bg-secondary text-foreground",
                  )}
                  onSelect={() => settings.setLegendPosition(workspaceId, position)}
                >
                  {t(LEGEND_POSITION_LABEL_KEYS[position])}
                </DropdownMenuItem>
              )
            })}
          </div>

          {/* No skill picker: the active build decides which memory skill runs,
              so choosing one here would have been a second, contradicting
              answer to the same question. */}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
})

export default WorkbenchMemoryTileHeaderActions
