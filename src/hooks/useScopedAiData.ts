import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { convex } from '@/lib/convex'
import { useAuth } from '@/contexts/AuthContext'
import { getAiUsageHistoryCacheKey, getWalletSummaryCacheKey } from '@/lib/queryCacheKeys'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'
import { useCachedQuery, useQueryCache } from '@/stores/useQueryCache'

interface UseScopedAiDataOptions {
  route?: string
  startDate: number
  endDate: number
}

const AI_USAGE_HISTORY_CACHE_MAX_AGE_MS = 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

type UsageRange = '7d' | '30d' | '90d'

function getUtcDayStart(value: number): number {
  const date = new Date(value)
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  )
}

function getUsageDateRange(range: UsageRange = '30d'): {
  startDate: number
  endDate: number
} {
  const usageDaysToShow = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const currentDayStart = getUtcDayStart(Date.now())
  return {
    startDate: currentDayStart - (usageDaysToShow - 1) * DAY_MS,
    endDate: currentDayStart + DAY_MS - 1,
  }
}

export async function prewarmAiSettingsData(args: {
  organizationId?: Id<'organizations'> | null
  userId?: Id<'users'> | null
  range?: UsageRange
}): Promise<void> {
  if (!args.organizationId || !args.userId || !convex) return

  const { startDate, endDate } = getUsageDateRange(args.range)
  const walletCacheKey = getWalletSummaryCacheKey(args.organizationId, args.userId)
  const dailyHistoryCacheKey = getAiUsageHistoryCacheKey(
    'daily',
    args.organizationId,
    startDate,
    endDate,
  )
  const detailedHistoryCacheKey = getAiUsageHistoryCacheKey(
    'detailed',
    args.organizationId,
    startDate,
    endDate,
  )

  const queryCache = useQueryCache.getState()
  const pendingQueries: Array<Promise<void>> = []

  if (queryCache.get(walletCacheKey) === undefined) {
    pendingQueries.push(
      convex
        .query(api.aiWallets.getWalletForViewer, {
          organizationId: args.organizationId,
          userId: args.userId,
        })
        .then((walletSummary) => {
          if (walletSummary !== undefined) {
            useQueryCache.getState().set(walletCacheKey, walletSummary)
          }
        }),
    )
  }

  if (queryCache.get(dailyHistoryCacheKey, AI_USAGE_HISTORY_CACHE_MAX_AGE_MS) === undefined) {
    pendingQueries.push(
      convex
        .query(api.aiUsage.getDailyHistory, {
          organizationId: args.organizationId,
          startDate,
          endDate,
        })
        .then((dailyHistory) => {
          if (dailyHistory !== undefined) {
            useQueryCache.getState().set(dailyHistoryCacheKey, dailyHistory)
          }
        }),
    )
  }

  if (queryCache.get(detailedHistoryCacheKey, AI_USAGE_HISTORY_CACHE_MAX_AGE_MS) === undefined) {
    pendingQueries.push(
      convex
        .query(api.aiUsage.getDetailedHistory, {
          organizationId: args.organizationId,
          startDate,
          endDate,
        })
        .then((detailedHistory) => {
          if (detailedHistory !== undefined) {
            useQueryCache.getState().set(detailedHistoryCacheKey, detailedHistory)
          }
        }),
    )
  }

  if (pendingQueries.length === 0) return
  await Promise.allSettled(pendingQueries)
}

export function useScopedAiData(options: UseScopedAiDataOptions) {
  const settingsPage = useScopedSettingsPage({
    route: options.route,
    surfaceId: 'ai',
  })
  const {
    user,
    logout,
    convexUserId,
    accessToken,
  } = useAuth()
  const scopedOrganizationId = settingsPage.resolvedScope.scopedOrganizationId
  const workspaceScoped = settingsPage.workspaceScoped
  const {
    convexOrg,
  } = settingsPage.workspaceAccess
  const canViewWorkspaceAiPage = !settingsPage.isWorkspaceAccessDenied

  const freshWalletSummary = useQuery(
    api.aiWallets.getWalletForViewer,
    convexOrg?._id && convexUserId && canViewWorkspaceAiPage
      ? { organizationId: convexOrg._id, userId: convexUserId }
      : 'skip',
  )
  const walletSummary = useCachedQuery(
    getWalletSummaryCacheKey(convexOrg?._id, convexUserId),
    freshWalletSummary,
  )

  const usageArgs =
    convexOrg?._id && canViewWorkspaceAiPage
      ? {
          organizationId: convexOrg._id,
          startDate: options.startDate,
          endDate: options.endDate,
        }
      : 'skip'

  const freshDailyUsageHistory = useQuery(
    api.aiUsage.getDailyHistory,
    usageArgs,
  )
  const dailyUsageHistory = useCachedQuery(
    getAiUsageHistoryCacheKey(
      'daily',
      convexOrg?._id,
      usageArgs === 'skip' ? null : usageArgs.startDate,
      usageArgs === 'skip' ? null : usageArgs.endDate,
    ),
    freshDailyUsageHistory,
    AI_USAGE_HISTORY_CACHE_MAX_AGE_MS,
  )

  const freshDetailedUsageHistory = useQuery(
    api.aiUsage.getDetailedHistory,
    usageArgs,
  )
  const detailedUsageHistory = useCachedQuery(
    getAiUsageHistoryCacheKey(
      'detailed',
      convexOrg?._id,
      usageArgs === 'skip' ? null : usageArgs.startDate,
      usageArgs === 'skip' ? null : usageArgs.endDate,
    ),
    freshDetailedUsageHistory,
    AI_USAGE_HISTORY_CACHE_MAX_AGE_MS,
  )

  return {
    settingsPage,
    user,
    logout,
    convexUserId,
    accessToken,
    scopedOrganizationId,
    workspaceScoped,
    convexOrg,
    canViewWorkspaceAiPage,
    walletSummary,
    dailyUsageHistory,
    detailedUsageHistory,
    isDailyUsageHistoryLoading:
      usageArgs !== 'skip' && freshDailyUsageHistory === undefined && dailyUsageHistory === undefined,
    isDetailedUsageHistoryLoading:
      usageArgs !== 'skip' && freshDetailedUsageHistory === undefined && detailedUsageHistory === undefined,
  }
}
