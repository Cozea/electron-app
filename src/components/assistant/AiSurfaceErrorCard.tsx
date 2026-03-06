import { AlertTriangle, ArrowRight, Clock3, XCircle } from 'lucide-react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSettingsDrawerStore } from '@/stores/useSettingsDrawerStore'
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
  provider_usage_limit: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
  provider_rate_limit: 'text-orange-600 bg-orange-500/10 border-orange-500/20',
  provider_error: 'text-destructive bg-destructive/10 border-destructive/20',
  duplicate_response_item_id: 'text-orange-600 bg-orange-500/10 border-orange-500/20',
} satisfies Record<AiSurfaceErrorData['code'], string>

export function AiSurfaceErrorCard({
  error,
  className,
  onDismiss,
  onAction,
}: AiSurfaceErrorCardProps) {
  const navigate = useViewTransitionNavigate()
  const openSettingsDrawer = useSettingsDrawerStore((state) => state.openFromRoute)
  const Icon = errorIcons[error.code]
  const colorClass = errorColors[error.code]

  const openHref = (href: string) => {
    if (href.startsWith('/settings/')) {
      openSettingsDrawer(href)
      return
    }
    if (/^https?:\/\//i.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    navigate(href)
  }

  return (
    <div className={cn('rounded-lg border p-3', colorClass, className)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium leading-tight">
                {error.title}
              </p>
              <p className="text-sm leading-snug opacity-90">
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
                      openHref(actionHref)
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
          {error.hint && (
            <p className="mt-1.5 text-xs leading-relaxed opacity-80">
              {error.hint}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
