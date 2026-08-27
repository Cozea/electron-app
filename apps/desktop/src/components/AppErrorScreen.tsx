import { HugeiconsIcon } from "@hugeicons/react"
import { AlertCircleIcon as __AlertCircleHugeIcon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { getStoredLanguage, getTranslation } from "@/lib/i18n"

/**
 * Route-level error fallback. Reads translations directly from storage so it
 * still renders if a provider higher in the tree is what crashed.
 */
export function AppErrorScreen({
  error,
  reset,
}: {
  error: unknown
  reset?: () => void
}) {
  const lang = getStoredLanguage()
  const message = error instanceof Error ? error.message : String(error ?? "")

  return (
    <div className="flex h-full min-h-[320px] w-full items-center justify-center bg-transparent p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">
            {getTranslation(lang, "errorScreen.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {getTranslation(lang, "errorScreen.description")}
          </p>
        </div>
        {message && (
          <pre className="max-h-32 w-full select-text overflow-auto rounded-md bg-muted/60 px-3 py-2 text-left font-mono text-[11px] leading-4 text-muted-foreground">
            {message}
          </pre>
        )}
        <div className="flex items-center gap-2">
          {reset && (
            <Button variant="outline" size="sm" onClick={reset}>
              {getTranslation(lang, "errorScreen.tryAgain")}
            </Button>
          )}
          <Button size="sm" onClick={() => window.location.reload()}>
            {getTranslation(lang, "errorScreen.reload")}
          </Button>
        </div>
      </div>
    </div>
  )
}
