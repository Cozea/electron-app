import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useConvex, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "../../../../../../convex/_generated/api"
import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import { DevAppStoreRow } from "@/features/devapps/components/DevAppStoreRow"
import { STORE_ORGANIZATION_ACCENT_CLASS } from "@/features/devapps/components/devAppStoreAccent"
import { useOrgDevAppInstallations } from "@/features/devapps/useOrgDevAppInstallations"
import { formatDevAppRef } from "@shared/devAppRef"
import { listStoreApps } from "@/features/devapps/registry"
import { useAuth } from "@/contexts/AuthContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { ContextMenuItem } from "@shared/assistant-contracts/ipc"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { getNativeMenuIcon } from "@/lib/nativeMenuIcons"
import {
  buildAppStoreSections,
  buildInstalledRail,
  countAppStoreMatches,
  resolveAppStoreScope,
  type AppStoreItem,
  type AppStoreScope,
  type AppStoreSectionId,
} from "@/features/devapps/model/appStoreSections"
import { useProjectHeader } from "@/lib/useProjectHeader"
import { useTranslation } from "@/lib/i18n"
import { featureFlags } from "@/lib/featureFlags"
import { useSearchParams } from "@/lib/router"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import { useCreateProjectDialogStore } from "@/lib/createProjectDialogStore"
import { browseForDirectory } from "@/lib/browseForDirectory"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon as __PlusHugeIcon,
  ArrowDown01Icon as __ChevronDownHugeIcon,
  Delete02Icon as __DeleteHugeIcon,
  MoreHorizontalIcon as __MoreHorizontalHugeIcon,
  Refresh01Icon as __RefreshHugeIcon,
  Search01Icon as __SearchHugeIcon,
  Settings01Icon as __SettingsHugeIcon,
} from "@hugeicons/core-free-icons"

/** The Convex row, whose branded ids the install handlers need. */
type OrgDevAppRow = FunctionReturnType<typeof api.devApps.listMine>[number]

const RAIL_ICON_SIZE_PX = 44
const SQUIRCLE_RATIO = 0.22265625
const HIGHLIGHT_DURATION_MS = 1_400

const SECTION_LABEL_KEYS = {
  popular: "appStore.section.popular",
  assistants: "appStore.section.assistants",
  updates: "appStore.section.updates",
  all: "appStore.section.all",
  results: "appStore.section.results",
} as const satisfies Record<AppStoreSectionId, string>

