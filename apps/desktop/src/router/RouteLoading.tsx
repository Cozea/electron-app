import { useTranslation } from "@/lib/i18n"
import type { TranslationKey } from "@/lib/i18n/en"
import { cn } from "@/lib/utils"

interface RouteLoadingProps {
  className?: string
  labelKey?: TranslationKey
}

// Token-bound invite flows can genuinely be blocked while their route code is
// resolving. Ordinary desktop surfaces are prewarmed and keep the persistent
// shell mounted instead of replacing it with a browser-style loading page.
const VISIBLE_BLOCKING_ROUTE_LOADERS = new Set<TranslationKey>([
  "routeLoading.projectInvite",
])

export function RouteLoading({ className, labelKey }: RouteLoadingProps) {
  const { t } = useTranslation()
  const resolvedLabelKey = labelKey ?? "routeLoading.default"

  if (!VISIBLE_BLOCKING_ROUTE_LOADERS.has(resolvedLabelKey)) {
    return null
  }

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
