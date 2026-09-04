import { useMemo, useState } from "react"
import { useConvex, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"
import { useAuth } from "@/contexts/AuthContext"
import {
  SettingsPageBody,
  SettingsPageHeader,
} from "@/features/settings/ui/SettingsChrome"
import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import { STORE_ORGANIZATION_ACCENT_CLASS } from "@/features/devapps/components/devAppStoreAccent"
import { totalInstalledDevAppBytes } from "@/features/devapps/orgDevAppInstallationCatalog"
import { useOrgDevAppInstallations } from "@/features/devapps/useOrgDevAppInstallations"
import { listStoreApps } from "@/features/devapps/registry"
import type { DevAppManifest } from "@/features/devapps/registry/types"
import { formatDevAppRef } from "@shared/devAppRef"
import { featureFlags } from "@/lib/featureFlags"
import { useTranslation } from "@/lib/i18n"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { useCreateProjectDialogStore } from "@/features/projects/model/createProjectDialogStore"
import { browseForDirectory } from "@/features/projects/lib/localProjectImport"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon as __PlusHugeIcon,
  ArrowDown01Icon as __ChevronDownHugeIcon,
  Folder01Icon as __FolderHugeIcon,
  Search01Icon as __SearchHugeIcon,
  Store01Icon as __StoreHugeIcon,
} from "@hugeicons/core-free-icons"

interface DevAppSettingsProps {
  surface?: "page" | "drawer"
  route?: string
}

type OrgDevAppRow = FunctionReturnType<typeof api.devApps.listMine>[number]

type FilterTab = "all" | "installed" | "builtin" | "assistants"

const SQUIRCLE_RATIO = 0.22265625
const ICON_SIZE_PX = 44

