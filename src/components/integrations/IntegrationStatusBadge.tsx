

import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon as __AlertCircleHugeIcon, CancelCircleIcon as __XCircleHugeIcon, CheckmarkCircle02Icon as __CheckCircleHugeIcon } from '@hugeicons/core-free-icons'

const CheckCircle = (props: any) => <HugeiconsIcon icon={__CheckCircleHugeIcon} {...props} />
const AlertCircle = (props: any) => <HugeiconsIcon icon={__AlertCircleHugeIcon} {...props} />
const XCircle = (props: any) => <HugeiconsIcon icon={__XCircleHugeIcon} {...props} />

/**
 * Integration Status Badge
 *
 * Displays the connection status of an integration.
 */

import { Badge } from '@/components/ui/badge'
import type { IntegrationStatus } from '@/lib/integrations/types'

interface IntegrationStatusBadgeProps {
  status: IntegrationStatus
  showIcon?: boolean
  size?: 'sm' | 'md'
}

const STATUS_CONFIG: Record<
  IntegrationStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle }
> = {
  active: {
    label: 'Connected',
    variant: 'default',
    icon: CheckCircle,
  },
  expired: {
    label: 'Expired',
    variant: 'destructive',
    icon: XCircle,
  },
  revoked: {
    label: 'Revoked',
    variant: 'destructive',
    icon: XCircle,
  },
  needs_reauth: {
    label: 'Needs Reauth',
    variant: 'secondary',
    icon: AlertCircle,
  },
}

export function IntegrationStatusBadge({
  status,
  showIcon = true,
  size = 'md',
}: IntegrationStatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon

  return (
    <Badge variant={config.variant} className={size === 'sm' ? 'text-xs px-1.5 py-0' : ''}>
      {showIcon && <Icon className={size === 'sm' ? 'h-3 w-3 mr-1' : 'h-3.5 w-3.5 mr-1'} />}
      {config.label}
    </Badge>
  )
}

interface IntegrationComingSoonBadgeProps {
  size?: 'sm' | 'md'
}

export function IntegrationComingSoonBadge({ size = 'md' }: IntegrationComingSoonBadgeProps) {
  return (
    <Badge variant="outline" className={size === 'sm' ? 'text-xs px-1.5 py-0' : ''}>
      Coming Soon
    </Badge>
  )
}

interface IntegrationBetaBadgeProps {
  size?: 'sm' | 'md'
}

export function IntegrationBetaBadge({ size = 'md' }: IntegrationBetaBadgeProps) {
  return (
    <Badge variant="secondary" className={size === 'sm' ? 'text-xs px-1.5 py-0' : ''}>
      Beta
    </Badge>
  )
}
