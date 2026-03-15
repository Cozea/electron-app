import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'
import { getSettingsSurfaceRoute } from '@/lib/settings/settingsRegistry'

interface UseScopedBillingDataOptions {
  route?: string
}

const WORKSPACE_BILLING_ROUTE =
  getSettingsSurfaceRoute('billing', 'workspace') ?? '/workspace/billing'
const PERSONAL_BILLING_ROUTE =
  getSettingsSurfaceRoute('billing', 'personal') ?? '/settings/billing'

export function useScopedBillingData(options: UseScopedBillingDataOptions = {}) {
  const settingsPage = useScopedSettingsPage({
    route: options.route,
    surfaceId: 'billing',
  })
  const {
    user,
    logout,
    convexUserId,
    accessToken,
  } = useAuth()
  const {
    convexOrg,
    canManageWorkspaceBilling,
  } = settingsPage.workspaceAccess
  const scopedWorkspace = settingsPage.resolvedScope.scopedWorkspace
  const workspaceScoped = settingsPage.workspaceScoped
  const billingOrganizationId = scopedWorkspace?.organizationId ?? null
  const canLoadWorkspaceBillingData = !settingsPage.isWorkspaceAccessDenied
  const billingRoute =
    settingsPage.surface?.routes[settingsPage.scopeKind] ??
    (workspaceScoped ? WORKSPACE_BILLING_ROUTE : PERSONAL_BILLING_ROUTE)

  const members = useQuery(
    api.organizations.getMembers,
    convexOrg?._id && canLoadWorkspaceBillingData ? { orgId: convexOrg._id } : 'skip',
  )

  const billingViewerArgs =
    convexOrg?._id &&
    convexUserId &&
    canLoadWorkspaceBillingData &&
    settingsPage.workspaceAccess.memberAccess !== undefined &&
    settingsPage.workspaceAccess.memberAccess !== null
      ? { organizationId: convexOrg._id, userId: convexUserId }
      : 'skip'

  const seatManagement = useQuery(
    api.billing.getSeatManagement,
    billingViewerArgs,
  )

  const walletSummary = useQuery(
    api.aiWallets.getWalletForViewer,
    billingViewerArgs,
  )

  const seatWallets = useQuery(
    api.aiWallets.getSeatWalletsForViewer,
    billingViewerArgs,
  )

  return {
    settingsPage,
    user,
    logout,
    convexUserId,
    accessToken,
    convexOrg,
    scopedWorkspace,
    workspaceScoped,
    canManageWorkspaceBilling,
    billingOrganizationId,
    canLoadWorkspaceBillingData,
    billingRoute,
    members,
    seatManagement,
    walletSummary,
    seatWallets,
  }
}
