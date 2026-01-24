import { AlertCircle, CreditCard, Key, ArrowRight, AlertTriangle, Ban } from 'lucide-react'
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
  const code = error.code || 'UNKNOWN'
  const Icon = errorIcons[code] || AlertCircle
  const colorClass = errorColors[code] || 'text-muted-foreground bg-muted/50 border-border'

  const handleAction = () => {
    if (error.action?.href && onAction) {
      onAction(error.action.href)
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4',
        colorClass,
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-1">
          <p className="font-medium leading-tight">
            {error.title || 'Error'}
          </p>
          <p className="text-sm opacity-90">
            {error.message}
          </p>
          {error.hint && (
            <p className="text-xs opacity-70 mt-2">
              {error.hint}
            </p>
          )}
        </div>
      </div>

      {error.action && (
        <div className="flex flex-col gap-2">
          <Button
            variant="default"
            size="sm"
            className="w-full justify-between"
            onClick={handleAction}
          >
            {error.action.label}
            <ArrowRight className="h-4 w-4" />
          </Button>
          {error.secondaryAction && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => onAction?.(error.secondaryAction!.href)}
            >
              {error.secondaryAction.label}
            </Button>
          )}
        </div>
      )}

      {error.details && error.code === 'INSUFFICIENT_CREDITS' && (
        <div className="text-xs opacity-60 border-t border-current/10 pt-2 mt-1">
          <div className="flex justify-between">
            <span>Plan:</span>
            <span className="font-medium capitalize">{error.details.plan}</span>
          </div>
          <div className="flex justify-between">
            <span>Remaining:</span>
            <span className="font-medium">{error.details.totalAvailable?.toLocaleString()} credits</span>
          </div>
        </div>
      )}
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
      return obj as BillingErrorData
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
