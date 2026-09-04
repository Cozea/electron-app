import { useMemo, useState } from "react"
import { useConvex, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"
import { useAuth } from "@/contexts/AuthContext"
import {
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
} from "@/features/settings/ui/SettingsChrome"
import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import { STORE_ORGANIZATION_ACCENT_CLASS } from "@/features/devapps/components/devAppStoreAccent"
import { useOrgDevAppInstallations } from "@/features/devapps/useOrgDevAppInstallations"
import { listStoreApps } from "@/features/devapps/registry"
import type { DevAppManifest } from "@/features/devapps/registry/types"
import { formatDevAppRef } from "@shared/devAppRef"
import { featureFlags } from "@/lib/featureFlags"
import { useTranslation } from "@/lib/i18n"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { useCreateProjectDialogStore } from "@/lib/createProjectDialogStore"
import { browseForDirectory } from "@/lib/browseForDirectory"
import { useProjectHeader } from "@/lib/useProjectHeader"
import type { ContextMenuItem } from "@shared/assistant-contracts/ipc"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { getNativeMenuIcon } from "@/lib/nativeMenuIcons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
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

function formatDevAppSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "0 KB"
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  const kb = bytes / 1024
  if (kb < 10) {
    return `${kb.toFixed(1)} KB`
  }
  return `${Math.round(kb)} KB`
}

function formatDevAppDate(timestamp?: number | null): string | null {
  if (!timestamp || Number.isNaN(timestamp) || timestamp <= 0) return null
  try {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return null
  }
}

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

  const headerActions = useMemo(() => {
    return (
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 rounded-full px-3 text-xs font-normal"
          onClick={handleBrowseStore}
        >
          <HugeiconsIcon icon={__StoreHugeIcon} className="size-3.5" aria-hidden />
          {t("settings.devapps.browseStore")}
        </Button>

        <Button
          type="button"
          size="sm"
          className="h-7 gap-1 rounded-full px-3 text-xs font-normal"
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
          {t("common.add")}
          <HugeiconsIcon icon={__ChevronDownHugeIcon} className="size-3" aria-hidden />
        </Button>
      </div>
    )
  }, [handleBrowseStore, openCreateProjectDialog, t])

  useProjectHeader(null, null, {
    rightAddon: surface === "page" ? headerActions : null,
    hideShare: true,
  })

  return (
    <SettingsPageBody surface={surface} className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-4 mb-4">
          <SettingsPageHeader
            title={t("settings.devapps.title")}
            description={t("settings.devapps.description")}
            className="mb-0"
          />
          {surface === "drawer" ? (
            <div className="flex shrink-0 items-center gap-2 pt-1">{headerActions}</div>
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

      {/* Sticky Filter Tabs & Search Bar */}
      <div
        className={cn(
          "sticky z-20 bg-background/95 pt-3 pb-2.5 backdrop-blur-md",
          surface === "drawer" ? "top-[-1.75rem] -mx-8 px-8" : "top-[-1.5rem] -mx-8 sm:-mx-10 px-8 sm:px-10",
        )}
      >
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
              className="h-8 rounded-search bg-muted/60 pl-8 pr-3 text-xs"
            />
          </div>
        </div>

        {/* Soft edge fade right under the sticky filter/search bar matching DevStore */}
        <div
          className="pointer-events-none absolute -bottom-4 left-0 right-0 h-4 bg-gradient-to-b from-background/95 via-background/60 to-transparent"
          aria-hidden
        />
      </div>

      {/* DevApps List */}
      <SettingsGroup className="mt-1">
        {totalFilteredCount === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            {t("settings.devapps.noApps")}
          </div>
        ) : null}

        {/* Built-in Apps Rows */}
        {filteredBuiltins.map((app: DevAppManifest) => (
          <div
            key={app.id}
            className="flex min-h-[58px] items-center gap-3.5 px-5 py-3 transition-colors hover:bg-muted/30 dark:hover:bg-white/[0.02]"
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
              <span className="block truncate text-sm font-medium text-foreground">{app.name}</span>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground/70">
                <span>~60 KB</span>
                <span aria-hidden className="text-muted-foreground/40">·</span>
                <span>v0.2.2</span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
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
              className="flex min-h-[58px] items-center gap-3.5 px-5 py-3 transition-colors hover:bg-muted/30 dark:hover:bg-white/[0.02]"
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
                <span className="block truncate text-sm font-medium text-foreground">{item.name}</span>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground/70">
                  <span>{item.organizationName}</span>
                  <span aria-hidden className="text-muted-foreground/40">·</span>
                  {installation ? (
                    <>
                      <span>{formatDevAppSize(installation.sizeBytes)}</span>
                      <span aria-hidden className="text-muted-foreground/40">·</span>
                      <span>v{installation.activeRelease.version}</span>
                      {installation.installedAt ? (
                        <>
                          <span aria-hidden className="text-muted-foreground/40">·</span>
                          <span>Installed {formatDevAppDate(installation.installedAt)}</span>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span>v{item.version}</span>
                      <span aria-hidden className="text-muted-foreground/40">·</span>
                      <span>Not installed</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
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
      </SettingsGroup>

      {/* Soft edge fade right at the bottom of the screen matching assistant and store fade */}
      <div
        className={cn(
          "pointer-events-none sticky h-8 bg-gradient-to-t from-background via-background/70 to-transparent z-10 -mt-8",
          surface === "drawer" ? "bottom-[-1.75rem] -mx-8" : "bottom-[-3rem] -mx-8 sm:-mx-10",
        )}
        aria-hidden
      />
    </SettingsPageBody>
  )
}
