
import { useMemo, useState } from "react"
import { useConvex, useQuery } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import { buildPublishedDevAppManifest } from "@/features/devapps/orgDevAppManifest"
import {
  activeInstallationsByPublication,
  isOrgDevAppUpdateAvailable,
  totalInstalledDevAppBytes,
} from "@/features/devapps/orgDevAppInstallationCatalog"
import { useOrgDevAppInstallations } from "@/features/devapps/useOrgDevAppInstallations"
import { formatDevAppRef } from "@shared/devAppRef"
import { listStoreApps } from "@/features/devapps/registry"
import { useAuth } from "@/contexts/AuthContext"
import {
  SettingsSectionDescription,
  SettingsSectionTitle,
} from "@/components/settings/SettingsChrome"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ProjectShellTitleBarCenterFromLabel } from "@/features/projects/components/ProjectShellTitleBarCenterFromLabel"
import {
  resolveAppStoreCategory,
} from "@/features/projects/lib/appStoreCatalog"
import { useProjectHeader } from "@/hooks/useProjectHeader"
import { useTranslation } from "@/lib/i18n"
import { featureFlags } from "@/lib/featureFlags"
import { useSearchParams } from "@/lib/router"
import { cn } from "@/lib/utils"
import { useCreateProjectDialogStore } from "@/stores/useCreateProjectDialogStore"
import { browseForDirectory } from "@/features/projects/lib/localProjectImport"

import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle02Icon as __CheckHugeIcon,
  Copy01Icon as __CopyHugeIcon,
  CpuChargeIcon as __ChipHugeIcon,
  FirstBracketCircleIcon as __BoltHugeIcon,
} from '@hugeicons/core-free-icons'

