import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type RefObject, type SVGProps } from "react"
import type { ProviderKind } from "@cozea/assistant-contracts"
import { SiGooglechrome } from "react-icons/si"

import type {

  WorkbenchSelectionTile,
} from "@/stores/useProjectWorkbenchStore"
import { NativeProjectFolderIcon } from "@/features/projects/components/NativeProjectFolderIcon"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import { ClaudeAI, CursorIcon, OpenAI, OpenCodeIcon } from "@/features/projects/components/assistant/Icons"
import { useAssistantServerConfig } from "@/features/projects/components/workbench/assistant/useAssistantServerConfig"
import type { WorkbenchSelectionLaunchRequest } from "@/features/projects/lib/workbenchSelectionLaunch"
import { useViewTransitionNavigate } from "@/lib/navigation"
import {
  computeWorkbenchSelectionLauncherLayout,
  type WorkbenchSelectionLauncherLayout,
} from "@/features/projects/components/workbench/workbenchSelectionLauncherLayout"

import { HugeiconsIcon } from '@hugeicons/react'
import { ComputerTerminal01Icon as __ComputerTerminalHugeIcon, DeviceAccessIcon as __PhoneHugeIcon, Search01Icon as __SearchHugeIcon, ServerStack02Icon as __ServerStackHugeIcon, ShoppingBag01Icon as __ShoppingBagHugeIcon } from '@hugeicons/core-free-icons'

const ServerStack = (props: any) => <HugeiconsIcon icon={__ServerStackHugeIcon} {...props} />
const ComputerTerminal = (props: any) => <HugeiconsIcon icon={__ComputerTerminalHugeIcon} {...props} />
const Phone = (props: any) => <HugeiconsIcon icon={__PhoneHugeIcon} {...props} />

type CategoryTab = "All" | "Development" | "Assistant" | "Explore DevApps Store"

const SPACIOUS_MIN_W = 720
const SPACIOUS_MIN_H = 480
const WORKBENCH_SELECTION_LIST_CONTENT_MAX_WIDTH = 680

const LAUNCHER_CONFIG = {
  tileWidth: 96,
  iconSize: 58,
  iconRadius: 18,
  iconGlyphSize: 24,
  cellWidth: 96,
  cellHeight: 102,
  columnGap: 22,
  rowGap: 18,
  labelClassName: "text-[12px]",
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
  onChoose: (request: WorkbenchSelectionLaunchRequest) => void
}

type SelectionOptionIcon = ComponentType<SVGProps<SVGSVGElement>>

interface SelectionOption {
  id: string
  label: string
  description: string
  iconBgClass: string
  iconColorClass: string
  category: "Development" | "Assistant" | "Explore DevApps Store"
  type?: WorkbenchSelectionLaunchRequest["type"]
  provider?: ProviderKind
  icon: SelectionOptionIcon
}

function ChromiumIcon(props: SVGProps<SVGSVGElement>) {
  return <SiGooglechrome {...props} />
}

