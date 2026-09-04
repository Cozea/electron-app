import { useState } from "react"

import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  EyeIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button"
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"
import { useTranslation } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface PublicIdDisclosureProps {
  value: string
  label: string
  className?: string
  loadingLabel?: string
}

export function PublicIdDisclosure({
  value,
  label,
  className,
  loadingLabel,
}: PublicIdDisclosureProps) {
  const { t } = useTranslation()
  const [revealedValue, setRevealedValue] = useState<string | null>(null)
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const { copyToClipboard, isCopied } = useCopyToClipboard<string>({
    onCopy: setCopiedValue,
  })
  const isRevealed = revealedValue === value
  const isCurrentValueCopied = isCopied && copiedValue === value

  if (!value) {
    return (
      <p className={cn("mt-0.5 text-[11px] text-muted-foreground", className)}>
        {loadingLabel ?? t("common.loading")}
      </p>
    )
  }

  return (
    <div className={cn("mt-0.5 flex min-w-0 items-center gap-1.5", className)}>
      {isRevealed ? (
        <code className="min-w-0 truncate text-[11px] text-muted-foreground">
          {value}
        </code>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
          aria-expanded={false}
          aria-label={`${t("settings.publicId.show")} ${label}`}
          onClick={(event) => {
            event.stopPropagation()
            setRevealedValue(value)
          }}
        >
          <HugeiconsIcon icon={EyeIcon} className="size-3.5" aria-hidden />
          {t("settings.publicId.show")}
        </Button>
      )}

      {isRevealed ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-expanded="true"
            aria-label={`${t("settings.publicId.hide")} ${label}`}
            title={t("settings.publicId.hide")}
            onClick={(event) => {
              event.stopPropagation()
              setRevealedValue(null)
            }}
          >
            <HugeiconsIcon icon={ViewOffSlashIcon} className="size-3.5" aria-hidden />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
            aria-label={`${t("common.copy")} ${label}`}
            onClick={(event) => {
              event.stopPropagation()
              copyToClipboard(value, value)
            }}
          >
            <HugeiconsIcon
              icon={isCurrentValueCopied ? CheckmarkCircle02Icon : Copy01Icon}
              className="size-3.5"
              aria-hidden
            />
            <span aria-live="polite">
              {isCurrentValueCopied ? t("common.copied") : t("common.copy")}
            </span>
          </Button>
        </div>
      ) : null}
    </div>
  )
}
