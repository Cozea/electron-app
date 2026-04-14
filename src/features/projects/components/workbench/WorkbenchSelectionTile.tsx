import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type RefObject, type SVGProps } from "react"
import { ArchiveBoxIcon as PackageOpen, BuildingStorefrontIcon as Store, CommandLineIcon as SquareTerminal, ComputerDesktopIcon as AppWindow, DevicePhoneMobileIcon as Phone, MagnifyingGlassIcon as Search } from "@heroicons/react/24/outline"
import type { ProviderKind } from "@cozea/assistant-contracts"

import type {
  WorkbenchSelectionTile,
} from "@/stores/useProjectWorkbenchStore"
import { NativeProjectFolderIcon } from "@/features/projects/components/NativeProjectFolderIcon"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import { ClaudeAI, OpenAI } from "@/features/projects/components/assistant/Icons"
import { useAssistantServerConfig } from "@/features/projects/components/workbench/assistant/useAssistantServerConfig"
import type { WorkbenchSelectionLaunchRequest } from "@/features/projects/lib/workbenchSelectionLaunch"
import {
  computeWorkbenchSelectionLauncherLayout,
  WORKBENCH_SELECTION_LAUNCHER_CELL_HEIGHT,
  WORKBENCH_SELECTION_LAUNCHER_CELL_WIDTH,
  WORKBENCH_SELECTION_LAUNCHER_COLUMN_GAP,
  WORKBENCH_SELECTION_LAUNCHER_ROW_GAP,
  type WorkbenchSelectionLauncherLayout,
} from "@/features/projects/components/workbench/workbenchSelectionLauncherLayout"

type CategoryTab = "All" | "Development" | "Assistant" | "Explore marketplace"

const SPACIOUS_MIN_W = 720
const SPACIOUS_MIN_H = 480

const LAUNCHER_DENSITY_CONFIG = {
  large: {
    tileWidth: 112,
    iconSize: 76,
    iconRadius: 24,
    iconGlyphSize: 32,
    cellWidth: WORKBENCH_SELECTION_LAUNCHER_CELL_WIDTH,
    cellHeight: WORKBENCH_SELECTION_LAUNCHER_CELL_HEIGHT,
    columnGap: WORKBENCH_SELECTION_LAUNCHER_COLUMN_GAP,
    rowGap: WORKBENCH_SELECTION_LAUNCHER_ROW_GAP,
    labelClassName: "text-[13px]",
  },
  normal: {
    tileWidth: 96,
    iconSize: 58,
    iconRadius: 18,
    iconGlyphSize: 24,
    cellWidth: 96,
    cellHeight: 102,
    columnGap: 22,
    rowGap: 18,
    labelClassName: "text-[12px]",
  },
} as const

function isSpaciousSelectionSurface(width: number, height: number) {
  return width >= SPACIOUS_MIN_W && height >= SPACIOUS_MIN_H
}

interface WorkbenchSelectionTileProps {
  tile: WorkbenchSelectionTile
  /** True when this is the only tile and the workbench is in empty state (no tools opened yet). */
  singletonEmptyWorkbench?: boolean
  projectName?: string | null
  projectPath?: string | null
  launcherDensity?: "large" | "normal"
  onChoose: (request: WorkbenchSelectionLaunchRequest) => void
}

type SelectionOptionIcon = ComponentType<SVGProps<SVGSVGElement>>

interface SelectionOption {
  id: string
  label: string
  description: string
  iconBgClass: string
  iconColorClass: string
  category: "Development" | "Assistant" | "Explore marketplace"
  type?: WorkbenchSelectionLaunchRequest["type"]
  provider?: ProviderKind
  icon: SelectionOptionIcon
}

const DEVELOPMENT_SELECTION_OPTIONS: SelectionOption[] = [
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
    description: "web preview and runtime",
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
    id: "mobileSimulator",
    label: "Mobile Simulator",
    description: "native device preview",
    iconBgClass: "bg-indigo-500/90",
    iconColorClass: "text-white",
    category: "Development",
    type: "mobileSimulator",
    icon: Phone,
  },
]