export function AppStorePage() {
  const { t } = useTranslation()
  const { convexUserId } = useAuth()
  const convex = useConvex()
  const [searchParams] = useSearchParams()
  const activeCategory = resolveAppStoreCategory(searchParams.get("category"))
  const query = searchParams.get("q") ?? ""
  const [copiedRef, setCopiedRef] = useState<string | null>(null)
  const [pendingPublicationId, setPendingPublicationId] = useState<string | null>(null)
  const [installationError, setInstallationError] = useState<string | null>(null)
  const { installations } = useOrgDevAppInstallations()
  const openCreateProjectDialog = useCreateProjectDialogStore((state) => state.open)
  const orgDevApps = useQuery(
    api.devApps.listMine,
    featureFlags.projectDevApps && convexUserId ? {} : "skip",
  )

  const headerCenter = useMemo(
    () => <ProjectShellTitleBarCenterFromLabel label={t('appStore.page.title')} />,
    [t],
  )

  useProjectHeader(null, headerCenter)

  const visiblePreviewApps = useMemo(() => {
    return listStoreApps({
      category: activeCategory.id,
      query,
    })
  }, [activeCategory.id, query])

  const visibleOrgDevApps = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return (orgDevApps ?? [])
      .map((entry) => ({
        entry,
        app: buildPublishedDevAppManifest(entry),
      }))
      .filter(({ app, entry }) => {
        if (activeCategory.id === "updates") {
          return isOrgDevAppUpdateAvailable(
            installations,
            entry.publicationId,
            entry.activeRelease.version,
          )
        }
        return activeCategory.id === "discover" || app.categories.includes(activeCategory.id)
      })
      .filter(({ app, entry }) => {
        if (!normalizedQuery) return true

        return [
          app.name,
          app.description,
          app.store.categoryLabel,
          entry.organizationName,
          entry.activeRelease.framework,
          `v${entry.activeRelease.version}`,
        ].some((value) => value.toLowerCase().includes(normalizedQuery))
      })
  }, [orgDevApps, activeCategory.id, installations, query])

  const activeInstallationByPublication = useMemo(
    () => activeInstallationsByPublication(installations),
    [installations],
  )

  const installRelease = async (entry: (typeof visibleOrgDevApps)[number]["entry"]): Promise<void> => {
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

  const hasResults =
    visibleOrgDevApps.length > 0 ||
    visiblePreviewApps.length > 0 ||
    installations.length > 0

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-8 px-6 pt-5 pb-8">
      <section>
        <SettingsSectionTitle>{(t as any)(`devApp.category.${activeCategory.id}`) ?? activeCategory.label}</SettingsSectionTitle>
        <SettingsSectionDescription>
          {query.trim()
            ? t('appStore.page.resultsFor').replace('{query}', query).replace('{category}', ((t as any)(`devApp.category.${activeCategory.id}`) ?? activeCategory.label).toLowerCase())
            : (t as any)(`appStore.${activeCategory.id}.desc`) || activeCategory.description}
        </SettingsSectionDescription>

        {activeCategory.id === "discover" && !query.trim() ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-secondary/25 p-3">
            <div className="min-w-0 flex-1 px-1">
              <p className="text-sm font-medium text-foreground">{t("appStore.page.buildNativeDevApp")}</p>
              <p className="text-xs text-muted-foreground">
                {t("appStore.page.buildNativeDevAppDesc")}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="rounded-full"
              onClick={() => openCreateProjectDialog({ mode: "devapp" })}
            >
              {t("appStore.page.createNativeDevApp")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => {
                void browseForDirectory("Select existing DevApp project").then((selectedPath) => {
                  if (selectedPath?.trim()) {
                    openCreateProjectDialog({ mode: "devapp-local", localFolderPath: selectedPath })
                  }
                })
              }}
            >
              {t("appStore.page.openExistingDevApp")}
            </Button>
          </div>
        ) : null}

        {activeCategory.id === "discover" && !query.trim() ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-[0.85fr_2fr]">
            <div className="relative overflow-hidden rounded-[28px] bg-[#24263b] p-7 text-white">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_65%)]" />
              <div className="relative z-10 flex h-full min-h-[16rem] flex-col justify-between gap-8">
                <div className="space-y-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/65">
                    {t("appStore.page.openingSoon")}
                  </p>
                  <div className="space-y-2">
                    <h1 className="max-w-[14rem] text-[28px] font-medium leading-[1.05] tracking-[-0.03em]">
                      {t(`appStore.${activeCategory.id}.heroTitle` as any) || activeCategory.heroTitle}
                    </h1>
                    <p className="max-w-[15rem] text-sm leading-6 text-white/72">
                      {t(`appStore.${activeCategory.id}.heroDesc` as any) || activeCategory.heroDescription}
                    </p>
                  </div>
                </div>

                <div className="inline-flex w-fit items-center rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs text-white/80 backdrop-blur-sm">
                  {t("appStore.page.storefrontPreview")}
                </div>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#4f5cf5_0%,#7b66ff_28%,#e86aa6_68%,#f4b35d_100%)] p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.28),transparent_28%),radial-gradient(circle_at_82%_15%,rgba(255,255,255,0.2),transparent_18%),linear-gradient(180deg,rgba(255,255,255,0.06),transparent_75%)]" />
              <div className="absolute -left-5 top-10 h-28 w-28 rounded-[32px] bg-white/18 blur-[1px]" />
              <div className="absolute left-[21%] top-7 h-16 w-16 rotate-12 rounded-[20px] bg-[#7dd3fc]/55" />
              <div className="absolute left-[33%] top-[48%] h-20 w-20 -rotate-12 rounded-[24px] bg-[#fde68a]/45" />
              <div className="absolute right-[16%] top-11 h-24 w-24 rounded-full bg-white/24" />
              <div className="absolute right-[10%] top-[46%] h-16 w-16 rotate-12 rounded-[20px] bg-[#34d399]/45" />
              <div className="absolute right-10 bottom-10 h-[15.5rem] w-[11rem] rounded-[42px] bg-[linear-gradient(180deg,rgba(255,255,255,0.85),rgba(255,255,255,0.18))]" />
              <div className="absolute right-[14.5rem] bottom-12 h-[13rem] w-[8.5rem] -rotate-[8deg] rounded-[34px] bg-[linear-gradient(180deg,rgba(22,24,39,0.92),rgba(22,24,39,0.42))]" />
              <div className="absolute right-[5.75rem] bottom-[6.5rem] h-[6.5rem] w-[10.5rem] skew-x-[-28deg] rounded-[14px] bg-[linear-gradient(120deg,#1d1d25,#f97316)] opacity-90" />

              <div className="relative z-10 flex min-h-[16rem] items-end">
                <div className="max-w-[22rem] space-y-3 text-white">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
                    {activeCategory.heroEyebrow}
                  </p>
                  <div className="space-y-2">
                    <h2 className="text-[34px] font-medium leading-[0.98] tracking-[-0.04em]">
                      {t('appStore.page.heroTitle')}
                    </h2>
                    <p className="text-sm leading-6 text-white/80">
                      {t('appStore.page.heroDesc')}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {installationError ? (
        <div className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {installationError}
        </div>
      ) : null}

      {hasResults ? (
        <>
          {visibleOrgDevApps.length > 0 ? (
            <section className="space-y-4">
              <div className="flex items-end justify-between gap-4 px-1">
                <div className="space-y-1">
                  <h2 className="text-xl font-medium tracking-[-0.03em] text-foreground">
                    {t("appStore.page.privateDevApps")}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t("appStore.page.privateDevAppsDesc")}
                  </p>
                </div>
                <span
                  data-store-organization-accent
                  className="shrink-0 rounded-full bg-[var(--store-organization-accent-surface)] px-3 py-1 text-xs text-[var(--store-organization-accent)]"
                >
                  {visibleOrgDevApps.length}{" "}
                  {visibleOrgDevApps.length === 1
                    ? t("appStore.page.release")
                    : t("appStore.page.releases")}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleOrgDevApps.map(({ app, entry }) => {
                  const ref = formatDevAppRef({
                    kind: "publication",
                    organizationId: entry.organizationId,
                    publicationId: entry.publicationId,
                    version: "latest",
                  })
                  const installed = activeInstallationByPublication.get(entry.publicationId)
                  const isCurrent = installed?.activeRelease.version === entry.activeRelease.version
                  const isPending = pendingPublicationId === entry.publicationId
                  return (
                    <article
                      key={app.id}
                      className="flex min-h-36 flex-col rounded-[22px] bg-background px-4 py-4"
                    >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br",
                          app.store.accentClassName,
                        )}
                        style={{ borderRadius: 48 * 0.22265625 }}
                      >
                        <DevAppIcon app={app} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <h3 className="truncate text-sm font-medium text-foreground">
                                {app.name}
                              </h3>
                              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                                V{entry.activeRelease.version}
                              </span>
                            </div>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {entry.organizationName}
                            </p>
                          </div>
                          <Badge
                            variant="secondary"
                            data-store-organization-accent
                            className="h-6 rounded-full bg-[var(--store-organization-accent-surface)] px-2.5 text-[11px] font-normal text-[var(--store-organization-accent)]"
                          >
                            {t("appStore.page.privateBadge")}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
                      {app.description}
                    </p>
                    <div className="mt-auto flex min-w-0 items-center gap-2 pt-3">
                      <code className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                        {ref}
                      </code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        title={t("appStore.page.copyReference")}
                        aria-label={t("appStore.page.copyReference")}
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(ref)
                            .then(() => {
                              setCopiedRef(ref)
                              window.setTimeout(() => {
                                setCopiedRef((current) => (current === ref ? null : current))
                              }, 1_500)
                            })
                            .catch(() => undefined)
                        }}
                      >
                        <HugeiconsIcon
                          icon={copiedRef === ref ? __CheckHugeIcon : __CopyHugeIcon}
                          className="size-3.5"
                          aria-hidden
                        />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={installed ? "outline" : "default"}
                        className="rounded-full"
                        disabled={isPending}
                        onClick={() => {
                          if (isCurrent) void uninstallPublication(entry.publicationId)
                          else void installRelease(entry)
                        }}
                      >
                        {isPending
                          ? t("appStore.install.working")
                          : isCurrent
                            ? t("appStore.install.uninstall")
                            : installed
                              ? t("appStore.install.update")
                              : t("appStore.install.install")}
                      </Button>
                    </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}

          {visiblePreviewApps.length > 0 ? <section className="space-y-4">
            <div className="px-1">
              <div className="space-y-1">
                <h2 className="text-xl font-medium tracking-[-0.03em] text-foreground">
                  {t('appStore.page.builtIn')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('appStore.page.builtInDesc')}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visiblePreviewApps.map((app) => {
                return (
                  <div
                    key={app.id}
                    className="flex items-start gap-4 rounded-[22px] bg-background px-4 py-4"
                  >
                    <div
                      className={cn(
                        "flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br",
                        app.store.accentClassName,
                      )}
                      style={{ borderRadius: 56 * 0.22265625 }}
                    >
                      <DevAppIcon app={app} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {app.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{(t as any)(`devApp.category.${app.store.categoryLabel}`) ?? app.store.categoryLabel}</p>
                        </div>
                        <Badge
                          variant="secondary"
                          className="h-6 rounded-full bg-muted px-2.5 text-[11px] font-normal text-muted-foreground"
                        >
                          {app.store.badgeLabel === "Built in" ? t('appStore.page.badgeBuiltIn') : app.store.badgeLabel}
                        </Badge>
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">{app.description}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section> : null}

          {installations.length > 0 ? (
            <section className="space-y-4">
              <div className="flex items-end justify-between gap-4 px-1">
                <div className="space-y-1">
                  <h2 className="text-xl font-medium tracking-[-0.03em] text-foreground">
                    {t("appStore.install.storageTitle")}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t("appStore.install.storageDescription")}
                  </p>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {(totalInstalledDevAppBytes(installations) / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
              <div className="divide-y divide-border/60 rounded-[22px] bg-background px-4">
                {installations.map((installation) => (
                  <div key={installation.ref} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{installation.name}</p>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          V{installation.activeRelease.version}{installation.active ? ` · ${t("appStore.install.active")}` : ""}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{installation.ref}</p>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {(installation.sizeBytes / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pendingPublicationId === installation.publicationId}
                      onClick={() => {
                        setPendingPublicationId(installation.publicationId)
                        void window.electronAPI.orgDevApp.removeInstalledVersion({ ref: installation.ref })
                          .then((result) => {
                            if (!result.success) setInstallationError(result.error)
                          })
                          .finally(() => setPendingPublicationId(null))
                      }}
                    >
                      {t("appStore.install.removeVersion")}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <section className="overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,rgba(120,119,198,0.08),rgba(255,255,255,0.02))]">
          <div className="grid gap-6 p-7 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t('appStore.page.noMatchesEyebrow')}
              </p>
              <div className="space-y-2">
                <h2 className="text-[30px] font-medium leading-[1.02] tracking-[-0.04em] text-foreground">
                  {t('appStore.page.noMatchesTitle').replace('{query}', query)}
                </h2>
                <p className="max-w-[38rem] text-sm leading-6 text-muted-foreground">
                  {t('appStore.page.noMatchesDesc')}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[20px] bg-background/80 p-4">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-foreground">
                  <HugeiconsIcon icon={__BoltHugeIcon} className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium text-foreground">{t('appStore.page.curatedColls')}</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  {t('appStore.page.curatedCollsDesc')}
                </p>
              </div>
              <div className="rounded-[20px] bg-background/80 p-4">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-foreground">
                  <HugeiconsIcon icon={__ChipHugeIcon} className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium text-foreground">{t('appStore.page.devTools')}</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  {t('appStore.page.devToolsDesc')}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
