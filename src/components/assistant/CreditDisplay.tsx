/**
 * Credit Display Component
 *
 * Shows remaining credits with a progress bar for the current billing period.
 * Uses Convex directly for real-time updates.
 */

import { useAuth } from '@/contexts/AuthContext'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { IconCoins } from '@tabler/icons-react'

/**
 * Format a number with k, m, b suffixes for compact display
 */
function formatCompactNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'b'
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm'
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  }
  return num.toString()
}

interface CreditDisplayProps {
  className?: string
  variant?: 'compact' | 'full'
}

export function CreditDisplay({ className, variant = 'compact' }: CreditDisplayProps) {
  const { currentOrganization } = useAuth()

  // Get Convex organization by WorkOS ID
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )

  // Get credit lots (purchased credits)
  const creditLots = useQuery(
    api.billing.getCreditLots,
    convexOrg?._id ? { organizationId: convexOrg._id } : 'skip'
  )

  // Calculate credits
  const credits = convexOrg?.credits
  const subscriptionCreditsRemaining = credits?.subscriptionCreditsRemaining ?? 0
  const subscriptionCreditsTotal = credits?.subscriptionCreditsTotal ?? 0

  // Purchased credits from active lots
  const purchasedCreditsRemaining = creditLots
    ?.filter(lot => lot.status === 'active')
    .reduce((sum, lot) => sum + lot.remainingCredits, 0) ?? 0

  const totalCreditsRemaining = subscriptionCreditsRemaining + purchasedCreditsRemaining
  const plan = convexOrg?.subscription?.plan || 'free'

  // Don't render until data is loaded
  if (!convexOrg) {
    return null
  }

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
      <div className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
        <IconCoins className="h-3 w-3" />
        <span>{formatCompactNumber(totalCreditsRemaining)}</span>
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