export function DevAppSettings({ surface = "page", route: _route }: DevAppSettingsProps) {
  const { t } = useTranslation()
  const { convexUserId } = useAuth()
  const convex = useConvex()
  const navigate = useViewTransitionNavigate()
  const openCreateProjectDialog = useCreateProjectDialogStore((state) => state.open)

  const [activeTab, setActiveTab] = useState<FilterTab>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [pendingPublicationId, setPendingPublicationId] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)

  const { installations, loading: installationsLoading } = useOrgDevAppInstallations()

  const orgScopeEnabled = featureFlags.projectDevApps && Boolean(convexUserId)
  const orgDevApps = useQuery(api.devApps.listMine, orgScopeEnabled ? {} : "skip")

  const builtinApps = useMemo(() => listStoreApps(), [])

  const installedPublicationIds = useMemo(
    () => new Set(installations.filter((i) => i.active).map((i) => i.publicationId)),
    [installations],
  )

  const installationsByPubId = useMemo(
    () => new Map(installations.map((i) => [i.publicationId, i])),
    [installations],
  )

  const counts = useMemo(() => {
    const builtinSurfacesCount = builtinApps.filter((a) => a.launcher.group === "Development").length
    const assistantsCount = builtinApps.filter((a) => a.launcher.group === "Assistant").length
    const installedCount = installations.filter((i) => i.active).length
    const totalCount = builtinApps.length + (orgDevApps?.length ?? installations.length)

    return {
      all: totalCount,
      installed: installedCount,
      builtin: builtinSurfacesCount,
      assistants: assistantsCount,
    }
  }, [builtinApps, installations, orgDevApps])

  const installRelease = async (entry: OrgDevAppRow): Promise<void> => {
    setPendingPublicationId(entry.publicationId)
    setOperationError(null)
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
      setOperationError(error instanceof Error ? error.message : t("appStore.install.failed"))
    } finally {
      setPendingPublicationId(null)
    }
  }

  const uninstallPublication = async (publicationId: string): Promise<void> => {
    setPendingPublicationId(publicationId)
    setOperationError(null)
    try {
      const result = await window.electronAPI.orgDevApp.uninstallPublication({ publicationId })
      if (!result.success) throw new Error(result.error)
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : t("appStore.uninstall.failed"))
    } finally {
      setPendingPublicationId(null)
    }
  }

  const query = searchQuery.trim().toLowerCase()

  const filteredBuiltins = useMemo(() => {
    return builtinApps.filter((app) => {
      if (activeTab === "installed") return false
      if (activeTab === "builtin" && app.launcher.group !== "Development") return false
      if (activeTab === "assistants" && app.launcher.group !== "Assistant") return false
      if (query) {
        return (
          app.name.toLowerCase().includes(query) ||
          app.description.toLowerCase().includes(query) ||
          app.store.categoryLabel.toLowerCase().includes(query)
        )
      }
      return true
    })
  }, [activeTab, builtinApps, query])

  const filteredOrgApps = useMemo(() => {
    if (activeTab === "builtin" || activeTab === "assistants") return []
    const baseList: Array<{
      publicationId: string
      name: string
      description: string
      organizationName: string
      version: number
      framework: string
      logoDataUrl?: string
      entry?: OrgDevAppRow
    }> = (orgDevApps ?? installations).map((item) => ({
      publicationId: String(item.publicationId),
      name: item.name,
      description: item.description ?? "",
      organizationName: item.organizationName,
      version: item.activeRelease.version,
      framework: item.activeRelease.framework,
      logoDataUrl: item.logoDataUrl ?? undefined,
      entry: "organizationId" in item ? (item as OrgDevAppRow) : undefined,
    }))

    return baseList.filter((app) => {
      const isInstalled = installedPublicationIds.has(app.publicationId)
      if (activeTab === "installed" && !isInstalled) return false
      if (query) {
        return (
          app.name.toLowerCase().includes(query) ||
          app.description.toLowerCase().includes(query) ||
          app.organizationName.toLowerCase().includes(query)
        )
      }
      return true
    })
  }, [activeTab, installedPublicationIds, installations, orgDevApps, query])

  const totalFilteredCount = filteredBuiltins.length + filteredOrgApps.length

  const handleBrowseStore = () => {
    navigate("/projects/store")
  }

  return (
    <SettingsPageBody surface={surface} className="space-y-6">
      <div>
        <SettingsPageHeader
          title={t("settings.devapps.title")}
          description={t("settings.devapps.description")}
          className="mb-4"
        />

        {/* Action buttons directly below title (matches Codex: Browse directory + Add) */}
        <div className="flex items-center gap-2 px-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3 text-xs font-normal"
            onClick={handleBrowseStore}
          >
            <HugeiconsIcon icon={__StoreHugeIcon} className="size-3.5" aria-hidden />
            {t("settings.devapps.browseStore")}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" className="h-8 gap-1 rounded-full px-3 text-xs font-normal">
                {t("common.add")}
                <HugeiconsIcon icon={__ChevronDownHugeIcon} className="size-3" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => openCreateProjectDialog({ mode: "devapp" })}>
                <HugeiconsIcon icon={__PlusHugeIcon} className="size-3.5" aria-hidden />
                {t("appStore.page.createNativeDevApp")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void browseForDirectory("Select existing DevApp project").then((selectedPath) => {
                    if (selectedPath?.trim()) {
                      openCreateProjectDialog({ mode: "devapp-local", localFolderPath: selectedPath })
                    }
                  })
                }}
              >
                <HugeiconsIcon icon={__FolderHugeIcon} className="size-3.5" aria-hidden />
                {t("appStore.page.openExistingDevApp")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {installations.length > 0 ? (
            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground/70">
              {t("settings.devapps.storage")
                .replace("{count}", String(installations.length))
                .replace(
                  "{size}",
                  (totalInstalledDevAppBytes(installations) / 1024 / 1024).toFixed(1),
                )}
            </span>
          ) : null}
        </div>
      </div>

      {operationError ? (
        <div
          className="flex items-center justify-between rounded-xl bg-destructive/10 px-4 py-2.5 text-xs text-destructive"
          role="alert"
        >
          <span>{operationError}</span>
          <button
            type="button"
            className="text-sm font-semibold hover:opacity-80"
            onClick={() => setOperationError(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-1">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-0.5">
          {(
            [
              { id: "all", label: t("settings.devapps.tabAll"), count: counts.all },
              { id: "installed", label: t("settings.devapps.tabInstalled"), count: counts.installed },
              { id: "builtin", label: t("settings.devapps.tabBuiltin"), count: counts.builtin },
              { id: "assistants", label: t("settings.devapps.tabAssistants"), count: counts.assistants },
            ] as const
          ).map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
                    isActive ? "text-foreground/80 font-semibold" : "text-muted-foreground/70",
                  )}
                >
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="relative w-full sm:w-56">
          <HugeiconsIcon
            icon={__SearchHugeIcon}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70"
            aria-hidden
          />
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("appStore.searchPlaceholder")}
            className="h-8 rounded-full bg-muted/60 pl-8 pr-3 text-xs"
          />
        </div>
      </div>

      {/* DevApps List */}
      <div className="space-y-1 divide-y divide-border/30 rounded-2xl border border-border/40 bg-secondary/20 p-1 dark:bg-secondary/10">
        {totalFilteredCount === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            {t("settings.devapps.noApps")}
          </div>
        ) : null}

        {/* Built-in Apps Rows */}
        {filteredBuiltins.map((app: DevAppManifest) => (
          <div
            key={app.id}
            className="flex items-center gap-3.5 rounded-xl px-4 py-3 transition-colors hover:bg-muted/40"
          >
            <div
              className={cn(
                "flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br ring-1 ring-border/60",
                app.store.accentClassName,
              )}
              style={{
                height: ICON_SIZE_PX,
                width: ICON_SIZE_PX,
                borderRadius: ICON_SIZE_PX * SQUIRCLE_RATIO,
              }}
            >
              <DevAppIcon app={app} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{app.name}</span>
                <Badge
                  variant="outline"
                  className="h-4.5 rounded-full px-1.5 text-[10px] font-normal text-muted-foreground border-border/50"
                >
                  {app.store.categoryLabel}
                </Badge>
              </div>
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/80">
                {app.description}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden text-[11px] text-muted-foreground/70 sm:inline-block">
                {t("appStore.page.badgeBuiltIn")}
              </span>
              <Switch checked={true} disabled aria-label={app.name} />
            </div>
          </div>
        ))}

        {/* Organization Apps Rows */}
        {filteredOrgApps.map((item) => {
          const isInstalled = installedPublicationIds.has(item.publicationId)
          const isPending = pendingPublicationId === item.publicationId
          const installation = installationsByPubId.get(item.publicationId)

          return (
            <div
              key={item.publicationId}
              className="flex items-center gap-3.5 rounded-xl px-4 py-3 transition-colors hover:bg-muted/40"
            >
              <div
                className={cn(
                  "flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br ring-1 ring-border/60",
                  STORE_ORGANIZATION_ACCENT_CLASS,
                )}
                style={{
                  height: ICON_SIZE_PX,
                  width: ICON_SIZE_PX,
                  borderRadius: ICON_SIZE_PX * SQUIRCLE_RATIO,
                }}
              >
                {item.logoDataUrl ? (
                  <img
                    src={item.logoDataUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="text-xs font-semibold text-foreground/80">
                    {item.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
                  <Badge
                    variant="secondary"
                    data-store-organization-accent
                    className={cn(
                      "h-4.5 shrink-0 rounded-full px-2 text-[10px] font-normal",
                      STORE_ORGANIZATION_ACCENT_CLASS,
                    )}
                  >
                    {item.organizationName}
                  </Badge>
                </div>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/80">
                  {item.description}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {installation ? (
                  <span className="text-[11px] tabular-nums text-muted-foreground/70">
                    {(installation.sizeBytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                ) : (
                  <span className="text-[11px] tabular-nums text-muted-foreground/50">
                    v{item.version}
                  </span>
                )}

                <Switch
                  checked={isInstalled}
                  disabled={isPending || installationsLoading}
                  onCheckedChange={(checked) => {
                    if (checked && item.entry) {
                      void installRelease(item.entry)
                    } else if (!checked) {
                      void uninstallPublication(item.publicationId)
                    }
                  }}
                  aria-label={item.name}
                />
              </div>
            </div>
          )
        })}
      </div>
    </SettingsPageBody>
  )
}
