import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"

import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import { listLauncherApps } from "@/features/devapps/registry"
import type { DevAppLauncherGroup, DevAppManifest } from "@/features/devapps/registry/types"
import type {
  WorkbenchSelectionTile,
} from "@/stores/useProjectWorkbenchStore"
import { NativeProjectFolderIcon } from "@/features/projects/components/NativeProjectFolderIcon"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import { useAssistantServerConfig } from "@/features/projects/components/workbench/assistant/useAssistantServerConfig"
import type { WorkbenchSelectionLaunchRequest } from "@/features/projects/lib/workbenchSelectionLaunch"
import { useViewTransitionNavigate } from "@/lib/navigation"
import {
  computeWorkbenchSelectionLauncherLayout,
  type WorkbenchSelectionLauncherLayout,
} from "@/features/projects/components/workbench/workbenchSelectionLauncherLayout"
import { useTranslation } from "@/lib/i18n"

import { HugeiconsIcon } from '@hugeicons/react'
import { Search01Icon as __SearchHugeIcon, ShoppingBag01Icon as __ShoppingBagHugeIcon } from '@hugeicons/core-free-icons'

type CategoryTab = "All" | DevAppLauncherGroup | "Explore DevApps Store"

const SPACIOUS_MIN_W = 720
const SPACIOUS_MIN_H = 480
const WORKBENCH_SELECTION_LIST_CONTENT_MAX_WIDTH = 680

const LAUNCHER_CONFIG = {
  tileWidth: 96,
  iconSize: 58,
  iconRadius: 58 * 0.22265625, // macOS standard: width * 0.22265625
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
  workspaceId?: string | null
  onChoose: (request: WorkbenchSelectionLaunchRequest) => void
}

const CATEGORY_TABS: CategoryTab[] = ["All", "Development", "Assistant", "Explore DevApps Store"]

function isLauncherGroup(category: CategoryTab): category is DevAppLauncherGroup {
  return category === "Development" || category === "Assistant"
}

