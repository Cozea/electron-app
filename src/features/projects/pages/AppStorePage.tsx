import {
  BoltIcon as Bolt,
  CpuChipIcon as Chip,
} from "@heroicons/react/24/outline"
import { useMemo } from "react"

import {
  SettingsSectionDescription,
  SettingsSectionTitle,
} from "@/components/settings/SettingsChrome"
import { ProjectShellTitleBarCenterFromLabel } from "@/features/projects/components/ProjectShellTitleBarCenterFromLabel"
import {
  APP_STORE_FEATURE_CARDS,
  APP_STORE_PREVIEW_APPS,
  resolveAppStoreCategory,
} from "@/features/projects/lib/appStoreCatalog"
import { useProjectHeader } from "@/hooks/useProjectHeader"
import { useSearchParams } from "@/lib/router"
import { cn } from "@/lib/utils"

function matchesStoreQuery(values: string[], query: string): boolean {
  if (!query.trim()) return true
  const normalizedQuery = query.trim().toLowerCase()
  return values.some((value) => value.toLowerCase().includes(normalizedQuery))
}

export function AppStorePage() {
  const [searchParams] = useSearchParams()
  const activeCategory = resolveAppStoreCategory(searchParams.get("category"))
  const query = searchParams.get("q") ?? ""

  const headerCenter = useMemo(
    () => <ProjectShellTitleBarCenterFromLabel label="DevApps Store" />,
    [],
  )

  useProjectHeader(null, headerCenter)

  const visibleFeatureCards = useMemo(() => {
    const cards = APP_STORE_FEATURE_CARDS.filter(
      (card) =>
        activeCategory.id === "discover" || card.categories.includes(activeCategory.id),
    ).filter((card) =>
      matchesStoreQuery([card.eyebrow, card.title, card.description], query),
    )

    return activeCategory.id === "discover" ? cards.slice(0, 3) : cards.slice(0, 3)
  }, [activeCategory.id, query])

  const visiblePreviewApps = useMemo(() => {
    const apps = APP_STORE_PREVIEW_APPS.filter(
      (app) =>
        activeCategory.id === "discover" || app.categories.includes(activeCategory.id),
    ).filter((app) =>
      matchesStoreQuery([app.name, app.category, app.description], query),
    )

    return activeCategory.id === "discover" ? apps.slice(0, 6) : apps.slice(0, 6)
  }, [activeCategory.id, query])

  const hasResults = visibleFeatureCards.length > 0 || visiblePreviewApps.length > 0

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-8 px-6 pt-5 pb-8">
      <section>
        <SettingsSectionTitle>{activeCategory.label}</SettingsSectionTitle>
        <SettingsSectionDescription>
          {query.trim()
            ? `Results for “${query}” in ${activeCategory.label.toLowerCase()}.`
            : activeCategory.description}
        </SettingsSectionDescription>

        <div className="mt-4 grid gap-4 xl:grid-cols-[0.85fr_2fr]">
          <div className="relative overflow-hidden rounded-[28px] bg-[#24263b] p-7 text-white">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_65%)]" />
            <div className="relative z-10 flex h-full min-h-[16rem] flex-col justify-between gap-8">
              <div className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/65">
                  Opening soon
                </p>
                <div className="space-y-2">
                  <h1 className="max-w-[14rem] text-[28px] font-medium leading-[1.05] tracking-[-0.03em]">
                    {activeCategory.heroTitle}
                  </h1>
                  <p className="max-w-[15rem] text-sm leading-6 text-white/72">
                    {activeCategory.heroDescription}
                  </p>
                </div>
              </div>

              <div className="inline-flex w-fit items-center rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs text-white/80 backdrop-blur-sm">
                Storefront preview
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
                    Build your Cozea workspace like a real product stack.
                  </h2>
                  <p className="text-sm leading-6 text-white/80">
                    The store will surface high-signal tools for previews, agents, runtimes, and
                    team workflows in one curated place.
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
              {visibleFeatureCards.map((card) => {
                const Icon = card.icon
                return (
                  <div
                    key={card.title}
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
                          {card.eyebrow}
                        </p>
                        <div className="space-y-1">
                          <h3 className="text-lg font-medium tracking-[-0.02em] text-foreground">
                            {card.title}
                          </h3>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {card.description}
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
                  Preview shelves
                </h2>
                <p className="text-sm text-muted-foreground">
                  A first look at the kinds of products that will live in the store.
                </p>
              </div>
              <span className="rounded-full bg-muted/70 px-3 py-1 text-xs text-muted-foreground">
                Coming soon
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visiblePreviewApps.map((app) => {
                const Icon = app.icon
                return (
                  <div
                    key={app.name}
                    className="flex items-start gap-4 rounded-[22px] bg-background px-4 py-4"
                  >
                    <div
                      className={cn(
                        "flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px]",
                        app.accentClassName,
                      )}
                    >
                      <Icon className="h-7 w-7" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{app.name}</p>
                          <p className="text-[11px] text-muted-foreground">{app.category}</p>
                        </div>
                        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                          Soon
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
                No matches yet
              </p>
              <div className="space-y-2">
                <h2 className="text-[30px] font-medium leading-[1.02] tracking-[-0.04em] text-foreground">
                  Nothing in the store matches “{query}” yet.
                </h2>
                <p className="max-w-[38rem] text-sm leading-6 text-muted-foreground">
                  We are still shaping this storefront. Try another search term or switch to a
                  broader category while the first set of Cozea store collections comes together.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[20px] bg-background/80 p-4">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-foreground">
                  <Bolt className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium text-foreground">Curated collections</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  Editorial shelves, onboarding kits, and installable bundles are coming next.
                </p>
              </div>
              <div className="rounded-[20px] bg-background/80 p-4">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-foreground">
                  <Chip className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium text-foreground">Developer-first tooling</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  The store will focus on real project work: agents, previews, runtimes, and release flows.
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
              Store roadmap
            </p>
            <div className="space-y-2">
              <h2 className="text-[30px] font-medium leading-[1.02] tracking-[-0.04em] text-foreground">
                The storefront is taking shape.
              </h2>
              <p className="max-w-[38rem] text-sm leading-6 text-muted-foreground">
                This page will soon host installable tools, runtime bundles, preview surfaces,
                workflow add-ons, and shared team utilities. For now, we are showing the structure
                it will grow into so the store feels like part of the product from day one.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[20px] bg-background/80 p-4">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-foreground">
                <Bolt className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-foreground">Install flows</p>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                Lightweight setup, versioning, and workspace-scoped installs.
              </p>
            </div>
            <div className="rounded-[20px] bg-background/80 p-4">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-foreground">
                <Chip className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-foreground">Curated bundles</p>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                Opinionated packs for agents, previews, and local tooling.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
