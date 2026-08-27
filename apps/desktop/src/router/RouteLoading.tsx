import { useTranslation } from "@/lib/i18n"
import type { TranslationKey } from "@/lib/i18n/en"
import { cn } from "@/lib/utils"

interface RouteLoadingProps {
  className?: string
  labelKey?: TranslationKey
}

export function RouteLoading({ className, labelKey }: RouteLoadingProps) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        "flex min-h-[240px] items-center justify-center px-6 py-10 text-sm text-muted-foreground",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <div className="loader" />
        <span>{t(labelKey ?? "routeLoading.default")}</span>
      </div>
    </div>
  )
}
