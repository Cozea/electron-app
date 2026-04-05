import { AppWindow, Bot, MonitorCog, SquareTerminal } from "lucide-react"

import type {
  WorkbenchSelectionTile,
  WorkbenchTileType,
} from "@/stores/useProjectWorkbenchStore"
import { cn } from "@/lib/utils"

interface WorkbenchSelectionTileProps {
  tile: WorkbenchSelectionTile
  onChoose: (
    type: Extract<WorkbenchTileType, "assistantChat" | "browser" | "terminal" | "devServer">,
  ) => void
}

interface SelectionOption {
  id: string
  label?: string
  type?: Extract<WorkbenchTileType, "assistantChat" | "browser" | "terminal" | "devServer">
  icon?: typeof AppWindow
}

const SELECTION_OPTIONS: SelectionOption[] = [
  {
    id: "browser",
    label: "Browser",
    type: "browser",
    icon: AppWindow,
  },
  {
    id: "terminal",
    label: "Terminal",
    type: "terminal",
    icon: SquareTerminal,
  },
  {
    id: "devServer",
    label: "Dev Server",
    type: "devServer",
    icon: MonitorCog,
  },
  {
    id: "assistantChat",
    label: "AI Agent",
    type: "assistantChat",
    icon: Bot,
  },
]

export function WorkbenchSelectionTile({
  tile,
  onChoose,
}: WorkbenchSelectionTileProps) {
  const isEmptyStateTile = tile.mode === "emptyState"
  const isHorizontalTile = tile.edge === "top" || tile.edge === "bottom"

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-content-surface px-8 py-10">
      <div
        className={cn(
          "grid shrink-0 place-items-center",
          isEmptyStateTile
            ? "h-full w-full grid-cols-2 grid-rows-2"
            : isHorizontalTile
              ? "w-fit max-w-full grid-cols-4 gap-x-8 gap-y-0"
              : "w-fit max-w-full grid-cols-2 gap-x-10 gap-y-8",
        )}
      >
        {SELECTION_OPTIONS.map((option, index) => {
          const emptyStateDividerClass = isEmptyStateTile
            ? cn(
                "box-border border-border/60",
                index === 0 && "border-b border-r",
                index === 1 && "border-b",
                index === 2 && "border-r",
              )
            : null

          const Icon = option.icon

          return (
            <button
              key={option.id}
              type="button"
              className={cn(
                "flex flex-col items-center justify-center gap-3 text-sm text-foreground transition-opacity hover:opacity-70",
                isEmptyStateTile
                  ? "h-full min-h-[9rem] w-full"
                  : isHorizontalTile
                    ? "min-h-[7rem] w-[8.5rem]"
                    : "aspect-[1.15/1] w-[11rem]",
                tile.mode === "edgePreview" ? "opacity-95" : "opacity-100",
                emptyStateDividerClass,
              )}
              onClick={() => {
                if (!option.type) return
                onChoose(option.type)
              }}
            >
              {Icon ? <Icon className="h-5 w-5" /> : null}
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
