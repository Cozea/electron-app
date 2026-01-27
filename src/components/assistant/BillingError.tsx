import { AlertCircle, CreditCard, ArrowRight, AlertTriangle, Ban } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
    subscriptionCreditsRemaining?: number
    purchasedCreditsRemaining?: number
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
  INSUFFICIENT_CREDITS: CreditCard,
  SUBSCRIPTION_INACTIVE: AlertTriangle,
  TIER_NOT_AVAILABLE: Ban,
  MODEL_RESTRICTED: Ban,
  PROVIDER_RESTRICTED: Ban,
}

const errorColors: Record<string, string> = {
  SUBSCRIPTION_REQUIRED: 'text-primary bg-primary/10 border-primary/20',
  INSUFFICIENT_CREDITS: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  SUBSCRIPTION_INACTIVE: 'text-red-500 bg-red-500/10 border-red-500/20',
  TIER_NOT_AVAILABLE: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
  MODEL_RESTRICTED: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
  PROVIDER_RESTRICTED: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
}

export function BillingError({ error, onAction, className }: BillingErrorProps) {
  const navigate = useNavigate()
  const code = error.code || 'UNKNOWN'
  const Icon = errorIcons[code] || AlertCircle
  const colorClass = errorColors[code] || 'text-muted-foreground bg-muted/50 border-border'

  const handleAction = () => {
    if (error.action?.href) {
      if (onAction) {
        onAction(error.action.href)
      } else {
        navigate(error.action.href)
      }
    }
  }

  const handleSecondaryAction = () => {
    if (error.secondaryAction?.href) {
      if (onAction) {
        onAction(error.secondaryAction.href)
      } else {
        navigate(error.secondaryAction.href)
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
              {code !== 'INSUFFICIENT_CREDITS' && (
                <p className="text-sm opacity-90 leading-snug">
                  {error.message}
                </p>
              )}
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
                  Billing
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
        // Fix incorrect billing URL
        if (parsed.action?.href === '/workspace/billing/credits') {
          parsed.action.href = '/workspace/billing'
        }
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
      if (message.includes('credit') || message.includes('insufficient')) {
        return {
          error: 'insufficient_credits',
          code: 'INSUFFICIENT_CREDITS',
          title: 'Insufficient Credits',
          message: message,
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
 * Check if an error is a billing/credit related error
 */
export function isBillingError(err: unknown): boolean {
  const parsed = parseBillingError(err)
  if (!parsed) return false

  const billingCodes = [
    'SUBSCRIPTION_REQUIRED',
    'INSUFFICIENT_CREDITS',
    'SUBSCRIPTION_INACTIVE',
    'TIER_NOT_AVAILABLE',
    'MODEL_RESTRICTED',
    'PROVIDER_RESTRICTED',
  ]

  return billingCodes.includes(parsed.code || '')
}