function WelcomeHero({
  projectName,
  workspaceId,
}: {
  projectName?: string | null
  workspaceId?: string | null
}) {
  const { t } = useTranslation()
  const normalizedProjectName = projectName?.trim() || "this project"

  return (
    <div className="mb-8 flex w-full max-w-4xl flex-col items-center">
      <div className="mb-8 flex flex-col items-center gap-1">
        <span className="text-center text-2xl text-muted-foreground md:text-3xl">
          {t('workbench.selection.letsWorkOn')}
        </span>
        <span className="inline-flex items-center gap-3 text-center text-2xl font-bold tracking-tight text-foreground md:text-4xl">
          <NativeProjectFolderIcon
            folderPath={workspaceId}
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
  searchQuery,
  onSearchQueryChange,
  searchInputRef,
  contentWidth,
  flush = false,
}: {
  isMac: boolean
  activeCategory: CategoryTab
  onCategoryChange: (category: CategoryTab) => void
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  searchInputRef: RefObject<HTMLInputElement | null>
  contentWidth?: number
  flush?: boolean
}) {
  const { t } = useTranslation()
  const shortcut = isMac ? "⌘P" : "Ctrl+P"

  return (
    <div
      className={cn(
        "w-full shrink-0 bg-transparent py-2",
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
                {cat === "Explore DevApps Store" ? t('workbench.selection.exploreStore') : ((t as any)(`devApp.category.${cat}`) ?? cat)}
              </button>
              {index < array.length - 1 ? (
                <span aria-hidden className="mx-0.5 my-2 w-px shrink-0 bg-border/70 sm:mx-1" />
              ) : null}
            </div>
          ))}
        </div>

        <label
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-md border border-sidebar-border/50 bg-secondary px-3 text-sm transition-[color,box-shadow]",
            "ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1",
          )}
        >
          <span className="sr-only">{t('workbench.selection.searchTools')}</span>
          <span className="flex w-full shrink-0 items-center gap-2">
            <HugeiconsIcon icon={__SearchHugeIcon} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder={t('workbench.selection.searchPlaceholder')}
              className={cn(
                "min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground",
                "outline-none",
              )}
              aria-label="Search launcher options"
            />
            <Kbd className="shrink-0 px-1.5">{shortcut}</Kbd>
          </span>
        </label>
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
  option: DevAppManifest
  onChoose: WorkbenchSelectionTileProps["onChoose"]
}) {

  const localizedName = option.name

  return (
    <button
      type="button"
      className={cn(
        "group flex shrink-0 flex-col items-center gap-3 text-center transition-transform",
        "hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      style={{ width: `${LAUNCHER_CONFIG.tileWidth}px` }}
      title={option.description}
      onClick={() => onChoose({ appId: option.id })}
    >
      <div
        className="shrink-0 overflow-hidden ring-1 ring-black/5 transition-transform group-hover:scale-[1.03]"
        style={{
          height: `${LAUNCHER_CONFIG.iconSize}px`,
          width: `${LAUNCHER_CONFIG.iconSize}px`,
          borderRadius: `${LAUNCHER_CONFIG.iconRadius}px`,
        }}
      >
        <DevAppIcon app={option} />
      </div>
      <span
        className={cn(
          "block w-full truncate font-medium leading-tight text-muted-foreground",
          LAUNCHER_CONFIG.labelClassName,
        )}
      >
        {localizedName}
      </span>
    </button>
  )
}

function SelectionListButton({
  option,
  onChoose,
}: {
  option: DevAppManifest
  onChoose: WorkbenchSelectionTileProps["onChoose"]
}) {

  const iconSize = 42
  const iconRadius = 42 * 0.22265625 // macOS standard: width * 0.22265625

  const localizedName = option.name

  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-4 bg-transparent px-4 py-3 text-left transition-colors",
        "hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      title={option.description}
      onClick={() => onChoose({ appId: option.id })}
    >
      <div
        className="shrink-0 overflow-hidden ring-1 ring-black/5"
        style={{
          height: `${iconSize}px`,
          width: `${iconSize}px`,
          borderRadius: `${iconRadius}px`,
        }}
      >
        <DevAppIcon app={option} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{localizedName}</div>
        <div className="truncate text-xs text-muted-foreground">{option.description}</div>
      </div>
    </button>
  )
}

export function WorkbenchSelectionTile({
  tile: _tile,
  singletonEmptyWorkbench = false,
  projectName,
  workspaceId,
  onChoose,
}: WorkbenchSelectionTileProps) {
  const { t } = useTranslation()
  const navigate = useViewTransitionNavigate()
  const isMac = useMemo(() => navigator.platform.toLowerCase().includes("mac"), [])
  const { config } = useAssistantServerConfig(true)
  const densityConfig = LAUNCHER_CONFIG

  const [rootRef, spacious] = useSelectionSurfaceDensity()
  const [activeCategory, setActiveCategory] = useState<CategoryTab>("All")
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const enabledAssistantProviders = useMemo(() => {
    const providers =
      config?.providers
        .filter((provider) => provider.enabled)
        .map((provider) => provider.provider) ?? []

    return providers.length > 0 ? providers : null
  }, [config])

  const allOptions = useMemo(
    () => listLauncherApps({ enabledAssistantProviders }),
    [enabledAssistantProviders],
  )
  const categoryOptions = useMemo(() => {
    if (!isLauncherGroup(activeCategory)) return allOptions
    return listLauncherApps({
      enabledAssistantProviders,
      group: activeCategory,
    })
  }, [activeCategory, allOptions, enabledAssistantProviders])
  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return categoryOptions

    if (!isLauncherGroup(activeCategory)) {
      return listLauncherApps({
        enabledAssistantProviders,
        query: searchQuery,
      })
    }

    return listLauncherApps({
      enabledAssistantProviders,
      group: activeCategory,
      query: searchQuery,
    })
  }, [activeCategory, categoryOptions, enabledAssistantProviders, searchQuery])
  const [launcherViewportRef, launcherLayout] = useLauncherGridLayout(allOptions.length)
  const launcherPagerRef = useRef<HTMLDivElement | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const useListView = launcherLayout.fittingColumns <= 2

  const launcherContentWidth = useMemo(() => {
    // Keep filter bar and launcher content width tied to available layout columns,
    // not to current result count (prevents width jitter while searching).
    const visibleColumns = Math.max(1, launcherLayout.columns)
    return (
      visibleColumns * densityConfig.cellWidth +
      Math.max(0, visibleColumns - 1) * densityConfig.columnGap
    )
  }, [densityConfig.cellWidth, densityConfig.columnGap, launcherLayout.columns])

  const pagedOptions = useMemo(() => {
    const pages: DevAppManifest[][] = []
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
  }, [activeCategory, launcherLayout.columns, launcherLayout.itemsPerPage, launcherLayout.rows, searchQuery, useListView])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const pressedShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p"
      if (!pressedShortcut) return
      event.preventDefault()
      const input = searchInputRef.current
      if (!input) return
      input.focus()
      input.select()
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true })
  }, [])

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
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchInputRef={searchInputRef}
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
            <WelcomeHero projectName={projectName} workspaceId={workspaceId} />
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
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((option) => (
                    <SelectionListButton
                      key={option.id}
                      option={option}
                      onChoose={onChoose}
                    />
                  ))
                ) : (
                  <div className="px-3 py-4 text-xs text-muted-foreground">
                    {t('workbench.selection.noResults')} "{searchQuery.trim()}".
                  </div>
                )}
              </div>
            ) : (
              <>
                {filteredOptions.length > 0 ? (
                  <div
                    ref={launcherPagerRef}
                    className={cn(
                      "overflow-x-auto overflow-y-hidden scroll-smooth snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                      centerSingletonSelectionLayout ? "w-full flex-none" : "min-h-0 flex-1",
                    )}
                  >
                    <div className="flex h-full">
                      {pagedOptions.map((page, pageIndex) => {
                        const pageColumns = Math.max(1, launcherLayout.columns)
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
                ) : (
                  <div
                    className={cn(
                      "flex items-center justify-center px-2 py-8 text-xs text-muted-foreground",
                      centerSingletonSelectionLayout ? "w-full flex-none" : "min-h-0 flex-1",
                    )}
                  >
                    {t('workbench.selection.noResults')} "{searchQuery.trim()}".
                  </div>
                )}

                {filteredOptions.length > 0 && pagedOptions.length > 1 ? (
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
