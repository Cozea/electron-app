/**
 * Usage Display Component
 *
 * Shows workspace AI token usage summary.
 */

import { useAuth } from '@/contexts/AuthContext'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { cn } from '@/lib/utils'
import { IconActivity } from '@tabler/icons-react'
import { getWorkspacePlanLabel } from '@/lib/billing/planLabels'

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

  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )

  const usageSummary = useQuery(
    api.organizations.getUsageSummary,
    convexOrg?._id ? { orgId: convexOrg._id, period: 'monthly' } : 'skip'
  )

  if (!convexOrg) {
    return null
  }

  const aggregate = usageSummary?.aggregate
  const totalTokens = aggregate?.totalTokens ?? 0
  const requestCount = aggregate?.requestCount ?? 0
  const plan = convexOrg.subscription?.plan || 'free'
  const planLabel = getWorkspacePlanLabel(plan)

  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
        <IconActivity className="h-3 w-3" />
        <span>{formatCompactNumber(totalTokens)} tok</span>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2 p-3 rounded-lg bg-muted/50', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconActivity className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Token Tracking</span>
        </div>
        <span className="text-xs text-muted-foreground">{planLabel}</span>
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{totalTokens.toLocaleString()} tokens (MTD)</span>
        <span>{requestCount.toLocaleString()} requests</span>
      </div>
    </div>
  )
}
