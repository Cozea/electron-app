import { AlertCircle, CreditCard, ArrowRight, AlertTriangle, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useScopedSettingsNavigation } from '@/hooks/useScopedSettingsNavigation'
import type { BillingErrorData } from '@/lib/ai/billingErrors'

interface BillingErrorProps {
  error: BillingErrorData
  onAction?: (href: string) => void
  className?: string
}

const errorIcons: Record<string, typeof AlertCircle> = {
  SUBSCRIPTION_REQUIRED: CreditCard,
  SUBSCRIPTION_INACTIVE: AlertTriangle,
  TIER_NOT_AVAILABLE: Ban,
  MODEL_RESTRICTED: Ban,
  PROVIDER_RESTRICTED: Ban,
  PROVIDER_AUTH_REQUIRED: AlertCircle,
  MODEL_CONFIGURATION_REQUIRED: AlertCircle,
  ENTITLEMENT_REQUIRED: CreditCard,
  WALLET_INSUFFICIENT_FUNDS: CreditCard,
}

const errorColors: Record<string, string> = {
  SUBSCRIPTION_REQUIRED: 'text-primary bg-primary/10 border-primary/20',
  SUBSCRIPTION_INACTIVE: 'text-red-500 bg-red-500/10 border-red-500/20',
  TIER_NOT_AVAILABLE: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
  MODEL_RESTRICTED: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
  PROVIDER_RESTRICTED: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
  PROVIDER_AUTH_REQUIRED: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  MODEL_CONFIGURATION_REQUIRED: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  ENTITLEMENT_REQUIRED: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  WALLET_INSUFFICIENT_FUNDS: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
}

export function BillingError({ error, onAction, className }: BillingErrorProps) {
  const { openScopedHref } = useScopedSettingsNavigation()
  const code = error.code || 'UNKNOWN'
  const Icon = errorIcons[code] || AlertCircle
  const colorClass = errorColors[code] || 'text-muted-foreground bg-muted/50 border-border'

  const handleAction = () => {
    if (error.action?.href) {
      if (onAction) {
        onAction(error.action.href)
      } else {
        openScopedHref(error.action.href)
      }
    }
  }

  const handleSecondaryAction = () => {
    if (error.secondaryAction?.href) {
      if (onAction) {
        onAction(error.secondaryAction.href)
      } else {
        openScopedHref(error.secondaryAction.href)
      }
    }
  }

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        colorClass,
        className
      )}
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            <Icon className="h-5 w-5" />
          </div>
          <p className="min-w-0 flex-1 truncate whitespace-nowrap font-medium leading-tight text-sm">
            {error.title || 'Error'}
          </p>
          {error.action ? (
            <div className="shrink-0 flex items-center gap-2 whitespace-nowrap">
              {error.secondaryAction && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 text-muted-foreground hover:bg-transparent hover:text-foreground"
                  onClick={handleSecondaryAction}
                >
                  {error.secondaryAction.label}
                </Button>
              )}
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs gap-1.5 px-3"
                onClick={handleAction}
              >
                {error.action.label}
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          ) : null}
        </div>
        <p className="text-sm opacity-90 leading-snug">
          {error.message}
        </p>
        {error.hint && (
          <p className="text-xs opacity-80">
            {error.hint}
          </p>
        )}
      </div>
    </div>
  )
}
export { parseBillingError, isBillingError, type BillingErrorData } from '@/lib/ai/billingErrors'
