import { useState, useMemo } from "react"
import {
  AppWindow,
  Bot,
  MonitorCog,
  PackageOpen,
  Search,
  Store,
  SquareTerminal,
} from "lucide-react"

import type {
  WorkbenchSelectionTile,
  WorkbenchTileType,
} from "@/stores/useProjectWorkbenchStore"
import { ProjectFavicon } from "@/features/projects/components/ProjectFavicon"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"

interface WorkbenchSelectionTileProps {
  tile: WorkbenchSelectionTile
  /** True when this is the only tile and the workbench is in empty state (no tools opened yet). */
  singletonEmptyWorkbench?: boolean
  projectName?: string | null
  projectPath?: string | null
  onChoose: (
    type: Extract<WorkbenchTileType, "assistantChat" | "browser" | "terminal" | "devServer">,
  ) => void
}

interface SelectionOption {
  id: string
  label: string
  description: string
  iconBgClass: string
  iconColorClass: string
  category: "Development" | "Assistant" | "Explore marketplace"
  type?: Extract<WorkbenchTileType, "assistantChat" | "browser" | "terminal" | "devServer">
  icon: typeof AppWindow
}

const CORE_SELECTION_OPTIONS: SelectionOption[] = [
  {
    id: "browser",
    label: "Browser",
    description: "web preview",
    iconBgClass: "bg-[#3BB4FF]",
    iconColorClass: "text-white",
    category: "Development",
    type: "browser",
    icon: AppWindow,
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "local shell",
    iconBgClass: "bg-zinc-900 dark:bg-zinc-100",
    iconColorClass: "text-white dark:text-zinc-900",
    category: "Development",
    type: "terminal",
    icon: SquareTerminal,
  },
  {
    id: "devServer",
    label: "Dev Server",
    description: "localhost",
    iconBgClass: "bg-[#FFBE3B]",
    iconColorClass: "text-black",
    category: "Development",
    type: "devServer",
    icon: MonitorCog,
  },
  {
    id: "assistantChat",
    label: "AI Agent",
    description: "workspace",
    iconBgClass: "bg-[#C48CFF]",
    iconColorClass: "text-black",
    category: "Assistant",
    type: "assistantChat",
    icon: Bot,
  },
]

function SingletonEmptyHero({
  isMac,
  projectName,
  projectPath,
  activeCategory,
  onCategoryChange,
}: {
  isMac: boolean
  projectName?: string | null
  projectPath?: string | null
  activeCategory: "All" | "Development" | "Assistant" | "Explore marketplace"
  onCategoryChange: (category: "All" | "Development" | "Assistant" | "Explore marketplace") => void
}) {
  const shortcut = isMac ? "⌘P" : "Ctrl+P"
  const normalizedProjectName = projectName?.trim() || "this project"

  return (
    <div className="mb-8 flex w-full flex-col items-center">
      <div className="mb-8 flex flex-col items-center gap-1">
        <span className="text-center text-2xl text-muted-foreground md:text-3xl">
          Let&apos;s work on
        </span>
        <span className="inline-flex items-center gap-3 text-center text-2xl font-bold tracking-tight text-foreground md:text-4xl">
          <ProjectFavicon cwd={projectPath ?? null} className="size-7 md:size-9" imageClassName="h-7 w-auto max-w-12 md:h-9 md:max-w-14" />
          {normalizedProjectName}
        </span>
      </div>

      <div className="flex w-full max-w-4xl items-end justify-between border-b border-border/70 pt-3">
        <div className="flex items-end">
          {(["All", "Development", "Assistant", "Explore marketplace"] as const).map((cat, index, array) => (
            <div key={cat} className="flex items-stretch">
              <button
                onClick={() => onCategoryChange(cat)}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 pb-3 pt-2 text-[13px] font-medium transition-colors",
                  activeCategory === cat
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {cat === "Explore marketplace" ? <Store className="size-3.5" aria-hidden /> : null}
                {cat}
              </button>
              {index < array.length - 1 ? (
                <span aria-hidden className="mx-1 my-2 w-px bg-border/70" />
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex items-end justify-end pb-2">
          <div
            className="flex h-9 w-48 items-center gap-2 rounded-full bg-secondary/50 px-3 text-sm transition-[color,box-shadow]"
            role="status"
            aria-label="Quick open hint"
          >
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">Search...</span>
            <Kbd className="shrink-0 px-1.5">{shortcut}</Kbd>
          </div>
        </div>
      </div>

    </div>
  )
}

export function WorkbenchSelectionTile({
  tile,
  singletonEmptyWorkbench = false,
  projectName,
  projectPath,
  onChoose,
}: WorkbenchSelectionTileProps) {
  const isMac = useMemo(() => navigator.platform.toLowerCase().includes("mac"), [])
  const isEmptyStateTile = tile.mode === "emptyState"
  const isHorizontalTile = tile.edge === "top" || tile.edge === "bottom"
  const singletonRowLayout = isEmptyStateTile && singletonEmptyWorkbench
  const [activeCategory, setActiveCategory] = useState<"All" | "Development" | "Assistant" | "Explore marketplace">("All")

  const singletonAppGridOptions = useMemo(
    () => {
      const all = [...CORE_SELECTION_OPTIONS]
      if (activeCategory === "All") return all
      return all.filter(option => option.category === activeCategory)
    },
    [activeCategory],
  )

  if (singletonRowLayout) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto bg-content-surface p-8 md:p-12">
        <SingletonEmptyHero
          isMac={isMac}
          projectName={projectName}
          projectPath={projectPath}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
        />
        {activeCategory === "Explore marketplace" ? (
          <div className="flex w-full max-w-4xl flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <PackageOpen className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <h3 className="text-sm font-medium text-foreground">Marketplace coming soon</h3>
            <p className="mt-1 max-w-xs text-center text-xs text-muted-foreground">
              Extensions, integrations and community tools will appear here.
            </p>
          </div>
        ) : (
          <div className="grid w-full max-w-4xl grid-cols-1 gap-x-2 gap-y-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {singletonAppGridOptions.map((option) => {
              const Icon = option.icon
              if (!Icon) return null

              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={!option.type}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-xl border border-border/80 bg-background p-2 text-left transition-colors",
                    option.type
                      ? "hover:bg-black/5 dark:hover:bg-white/5 hover:border-border focus-visible:bg-black/5 dark:focus-visible:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      : "cursor-default opacity-80",
                  )}
                  onClick={() => {
                    if (!option.type) return
                    onChoose(option.type)
                  }}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]",
                      option.iconBgClass,
                      option.iconColorClass,
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold text-foreground">
                        {option.label}
                      </span>
                    </div>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {option.description}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-content-surface px-8 py-10">
      <div
        className={cn(
          "grid shrink-0 place-items-center",
          isEmptyStateTile && "h-full w-full grid-cols-2 grid-rows-2",
          !isEmptyStateTile &&
            (isHorizontalTile
              ? "w-fit max-w-full grid-cols-4 gap-x-8 gap-y-0"
              : "w-fit max-w-full grid-cols-2 gap-x-10 gap-y-8"),
        )}
      >
        {CORE_SELECTION_OPTIONS.map((option, index) => {
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
