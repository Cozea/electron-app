import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"
import { useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"
import { FilterChip } from "@/components/ui/filter-chip"
import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import { buildInstalledDevAppManifest, buildPublishedDevAppManifest } from "@/features/devapps/orgDevAppManifest"
import { useOrgDevAppInstallations } from "@/features/devapps/useOrgDevAppInstallations"
import { buildDevelopmentDevAppManifest } from "@/features/devapps/developmentDevAppManifest"
import { listLauncherApps } from "@/features/devapps/registry"
import {
  DEV_APP_REF_SCHEME,
  parseDevAppRef,
  resolveBuiltinRef,
} from "@/features/devapps/registry/ref"
import { featureFlags } from "@/lib/featureFlags"
import { useAuth } from "@/contexts/AuthContext"
import type {
  DevAppManifest,
  DevelopmentDevAppLaunchSpec,
  PublishedDevAppLaunchSpec,
} from "@/features/devapps/registry/types"
import type { DevAppDevelopmentSource } from "@shared/devAppAuthoringTypes"
import type { WorkbenchSelectionTile } from "@/lib/workbenchTileContract"
import { ProjectPixelInvaderIcon } from "@/components/ProjectPixelInvaderIcon"
import { Kbd } from "@/components/ui/kbd"
import { ScrollArea } from "@/components/ui/scroll-area"
import { prefersReducedMotion } from "@/lib/viewTransition"
import { cn } from "@/lib/utils"
import { useAssistantServerConfig } from "@/features/workbench/assistant/useAssistantServerConfig"
import type { WorkbenchSelectionLaunchRequest } from "@/features/workbench/model/workbenchSelectionLaunch"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { WORKBENCH_SELECTION_LAUNCHER_LAYOUT } from "@/features/workbench/workbenchSelectionLauncherLayout"
import { useLauncherGridLayout } from "./useLauncherGridLayout"
import { resolveEnabledWorkbenchAssistantProviders } from "@/features/workbench/workbenchSelectionAssistantProviders"
import { useTranslation } from "@/lib/i18n"
import { getNavigatorPlatform, isMacPlatform } from "@/lib/platform"
import {
  filterWorkbenchSelectionApps,
  getWorkbenchSelectionCategories,
  resolveWorkbenchSelectionCategory,
  type WorkbenchSelectionCategory,
} from "@/features/workbench/model/workbenchSelectionCategories"
import { GlideMenu } from "@/components/primitives/GlideMenu"

import { HugeiconsIcon } from '@hugeicons/react'
import { Search01Icon as __SearchHugeIcon, ShoppingBag01Icon as __ShoppingBagHugeIcon } from '@hugeicons/core-free-icons'

type CategoryTab = WorkbenchSelectionCategory

const SPACIOUS_MIN_W = 720
const SPACIOUS_MIN_H = 480
const WORKBENCH_SELECTION_LIST_CONTENT_MAX_WIDTH = 680

const LAUNCHER_CONFIG = {
  tileWidth: 96,
  iconSize: 58,
  iconRadius: 58 * 0.22265625, // macOS standard: width * 0.22265625
  iconGlyphSize: 24,
  ...WORKBENCH_SELECTION_LAUNCHER_LAYOUT,
  maxRows: 2,
  labelClassName: "text-sm",
} as const

function isSpaciousSelectionSurface(width: number, height: number) {
  return width >= SPACIOUS_MIN_W && height >= SPACIOUS_MIN_H
}

interface WorkbenchSelectionTileProps {
  tile: WorkbenchSelectionTile
  /** True when this is the only tile and the workbench is in empty state (no tools opened yet). */
  singletonEmptyWorkbench?: boolean
  projectId?: string | null
  projectName?: string | null
  workspaceId?: string | null
  onChoose: (request: WorkbenchSelectionLaunchRequest) => void
  /**
   * Extra classes for the root surface. Defaults to an opaque `bg-content-surface`
   * (correct inside a tile's rounded chrome). The empty-lane watermark passes
   * `bg-transparent` so the launcher renders directly on the dock canvas instead
   * of as a square-cornered opaque panel.
   */
  className?: string
}

function WelcomeHero({
  projectName,
  workspaceId: _workspaceId,
}: {
  projectName?: string | null
  workspaceId?: string | null
}) {
  const { t } = useTranslation()
  const normalizedProjectName = projectName?.trim() || t("workbench.selection.thisProject")

  return (
    <div className="mb-6 flex w-full max-w-4xl items-center justify-center">
      <div className="inline-flex max-w-full items-center justify-center gap-2.5 text-center text-2xl tracking-tight md:text-3xl">
        <span className="shrink-0 text-muted-foreground">
          {t('workbench.selection.letsWorkOn')}
        </span>
        <ProjectPixelInvaderIcon
          name={normalizedProjectName}
          className="size-6 shrink-0 md:size-7"
        />
        <span className="truncate font-medium text-foreground">
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
  categories,
  contentWidth,
  flush = false,
}: {
  isMac: boolean
  activeCategory: CategoryTab
  onCategoryChange: (category: CategoryTab) => void
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  searchInputRef: RefObject<HTMLInputElement | null>
  categories: CategoryTab[]
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
        <ScrollArea
          scrollFade
          hideScrollbars
          fadeSize="1.5rem"
          className="relative w-full"
          viewportClassName="overflow-x-auto"
        >
          <div className="flex w-max items-center gap-1.5 pb-0.5">
            {categories.map((cat) => (
              <FilterChip
                key={cat}
                type="button"
                onClick={() => onCategoryChange(cat)}
                active={activeCategory === cat}
                className="inline-flex items-center gap-1.5 shrink-0"
              >
                {cat === "Explore DevApps Store" ? <HugeiconsIcon icon={__ShoppingBagHugeIcon} className="size-3" aria-hidden /> : null}
                {cat === "Explore DevApps Store"
                  ? t("workbench.selection.exploreStore")
                  : t(`devApp.category.${cat}`)}
              </FilterChip>
            ))}
          </div>
        </ScrollArea>

        <label
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-search border border-sidebar-border/50 bg-secondary px-3 text-sm transition-[color,box-shadow]",
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
              aria-label={t("workbench.selection.searchTools")}
            />
            <Kbd className="shrink-0 px-1.5">{shortcut}</Kbd>
          </span>
        </label>
      </div>
    </div>
  )
}

interface SelectionSurfaceMetrics {
  width: number
  height: number
}

function useSelectionSurfaceDensity(): [
  RefObject<HTMLDivElement | null>,
  SelectionSurfaceMetrics,
] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [metrics, setMetrics] = useState<SelectionSurfaceMetrics>({ width: 0, height: 0 })

  const updateMetrics = useCallback((width: number, height: number) => {
    setMetrics((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    )
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    updateMetrics(width, height)
  }, [updateMetrics])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      updateMetrics(width, height)
    })

    ro.observe(el)
    return () => ro.disconnect()
  }, [updateMetrics])

  return [ref, metrics]
}


