import { AlertTriangle, ArrowRight, Clock3, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useScopedSettingsNavigation } from '@/hooks/useScopedSettingsNavigation'
import type { AiSurfaceErrorData } from '@/lib/ai/surfaceErrors'

interface AiSurfaceErrorCardProps {
  error: AiSurfaceErrorData
  className?: string
  onDismiss?: () => void
  onAction?: (href: string) => void
}

const errorIcons = {
  provider_usage_limit: Clock3,
  provider_rate_limit: AlertTriangle,
  provider_error: XCircle,
  duplicate_response_item_id: AlertTriangle,
} satisfies Record<AiSurfaceErrorData['code'], typeof AlertTriangle>

const errorColors = {
  provider_usage_limit: 'bg-amber-100 text-amber-950',
  provider_rate_limit: 'bg-orange-100 text-orange-950',
  provider_error: 'bg-red-100 text-red-950',
  duplicate_response_item_id: 'bg-orange-100 text-orange-950',
} satisfies Record<AiSurfaceErrorData['code'], string>

export function AiSurfaceErrorCard({
  error,
  className,
  onDismiss,
  onAction,
}: AiSurfaceErrorCardProps) {
  const { openScopedHref } = useScopedSettingsNavigation()
  const Icon = errorIcons[error.code]
  const colorClass = errorColors[error.code]

  return (
    <div className={cn('rounded-lg p-3', colorClass, className)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <p className="truncate text-sm font-medium leading-tight">
                {error.title}
              </p>
              <p className="truncate text-xs leading-5 opacity-90">
                {error.message}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {error.action && (
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 gap-1.5 px-3 text-xs"
                  onClick={() => {
                    const actionHref = error.action?.href
                    if (!actionHref) return
                    if (onAction) {
                      onAction(actionHref)
                    } else {
                      openScopedHref(actionHref)
                    }
                  }}
                >
                  {error.action.label}
                  <ArrowRight className="h-3 w-3" />
                </Button>
              )}
              {onDismiss && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-current/70 hover:bg-transparent hover:text-current"
                  onClick={onDismiss}
                  aria-label="Dismiss error"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