export function AppStorePage() {
  const { t } = useTranslation()
  const { convexUserId } = useAuth()
  const convex = useConvex()
  const navigate = useViewTransitionNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const routeQuery = searchParams.get("q") ?? ""
  const [query, setQuery] = useState(routeQuery)
  useEffect(() => setQuery(routeQuery), [routeQuery])
  const scope = resolveAppStoreScope(searchParams.get("scope"))

  const [pendingPublicationId, setPendingPublicationId] = useState<string | null>(null)
  const [installationError, setInstallationError] = useState<string | null>(null)
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const highlightTimer = useRef<number | null>(null)

  const { installations, loading: installationsLoading, error: installationsError, refresh } = useOrgDevAppInstallations()
  const openCreateProjectDialog = useCreateProjectDialogStore((state) => state.open)

  const orgScopeEnabled = featureFlags.projectDevApps && Boolean(convexUserId)
  const orgDevApps = useQuery(api.devApps.listMine, orgScopeEnabled ? {} : "skip")

  // The registry owns built-in matching, so search stays consistent with the
  // workbench launcher.
  const builtinApps = useMemo(() => listStoreApps({ query }), [query])

  const sectionInput = useMemo(
    () => ({ query, builtinApps, orgApps: orgDevApps, installations }),
    [query, builtinApps, orgDevApps, installations],
  )
  const sections = useMemo(
    () => buildAppStoreSections({ scope, ...sectionInput }),
    [scope, sectionInput],
  )
  const matchCounts = useMemo(() => countAppStoreMatches(sectionInput), [sectionInput])
  const rail = useMemo(() => buildInstalledRail(listStoreApps(), installations), [installations])

  const setParam = useCallback(
    (key: string, value: string | null, options?: { replace?: boolean }) => {
      if (key === "q") setQuery(value ?? "")
      const next = new URLSearchParams(searchParams)
      if (value) next.set(key, value)
      else next.delete(key)
      setSearchParams(next, options)
    },
    [searchParams, setSearchParams],
  )

  /**
   * The rail cannot launch anything here — this route has no project, lane or
   * workspace — so it indexes the list instead: jump to the row and flag it.
   */
  const revealApp = useCallback(
    (key: string, targetScope: AppStoreScope) => {
      if (targetScope !== scope) setParam("scope", targetScope === "builtin" ? null : targetScope)
      setHighlightedKey(key)
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
      highlightTimer.current = window.setTimeout(() => {
        setHighlightedKey((current) => (current === key ? null : current))
      }, HIGHLIGHT_DURATION_MS)
      window.requestAnimationFrame(() => {
        rowRefs.current.get(key)?.scrollIntoView({ block: "center", behavior: "smooth" })
      })
    },
    [scope, setParam],
  )

  const installRelease = async (entry: OrgDevAppRow): Promise<void> => {
    setPendingPublicationId(entry.publicationId)
    setInstallationError(null)
    try {
      const ref = formatDevAppRef({
        kind: "publication",
        organizationId: entry.organizationId,
        publicationId: entry.publicationId,
        version: entry.activeRelease.version,
      })
      const artifact = await convex.query(api.devApps.getArtifactUrl, { ref })
      if (!artifact) throw new Error(t("appStore.install.accessLost"))
      const result = await window.electronAPI.orgDevApp.install({
        downloadUrl: artifact.url,
        installation: {
          ref,
          publicationId: entry.publicationId,
          organizationId: entry.organizationId,
          organizationName: entry.organizationName,
          name: entry.name,
          description: entry.description,
          logoDataUrl: entry.logoDataUrl,
          activeRelease: entry.activeRelease,
        },
      })
      if (!result.success) throw new Error(result.error)
    } catch (error) {
      setInstallationError(error instanceof Error ? error.message : t("appStore.install.failed"))
    } finally {
      setPendingPublicationId(null)
    }
  }

  const uninstallPublication = async (publicationId: string): Promise<void> => {
    setPendingPublicationId(publicationId)
    setInstallationError(null)
    try {
      const result = await window.electronAPI.orgDevApp.uninstallPublication({ publicationId })
      if (!result.success) throw new Error(result.error)
    } catch (error) {
      setInstallationError(error instanceof Error ? error.message : t("appStore.uninstall.failed"))
    } finally {
      setPendingPublicationId(null)
    }
  }

  const copyRef = (ref: string) => {
    void navigator.clipboard.writeText(ref).catch(() => undefined)
  }

  const handleRefresh = () => {
    setRefreshing(true)
    void refresh().finally(() => setRefreshing(false))
  }

  const renderItem = (item: AppStoreItem<OrgDevAppRow>) => {
    const highlighted = highlightedKey === item.key
    const registerRow = (node: HTMLDivElement | null) => {
      if (node) rowRefs.current.set(item.key, node)
      else rowRefs.current.delete(item.key)
    }

    if (item.kind === "builtin") {
      return (
        <div key={item.key} ref={registerRow}>
          <DevAppStoreRow
            app={item.app}
            meta={item.app.store.categoryLabel}
            highlighted={highlighted}
            action={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label={t("common.manage")}
                onClick={async (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  const rect = event.currentTarget.getBoundingClientRect()
                  const position = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }
                  const items: ContextMenuItem<string>[] = [
                    {
                      id: "manage",
                      label: t("common.manage"),
                      icon: getNativeMenuIcon("settings"),
                    },
                  ]
                  const action = await showDesktopContextMenu(items, position)
                  if (action === "manage") {
                    navigate("/projects/settings/devapps")
                  }
                }}
              >
                <HugeiconsIcon icon={__MoreHorizontalHugeIcon} className="size-4" aria-hidden />
              </Button>
            }
          />
        </div>
      )
    }

    const { entry, installState } = item
    const latestRef = formatDevAppRef({
      kind: "publication",
      organizationId: entry.organizationId,
      publicationId: entry.publicationId,
      version: "latest",
    })
    const isPending = pendingPublicationId === entry.publicationId

    const handleOrgMenu = async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      const position = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }
      const items: ContextMenuItem<string>[] = [
        {
          id: "manage",
          label: t("common.manage"),
          icon: getNativeMenuIcon("settings"),
        },
        {
          id: "copyRef",
          label: t("appStore.page.copyReference"),
          icon: getNativeMenuIcon("copy"),
        },
        {
          id: "separator",
          type: "separator",
        },
        {
          id: "uninstall",
          label: t("appStore.install.uninstall"),
          destructive: true,
          icon: getNativeMenuIcon("delete"),
        },
      ]
      const action = await showDesktopContextMenu(items, position)
      if (action === "manage") {
        navigate("/projects/settings/devapps")
      } else if (action === "copyRef") {
        copyRef(latestRef)
      } else if (action === "uninstall") {
        void uninstallPublication(entry.publicationId)
      }
    }

    return (
      <div key={item.key} ref={registerRow}>
        <DevAppStoreRow
          app={item.app}
          meta={`v${entry.activeRelease.version} · ${entry.activeRelease.framework}`}
          highlighted={highlighted}
          badge={
            <Badge
              variant="secondary"
              data-store-organization-accent
              className={cn(
                "h-5 shrink-0 rounded-full px-2 text-[10px] font-normal",
                STORE_ORGANIZATION_ACCENT_CLASS,
              )}
            >
              {entry.organizationName}
            </Badge>
          }
          action={
            installationsLoading ? (
              <Skeleton className="size-7 rounded-full" />
            ) : installState === "installed" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label="Options"
                disabled={isPending}
                onClick={handleOrgMenu}
              >
                <HugeiconsIcon icon={__MoreHorizontalHugeIcon} className="size-4" aria-hidden />
              </Button>
            ) : installState === "update" ? (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full px-2.5 text-xs font-normal"
                  disabled={isPending}
                  onClick={() => void installRelease(entry)}
                >
                  {isPending ? t("appStore.install.working") : t("appStore.install.update")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  aria-label="Options"
                  disabled={isPending}
                  onClick={handleOrgMenu}
                >
                  <HugeiconsIcon icon={__MoreHorizontalHugeIcon} className="size-4" aria-hidden />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-7 text-muted-foreground hover:text-foreground"
                disabled={isPending}
                aria-label={t("appStore.install.install")}
                onClick={() => void installRelease(entry)}
              >
                {isPending ? (
                  <HugeiconsIcon icon={__RefreshHugeIcon} className="size-4 animate-spin" aria-hidden />
                ) : (
                  <HugeiconsIcon icon={__PlusHugeIcon} className="size-4" aria-hidden />
                )}
              </Button>
            )
          }
        />
      </div>
    )
  }

  /**
   * Pinned to the title bar rather than the page body, and the share control
   * is dropped: this route has no project to share.
   */
  const headerActions = useMemo(
    () => (
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("appStore.page.refresh")}
              disabled={refreshing}
              onClick={handleRefresh}
            >
              <HugeiconsIcon
                icon={__RefreshHugeIcon}
                className={cn("size-4", refreshing && "animate-spin")}
                aria-hidden
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("appStore.page.refresh")}</TooltipContent>
        </Tooltip>

        {orgScopeEnabled ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("appStore.page.orgSettings")}
                onClick={() => navigate("/projects/settings/organizations?tab=devApps")}
              >
                <HugeiconsIcon icon={__SettingsHugeIcon} className="size-4" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("appStore.page.orgSettings")}</TooltipContent>
          </Tooltip>
        ) : null}

        <Button
          type="button"
          size="sm"
          className="gap-1 rounded-full"
          onClick={async (event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const position = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }
            const items: ContextMenuItem<string>[] = [
              {
                id: "create",
                label: t("appStore.page.createNativeDevApp"),
                icon: getNativeMenuIcon("plus"),
              },
              {
                id: "open",
                label: t("appStore.page.openExistingDevApp"),
                icon: getNativeMenuIcon("open-folder"),
              },
            ]
            const action = await showDesktopContextMenu(items, position)
            if (action === "create") {
              openCreateProjectDialog({ mode: "devapp" })
            } else if (action === "open") {
              void browseForDirectory("Select existing DevApp project").then((selectedPath) => {
                if (selectedPath?.trim()) {
                  openCreateProjectDialog({ mode: "devapp-local", localFolderPath: selectedPath })
                }
              })
            }
          }}
        >
          <HugeiconsIcon icon={__PlusHugeIcon} className="size-3.5" aria-hidden />
          {t("appStore.page.newDevApp")}
          <HugeiconsIcon icon={__ChevronDownHugeIcon} className="size-3.5" aria-hidden />
        </Button>
      </div>
    ),
    [
      handleRefresh,
      navigate,
      openCreateProjectDialog,
      orgScopeEnabled,
      refreshing,
      t,
    ],
  )

  useProjectHeader(null, null, { rightAddon: headerActions, hideShare: true })

  const orgLoading = orgScopeEnabled && orgDevApps === undefined
  const showEmptyState = sections.length === 0 && !orgLoading

  return (
    <div className="mx-auto w-full max-w-[960px] space-y-6 px-6 pt-4 pb-10">
      {installationError || installationsError ? (
        <div
          className="flex items-center gap-3 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <span className="min-w-0 flex-1">{installationError ?? installationsError}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss"
            onClick={() => setInstallationError(null)}
          >
            ×
          </Button>
        </div>
      ) : null}

      <header className="space-y-1">
        <h1 className="text-[26px] leading-tight font-medium tracking-[-0.03em] text-foreground">
          {t("appStore.page.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("appStore.page.subtitle")}</p>
      </header>

      <div className="sticky top-[-1rem] z-20 -mx-6 bg-background/95 px-6 pt-3 pb-2 backdrop-blur-md">
        <div className="relative">
          <HugeiconsIcon
            icon={__SearchHugeIcon}
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onBlur={() => setParam("q", query.trim() ? query : null, { replace: true })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setParam("q", query.trim() ? query : null, { replace: true })
            }}
            placeholder={t("appStore.searchPlaceholder")}
            className="h-11 rounded-search bg-muted pl-9 text-sm"
          />
        </div>
        {/* Soft edge fade right under the search bar matching assistant fade */}
        <div
          className="pointer-events-none absolute -bottom-4 left-0 right-0 h-4 bg-gradient-to-b from-background/95 via-background/60 to-transparent"
          aria-hidden
        />
      </div>

      {rail.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-[13px] font-medium text-foreground">
              {t("appStore.section.installed")}
            </h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("appStore.page.manageDevApps")}
                  onClick={() => navigate("/projects/settings/devapps")}
                >
                  <HugeiconsIcon icon={__SettingsHugeIcon} className="size-3.5" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("appStore.page.manageDevApps")}</TooltipContent>
            </Tooltip>
          </div>

          <TooltipProvider delay={100} closeDelay={80}>
            <div className="flex flex-wrap items-center gap-2">
              {rail.map((item) => (
                <Tooltip key={`${item.kind}:${item.key}`}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={item.name}
                      onClick={() => revealApp(item.key, item.scope)}
                      className={cn(
                        "flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br ring-1 ring-border/50 shadow-[0_2px_8px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.45)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.18)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.55)] transition-all hover:scale-105",
                        item.app.store.accentClassName,
                      )}
                      style={{
                        height: RAIL_ICON_SIZE_PX,
                        width: RAIL_ICON_SIZE_PX,
                        borderRadius: RAIL_ICON_SIZE_PX * SQUIRCLE_RATIO,
                      }}
                    >
                      <DevAppIcon app={item.app} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={5}
                    className="pointer-events-none rounded-md border border-border/50 bg-popover/95 px-1.5 py-0.5 text-[11px] font-medium leading-none text-popover-foreground shadow-sm backdrop-blur-sm"
                  >
                    {item.name}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>
        </section>
      ) : null}

      {orgScopeEnabled ? (
        <div className="flex items-end border-b border-border/60">
          {(["builtin", "organization"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setParam("scope", tab === "builtin" ? null : tab)}
              className={cn(
                "relative inline-flex items-center gap-1.5 px-3 pt-1.5 pb-2.5 text-[13px] font-medium transition-colors",
                scope === tab
                  ? "text-foreground after:absolute after:right-0 after:-bottom-px after:left-0 after:h-0.5 after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab === "builtin"
                ? t("appStore.page.badgeBuiltIn")
                : t("appStore.page.privateDevApps")}
              {query.trim() && scope !== tab && matchCounts[tab] > 0 ? (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {matchCounts[tab]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {orgLoading && scope === "organization" ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3 px-2 py-2.5">
              <Skeleton className="size-10 rounded-[9px]" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {sections.map((section) => (
        <section key={section.id} className="space-y-1">
          <h2 className="px-2 text-[13px] font-medium text-foreground">
            {t(SECTION_LABEL_KEYS[section.id])}
          </h2>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {section.items.map(renderItem)}
          </div>
        </section>
      ))}

      {showEmptyState ? (
        <Empty>
          <EmptyTitle>
            {query.trim()
              ? t("appStore.page.noResultsTitle").replace("{query}", query)
              : t("appStore.page.noOrgAppsTitle")}
          </EmptyTitle>
          <EmptyDescription>
            {query.trim() ? null : t("appStore.page.noOrgAppsDesc")}
          </EmptyDescription>
          <EmptyContent>
            {query.trim() ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setParam("q", null)}
                >
                  {t("appStore.page.clearSearch")}
                </Button>
                {matchCounts[scope === "builtin" ? "organization" : "builtin"] > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setParam("scope", scope === "builtin" ? "organization" : null)}
                  >
                    {t("appStore.page.searchOtherScope").replace(
                      "{count}",
                      String(matchCounts[scope === "builtin" ? "organization" : "builtin"]),
                    )}
                  </Button>
                ) : null}
              </div>
            ) : orgScopeEnabled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate("/projects/settings/organizations?tab=devApps")}
              >
                {t("appStore.page.orgSettings")}
              </Button>
            ) : null}
          </EmptyContent>
        </Empty>
      ) : null}

      {/* Soft edge fade right at the bottom of the screen matching assistant fade */}
      <div
        className="pointer-events-none sticky bottom-[-1rem] -mx-6 -mt-8 h-8 bg-gradient-to-t from-background via-background/70 to-transparent z-10"
        aria-hidden
      />
    </div>
  )
}