const DEVELOPMENT_SELECTION_OPTIONS: SelectionOption[] = [
  {
    id: "browser",
    label: "Browser",
    description: "persistent web surface",
    iconBgClass: "bg-zinc-950",
    iconColorClass: "text-white",
    category: "Development",
    type: "browser",
    icon: ChromiumIcon,
  },
  {
    id: "devServer",
    label: "Dev Server",
    description: "web preview and runtime",
    iconBgClass: "bg-emerald-500/90",
    iconColorClass: "text-white",
    category: "Development",
    type: "devServer",
    icon: ServerStack,
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "local shell",
    iconBgClass: "bg-zinc-900 dark:bg-zinc-100",
    iconColorClass: "text-white dark:text-zinc-900",
    category: "Development",
    type: "terminal",
    icon: ComputerTerminal,
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

const SUPPORTED_ASSISTANT_PROVIDER_OPTIONS: ReadonlyArray<SelectionOption & { provider: ProviderKind }> = [
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
  {
    id: "assistant-cursor",
    label: "Cursor",
    description: "AI agent",
    iconBgClass: "bg-zinc-100",
    iconColorClass: "text-zinc-700",
    category: "Assistant",
    type: "assistantChat",
    provider: "cursor",
    icon: CursorIcon,
  },
  {
    id: "assistant-opencode",
    label: "OpenCode",
    description: "AI agent",
    iconBgClass: "bg-zinc-900",
    iconColorClass: "text-white",
    category: "Assistant",
    type: "assistantChat",
    provider: "opencode",
    icon: OpenCodeIcon,
  },
]

const CATEGORY_TABS: CategoryTab[] = ["All", "Development", "Assistant", "Explore DevApps Store"]

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
  flush = false,
}: {
  isMac: boolean
  activeCategory: CategoryTab
  onCategoryChange: (category: CategoryTab) => void
  contentWidth?: number
  flush?: boolean
}) {
  const shortcut = isMac ? "⌘P" : "Ctrl+P"

  return (
    <div
      className={cn(
        "w-full shrink-0 bg-content-surface py-2",
        flush ? "px-0" : "px-2 md:px-0",
      )}
    >
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
                {cat === "Explore DevApps Store" ? <HugeiconsIcon icon={__ShoppingBagHugeIcon} className="size-3.5" aria-hidden /> : null}
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
            className="flex h-9 w-full items-center gap-2 rounded-md bg-secondary px-3 text-sm transition-[color,box-shadow]"
            role="status"
            aria-label="Quick open hint"
          >
            <HugeiconsIcon icon={__SearchHugeIcon} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
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
): [RefObject<HTMLDivElement | null>, WorkbenchSelectionLauncherLayout] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [layout, setLayout] = useState<WorkbenchSelectionLauncherLayout>(() =>
    computeWorkbenchSelectionLauncherLayout({
      width: 0,
      height: 0,
      itemCount,
      cellWidth: LAUNCHER_CONFIG.cellWidth,
      cellHeight: LAUNCHER_CONFIG.cellHeight,
      columnGap: LAUNCHER_CONFIG.columnGap,
      rowGap: LAUNCHER_CONFIG.rowGap,
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
        cellWidth: LAUNCHER_CONFIG.cellWidth,
        cellHeight: LAUNCHER_CONFIG.cellHeight,
        columnGap: LAUNCHER_CONFIG.columnGap,
        rowGap: LAUNCHER_CONFIG.rowGap,
      }),
    )
  }, [itemCount])

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
        "group flex shrink-0 flex-col items-center gap-3 text-center transition-transform",
        option.type
          ? "hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "cursor-default opacity-80",
      )}
      style={{ width: `${LAUNCHER_CONFIG.tileWidth}px` }}
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
          height: `${LAUNCHER_CONFIG.iconSize}px`,
          width: `${LAUNCHER_CONFIG.iconSize}px`,
          borderRadius: `${LAUNCHER_CONFIG.iconRadius}px`,
        }}
      >
        <Icon
          aria-hidden
          className="shrink-0"
          style={{
            height: `${LAUNCHER_CONFIG.iconGlyphSize}px`,
            width: `${LAUNCHER_CONFIG.iconGlyphSize}px`,
          }}
        />
      </div>
      <span
        className={cn(
          "block w-full truncate font-medium leading-tight text-muted-foreground",
          LAUNCHER_CONFIG.labelClassName,
        )}
      >
        {option.label}
      </span>
    </button>
  )
}

