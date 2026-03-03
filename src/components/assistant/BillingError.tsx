import { AlertCircle, CreditCard, ArrowRight, AlertTriangle, Ban } from 'lucide-react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSettingsDrawerStore } from '@/stores/useSettingsDrawerStore'

export interface BillingErrorData {
  error: string
  code?: string
  title?: string
  message?: string
  action?: {
    label: string
    href: string
  }
  secondaryAction?: {
    label: string
    href: string
  }
  hint?: string
  details?: {
    totalAvailable?: number
    plan?: string
  }
}

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
  ENTITLEMENT_REQUIRED: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  WALLET_INSUFFICIENT_FUNDS: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
}

export function BillingError({ error, onAction, className }: BillingErrorProps) {
  const navigate = useViewTransitionNavigate()
  const openSettingsDrawer = useSettingsDrawerStore((state) => state.openFromRoute)
  const code = error.code || 'UNKNOWN'
  const Icon = errorIcons[code] || AlertCircle
  const colorClass = errorColors[code] || 'text-muted-foreground bg-muted/50 border-border'

  const openHref = (href: string) => {
    if (href.startsWith('/settings/')) {
      openSettingsDrawer(href)
      return
    }
    navigate(href)
  }

  const handleAction = () => {
    if (error.action?.href) {
      if (onAction) {
        onAction(error.action.href)
      } else {
        openHref(error.action.href)
      }
    }
  }

  const handleSecondaryAction = () => {
    if (error.secondaryAction?.href) {
      if (onAction) {
        onAction(error.secondaryAction.href)
      } else {
        openHref(error.secondaryAction.href)
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
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <p className="font-medium leading-tight text-sm">
                {error.title || 'Error'}
              </p>
              <p className="text-sm opacity-90 leading-snug">
                {error.message}
              </p>
            </div>
            {error.action && (
              <div className="shrink-0 flex items-center gap-2">
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
            )}
          </div>

          {error.hint && (
            <p className="text-xs opacity-80 mt-1.5">
              {error.hint}
            </p>
          )}


        </div>
      </div>
    </div>
  )
}

/**
 * Parse an error response into BillingErrorData
 */
export function parseBillingError(err: unknown): BillingErrorData | null {
  if (!err) return null

  // Handle Error objects with message containing JSON
  if (err instanceof Error) {
    try {
      const parsed = JSON.parse(err.message)
      if (parsed.code || parsed.title || parsed.error) {
        return parsed as BillingErrorData
      }
    } catch {
      // Not JSON, check for known patterns
      const message = err.message
      if (message.includes('subscription_required') || message.includes('Subscription Required')) {
        return {
          error: 'subscription_required',
          code: 'SUBSCRIPTION_REQUIRED',
          title: 'Subscription Required',
          message: message,
        }
      }
      if (message.includes('provider_auth_required') || message.includes('provider account required')) {
        return {
          error: 'provider_auth_required',
          code: 'PROVIDER_AUTH_REQUIRED',
          title: 'Provider Account Required',
          message: message,
        }
      }
      if (message.includes('entitlement') || message.includes('plan limit')) {
        return {
          error: 'entitlement_required',
          code: 'ENTITLEMENT_REQUIRED',
          title: 'Plan Upgrade Required',
          message,
        }
      }
      if (message.includes('wallet_insufficient_funds') || message.includes('insufficient ai wallet')) {
        return {
          error: 'wallet_insufficient_funds',
          code: 'WALLET_INSUFFICIENT_FUNDS',
          title: 'Insufficient AI Wallet Balance',
          message,
        }
      }
    }
  }

  // Handle plain objects
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>
    if (obj.code || obj.title || obj.error) {
      return obj as unknown as BillingErrorData
    }
  }

  return null
}

/**
 * Check if an error is billing/provider-auth related
 */
export function isBillingError(err: unknown): boolean {
  const parsed = parseBillingError(err)
  if (!parsed) return false

  const billingCodes = [
    'SUBSCRIPTION_REQUIRED',
    'SUBSCRIPTION_INACTIVE',
    'TIER_NOT_AVAILABLE',
    'MODEL_RESTRICTED',
    'PROVIDER_RESTRICTED',
    'PROVIDER_AUTH_REQUIRED',
    'ENTITLEMENT_REQUIRED',
    'WALLET_INSUFFICIENT_FUNDS',
  ]

  return billingCodes.includes(parsed.code || '')
}
