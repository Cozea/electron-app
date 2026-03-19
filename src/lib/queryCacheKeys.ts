export function getSeatManagementCacheKey(
  organizationId?: string | null,
  userId?: string | null
): string {
  return `seat-management-${organizationId ?? 'none'}-${userId ?? 'none'}`
}

export function getWalletSummaryCacheKey(
  organizationId?: string | null,
  userId?: string | null
): string {
  return `wallet-summary-${organizationId ?? 'none'}-${userId ?? 'none'}`
}

export function getSeatWalletsCacheKey(
  organizationId?: string | null,
  userId?: string | null
): string {
  return `seat-wallets-${organizationId ?? 'none'}-${userId ?? 'none'}`
}

export function getUsageSummaryCacheKey(
  organizationId?: string | null,
  period: 'daily' | 'monthly' = 'monthly'
): string {
  return `usage-summary-${organizationId ?? 'none'}-${period}`
}

export function getUsageLimitsCacheKey(
  organizationId?: string | null
): string {
  return `usage-limits-${organizationId ?? 'none'}`
}

export function getAiUsageHistoryCacheKey(
  kind: 'daily' | 'detailed',
  organizationId?: string | null,
  startDate?: number | null,
  endDate?: number | null
): string {
  return `ai-usage-history-${kind}-${organizationId ?? 'none'}-${startDate ?? 'none'}-${endDate ?? 'none'}`
}