const SUPPORTED_ASSISTANT_PROVIDER_OPTIONS: ReadonlyArray<SelectionOption> = [
  {
    id: "assistant-codex",
    label: "Codex",
    description: "AI agent",
    iconBgClass: "bg-zinc-950",
    iconColorClass: "text-white",
    category: "Assistant",
    type: "assistantChat",
    provider: "codex",
    icon: OpenAI,
  },
  {
    id: "assistant-claude",
    label: "Claude",
    description: "AI agent",
    iconBgClass: "bg-[#d97757]",
    iconColorClass: "text-white",
    category: "Assistant",
    type: "assistantChat",
    provider: "claudeAgent",
    icon: ClaudeAI,
  },
]

function isSupportedAssistantProvider(provider: ProviderKind): provider is "codex" | "claudeAgent" {
  return provider === "codex" || provider === "claudeAgent"
}

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
  contentWidth,
}: {
  isMac: boolean
  activeCategory: CategoryTab
  onCategoryChange: (category: CategoryTab) => void
  contentWidth?: number
}) {
  const shortcut = isMac ? "⌘P" : "Ctrl+P"

  return (
    <div className="w-full shrink-0 bg-content-surface px-2 py-2 md:px-0">
      <div
        className="mx-auto flex w-full flex-col gap-2.5 pb-2"
        style={contentWidth ? { maxWidth: `${contentWidth}px` } : undefined}
      >
        <div
          className="flex min-w-0 items-end overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
            className="flex h-9 w-full items-center gap-2 rounded-full bg-secondary px-3 text-sm transition-[color,box-shadow]"
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

function useSelectionSurfaceDensity(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [spacious, setSpacious] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setSpacious(isSpaciousSelectionSurface(width, height))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSpacious(isSpaciousSelectionSurface(width, height))
    })

    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, spacious]
}

function useLauncherGridLayout(
  itemCount: number,
  launcherDensity: NonNullable<WorkbenchSelectionTileProps["launcherDensity"]>,
): [RefObject<HTMLDivElement | null>, WorkbenchSelectionLauncherLayout] {
  const ref = useRef<HTMLDivElement | null>(null)
  const densityConfig = LAUNCHER_DENSITY_CONFIG[launcherDensity]
  const [layout, setLayout] = useState<WorkbenchSelectionLauncherLayout>(() =>
    computeWorkbenchSelectionLauncherLayout({
      width: 0,
      height: 0,
      itemCount,
      cellWidth: densityConfig.cellWidth,
      cellHeight: densityConfig.cellHeight,
      columnGap: densityConfig.columnGap,
      rowGap: densityConfig.rowGap,
    }),
  )

  const recalculate = useCallback(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setLayout(
      computeWorkbenchSelectionLauncherLayout({
        width,
        height,
        itemCount,
        cellWidth: densityConfig.cellWidth,
        cellHeight: densityConfig.cellHeight,
        columnGap: densityConfig.columnGap,
        rowGap: densityConfig.rowGap,
      }),
    )
  }, [densityConfig.cellHeight, densityConfig.cellWidth, densityConfig.columnGap, densityConfig.rowGap, itemCount])

  useLayoutEffect(() => {
    recalculate()
  }, [recalculate])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver(() => {
      recalculate()
    })

    ro.observe(el)
    return () => ro.disconnect()
  }, [recalculate])

  return [ref, layout]
}

function SelectionLauncherButton({
  option,
  launcherDensity,
  onChoose,
}: {
  option: SelectionOption
  launcherDensity: NonNullable<WorkbenchSelectionTileProps["launcherDensity"]>
  onChoose: WorkbenchSelectionTileProps["onChoose"]
}) {
  const Icon = option.icon
  if (!Icon) return null
  const densityConfig = LAUNCHER_DENSITY_CONFIG[launcherDensity]

  return (
    <button
      type="button"
      disabled={!option.type}
      className={cn(
        "group flex shrink-0 flex-col items-center gap-3 text-center transition-transform",
        option.type
          ? "hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "cursor-default opacity-80",
      )}
      style={{ width: `${densityConfig.tileWidth}px` }}
      title={option.description}
      onClick={() => {
        if (!option.type) return
        onChoose({
          type: option.type,
          provider: option.provider,
        })
      }}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center ring-1 ring-black/5 transition-transform group-hover:scale-[1.03]",
          option.iconBgClass,
          option.iconColorClass,
        )}
        style={{
          height: `${densityConfig.iconSize}px`,
          width: `${densityConfig.iconSize}px`,
          borderRadius: `${densityConfig.iconRadius}px`,
        }}
      >
        <Icon
          aria-hidden
          className="shrink-0"
          style={{
            height: `${densityConfig.iconGlyphSize}px`,
            width: `${densityConfig.iconGlyphSize}px`,
          }}
        />
      </div>
      <span
        className={cn(
          "block w-full truncate font-medium leading-tight text-muted-foreground",
          densityConfig.labelClassName,
        )}
      >
        {option.label}
      </span>
    </button>
  )
}