function SelectionListButton({
  option,
  onChoose,
}: {
  option: SelectionOption
  onChoose: WorkbenchSelectionTileProps["onChoose"]
}) {
  const Icon = option.icon
  if (!Icon) return null

  const iconSize = 42
  const iconRadius = 14
  const iconGlyphSize = 20

  return (
    <button
      type="button"
      disabled={!option.type}
      className={cn(
        "group flex w-full items-center gap-4 bg-transparent px-4 py-3 text-left transition-colors",
        option.type
          ? "hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

export function WorkbenchSelectionTile({
  tile: _tile,
  singletonEmptyWorkbench = false,
  projectName,
  projectPath,
  onChoose,
}: WorkbenchSelectionTileProps) {
  const navigate = useViewTransitionNavigate()
  const isMac = useMemo(() => navigator.platform.toLowerCase().includes("mac"), [])
  const { config } = useAssistantServerConfig(true)
  const densityConfig = LAUNCHER_CONFIG

  const [rootRef, spacious] = useSelectionSurfaceDensity()
  const [activeCategory, setActiveCategory] = useState<CategoryTab>("All")

  const assistantOptions = useMemo(() => {
    const optionByProvider = new Map(
      SUPPORTED_ASSISTANT_PROVIDER_OPTIONS.map((option) => [option.provider, option]),
    )
    const configuredProviders =
      config?.providers
        .filter((provider) => provider.enabled)
        .map((provider) => optionByProvider.get(provider.provider))
        .filter(
          (option): option is SelectionOption & { provider: ProviderKind } => option !== undefined,
        ) ?? []

    if (configuredProviders.length <= 0) {
      return [...SUPPORTED_ASSISTANT_PROVIDER_OPTIONS]
    }
    return configuredProviders
  }, [config])

  const filteredOptions = useMemo(() => {
    const all = [...DEVELOPMENT_SELECTION_OPTIONS, ...assistantOptions]
    if (activeCategory === "All") return all
    return all.filter((option) => option.category === activeCategory)
  }, [activeCategory, assistantOptions])
  const [launcherViewportRef, launcherLayout] = useLauncherGridLayout(filteredOptions.length)
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
  const centerSingletonSelectionLayout = showHero && !useListView

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

  const filterContentWidth = useListView
    ? WORKBENCH_SELECTION_LIST_CONTENT_MAX_WIDTH
    : launcherContentWidth
  const handleCategoryChange = useCallback(
    (category: CategoryTab) => {
      if (category === "Explore DevApps Store") {
        navigate("/projects/store")
        return
      }
      setActiveCategory(category)
    },
    [navigate],
  )
  const sharedFilterBar = (
    <SelectionFilterBar
      isMac={isMac}
      activeCategory={activeCategory}
      onCategoryChange={handleCategoryChange}
      contentWidth={useListView ? undefined : filterContentWidth}
      flush={useListView}
    />
  )

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-content-surface">
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto",
          centerSingletonSelectionLayout ? "justify-center" : null,
        )}
      >
        {showHero ? (
          <div className="flex w-full max-w-5xl flex-col items-stretch self-center px-6 pb-6 pt-8 md:px-10 md:pt-10">
            <WelcomeHero projectName={projectName} projectPath={projectPath} />
            {useListView ? null : sharedFilterBar}
          </div>
        ) : null}

        {!useListView && !showHero ? sharedFilterBar : null}

        <div
          className={cn(
            "mx-auto flex w-full flex-col px-3 md:px-6",
            centerSingletonSelectionLayout ? "flex-none pb-6 pt-1" : "flex-1 min-h-0 pb-4 pt-3",
            "max-w-5xl",
          )}
        >
          <div
            ref={launcherViewportRef}
            className={cn(
              "flex w-full flex-col",
              centerSingletonSelectionLayout ? "flex-none" : "min-h-0 flex-1",
            )}
          >
            {useListView ? (
              <div
                className="mx-auto flex w-full flex-col divide-y divide-border/60 py-2"
                style={{ maxWidth: `${WORKBENCH_SELECTION_LIST_CONTENT_MAX_WIDTH}px` }}
              >
                {sharedFilterBar}
                {filteredOptions.map((option) => (
                  <SelectionListButton
                    key={option.id}
                    option={option}
                    onChoose={onChoose}
                  />
                ))}
              </div>
            ) : (
              <>
                <div
                  ref={launcherPagerRef}
                  className={cn(
                    "overflow-x-auto overflow-y-hidden scroll-smooth snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                    centerSingletonSelectionLayout ? "w-full flex-none" : "min-h-0 flex-1",
                  )}
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
        </div>
      </div>
    </div>
  )
}
