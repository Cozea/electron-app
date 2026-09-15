import { useTranslation } from "@/lib/i18n"
import type { TranslationKey } from "@/lib/i18n/en"
import { cn } from "@/lib/utils"

interface RouteLoadingProps {
  className?: string
  labelKey?: TranslationKey
}

function SettingsRouteSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("mx-auto w-full max-w-4xl space-y-7 px-8 sm:px-10 pt-6 pb-12 animate-pulse", className)}
      aria-busy="true"
      aria-label="Loading settings…"
    >
      <div className="mb-6 px-1">
        <div className="h-7 w-44 rounded-lg bg-muted/50" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-28 rounded bg-muted/40" />
        <div className="rounded-2xl border border-border/40 bg-secondary/35 divide-y divide-border/25">
          <div className="flex min-h-[58px] items-center justify-between gap-8 px-6 py-4">
            <div className="space-y-1.5 flex-1">
              <div className="h-4 w-36 rounded bg-muted/50" />
              <div className="h-3 w-56 rounded bg-muted/30" />
            </div>
            <div className="h-7 w-20 rounded-md bg-muted/40" />
          </div>
          <div className="flex min-h-[58px] items-center justify-between gap-8 px-6 py-4">
            <div className="space-y-1.5 flex-1">
              <div className="h-4 w-40 rounded bg-muted/50" />
              <div className="h-3 w-48 rounded bg-muted/30" />
            </div>
            <div className="h-7 w-24 rounded-md bg-muted/40" />
          </div>
        </div>
      </div>
    </div>
  )
}

function PageRouteSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("mx-auto w-full max-w-[960px] space-y-6 px-6 pt-4 pb-12 animate-pulse", className)}
      aria-busy="true"
      aria-label="Loading page…"
    >
      <div className="h-7 w-48 rounded-lg bg-muted/50" />
      <div className="h-9 w-full rounded-md bg-muted/30" />
      <div className="space-y-3 pt-2">
        <div className="h-20 w-full rounded-xl border border-border/40 bg-card/30" />
        <div className="h-20 w-full rounded-xl border border-border/40 bg-card/30" />
        <div className="h-20 w-full rounded-xl border border-border/40 bg-card/30" />
      </div>
    </div>
  )
}

export function RouteLoading({ className, labelKey }: RouteLoadingProps) {
  const { t } = useTranslation()
  const resolvedLabelKey = labelKey ?? "routeLoading.default"

  if (resolvedLabelKey === "routeLoading.projectInvite") {
    return (
      <div
        className={cn(
          "flex min-h-[240px] items-center justify-center px-6 py-10 text-sm text-muted-foreground",
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <div className="loader" />
          <span>{t(resolvedLabelKey)}</span>
        </div>
      </div>
    )
  }

  if (
    resolvedLabelKey === "routeLoading.account" ||
    resolvedLabelKey === "routeLoading.appearance" ||
    resolvedLabelKey === "routeLoading.organizations" ||
    resolvedLabelKey === "routeLoading.devapps" ||
    resolvedLabelKey === "routeLoading.tooling" ||
    resolvedLabelKey === "routeLoading.computerUse"
  ) {
    return <SettingsRouteSkeleton className={className} />
  }

  if (
    resolvedLabelKey === "routeLoading.store" ||
    resolvedLabelKey === "routeLoading.agentSkills" ||
    resolvedLabelKey === "routeLoading.inbox" ||
    resolvedLabelKey === "routeLoading.tasks"
  ) {
    return <PageRouteSkeleton className={className} />
  }

  return null
}