function SelectionLauncherButton({
  option,
  onSelect,
}: {
  option: DevAppManifest
  onSelect: (option: DevAppManifest) => void
}) {

  const localizedName = option.name

  return (
    <button
      type="button"
      className={cn(
        "group flex shrink-0 flex-col items-center gap-3 text-center transition-[transform,color] duration-150",
        "hover:-translate-y-0.5 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      style={{
        width: `${LAUNCHER_CONFIG.tileWidth}px`,
      }}
      title={option.description}
      onClick={() => onSelect(option)}
    >
      <div
        className="shrink-0 overflow-hidden ring-1 ring-black/5 transition-transform duration-150 group-hover:scale-[1.03]"
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
          "block w-full truncate font-medium leading-tight text-foreground/90 transition-colors group-hover:text-foreground",
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
  onSelect,
}: {
  option: DevAppManifest
  onSelect: (option: DevAppManifest) => void
}) {

  const iconSize = 42
  const iconRadius = 42 * 0.22265625 // macOS standard: width * 0.22265625

  const localizedName = option.name

  return (
    <button
      type="button"
      data-row
      className={cn(
        "group relative z-10 flex w-full items-center gap-4 bg-transparent px-4 py-3 text-left transition-[transform,color] duration-150",
        "active:scale-[0.99] hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      title={option.description}
      onClick={() => onSelect(option)}
    >
      <div
        className="shrink-0 overflow-hidden ring-1 ring-black/5 transition-transform duration-150 group-hover:scale-[1.03]"
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
  projectId: _projectId,
  projectName,
  workspaceId,
  onChoose,
  className,
}: WorkbenchSelectionTileProps) {
  const { t } = useTranslation()
  const navigate = useViewTransitionNavigate()
  const isMac = useMemo(() => isMacPlatform(getNavigatorPlatform()), [])
  const { config } = useAssistantServerConfig(true)
  const densityConfig = LAUNCHER_CONFIG

  const [rootRef, surfaceMetrics] = useSelectionSurfaceDensity()
  const [activeCategory, setActiveCategory] = useState<CategoryTab>("All")
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const { principalId } = useAuth()
  const [developmentSources, setDevelopmentSources] = useState<DevAppDevelopmentSource[]>([])
  const normalizedRefSearch = searchQuery.trim()
  const parsedRef = useMemo(() => parseDevAppRef(normalizedRefSearch), [normalizedRefSearch])
  const isDevAppRefInput = normalizedRefSearch.startsWith(`${DEV_APP_REF_SCHEME}:`)
  const canResolvePublicationRef = featureFlags.projectDevApps && Boolean(principalId)
  const { installations } = useOrgDevAppInstallations()
  const resolvedPublicationRef = useQuery(
    api.devApps.resolveReference,
    canResolvePublicationRef && parsedRef?.kind === "publication"
      ? { ref: normalizedRefSearch }
      : "skip",
  )

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.devAppAuthoring.listDevelopmentSources().then((result) => {
      if (!cancelled && result.success) setDevelopmentSources(result.sources)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const orgDevAppOptions = useMemo(
    () => installations.filter((entry) => entry.active).map(buildInstalledDevAppManifest),
    [installations],
  )
  const developmentDevAppOptions = useMemo(
    () => developmentSources.map(buildDevelopmentDevAppManifest),
    [developmentSources],
  )
  const resolvedRefOptions = useMemo<DevAppManifest[]>(() => {
    if (parsedRef?.kind === "builtin") {
      const manifest = resolveBuiltinRef(parsedRef)
      return manifest ? [manifest] : []
    }
    if (parsedRef?.kind === "publication" && resolvedPublicationRef) {
      return [buildPublishedDevAppManifest(resolvedPublicationRef, normalizedRefSearch)]
    }
    if (parsedRef?.kind === "development") {
      const source = developmentSources.find((candidate) => candidate.sourceId === parsedRef.sourceId)
      return source ? [buildDevelopmentDevAppManifest(source)] : []
    }
    return []
  }, [developmentSources, normalizedRefSearch, parsedRef, resolvedPublicationRef])
  const hasOrgDevApps = orgDevAppOptions.length > 0
  const categories = useMemo(
    () => getWorkbenchSelectionCategories(hasOrgDevApps),
    [hasOrgDevApps],
  )
  const resolvedActiveCategory = resolveWorkbenchSelectionCategory(
    activeCategory,
    hasOrgDevApps,
  )

  useEffect(() => {
    if (activeCategory === resolvedActiveCategory) return
    setActiveCategory(resolvedActiveCategory)
  }, [activeCategory, resolvedActiveCategory])

  const enabledAssistantProviders = useMemo(() => {
    return resolveEnabledWorkbenchAssistantProviders(config?.providers ?? null)
  }, [config])

  const allOptions = useMemo(
    () =>
      listLauncherApps({
        additionalApps: [...developmentDevAppOptions, ...orgDevAppOptions],
        enabledAssistantProviders,
      }),
    [developmentDevAppOptions, enabledAssistantProviders, orgDevAppOptions],
  )
  const searchedOptions = useMemo(
    () =>
      parsedRef
        ? resolvedRefOptions
        : searchQuery.trim()
          ? listLauncherApps({
            additionalApps: [...developmentDevAppOptions, ...orgDevAppOptions],
            enabledAssistantProviders,
            query: searchQuery,
          })
          : allOptions,
    [allOptions, developmentDevAppOptions, enabledAssistantProviders, orgDevAppOptions, parsedRef, resolvedRefOptions, searchQuery],
  )
  const filteredOptions = useMemo(
    () =>
      parsedRef
        ? searchedOptions
        : filterWorkbenchSelectionApps(searchedOptions, resolvedActiveCategory),
    [parsedRef, resolvedActiveCategory, searchedOptions],
  )
  const emptyResultsMessage = useMemo(() => {
    if (isDevAppRefInput && !parsedRef) return t("workbench.selection.invalidDevAppRef")
    if (
      parsedRef?.kind === "publication" &&
      canResolvePublicationRef &&
      resolvedPublicationRef === undefined
    ) {
      return t("workbench.selection.resolvingDevAppRef")
    }
    if (parsedRef && resolvedRefOptions.length === 0) {
      return t("workbench.selection.unavailableDevAppRef")
    }
    return `${t("workbench.selection.noResults")} "${searchQuery.trim()}".`
  }, [canResolvePublicationRef, isDevAppRefInput, parsedRef, resolvedPublicationRef, resolvedRefOptions.length, searchQuery, t])
  const isFullScreenView = Boolean(
    singletonEmptyWorkbench &&
      isSpaciousSelectionSurface(surfaceMetrics.width, surfaceMetrics.height),
  )
  const useListView = !isFullScreenView
  const [isExiting, setIsExiting] = useState(false)
  const [launcherViewportRef, launcherLayout] = useLauncherGridLayout(allOptions.length)
  const launcherPagerRef = useRef<HTMLDivElement | null>(null)
  const [currentPage, setCurrentPage] = useState(0)

  const pagedOptions = useMemo(() => {
    const pages: DevAppManifest[][] = []
    for (let index = 0; index < filteredOptions.length; index += launcherLayout.itemsPerPage) {
      pages.push(filteredOptions.slice(index, index + launcherLayout.itemsPerPage))
    }
    return pages.length > 0 ? pages : [[]]
  }, [filteredOptions, launcherLayout.itemsPerPage])

  useEffect(() => {
    setCurrentPage(0)
    if (useListView) return
    const pager = launcherPagerRef.current
    if (!pager) return
    pager.scrollTo({ left: 0, top: 0, behavior: "auto" })
  }, [launcherLayout.columns, launcherLayout.itemsPerPage, launcherLayout.rows, resolvedActiveCategory, searchQuery, useListView])

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
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      })
      setCurrentPage(pageIndex)
    },
    [launcherPagerRef],
  )

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
  const handleChooseOption = useCallback(
    (option: DevAppManifest) => {
      setIsExiting(true)
      const publishedDevApp: PublishedDevAppLaunchSpec | undefined =
        option.launch.kind === "publishedDevApp" ? option.launch : undefined
      const developmentDevApp: DevelopmentDevAppLaunchSpec | undefined =
        option.launch.kind === "developmentDevApp" ? option.launch : undefined

      const dispatch = () => {
        onChoose({
          appId: option.id,
          ...(publishedDevApp ? { publishedDevApp } : {}),
          ...(developmentDevApp ? { developmentDevApp } : {}),
        })
      }

      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(dispatch)
      } else {
        dispatch()
      }
    },
    [onChoose],
  )

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-content-surface transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]",
        isExiting && "opacity-0 scale-[0.985] pointer-events-none",
        className,
      )}
    >
      {/* Top centering spacer: smoothly expands in full-screen to center the cluster, collapses in list view */}
      <div
        className={cn(
          "transition-[flex-grow,max-height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          useListView ? "flex-grow-0 max-h-0" : "flex-grow max-h-[14vh] min-h-0",
        )}
      />

      {/* Welcome Hero: smoothly collapses height and fades out when in list view */}
      <div
        className={cn(
          "overflow-hidden transition-[max-height,opacity,margin,padding] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]",
          useListView
            ? "max-h-0 opacity-0 pointer-events-none mb-0"
            : "max-h-24 opacity-100 mb-2 flex justify-center",
        )}
      >
        <WelcomeHero projectName={projectName} workspaceId={workspaceId} />
      </div>

      {/* Persistent Filter Bar: single component across both layouts with smooth position interpolation */}
      <div className="w-full shrink-0">
        <SelectionFilterBar
          isMac={isMac}
          activeCategory={resolvedActiveCategory}
          onCategoryChange={handleCategoryChange}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          searchInputRef={searchInputRef}
          categories={categories}
          contentWidth={WORKBENCH_SELECTION_LIST_CONTENT_MAX_WIDTH}
          flush={false}
        />
      </div>

      {/* Main Content Area: list or grid, shown without an enter animation */}
      <div className={cn("relative min-h-0 w-full overflow-hidden", useListView ? "flex-1" : "shrink-0")}>
        {useListView ? (
          <div className="h-full w-full">
            <ScrollArea scrollFade fadeSize="2rem" className="min-h-0 flex-1 w-full" viewportClassName="px-3 md:px-6">
              <GlideMenu
                rowSelector="[data-row]"
                highlightClassName="rounded-xl bg-secondary/60 dark:bg-muted/50"
                className="mx-auto flex w-full flex-col py-2 [&>button:not(:first-of-type)]:border-t [&>button:not(:first-of-type)]:border-border/50"
                style={{ maxWidth: `${WORKBENCH_SELECTION_LIST_CONTENT_MAX_WIDTH}px` }}
              >
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((option) => (
                    <SelectionListButton
                      key={option.id}
                      option={option}
                      onSelect={handleChooseOption}
                    />
                  ))
                ) : (
                  <div className="px-3 py-4 text-xs text-muted-foreground">
                    {emptyResultsMessage}
                  </div>
                )}
              </GlideMenu>
            </ScrollArea>
          </div>
        ) : (
          <div
            data-tour="project-devapps"
            className="flex w-full flex-col items-center justify-center overflow-hidden py-1"
          >
            <div className="mx-auto flex w-full max-w-5xl flex-none flex-col px-3 md:px-6">
              <div
                ref={launcherViewportRef}
                className="flex h-[238px] w-full flex-none flex-col overflow-hidden"
              >
                {filteredOptions.length > 0 ? (
                  <div
                    ref={launcherPagerRef}
                    className="h-full w-full flex-none overflow-x-auto overflow-y-hidden snap-x snap-mandatory scroll-smooth motion-reduce:scroll-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                                minHeight: `${2 * densityConfig.cellHeight + densityConfig.rowGap}px`,
                              }}
                            >
                              {page.map((option) => (
                                <SelectionLauncherButton
                                  key={option.id}
                                  option={option}
                                  onSelect={handleChooseOption}
                                />
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full w-full flex-none items-center justify-center px-2 py-8 text-xs text-muted-foreground">
                    {emptyResultsMessage}
                  </div>
                )}
              </div>

              <div className="flex h-7 shrink-0 items-center justify-center">
                {filteredOptions.length > 0 && pagedOptions.length > 1 ? (
                  <div className="flex items-center justify-center gap-1">
                    {pagedOptions.map((_, pageIndex) => (
                      <button
                        key={`selection-page-dot-${pageIndex}`}
                        type="button"
                        aria-label={`${t("workbench.selection.goToPage")} ${pageIndex + 1}`}
                        aria-pressed={pageIndex === currentPage}
                        className="flex size-5 items-center justify-center cursor-pointer p-0"
                        onClick={() => handlePageSelect(pageIndex)}
                      >
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full transition-all",
                            pageIndex === currentPage ? "bg-foreground scale-110" : "bg-border hover:bg-muted-foreground/50",
                          )}
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom centering spacer: smoothly expands in full-screen to center the cluster, collapses in list view */}
      <div
        className={cn(
          "transition-[flex-grow,max-height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          useListView ? "flex-grow-0 max-h-0" : "flex-grow max-h-[18vh] min-h-0",
        )}
      />
    </div>
  )
}
