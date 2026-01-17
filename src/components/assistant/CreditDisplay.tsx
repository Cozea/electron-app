/**
 * Credit Display Component
 *
 * Shows remaining credits with a progress bar for the current billing period.
 */

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { IconCoins } from '@tabler/icons-react'

interface CreditDisplayProps {
  className?: string
  variant?: 'compact' | 'full'
}

interface CreditSummary {
  subscriptionCreditsRemaining: number
  subscriptionCreditsTotal: number
  purchasedCreditsRemaining: number
  totalCreditsRemaining: number
  plan: string
}

const AI_API_URL = import.meta.env.VITE_AI_API_URL || 'http://localhost:3001/ai/chat'
const AI_BASE_URL = AI_API_URL.replace(/\/chat$/, '')

export function CreditDisplay({ className, variant = 'compact' }: CreditDisplayProps) {
  const { currentOrganization, accessToken } = useAuth()
  const [creditSummary, setCreditSummary] = useState<CreditSummary | null>(null)

  useEffect(() => {
    if (!accessToken || !currentOrganization?.organizationId) {
      setCreditSummary(null)
      return
    }

    const controller = new AbortController()

    fetch(
      `${AI_BASE_URL}/usage?organizationId=${encodeURIComponent(currentOrganization.organizationId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      }
    )
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Failed to load usage')
        }
        return res.json()
      })
      .then((data) => {
        setCreditSummary(data?.credits ?? null)
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          console.warn('Failed to fetch credit summary:', err)
        }
        setCreditSummary(null)
      })

    return () => controller.abort()
  }, [accessToken, currentOrganization?.organizationId])

  if (!creditSummary) {
    return null
  }

  const {
    subscriptionCreditsTotal,
    purchasedCreditsRemaining,
    totalCreditsRemaining,
    plan,
  } = creditSummary

  // Calculate percentage used
  const totalCredits = subscriptionCreditsTotal + purchasedCreditsRemaining
  const percentUsed = totalCredits > 0
    ? Math.round(((totalCredits - totalCreditsRemaining) / totalCredits) * 100)
    : 0

  // Determine color based on remaining credits
  const getProgressColor = () => {
    if (percentUsed >= 90) return 'bg-destructive'
    if (percentUsed >= 75) return 'bg-yellow-500'
    return 'bg-primary'
  }

  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
        <IconCoins className="h-3 w-3" />
        <span>{totalCreditsRemaining.toLocaleString()} credits</span>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2 p-3 rounded-lg bg-muted/50', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconCoins className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Credits</span>
        </div>
        <span className="text-xs text-muted-foreground capitalize">{plan} plan</span>
      </div>

      <Progress
        value={100 - percentUsed}
        className="h-2"
        // @ts-ignore - indicatorClassName not in types but supported
        indicatorClassName={getProgressColor()}
      />

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{totalCreditsRemaining.toLocaleString()} remaining</span>
        <span>{totalCredits.toLocaleString()} total</span>
      </div>

      {purchasedCreditsRemaining > 0 && (
        <div className="text-xs text-muted-foreground">
          Includes {purchasedCreditsRemaining.toLocaleString()} purchased credits
        </div>
      )}
    </div>
  )
}
