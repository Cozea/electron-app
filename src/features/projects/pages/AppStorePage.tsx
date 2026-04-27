
import { useMemo } from "react"

import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import { listStoreApps } from "@/features/devapps/registry"
import {
  SettingsSectionDescription,
  SettingsSectionTitle,
} from "@/components/settings/SettingsChrome"
import { ProjectShellTitleBarCenterFromLabel } from "@/features/projects/components/ProjectShellTitleBarCenterFromLabel"
import {
  APP_STORE_FEATURE_CARDS,
  resolveAppStoreCategory,
} from "@/features/projects/lib/appStoreCatalog"
import { useProjectHeader } from "@/hooks/useProjectHeader"
import { useTranslation } from "@/lib/i18n"
import { useSearchParams } from "@/lib/router"
import { cn } from "@/lib/utils"

import { HugeiconsIcon } from '@hugeicons/react'
import { CpuChargeIcon as __ChipHugeIcon, FirstBracketCircleIcon as __BoltHugeIcon } from '@hugeicons/core-free-icons'

export function AppStorePage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const activeCategory = resolveAppStoreCategory(searchParams.get("category"))
  const query = searchParams.get("q") ?? ""

  const headerCenter = useMemo(
    () => <ProjectShellTitleBarCenterFromLabel label={t('appStore.page.title')} />,
    [t],
  )

  useProjectHeader(null, headerCenter)

  const visibleFeatureCards = useMemo(() => {
    const cards = APP_STORE_FEATURE_CARDS.filter(
      (card) =>
        activeCategory.id === "discover" || card.categories.includes(activeCategory.id),
    ).filter((card) => {
      if (!query.trim()) return true
      const normalizedQuery = query.trim().toLowerCase()
      return [card.eyebrow, card.title, card.description].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      )
    })

    return activeCategory.id === "discover" ? cards.slice(0, 3) : cards.slice(0, 3)
  }, [activeCategory.id, query])

  const visiblePreviewApps = useMemo(() => {
    const apps = listStoreApps({
      category: activeCategory.id,
      query,
    })

    return activeCategory.id === "discover" ? apps.slice(0, 6) : apps.slice(0, 6)
  }, [activeCategory.id, query])

  const hasResults = visibleFeatureCards.length > 0 || visiblePreviewApps.length > 0

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-8 px-6 pt-5 pb-8">
      <section>
        <SettingsSectionTitle>{(t as any)(`devApp.category.${activeCategory.id}`) ?? activeCategory.label}</SettingsSectionTitle>
        <SettingsSectionDescription>
          {query.trim()
            ? t('appStore.page.resultsFor').replace('{query}', query).replace('{category}', ((t as any)(`devApp.category.${activeCategory.id}`) ?? activeCategory.label).toLowerCase())
            : (t as any)(`appStore.${activeCategory.id}.desc`) || activeCategory.description}
        </SettingsSectionDescription>

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
      </section>

      {hasResults ? (
        <>
          <section className="space-y-3">
            <div className="grid gap-4 lg:grid-cols-3">
              {visibleFeatureCards.map((card, i) => {
                const Icon = card.icon
                return (
                  <div
                    key={t(`appStore.discover.card${i + 1}Title` as any) || card.title}
                    className="relative overflow-hidden rounded-[24px] bg-muted/70 p-5"
                  >
                    <div
                      className={cn(
                        "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-100",
                        card.accentClassName,
                      )}
                    />
                    <div className="relative z-10 flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/50 bg-background/80 text-foreground">
                        <Icon className="h-6 w-6" />
                      </div>
                      <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          {t(`appStore.discover.card${i + 1}Eyebrow` as any) || card.eyebrow}
                        </p>
                        <div className="space-y-1">
                          <h3 className="text-lg font-medium tracking-[-0.02em] text-foreground">
                            {t(`appStore.discover.card${i + 1}Title` as any) || card.title}
                          </h3>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {t(`appStore.discover.card${i + 1}Desc` as any) || card.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-end justify-between gap-4 px-1">
              <div className="space-y-1">
                <h2 className="text-xl font-medium tracking-[-0.03em] text-foreground">
                  {t('appStore.page.builtIn')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('appStore.page.builtInDesc')}
                </p>
              </div>
              <span className="rounded-full bg-muted/70 px-3 py-1 text-xs text-muted-foreground">
                {t('appStore.page.availableNow')}
              </span>
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
                            {(t as any)(`devApp.name.${app.id.replace(/-([a-z])/g, (g) => g[1].toUpperCase())}`) ?? app.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{(t as any)(`devApp.category.${app.store.categoryLabel}`) ?? app.store.categoryLabel}</p>
                        </div>
                        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                          {app.store.badgeLabel === "Built in" ? t('appStore.page.badgeBuiltIn') : app.store.badgeLabel}
                        </span>
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">{app.description}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
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

      <section className="overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,rgba(120,119,198,0.08),rgba(255,255,255,0.02))]">
        <div className="grid gap-6 p-7 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t('appStore.page.roadmapEyebrow')}
            </p>
            <div className="space-y-2">
              <h2 className="text-[30px] font-medium leading-[1.02] tracking-[-0.04em] text-foreground">
                {t('appStore.page.roadmapTitle')}
              </h2>
              <p className="max-w-[38rem] text-sm leading-6 text-muted-foreground">
                {t('appStore.page.roadmapDesc')}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[20px] bg-background/80 p-4">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-foreground">
                <HugeiconsIcon icon={__BoltHugeIcon} className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-foreground">{t('appStore.page.installFlows')}</p>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                {t('appStore.page.installFlowsDesc')}
              </p>
            </div>
            <div className="rounded-[20px] bg-background/80 p-4">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-foreground">
                <HugeiconsIcon icon={__ChipHugeIcon} className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-foreground">{t('appStore.page.curatedBundles')}</p>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                {t('appStore.page.curatedBundlesDesc')}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
