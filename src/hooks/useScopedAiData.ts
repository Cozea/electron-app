import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'

interface UseScopedAiDataOptions {
  route?: string
  startDate: number
  endDate: number
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

  const walletSummary = useQuery(
    api.aiWallets.getWalletForViewer,
    convexOrg?._id && convexUserId && canViewWorkspaceAiPage
      ? { organizationId: convexOrg._id, userId: convexUserId }
      : 'skip',
  )

  const usageArgs =
    convexOrg?._id && canViewWorkspaceAiPage
      ? {
          organizationId: convexOrg._id,
          startDate: options.startDate,
          endDate: options.endDate,
        }
      : 'skip'

  const dailyUsageHistory = useQuery(
    api.aiUsage.getDailyHistory,
    usageArgs,
  )

  const detailedUsageHistory = useQuery(
    api.aiUsage.getDetailedHistory,
    usageArgs,
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
  }
}
