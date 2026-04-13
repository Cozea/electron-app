import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"
import { ArchiveBoxIcon as PackageOpen, BuildingStorefrontIcon as Store, CommandLineIcon as SquareTerminal, ComputerDesktopIcon as AppWindow, CpuChipIcon as Bot, MagnifyingGlassIcon as Search } from "@heroicons/react/24/outline"

import type {
  WorkbenchSelectionTile,
  WorkbenchTileType,
} from "@/stores/useProjectWorkbenchStore"
import { NativeProjectFolderIcon } from "@/features/projects/components/NativeProjectFolderIcon"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"

type CategoryTab = "All" | "Development" | "Assistant" | "Explore marketplace"

type SelectionLayout = "spacious" | "verticalCompact" | "horizontalCompact"

const SPACIOUS_MIN_W = 720
const SPACIOUS_MIN_H = 480

function deriveSelectionLayout(width: number, height: number): SelectionLayout {
  if (width <= 0 || height <= 0) return "horizontalCompact"
  if (width >= SPACIOUS_MIN_W && height >= SPACIOUS_MIN_H) return "spacious"
  if (height > width * 1.02) return "verticalCompact"
  return "horizontalCompact"
}

interface WorkbenchSelectionTileProps {
  tile: WorkbenchSelectionTile
  /** True when this is the only tile and the workbench is in empty state (no tools opened yet). */
  singletonEmptyWorkbench?: boolean
  projectName?: string | null
  projectPath?: string | null
  onChoose: (type: Extract<WorkbenchTileType, "assistantChat" | "browser" | "devServer" | "terminal">) => void
}

interface SelectionOption {
  id: string
  label: string
  description: string
  iconBgClass: string
  iconColorClass: string
  category: "Development" | "Assistant" | "Explore marketplace"
  type?: Extract<WorkbenchTileType, "assistantChat" | "browser" | "devServer" | "terminal">
  icon: typeof AppWindow
}