function SelectionListButton({
  option,
  launcherDensity,
  onChoose,
}: {
  option: SelectionOption
  launcherDensity: NonNullable<WorkbenchSelectionTileProps["launcherDensity"]>
  onChoose: WorkbenchSelectionTileProps["onChoose"]
}) {
  const Icon = option.icon
  if (!Icon) return null

  const iconSize = launcherDensity === "large" ? 48 : 42
  const iconRadius = launcherDensity === "large" ? 16 : 14
  const iconGlyphSize = launcherDensity === "large" ? 22 : 20

  return (
    <button
      type="button"
      disabled={!option.type}
      className={cn(
        "group flex w-full items-center gap-4 rounded-[18px] border border-border/60 bg-content-surface px-4 py-3 text-left transition-colors",
        option.type
          ? "hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "cursor-default opacity-80",
      )}
      title={option.description}
      onClick={() => {
        if (!option.type) return
        onChoose({
          type: option.type,
          provider: option.provider,
        })
      }}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center ring-1 ring-black/5",
          option.iconBgClass,
          option.iconColorClass,
        )}
        style={{
          height: `${iconSize}px`,
          width: `${iconSize}px`,
          borderRadius: `${iconRadius}px`,
        }}
      >
        <Icon
          aria-hidden
          className="shrink-0"
          style={{
            height: `${iconGlyphSize}px`,
            width: `${iconGlyphSize}px`,
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{option.label}</div>
        <div className="truncate text-xs text-muted-foreground">{option.description}</div>
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
  launcherDensity = "large",
  onChoose,
}: WorkbenchSelectionTileProps) {
  const isMac = useMemo(() => navigator.platform.toLowerCase().includes("mac"), [])
  const { config } = useAssistantServerConfig(true)
  const densityConfig = LAUNCHER_DENSITY_CONFIG[launcherDensity]

  const [rootRef, spacious] = useSelectionSurfaceDensity()
  const [activeCategory, setActiveCategory] = useState<CategoryTab>("All")

  const assistantOptions = useMemo(() => {
    const configuredProviders =
      config?.providers
        .filter((provider) => isSupportedAssistantProvider(provider.provider))
        .filter((provider) => provider.enabled)
        .map((provider) => provider.provider) ?? []

    if (configuredProviders.length <= 0) {
      return [...SUPPORTED_ASSISTANT_PROVIDER_OPTIONS]
    }

    const optionByProvider = new Map(
      SUPPORTED_ASSISTANT_PROVIDER_OPTIONS.map((option) => [option.provider, option]),
    )

    return configuredProviders
      .map((provider) => optionByProvider.get(provider))
      .filter((option): option is SelectionOption => Boolean(option))
  }, [config])

  const filteredOptions = useMemo(() => {
    const all = [...DEVELOPMENT_SELECTION_OPTIONS, ...assistantOptions]
    if (activeCategory === "All") return all
    return all.filter((option) => option.category === activeCategory)
  }, [activeCategory, assistantOptions])
  const [launcherViewportRef, launcherLayout] = useLauncherGridLayout(filteredOptions.length, launcherDensity)
  const launcherPagerRef = useRef<HTMLDivElement | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const useListView = launcherLayout.fittingColumns <= 2

  const launcherContentWidth = useMemo(() => {
    const visibleColumns = Math.min(launcherLayout.columns, Math.max(1, filteredOptions.length))
    return (
      visibleColumns * densityConfig.cellWidth +
      Math.max(0, visibleColumns - 1) * densityConfig.columnGap
    )
  }, [densityConfig.cellWidth, densityConfig.columnGap, filteredOptions.length, launcherLayout.columns])

  const pagedOptions = useMemo(() => {
    const pages: SelectionOption[][] = []
    for (let index = 0; index < filteredOptions.length; index += launcherLayout.itemsPerPage) {
      pages.push(filteredOptions.slice(index, index + launcherLayout.itemsPerPage))
    }
    return pages.length > 0 ? pages : [[]]
  }, [filteredOptions, launcherLayout.itemsPerPage])

  const showHero = singletonEmptyWorkbench && spacious

  useEffect(() => {
    setCurrentPage(0)
    if (useListView) return
    const pager = launcherPagerRef.current
    if (!pager) return
    pager.scrollTo({ left: 0, top: 0, behavior: "auto" })
  }, [activeCategory, launcherLayout.columns, launcherLayout.itemsPerPage, launcherLayout.rows, useListView])

  useEffect(() => {
    if (useListView) return
    const pager = launcherPagerRef.current
    if (!pager) return

    const handleScroll = () => {
      const nextPage = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth))
      setCurrentPage(Math.max(0, Math.min(nextPage, pagedOptions.length - 1)))
    }

    handleScroll()
    pager.addEventListener("scroll", handleScroll, { passive: true })
    return () => pager.removeEventListener("scroll", handleScroll)
  }, [pagedOptions.length, useListView])

  const handlePageSelect = useCallback(
    (pageIndex: number) => {
      const pager = launcherPagerRef.current
      if (!pager) return
      pager.scrollTo({
        left: pageIndex * pager.clientWidth,
        top: 0,
        behavior: "smooth",
      })
      setCurrentPage(pageIndex)
    },
    [launcherPagerRef],
  )

  const filterContentWidth = useListView ? undefined : launcherContentWidth

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-content-surface">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {showHero ? (
          <div className="flex w-full max-w-5xl flex-col items-stretch self-center px-6 pb-6 pt-8 md:px-10 md:pt-10">
            <WelcomeHero projectName={projectName} projectPath={projectPath} />
            <SelectionFilterBar
              isMac={isMac}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              contentWidth={filterContentWidth}
            />
          </div>
        ) : (
          <SelectionFilterBar
            isMac={isMac}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            contentWidth={filterContentWidth}
          />
        )}

        <div
          className={cn(
            "mx-auto flex w-full flex-1 min-h-0 flex-col px-3 pb-4 pt-3 md:px-6",
            "max-w-5xl",
          )}
        >
          {activeCategory === "Explore marketplace" ? (
            <MarketplacePlaceholder />
          ) : (
            <div ref={launcherViewportRef} className="flex min-h-0 flex-1 flex-col">
              {useListView ? (
                <div className="mx-auto flex w-full flex-col gap-2 px-1 py-2">
                  {filteredOptions.map((option) => (
                    <SelectionListButton
                      key={option.id}
                      option={option}
                      launcherDensity={launcherDensity}
                      onChoose={onChoose}
                    />
                  ))}
                </div>
              ) : (
                <>
                  <div
                    ref={launcherPagerRef}
                    className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden scroll-smooth snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    <div className="flex h-full">
                      {pagedOptions.map((page, pageIndex) => {
                        const pageColumns = Math.min(launcherLayout.columns, Math.max(1, page.length))
                        return (
                          <div
                            key={`selection-page-${pageIndex}`}
                            className="flex min-w-full snap-start px-1 py-2"
                          >
                            <div
                              className="grid w-full content-start justify-center"
                              style={{
                                gridTemplateColumns: `repeat(${pageColumns}, ${densityConfig.cellWidth}px)`,
                                gridAutoRows: `${densityConfig.cellHeight}px`,
                                columnGap: `${densityConfig.columnGap}px`,
                                rowGap: `${densityConfig.rowGap}px`,
                              }}
                            >
                              {page.map((option) => (
                                <SelectionLauncherButton
                                  key={option.id}
                                  option={option}
                                  launcherDensity={launcherDensity}
                                  onChoose={onChoose}
                                />
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {pagedOptions.length > 1 ? (
                    <div className="mt-3 flex items-center justify-center gap-2">
                      {pagedOptions.map((_, pageIndex) => (
                        <button
                          key={`selection-page-dot-${pageIndex}`}
                          type="button"
                          aria-label={`Go to page ${pageIndex + 1}`}
                          aria-pressed={pageIndex === currentPage}
                          className={cn(
                            "h-2.5 w-2.5 rounded-full transition-colors",
                            pageIndex === currentPage ? "bg-foreground" : "bg-border hover:bg-muted-foreground/50",
                          )}
                          onClick={() => handlePageSelect(pageIndex)}
                        />
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