const CORE_SELECTION_OPTIONS: SelectionOption[] = [
  {
    id: "browser",
    label: "Browser",
    description: "persistent web surface",
    iconBgClass: "bg-sky-500/90",
    iconColorClass: "text-white",
    category: "Development",
    type: "browser",
    icon: AppWindow,
  },
  {
    id: "devServer",
    label: "Dev Server",
    description: "preview and runtime",
    iconBgClass: "bg-emerald-500/90",
    iconColorClass: "text-white",
    category: "Development",
    type: "devServer",
    icon: PackageOpen,
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

const CATEGORY_TABS: CategoryTab[] = ["All", "Development", "Assistant", "Explore marketplace"]

function WelcomeHero({
  projectName,
  projectPath,
}: {
  projectName?: string | null
  projectPath?: string | null
}) {
  const normalizedProjectName = projectName?.trim() || "this project"

  return (
    <div className="mb-8 flex w-full max-w-4xl flex-col items-center">
      <div className="mb-8 flex flex-col items-center gap-1">
        <span className="text-center text-2xl text-muted-foreground md:text-3xl">
          Let&apos;s work on
        </span>
        <span className="inline-flex items-center gap-3 text-center text-2xl font-bold tracking-tight text-foreground md:text-4xl">
          <NativeProjectFolderIcon
            folderPath={projectPath}
            fallbackClassName="h-7 w-7 text-muted-foreground md:h-9 md:w-9"
            imgClassName="h-7 w-7 md:h-9 md:w-9"
          />
          {normalizedProjectName}
        </span>
      </div>
    </div>
  )
}

function SelectionFilterBar({
  isMac,
  activeCategory,
  onCategoryChange,
  layout,
}: {
  isMac: boolean
  activeCategory: CategoryTab
  onCategoryChange: (category: CategoryTab) => void
  layout: SelectionLayout
}) {
  const shortcut = isMac ? "⌘P" : "Ctrl+P"
  const isSpacious = layout === "spacious"
  const isVerticalCompact = layout === "verticalCompact"

  return (
    <div className={cn("w-full shrink-0 border-b border-border/70 bg-content-surface", isSpacious ? "pt-3" : "px-2 py-2")}>
      <div className={cn("mx-auto flex w-full max-w-5xl flex-col gap-2.5", isSpacious && "pb-2")}>
        <div
          className={cn(
            "flex min-w-0 items-stretch overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            isVerticalCompact ? "w-full" : "items-end",
          )}
        >
          {CATEGORY_TABS.map((cat, index, array) => (
            <div key={cat} className="flex shrink-0 items-stretch">
              <button
                type="button"
                onClick={() => onCategoryChange(cat)}
                className={cn(
                  "relative inline-flex items-center gap-1.5 px-3 pb-2.5 pt-1.5 text-[12px] font-medium transition-colors sm:px-4 sm:pb-3 sm:pt-2 sm:text-[13px]",
                  activeCategory === cat
                    ? "text-foreground after:absolute after:-bottom-px after:left-0 after:right-0 after:h-0.5 after:bg-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {cat === "Explore marketplace" ? <Store className="size-3.5" aria-hidden /> : null}
                {cat}
              </button>
              {index < array.length - 1 ? (
                <span aria-hidden className="mx-0.5 my-2 w-px shrink-0 bg-border/70 sm:mx-1" />
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex w-full shrink-0 justify-end">
          <div
            className="flex h-9 w-full items-center gap-2 rounded-full bg-secondary/50 px-3 text-sm transition-[color,box-shadow]"
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

function useContainerLayout(): [RefObject<HTMLDivElement | null>, SelectionLayout] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [layout, setLayout] = useState<SelectionLayout>("horizontalCompact")

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setLayout(deriveSelectionLayout(width, height))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setLayout(deriveSelectionLayout(width, height))
    })

    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, layout]
}

function OptionCardButton({
  option,
  onChoose,
}: {
  option: SelectionOption
  onChoose: WorkbenchSelectionTileProps["onChoose"]
}) {
  const Icon = option.icon
  if (!Icon) return null

  return (
    <button
      type="button"
      disabled={!option.type}
      className={cn(
        "group flex shrink-0 items-center gap-3 rounded-xl border border-border/80 bg-background p-2 text-left transition-colors",
        "min-w-[13rem] max-w-[16rem]",
        option.type
          ? "hover:border-border hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5"
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
        <span className="truncate text-[13px] font-semibold text-foreground">{option.label}</span>
        <span className="truncate text-[11px] text-muted-foreground">{option.description}</span>
      </div>
    </button>
  )
}

function OptionListRow({
  option,
  onChoose,
}: {
  option: SelectionOption
  onChoose: WorkbenchSelectionTileProps["onChoose"]
}) {
  const Icon = option.icon
  if (!Icon) return null

  return (
    <button
      type="button"
      disabled={!option.type}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-none border-b border-border/55 bg-background px-4 py-2.5 text-left transition-colors last:border-b-0 md:px-6",
        option.type
          ? "hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5"
          : "cursor-default opacity-80",
      )}
      onClick={() => {
        if (!option.type) return
        onChoose(option.type)
      }}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          option.iconBgClass,
          option.iconColorClass,
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">{option.label}</div>
        <div className="truncate text-[11px] text-muted-foreground">{option.description}</div>
      </div>
    </button>
  )
}

function MarketplacePlaceholder() {
  return (
    <div className="flex w-full max-w-4xl flex-col items-center justify-center py-12 sm:py-16">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
        <PackageOpen className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <h3 className="text-sm font-medium text-foreground">Marketplace coming soon</h3>
      <p className="mt-1 max-w-xs text-center text-xs text-muted-foreground">
        Extensions, integrations and community tools will appear here.
      </p>
    </div>
  )
}

export function WorkbenchSelectionTile({
  tile: _tile,
  singletonEmptyWorkbench = false,
  projectName,
  projectPath,
  onChoose,
}: WorkbenchSelectionTileProps) {
  const isMac = useMemo(() => navigator.platform.toLowerCase().includes("mac"), [])

  const [rootRef, layout] = useContainerLayout()
  const [activeCategory, setActiveCategory] = useState<CategoryTab>("All")

  const filteredOptions = useMemo(() => {
    const all = [...CORE_SELECTION_OPTIONS]
    if (activeCategory === "All") return all
    return all.filter((option) => option.category === activeCategory)
  }, [activeCategory])
  const showHero = singletonEmptyWorkbench && layout === "spacious"
  const centerSingletonEmpty = singletonEmptyWorkbench

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-content-surface">
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto",
          centerSingletonEmpty && "justify-center",
        )}
      >
        {showHero ? (
          <div className="flex w-full max-w-5xl flex-col items-stretch self-center px-6 pb-6 pt-8 md:px-10 md:pt-10">
            <WelcomeHero projectName={projectName} projectPath={projectPath} />
            <SelectionFilterBar
              isMac={isMac}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              layout={layout}
            />
          </div>
        ) : (
          <SelectionFilterBar
            isMac={isMac}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            layout={layout}
          />
        )}

        <div
          className={cn(
            "mx-auto flex w-full flex-col pb-4",
            layout === "verticalCompact" ? "px-0" : "px-3 md:px-6",
            layout === "verticalCompact" ? "pt-0" : "pt-3",
            layout === "verticalCompact" ? "max-w-none" : "max-w-5xl",
            centerSingletonEmpty ? "flex-none" : "flex-1",
          )}
        >
          {activeCategory === "Explore marketplace" ? (
            <MarketplacePlaceholder />
          ) : layout === "verticalCompact" ? (
            <div className="app-scrollbar flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto">
              {filteredOptions.map((option) => (
                <OptionListRow key={option.id} option={option} onChoose={onChoose} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-row items-start gap-2 overflow-x-auto overflow-y-hidden py-0.5 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5">
              {filteredOptions.map((option) => (
                <OptionCardButton key={option.id} option={option} onChoose={onChoose} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
